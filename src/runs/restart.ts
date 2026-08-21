import { resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { CommandRunner } from "../core/command-runner.js";
import type { RunRecord } from "./types.js";

export type RestartRefusalReason =
  | "not_repository"
  | "worktree_mismatch"
  | "status_unknown"
  | "worktree_dirty";

export class RestartRefusedError extends Error {
  constructor(
    readonly reason: RestartRefusalReason,
    message: string
  ) {
    super(message);
    this.name = "RestartRefusedError";
  }
}

export interface RestartInspectionOptions {
  record: RunRecord;
  runner: CommandRunner;
  timeoutMs: number;
}

export async function assertSafeRestartWorktree(
  options: RestartInspectionOptions
): Promise<void> {
  const runGit = async (args: string[]) =>
    await options.runner.run({
      command: "git",
      args,
      cwd: options.record.worktreePath,
      timeoutMs: options.timeoutMs
    });
  const rootResult = await runGit(["rev-parse", "--show-toplevel"]);
  if (rootResult.exitCode !== 0 || !rootResult.stdout.trim()) {
    throw new RestartRefusedError(
      "not_repository",
      "Automatic restart requires a verifiable Git worktree"
    );
  }
  const canonicalPath = async (path: string): Promise<string> => {
    try {
      return await realpath(path);
    } catch {
      return resolve(path);
    }
  };
  if (
    (await canonicalPath(rootResult.stdout.trim())) !==
    (await canonicalPath(options.record.worktreePath))
  ) {
    throw new RestartRefusedError(
      "worktree_mismatch",
      "The recorded worktree path no longer matches the Git worktree root"
    );
  }

  const statusResult = await runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=normal"
  ]);
  if (
    statusResult.exitCode !== 0 ||
    statusResult.termination.cause !== "exited"
  ) {
    throw new RestartRefusedError(
      "status_unknown",
      "Switchyard could not determine the worktree state"
    );
  }
  if (statusResult.stdout.trim()) {
    throw new RestartRefusedError(
      "worktree_dirty",
      "Automatic restart is refused because the worktree has uncommitted changes"
    );
  }
}
