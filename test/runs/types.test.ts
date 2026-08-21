import { describe, expect, it } from "vitest";
import {
  createRestartAttempt,
  createRunRecord,
  transitionCurrentAttempt,
  type ExitEvidence,
  type RunRecord,
  type RunState,
  type TransitionAttemptInput
} from "../../src/runs/types.js";

const states: RunState[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "timed_out"
];

const legal: Readonly<Record<RunState, readonly RunState[]>> = {
  queued: ["running", "cancelled"],
  running: [
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "timed_out"
  ],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
  timed_out: []
};

function evidence(
  cause: ExitEvidence["termination"]["cause"],
  options: { exitCode?: number | null; completion?: boolean } = {}
): ExitEvidence {
  return {
    exitCode: options.exitCode ?? null,
    signal:
      cause === "cancelled"
        ? "SIGTERM"
        : cause === "timed_out"
          ? "SIGKILL"
          : null,
    termination: {
      cause,
      requestedSignal:
        cause === "cancelled" || cause === "timed_out" ? "SIGTERM" : null,
      forced: cause === "timed_out",
      processGroup: true
    },
    completionEvidence: options.completion ?? false
  };
}

function transitionInput(to: RunState): TransitionAttemptInput {
  switch (to) {
    case "queued":
      return { to, at: "2026-08-21T00:00:03.000Z", reason: "created" };
    case "running":
      return { to, at: "2026-08-21T00:00:03.000Z", reason: "dispatched" };
    case "completed":
      return {
        to,
        at: "2026-08-21T00:00:03.000Z",
        reason: "completion_evidence",
        exitEvidence: evidence("exited", { exitCode: 0, completion: true })
      };
    case "failed":
      return {
        to,
        at: "2026-08-21T00:00:03.000Z",
        reason: "provider_failure",
        exitEvidence: evidence("exited", { exitCode: 1 })
      };
    case "cancelled":
      return {
        to,
        at: "2026-08-21T00:00:03.000Z",
        reason: "operator_cancelled",
        exitEvidence: evidence("cancelled")
      };
    case "interrupted":
      return {
        to,
        at: "2026-08-21T00:00:03.000Z",
        reason: "process_interruption",
        exitEvidence: evidence("interrupted")
      };
    case "timed_out":
      return {
        to,
        at: "2026-08-21T00:00:03.000Z",
        reason: "deadline",
        exitEvidence: evidence("timed_out")
      };
  }
}

function recordIn(state: RunState): RunRecord {
  let record = createRunRecord({
    runId: "run-1",
    attemptId: "attempt-1",
    provider: "codex",
    identityId: "codex-isolated",
    repositoryPath: "/repo",
    worktreePath: "/repo",
    at: "2026-08-21T00:00:00.000Z"
  });
  if (state === "queued") return record;
  record = transitionCurrentAttempt(record, {
    to: "running",
    at: "2026-08-21T00:00:01.000Z",
    reason: "dispatched"
  });
  if (state === "running") return record;
  return transitionCurrentAttempt(record, transitionInput(state));
}

describe("run state transitions", () => {
  for (const from of states) {
    for (const to of states) {
      const allowed = legal[from].includes(to);
      it(`${allowed ? "allows" : "rejects"} ${from} -> ${to}`, () => {
        const operation = () =>
          transitionCurrentAttempt(recordIn(from), transitionInput(to));
        if (allowed) {
          expect(operation().state).toBe(to);
        } else {
          expect(operation).toThrow(/Illegal run transition/u);
        }
      });
    }
  }

  it("requires deterministic successful evidence for completion", () => {
    const running = recordIn("running");
    expect(() =>
      transitionCurrentAttempt(running, {
        to: "completed",
        at: "2026-08-21T00:00:04.000Z",
        reason: "completion_evidence",
        exitEvidence: evidence("exited", {
          exitCode: 0,
          completion: false
        })
      })
    ).toThrow(/completion evidence/u);
  });

  it("creates a linked restart attempt without rewriting history", () => {
    const cancelled = transitionCurrentAttempt(recordIn("running"), {
      ...transitionInput("cancelled"),
      at: "2026-08-21T00:00:04.000Z"
    });
    cancelled.attempts[0] = {
      ...cancelled.attempts[0]!,
      handoffPath: "/state/handoffs/run-1/attempt-1.md"
    };

    const restarted = createRestartAttempt(cancelled, {
      attemptId: "attempt-2",
      at: "2026-08-21T00:00:05.000Z"
    });

    expect(restarted).toMatchObject({
      state: "queued",
      currentAttemptId: "attempt-2",
      attempts: [
        { attemptId: "attempt-1", state: "cancelled" },
        {
          attemptId: "attempt-2",
          state: "queued",
          priorAttemptId: "attempt-1",
          handoffPath: "/state/handoffs/run-1/attempt-1.md"
        }
      ]
    });
  });
});
