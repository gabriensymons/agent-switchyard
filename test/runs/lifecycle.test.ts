import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SpawnCommandRunner } from "../../src/core/command-runner.js";
import type { LiveProbeReport } from "../../src/probes/types.js";
import { RunLifecycle } from "../../src/runs/lifecycle.js";
import { RunStore } from "../../src/runs/store.js";
import {
  createRunRecord,
  transitionCurrentAttempt
} from "../../src/runs/types.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchyard-lifecycle-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => await rm(root, {
      recursive: true,
      force: true
    }))
  );
});

function clock(): () => Date {
  let milliseconds = Date.parse("2026-08-21T00:00:00.000Z");
  return () => {
    const value = new Date(milliseconds);
    milliseconds += 1_000;
    return value;
  };
}

function report(
  state: LiveProbeReport["state"],
  options: { provider?: "codex" | "claude"; identityId?: string } = {}
): LiveProbeReport {
  const cause =
    state === "cancelled"
      ? "cancelled"
      : state === "timed_out"
        ? "timed_out"
        : state === "interrupted"
          ? "interrupted"
          : "exited";
  return {
    schemaVersion: 1,
    provider: options.provider ?? "codex",
    identityId: options.identityId ?? "codex-isolated",
    state,
    generatedAt: "2026-08-21T00:00:02.000Z",
    durationMs: 1_000,
    exitCode: state === "completed" ? 0 : null,
    signal: state === "cancelled" ? "SIGTERM" : null,
    termination: {
      cause,
      requestedSignal: state === "cancelled" ? "SIGTERM" : null,
      forced: false,
      processGroup: true
    },
    eventCount: 0,
    eventTypes: {},
    expectedMarkerObserved: state === "completed",
    usage: null,
    diagnostics: []
  };
}

function cleanGitRunner(status = ""): FakeCommandRunner {
  return new FakeCommandRunner(
    new Map([
      [
        commandKey("git", ["rev-parse", "--show-toplevel"]),
        commandResult({ stdout: "/repo\n" })
      ],
      [
        commandKey("git", [
          "status",
          "--porcelain=v1",
          "--untracked-files=normal"
        ]),
        commandResult({ stdout: status })
      ]
    ])
  );
}

