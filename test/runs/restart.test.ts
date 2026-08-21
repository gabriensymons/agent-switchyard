import { describe, expect, it } from "vitest";
import {
  assertSafeRestartWorktree
} from "../../src/runs/restart.js";
import {
  createRunRecord,
  transitionCurrentAttempt
} from "../../src/runs/types.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

function record() {
  return createRunRecord({
    runId: "run-1",
    attemptId: "attempt-1",
    provider: "codex",
    identityId: "codex-default",
    repositoryPath: "/repo",
    worktreePath: "/repo",
    at: "2026-08-21T00:00:00.000Z"
  });
}

function runner(options: {
  root?: string;
  rootExitCode?: number;
  status?: string;
  statusExitCode?: number;
}) {
  return new FakeCommandRunner(
    new Map([
      [
        commandKey("git", ["rev-parse", "--show-toplevel"]),
        commandResult({
          exitCode: options.rootExitCode ?? 0,
          stdout: options.root ?? "/repo\n"
        })
      ],
      [
        commandKey("git", [
          "status",
          "--porcelain=v1",
          "--untracked-files=normal"
        ]),
        commandResult({
          exitCode: options.statusExitCode ?? 0,
          stdout: options.status ?? ""
        })
      ]
    ])
  );
}

describe("assertSafeRestartWorktree", () => {
  it("accepts a clean, matching Git worktree", async () => {
    await expect(
      assertSafeRestartWorktree({
        record: record(),
        runner: runner({}),
        timeoutMs: 1_000
      })
    ).resolves.toBeUndefined();
  });

  it("refuses a dirty worktree", async () => {
    await expect(
      assertSafeRestartWorktree({
        record: record(),
        runner: runner({ status: " M src/index.ts\n" }),
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({
      reason: "worktree_dirty"
    });
  });

  it("refuses a path that no longer names the worktree root", async () => {
    await expect(
      assertSafeRestartWorktree({
        record: record(),
        runner: runner({ root: "/other\n" }),
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({
      reason: "worktree_mismatch"
    });
  });

  it("refuses an unknown Git status", async () => {
    await expect(
      assertSafeRestartWorktree({
        record: record(),
        runner: runner({ statusExitCode: 1 }),
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({
      reason: "status_unknown"
    });
  });

  it("refuses a non-repository without attempting a restart", async () => {
    const fake = runner({ rootExitCode: 1, root: "" });
    await expect(
      assertSafeRestartWorktree({
        record: transitionCurrentAttempt(record(), {
          to: "cancelled",
          at: "2026-08-21T00:00:01.000Z",
          reason: "operator_cancelled",
          exitEvidence: {
            exitCode: null,
            signal: null,
            termination: {
              cause: "cancelled",
              requestedSignal: null,
              forced: false,
              processGroup: false
            },
            completionEvidence: false
          }
        }),
        runner: fake,
        timeoutMs: 1_000
      })
    ).rejects.toMatchObject({
      reason: "not_repository"
    });
    expect(fake.calls).toHaveLength(1);
  });
});
