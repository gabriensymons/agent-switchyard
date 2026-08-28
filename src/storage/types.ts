import type { RepositoryPolicySnapshot } from "../repositories/policy.js";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface VersionedJsonObject {
  schemaVersion: number;
  [key: string]: JsonValue;
}

export const taskStates = [
  "ingested",
  "ready",
  "preparing",
  "running",
  "verifying",
  "review",
  "needs_human",
  "failed",
  "cancelled",
  "interrupted"
] as const;
export type TaskState = (typeof taskStates)[number];

export interface RepositoryRecord {
  id: string;
  alias: string;
  canonicalRoot: string;
  worktreeRoot: string;
  defaultBranch: string;
  policy: RepositoryPolicySnapshot;
  createdAt: string;
  updatedAt: string;
}

export type CreateRepositoryInput = RepositoryRecord;

export interface TaskRecord {
  id: string;
  schemaVersion: number;
  sourcePath: string;
  sourceIdentity: string;
  sourceHash: string;
  sourceRevision: number;
  repositoryId: string;
  title: string;
  objective: string;
  state: TaskState;
  limits: VersionedJsonObject;
  request: VersionedJsonObject;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput extends Omit<TaskRecord, "revision"> {
  actor: string;
  eventPayload: VersionedJsonObject;
}

export type ImportTaskInput = Omit<CreateTaskInput, "sourceRevision">;

export interface TaskEventRecord {
  sequence: number;
  taskId: string;
  attemptId: string | null;
  eventType: string;
  actor: string;
  payload: VersionedJsonObject;
  occurredAt: string;
}

export interface TransitionTaskInput {
  taskId: string;
  expectedRevision: number;
  to: TaskState;
  attemptId?: string;
  actor: string;
  payload: VersionedJsonObject;
  occurredAt: string;
}
