import { z } from "zod";
import { resolve } from "node:path";
import type { CommandTermination } from "../core/command-runner.js";

export const runStateSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "timed_out"
]);
export type RunState = z.infer<typeof runStateSchema>;

export const terminalRunStates = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "timed_out"
] as const satisfies readonly RunState[];

export type TerminalRunState = (typeof terminalRunStates)[number];

export const runTransitionReasonSchema = z.enum([
  "created",
  "dispatched",
  "completion_evidence",
  "provider_failure",
  "operator_cancelled",
  "deadline",
  "process_interruption",
  "switchyard_restart"
]);
export type RunTransitionReason = z.infer<
  typeof runTransitionReasonSchema
>;

const commandTerminationSchema = z
  .object({
    cause: z.enum([
      "exited",
      "cancelled",
      "timed_out",
      "interrupted",
      "spawn_error"
    ]),
    requestedSignal: z.string().nullable(),
    forced: z.boolean(),
    processGroup: z.boolean()
  })
  .strict();

export const exitEvidenceSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    errorCode: z.string().optional(),
    termination: commandTerminationSchema,
    completionEvidence: z.boolean()
  })
  .strict();
export type ExitEvidence = z.infer<typeof exitEvidenceSchema>;

export const runTransitionSchema = z
  .object({
    from: runStateSchema.nullable(),
    to: runStateSchema,
    at: z.string(),
    reason: runTransitionReasonSchema
  })
  .strict();
export type RunTransition = z.infer<typeof runTransitionSchema>;

export const runAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    ordinal: z.number().int().positive(),
    state: runStateSchema,
    createdAt: z.string(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    priorAttemptId: z.string().optional(),
    handoffPath: z.string().optional(),
    exitEvidence: exitEvidenceSchema.optional(),
    transitions: z.array(runTransitionSchema).min(1)
  })
  .strict()
  .superRefine((attempt, context) => {
    const lastTransition = attempt.transitions.at(-1);
    if (lastTransition?.to !== attempt.state) {
      context.addIssue({
        code: "custom",
        path: ["transitions"],
        message: "Last transition must match the attempt state"
      });
    }
    const terminal = terminalRunStates.includes(
      attempt.state as TerminalRunState
    );
    if (terminal && (!attempt.finishedAt || !attempt.exitEvidence)) {
      context.addIssue({
        code: "custom",
        message: "Terminal attempts require finishedAt and exitEvidence"
      });
    }
    if (!terminal && (attempt.finishedAt || attempt.exitEvidence)) {
      context.addIssue({
        code: "custom",
        message: "Non-terminal attempts cannot contain terminal evidence"
      });
    }
    if (attempt.state === "running" && !attempt.startedAt) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Running attempts require startedAt"
      });
    }
  });
export type RunAttempt = z.infer<typeof runAttemptSchema>;

export const runRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    provider: z.enum(["codex", "claude"]),
    identityId: z.string().min(1),
    repositoryPath: z.string().min(1),
    worktreePath: z.string().min(1),
    state: runStateSchema,
    currentAttemptId: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
    attempts: z.array(runAttemptSchema).min(1)
  })
  .strict()
  .superRefine((record, context) => {
    const current = record.attempts.find(
      (attempt) => attempt.attemptId === record.currentAttemptId
    );
    if (!current) {
      context.addIssue({
        code: "custom",
        path: ["currentAttemptId"],
        message: "Current attempt must exist in the run"
      });
    } else if (current.state !== record.state) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Run state must match the current attempt state"
      });
    }
  });
export type RunRecord = z.infer<typeof runRecordSchema>;

export interface CreateRunRecordInput {
  runId: string;
  attemptId: string;
  provider: RunRecord["provider"];
  identityId: string;
  repositoryPath: string;
  worktreePath: string;
  at: string;
}

