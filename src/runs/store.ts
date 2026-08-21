import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  interruptedExitEvidence,
  runRecordSchema,
  transitionCurrentAttempt,
  type RunRecord
} from "./types.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

function safeRunId(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Unsafe run identifier: ${runId}`);
  }
  return runId;
}

export class RunStore {
  readonly runsDirectory: string;

  constructor(stateRoot: string) {
    this.runsDirectory = resolve(stateRoot, "runs");
  }

  private pathFor(runId: string): string {
    return join(this.runsDirectory, `${safeRunId(runId)}.json`);
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.runsDirectory, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE
    });
    await chmod(this.runsDirectory, PRIVATE_DIRECTORY_MODE);
  }

  async save(record: RunRecord): Promise<void> {
    const parsed = runRecordSchema.parse(record);
    await this.prepareDirectory();
    const target = this.pathFor(parsed.runId);
    const temporary = join(
      this.runsDirectory,
      `.${parsed.runId}.${process.pid}.${randomUUID()}.tmp`
    );
    try {
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: "utf8",
        mode: PRIVATE_FILE_MODE,
        flag: "wx"
      });
      await rename(temporary, target);
      await chmod(target, PRIVATE_FILE_MODE);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async load(runId: string): Promise<RunRecord> {
    const serialized = await readFile(this.pathFor(runId), "utf8");
    return runRecordSchema.parse(JSON.parse(serialized) as unknown);
  }

  async recoverInterrupted(runId: string, at: string): Promise<RunRecord> {
    const record = await this.load(runId);
    if (record.state !== "running") return record;
    const recovered = transitionCurrentAttempt(record, {
      to: "interrupted",
      at,
      reason: "process_interruption",
      exitEvidence: interruptedExitEvidence()
    });
    await this.save(recovered);
    return recovered;
  }
}
