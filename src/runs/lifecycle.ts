import type { CommandRunner } from "../core/command-runner.js";
import type { LiveProbeReport } from "../probes/types.js";
import { writeRunHandoff } from "./handoff.js";
import { assertSafeRestartWorktree } from "./restart.js";
import { RunStore } from "./store.js";
import {
  attachHandoff,
  createRestartAttempt,
  createRunRecord,
  currentRunAttempt,
  transitionCurrentAttempt,
  type ExitEvidence,
  type RunRecord,
  type RunTransitionReason
} from "./types.js";

export type ProbeAttemptExecutor = () => Promise<LiveProbeReport>;

export interface RunLifecycleOptions {
  stateRoot: string;
  runner: CommandRunner;
  now?: () => Date;
  store?: RunStore;
}

export interface StartRunInput {
  runId: string;
  attemptId: string;
  provider: RunRecord["provider"];
  identityId: string;
  repositoryPath: string;
  worktreePath: string;
  execute: ProbeAttemptExecutor;
}

export interface RestartRunInput {
  runId: string;
  attemptId: string;
  worktreeCheckTimeoutMs: number;
  execute: ProbeAttemptExecutor;
}

export interface RunExecutionResult {
  record: RunRecord;
  report: LiveProbeReport;
}

function evidenceFromReport(report: LiveProbeReport): ExitEvidence {
  return {
    exitCode: report.exitCode,
    signal: report.signal,
    termination: report.termination,
    completionEvidence:
      report.state === "completed" && report.expectedMarkerObserved
  };
}

function reasonFromReport(report: LiveProbeReport): RunTransitionReason {
  switch (report.state) {
    case "completed":
      return "completion_evidence";
    case "failed":
      return "provider_failure";
    case "cancelled":
      return "operator_cancelled";
    case "timed_out":
      return "deadline";
    case "interrupted":
      return "process_interruption";
  }
}

export class RunLifecycle {
  private readonly now: () => Date;
  private readonly store: RunStore;

  constructor(private readonly options: RunLifecycleOptions) {
    this.now = options.now ?? (() => new Date());
    this.store = options.store ?? new RunStore(options.stateRoot);
  }

  async start(input: StartRunInput): Promise<RunExecutionResult> {
    const at = this.now().toISOString();
    const record = createRunRecord({
      runId: input.runId,
      attemptId: input.attemptId,
      provider: input.provider,
      identityId: input.identityId,
      repositoryPath: input.repositoryPath,
      worktreePath: input.worktreePath,
      at
    });
    await this.store.save(record);
    return await this.execute(record, input.execute);
  }

  async restart(input: RestartRunInput): Promise<RunExecutionResult> {
    let record = await this.store.recoverInterrupted(
      input.runId,
      this.now().toISOString()
    );
    const current = currentRunAttempt(record);
    if (
      (current.state === "cancelled" || current.state === "interrupted") &&
      !current.handoffPath
    ) {
      record = await this.persistHandoff(record);
    }
    await assertSafeRestartWorktree({
      record,
      runner: this.options.runner,
      timeoutMs: input.worktreeCheckTimeoutMs
    });
    record = createRestartAttempt(record, {
      attemptId: input.attemptId,
      at: this.now().toISOString()
    });
    await this.store.save(record);
    return await this.execute(record, input.execute);
  }

  private async execute(
    queued: RunRecord,
    executor: ProbeAttemptExecutor
  ): Promise<RunExecutionResult> {
    const running = transitionCurrentAttempt(queued, {
      to: "running",
      at: this.now().toISOString(),
      reason: "dispatched"
    });
    await this.store.save(running);
    const report = await executor();
    if (
      report.provider !== running.provider ||
      report.identityId !== running.identityId
    ) {
      throw new Error(
        "Provider report identity does not match the persisted run identity"
      );
    }
    let terminal = transitionCurrentAttempt(running, {
      to: report.state,
      at: this.now().toISOString(),
      reason: reasonFromReport(report),
      exitEvidence: evidenceFromReport(report)
    });
    await this.store.save(terminal);
    if (report.state === "cancelled" || report.state === "interrupted") {
      terminal = await this.persistHandoff(terminal);
    }
    return { record: terminal, report };
  }

  private async persistHandoff(record: RunRecord): Promise<RunRecord> {
    const handoffPath = await writeRunHandoff(this.options.stateRoot, record);
    const withHandoff = attachHandoff(
      record,
      handoffPath,
      this.now().toISOString()
    );
    await this.store.save(withHandoff);
    return withHandoff;
  }
}