const legalTransitions: Readonly<Record<RunState, readonly RunState[]>> = {
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

export function createRunRecord(input: CreateRunRecordInput): RunRecord {
  return {
    schemaVersion: 1,
    runId: input.runId,
    provider: input.provider,
    identityId: input.identityId,
    repositoryPath: resolve(input.repositoryPath),
    worktreePath: resolve(input.worktreePath),
    state: "queued",
    currentAttemptId: input.attemptId,
    createdAt: input.at,
    updatedAt: input.at,
    attempts: [
      {
        attemptId: input.attemptId,
        ordinal: 1,
        state: "queued",
        createdAt: input.at,
        transitions: [
          {
            from: null,
            to: "queued",
            at: input.at,
            reason: "created"
          }
        ]
      }
    ]
  };
}

export function currentRunAttempt(record: RunRecord): RunAttempt {
  const attempt = record.attempts.find(
    (candidate) => candidate.attemptId === record.currentAttemptId
  );
  if (!attempt) {
    throw new Error(
      `Run ${record.runId} does not contain current attempt ${record.currentAttemptId}`
    );
  }
  return attempt;
}

function validateTerminalEvidence(
  state: TerminalRunState,
  evidence: ExitEvidence
): void {
  if (
    state === "completed" &&
    (!evidence.completionEvidence ||
      evidence.exitCode !== 0 ||
      evidence.termination.cause !== "exited")
  ) {
    throw new Error(
      "A completed attempt requires successful deterministic completion evidence"
    );
  }
  if (state === "cancelled" && evidence.termination.cause !== "cancelled") {
    throw new Error("A cancelled attempt requires cancellation evidence");
  }
  if (state === "timed_out" && evidence.termination.cause !== "timed_out") {
    throw new Error("A timed-out attempt requires deadline evidence");
  }
  if (state === "interrupted" && evidence.termination.cause !== "interrupted") {
    throw new Error("An interrupted attempt requires interruption evidence");
  }
}

export interface TransitionAttemptInput {
  to: RunState;
  at: string;
  reason: RunTransitionReason;
  exitEvidence?: ExitEvidence;
}

export function transitionCurrentAttempt(
  record: RunRecord,
  input: TransitionAttemptInput
): RunRecord {
  const attempt = currentRunAttempt(record);
  if (!legalTransitions[attempt.state].includes(input.to)) {
    throw new Error(
      `Illegal run transition: ${attempt.state} -> ${input.to}`
    );
  }
  const terminal = terminalRunStates.includes(
    input.to as TerminalRunState
  );
  if (terminal && !input.exitEvidence) {
    throw new Error(`Terminal state ${input.to} requires exit evidence`);
  }
  if (!terminal && input.exitEvidence) {
    throw new Error("Exit evidence is only valid for terminal states");
  }
  if (terminal) {
    validateTerminalEvidence(
      input.to as TerminalRunState,
      input.exitEvidence as ExitEvidence
    );
  }

  const updatedAttempt: RunAttempt = {
    ...attempt,
    state: input.to,
    ...(input.to === "running" ? { startedAt: input.at } : {}),
    ...(terminal ? { finishedAt: input.at } : {}),
    ...(input.exitEvidence ? { exitEvidence: input.exitEvidence } : {}),
    transitions: [
      ...attempt.transitions,
      {
        from: attempt.state,
        to: input.to,
        at: input.at,
        reason: input.reason
      }
    ]
  };

  return {
    ...record,
    state: input.to,
    updatedAt: input.at,
    attempts: record.attempts.map((candidate) =>
      candidate.attemptId === attempt.attemptId ? updatedAttempt : candidate
    )
  };
}

export function attachHandoff(
  record: RunRecord,
  handoffPath: string,
  at: string
): RunRecord {
  const attempt = currentRunAttempt(record);
  if (attempt.state !== "cancelled" && attempt.state !== "interrupted") {
    throw new Error(
      "Handoffs can only be attached to cancelled or interrupted attempts"
    );
  }
  return {
    ...record,
    updatedAt: at,
    attempts: record.attempts.map((candidate) =>
      candidate.attemptId === attempt.attemptId
        ? { ...candidate, handoffPath }
        : candidate
    )
  };
}

export interface RestartAttemptInput {
  attemptId: string;
  at: string;
}

export function createRestartAttempt(
  record: RunRecord,
  input: RestartAttemptInput
): RunRecord {
  const prior = currentRunAttempt(record);
  if (prior.state !== "cancelled" && prior.state !== "interrupted") {
    throw new Error(
      "Only cancelled or interrupted attempts can create a restart attempt"
    );
  }
  if (!prior.handoffPath) {
    throw new Error("Restart requires a persisted sanitized handoff");
  }
  if (
    record.attempts.some(
      (candidate) => candidate.attemptId === input.attemptId
    )
  ) {
    throw new Error(`Attempt already exists: ${input.attemptId}`);
  }

  const attempt: RunAttempt = {
    attemptId: input.attemptId,
    ordinal: prior.ordinal + 1,
    state: "queued",
    createdAt: input.at,
    priorAttemptId: prior.attemptId,
    handoffPath: prior.handoffPath,
    transitions: [
      {
        from: null,
        to: "queued",
        at: input.at,
        reason: "switchyard_restart"
      }
    ]
  };
  return {
    ...record,
    state: "queued",
    currentAttemptId: attempt.attemptId,
    updatedAt: input.at,
    attempts: [...record.attempts, attempt]
  };
}

export function interruptedExitEvidence(): ExitEvidence {
  const termination: CommandTermination = {
    cause: "interrupted",
    requestedSignal: null,
    forced: false,
    processGroup: false
  };
  return {
    exitCode: null,
    signal: null,
    termination,
    completionEvidence: false
  };
}