describe("RunLifecycle", () => {
  it("persists cancellation evidence and a sanitized handoff", async () => {
    const stateRoot = await temporaryRoot();
    const lifecycle = new RunLifecycle({
      stateRoot,
      runner: cleanGitRunner(),
      now: clock()
    });

    const result = await lifecycle.start({
      runId: "run-1",
      attemptId: "attempt-1",
      provider: "codex",
      identityId: "codex-isolated",
      repositoryPath: "/repo",
      worktreePath: "/repo",
      execute: async () => report("cancelled")
    });
    const persisted = await new RunStore(stateRoot).load("run-1");
    const serialized = await readFile(
      join(stateRoot, "runs", "run-1.json"),
      "utf8"
    );

    expect(result.record).toEqual(persisted);
    expect(persisted).toMatchObject({
      state: "cancelled",
      attempts: [
        {
          state: "cancelled",
          handoffPath: join(
            stateRoot,
            "handoffs",
            "run-1",
            "attempt-1.md"
          ),
          exitEvidence: {
            completionEvidence: false,
            termination: { cause: "cancelled" }
          }
        }
      ]
    });
    expect(serialized).not.toMatch(
      /transcript|sessionId|accountId|threadId/iu
    );
  });

  it("restarts as a fresh linked attempt after a clean worktree check", async () => {
    const stateRoot = await temporaryRoot();
    const lifecycle = new RunLifecycle({
      stateRoot,
      runner: cleanGitRunner(),
      now: clock()
    });
    await lifecycle.start({
      runId: "run-1",
      attemptId: "attempt-1",
      provider: "codex",
      identityId: "codex-isolated",
      repositoryPath: "/repo",
      worktreePath: "/repo",
      execute: async () => report("cancelled")
    });

    const restarted = await lifecycle.restart({
      runId: "run-1",
      attemptId: "attempt-2",
      worktreeCheckTimeoutMs: 1_000,
      execute: async () => report("completed")
    });

    expect(restarted.record).toMatchObject({
      state: "completed",
      currentAttemptId: "attempt-2",
      identityId: "codex-isolated",
      attempts: [
        { attemptId: "attempt-1", state: "cancelled" },
        {
          attemptId: "attempt-2",
          priorAttemptId: "attempt-1",
          state: "completed",
          exitEvidence: { completionEvidence: true }
        }
      ]
    });
  });

  it("performs a fresh restart against a real clean Git worktree", async () => {
    const stateRoot = await temporaryRoot();
    const worktreePath = await temporaryRoot();
    const runner = new SpawnCommandRunner();
    const initialized = await runner.run({
      command: "git",
      args: ["init", "--quiet"],
      cwd: worktreePath,
      timeoutMs: 5_000
    });
    expect(initialized.exitCode).toBe(0);
    const lifecycle = new RunLifecycle({
      stateRoot,
      runner,
      now: clock()
    });
    await lifecycle.start({
      runId: "run-1",
      attemptId: "attempt-1",
      provider: "codex",
      identityId: "codex-isolated",
      repositoryPath: worktreePath,
      worktreePath,
      execute: async () => report("cancelled")
    });

    const restarted = await lifecycle.restart({
      runId: "run-1",
      attemptId: "attempt-2",
      worktreeCheckTimeoutMs: 5_000,
      execute: async () => report("completed")
    });

    expect(restarted.record).toMatchObject({
      state: "completed",
      attempts: [
        { state: "cancelled" },
        { state: "completed", priorAttemptId: "attempt-1" }
      ]
    });
  });

  it("recovers a running attempt as interrupted before restart", async () => {
    const stateRoot = await temporaryRoot();
    const store = new RunStore(stateRoot);
    let running = createRunRecord({
      runId: "run-1",
      attemptId: "attempt-1",
      provider: "claude",
      identityId: "claude-subscription",
      repositoryPath: "/repo",
      worktreePath: "/repo",
      at: "2026-08-21T00:00:00.000Z"
    });
    running = transitionCurrentAttempt(running, {
      to: "running",
      at: "2026-08-21T00:00:01.000Z",
      reason: "dispatched"
    });
    await store.save(running);
    const lifecycle = new RunLifecycle({
      stateRoot,
      store,
      runner: cleanGitRunner(),
      now: clock()
    });

    const restarted = await lifecycle.restart({
      runId: "run-1",
      attemptId: "attempt-2",
      worktreeCheckTimeoutMs: 1_000,
      execute: async () =>
        report("completed", {
          provider: "claude",
          identityId: "claude-subscription"
        })
    });

    expect(restarted.record.attempts).toMatchObject([
      {
        attemptId: "attempt-1",
        state: "interrupted",
        handoffPath: expect.stringContaining("attempt-1.md")
      },
      {
        attemptId: "attempt-2",
        state: "completed",
        priorAttemptId: "attempt-1"
      }
    ]);
  });

  it("refuses restart without changing history when the worktree is dirty", async () => {
    const stateRoot = await temporaryRoot();
    const lifecycle = new RunLifecycle({
      stateRoot,
      runner: cleanGitRunner(" M src/index.ts\n"),
      now: clock()
    });
    await lifecycle.start({
      runId: "run-1",
      attemptId: "attempt-1",
      provider: "codex",
      identityId: "codex-isolated",
      repositoryPath: "/repo",
      worktreePath: "/repo",
      execute: async () => report("cancelled")
    });

    await expect(
      lifecycle.restart({
        runId: "run-1",
        attemptId: "attempt-2",
        worktreeCheckTimeoutMs: 1_000,
        execute: async () => report("completed")
      })
    ).rejects.toMatchObject({
      reason: "worktree_dirty"
    });
    expect((await new RunStore(stateRoot).load("run-1")).attempts).toHaveLength(
      1
    );
  });

  it("leaves a mismatched provider report running for recovery", async () => {
    const stateRoot = await temporaryRoot();
    const lifecycle = new RunLifecycle({
      stateRoot,
      runner: cleanGitRunner(),
      now: clock()
    });

    await expect(
      lifecycle.start({
        runId: "run-1",
        attemptId: "attempt-1",
        provider: "codex",
        identityId: "codex-isolated",
        repositoryPath: "/repo",
        worktreePath: "/repo",
        execute: async () =>
          report("completed", {
            identityId: "codex-default"
          })
      })
    ).rejects.toThrow(/identity does not match/u);
    expect((await new RunStore(stateRoot).load("run-1")).state).toBe(
      "running"
    );
  });
});
