import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { currentRunAttempt, type RunRecord } from "./types.js";

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

function safeId(value: string): string {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new Error(`Unsafe handoff identifier: ${value}`);
  }
  return value;
}

export function renderRunHandoff(record: RunRecord): string {
  const attempt = currentRunAttempt(record);
  if (attempt.state !== "cancelled" && attempt.state !== "interrupted") {
    throw new Error(
      "A continuation handoff requires a cancelled or interrupted attempt"
    );
  }
  const evidence = attempt.exitEvidence;
  if (!evidence || !attempt.finishedAt) {
    throw new Error("A continuation handoff requires terminal exit evidence");
  }

  return [
    "# Agent Switchyard run handoff",
    "",
    "This sanitized handoff contains lifecycle metadata only. It contains no provider transcript, prompt, session identifier, account identifier, or credential material.",
    "",
    `- Run: ${record.runId}`,
    `- Attempt: ${attempt.attemptId}`,
    `- State: ${attempt.state}`,
    `- Provider identity: ${record.identityId} (${record.provider})`,
    `- Repository: ${record.repositoryPath}`,
    `- Worktree: ${record.worktreePath}`,
    `- Started: ${attempt.startedAt ?? "not started"}`,
    `- Stopped: ${attempt.finishedAt}`,
    `- Exit code: ${evidence.exitCode ?? "none"}`,
    `- Exit signal: ${evidence.signal ?? "none"}`,
    `- Termination cause: ${evidence.termination.cause}`,
    `- Forced termination: ${evidence.termination.forced ? "yes" : "no"}`,
    "",
    "## Next safe action",
    "",
    "Inspect the recorded worktree state. Start a new linked attempt only after Switchyard confirms the worktree is unambiguous. Do not infer provider completion from this attempt.",
    ""
  ].join("\n");
}

export async function writeRunHandoff(
  stateRoot: string,
  record: RunRecord
): Promise<string> {
  const attempt = currentRunAttempt(record);
  const directory = resolve(
    stateRoot,
    "handoffs",
    safeId(record.runId)
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const target = join(directory, `${safeId(attempt.attemptId)}.md`);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, renderRunHandoff(record), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return target;
}
