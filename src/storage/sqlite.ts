import Database from "better-sqlite3";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseRepositoryPolicy } from "../repositories/policy.js";
import {
  normalizeStorageError,
  StorageError
} from "./errors.js";
import { migrateDatabase } from "./migrations.js";
import type { SwitchyardStorage } from "./storage.js";
import {
  taskStates,
  type CreateRepositoryInput,
  type CreateTaskInput,
  type RepositoryRecord,
  type TaskEventRecord,
  type TaskRecord,
  type TaskState,
  type TransitionTaskInput,
  type VersionedJsonObject
} from "./types.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const BUSY_TIMEOUT_MS = 5_000;

interface RepositoryRow {
  id: string;
  alias: string;
  canonical_root: string;
  worktree_root: string;
  default_branch: string;
  policy_json: string;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  schema_version: number;
  source_path: string;
  source_hash: string;
  source_revision: number;
  repository_id: string;
  title: string;
  objective: string;
  state: string;
  limits_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  sequence: number;
  task_id: string;
  attempt_id: string | null;
  event_type: string;
  actor: string;
  payload_json: string;
  occurred_at: string;
}

export interface SqliteStorageOptions {
  stateRoot: string;
  now?: () => Date;
}

const legalTaskTransitions: Readonly<
  Record<TaskState, readonly TaskState[]>
> = {
  ingested: ["ready"],
  ready: ["preparing"],
  preparing: [
    "running",
    "needs_human",
    "failed",
    "cancelled",
    "interrupted"
  ],
  running: [
    "verifying",
    "needs_human",
    "failed",
    "cancelled",
    "interrupted"
  ],
  verifying: [
    "review",
    "needs_human",
    "failed",
    "cancelled",
    "interrupted"
  ],
  review: [],
  needs_human: [],
  failed: [],
  cancelled: [],
  interrupted: ["ready"]
};

function preparePrivateDirectory(path: string, kind: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new StorageError(
      "open_failed",
      `Switchyard storage refuses a symbolic-link ${kind}`
    );
  }
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(path, PRIVATE_DIRECTORY_MODE);
}

function prepareDatabaseFile(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new StorageError(
      "open_failed",
      "Switchyard storage refuses a symbolic-link database"
    );
  }
  const descriptor = openSync(path, "a", PRIVATE_FILE_MODE);
  closeSync(descriptor);
  chmodSync(path, PRIVATE_FILE_MODE);
}

function serializeVersionedJson<T extends { schemaVersion: number }>(value: T): string {
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw new StorageError(
      "constraint_violation",
      "Versioned storage payloads require a positive schema version"
    );
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) throw new Error("not serializable");
    JSON.parse(serialized);
    return serialized;
  } catch {
    throw new StorageError(
      "constraint_violation",
      "Storage payload is not valid JSON"
    );
  }
}

function parseVersionedJson(serialized: string): VersionedJsonObject {
  try {
    const value = JSON.parse(serialized) as Partial<VersionedJsonObject>;
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Number.isInteger(value.schemaVersion) ||
      (value.schemaVersion ?? 0) < 1
    ) {
      throw new Error("invalid versioned payload");
    }
    return value as VersionedJsonObject;
  } catch {
    throw new StorageError(
      "schema_incompatible",
      "Stored JSON payload does not match the supported schema"
    );
  }
}

function repositoryFromRow(row: RepositoryRow): RepositoryRecord {
  let policy: RepositoryRecord["policy"];
  try {
    policy = parseRepositoryPolicy(JSON.parse(row.policy_json) as unknown);
  } catch {
    throw new StorageError(
      "schema_incompatible",
      "Stored repository policy does not match the supported schema"
    );
  }
  return {
    id: row.id,
    alias: row.alias,
    canonicalRoot: row.canonical_root,
    worktreeRoot: row.worktree_root,
    defaultBranch: row.default_branch,
    policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isTaskState(value: string): value is TaskState {
  return taskStates.includes(value as TaskState);
}

function taskFromRow(row: TaskRow): TaskRecord {
  if (!isTaskState(row.state)) {
    throw new StorageError(
      "schema_incompatible",
      "Stored task state is not supported"
    );
  }
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    sourcePath: row.source_path,
    sourceHash: row.source_hash,
    sourceRevision: row.source_revision,
    repositoryId: row.repository_id,
    title: row.title,
    objective: row.objective,
    state: row.state,
    limits: parseVersionedJson(row.limits_json),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function eventFromRow(row: EventRow): TaskEventRecord {
  return {
    sequence: row.sequence,
    taskId: row.task_id,
    attemptId: row.attempt_id,
    eventType: row.event_type,
    actor: row.actor,
    payload: parseVersionedJson(row.payload_json),
    occurredAt: row.occurred_at
  };
}

export class SqliteStorage implements SwitchyardStorage {
  readonly databasePath: string;
  readonly artifactsRoot: string;

  private constructor(private readonly database: Database.Database) {
    this.databasePath = database.name;
    this.artifactsRoot = join(dirname(database.name), "artifacts");
  }

  static open(options: SqliteStorageOptions): SqliteStorage {
    if (options.stateRoot.trim().length === 0) {
      throw new StorageError(
        "open_failed",
        "Switchyard storage requires a non-empty state root"
      );
    }
    const stateRoot = resolve(options.stateRoot);
    const artifactsRoot = join(stateRoot, "artifacts");
    const databasePath = join(stateRoot, "switchyard.sqlite3");
    let database: Database.Database | undefined;
    try {
      preparePrivateDirectory(stateRoot, "state root");
      preparePrivateDirectory(artifactsRoot, "artifact directory");
      prepareDatabaseFile(databasePath);
      database = new Database(databasePath);
      const journalMode = database.pragma("journal_mode = WAL", {
        simple: true
      });
      database.pragma("foreign_keys = ON");
      database.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
      if (
        journalMode !== "wal" ||
        database.pragma("foreign_keys", { simple: true }) !== 1 ||
        database.pragma("busy_timeout", { simple: true }) !== BUSY_TIMEOUT_MS
      ) {
        throw new StorageError(
          "open_failed",
          "Switchyard storage could not enable required SQLite safeguards"
        );
      }
      migrateDatabase(
        database,
        (options.now ?? (() => new Date()))().toISOString()
      );
      return new SqliteStorage(database);
    } catch (error) {
      database?.close();
      throw normalizeStorageError(error, "open");
    }
  }

  close(): void {
    try {
      this.database.close();
    } catch (error) {
      throw normalizeStorageError(error, "write");
    }
  }

  diagnostics(): {
    journalMode: string;
    foreignKeys: boolean;
    busyTimeoutMs: number;
  } {
    try {
      return {
        journalMode: String(
          this.database.pragma("journal_mode", { simple: true })
        ),
        foreignKeys:
          this.database.pragma("foreign_keys", { simple: true }) === 1,
        busyTimeoutMs: Number(
          this.database.pragma("busy_timeout", { simple: true })
        )
      };
    } catch (error) {
      throw normalizeStorageError(error, "read");
    }
  }

  createRepository(input: CreateRepositoryInput): RepositoryRecord {
    try {
      const policy = parseRepositoryPolicy(input.policy);
      this.database.prepare(`
        INSERT INTO repositories(
          id, alias, canonical_root, worktree_root, default_branch,
          policy_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.alias,
        input.canonicalRoot,
        input.worktreeRoot,
        input.defaultBranch,
        serializeVersionedJson(policy),
        input.createdAt,
        input.updatedAt
      );
      return this.requireRepository(input.id);
    } catch (error) {
      throw normalizeStorageError(error, "write");
    }
  }

  getRepository(id: string): RepositoryRecord | null {
    try {
      const row = this.database.prepare(`
        SELECT * FROM repositories WHERE id = ?
      `).get(id) as RepositoryRow | undefined;
      return row ? repositoryFromRow(row) : null;
    } catch (error) {
      throw normalizeStorageError(error, "read");
    }
  }

  getRepositoryByAlias(alias: string): RepositoryRecord | null {
    try {
      const row = this.database.prepare(`
        SELECT * FROM repositories WHERE alias = ?
      `).get(alias) as RepositoryRow | undefined;
      return row ? repositoryFromRow(row) : null;
    } catch (error) {
      throw normalizeStorageError(error, "read");
    }
  }

  listRepositories(): RepositoryRecord[] {
    try {
      return this.database.prepare(`
        SELECT * FROM repositories ORDER BY alias, id
      `).all().map((row) => repositoryFromRow(row as RepositoryRow));
    } catch (error) {
      throw normalizeStorageError(error, "read");
    }
  }

  createTask(input: CreateTaskInput): TaskRecord {
    if (input.state !== "ingested") {
      throw new StorageError(
        "invalid_transition",
        "New tasks must begin in the ingested state"
      );
    }
    try {
      this.database.transaction(() => {
        this.database.prepare(`
          INSERT INTO tasks(
            id, schema_version, source_path, source_hash, source_revision,
            repository_id, title, objective, state, limits_json, revision,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          input.id,
          input.schemaVersion,
          input.sourcePath,
          input.sourceHash,
          input.sourceRevision,
          input.repositoryId,
          input.title,
          input.objective,
          input.state,
          serializeVersionedJson(input.limits),
          input.createdAt,
          input.updatedAt
        );
        this.database.prepare(`
          INSERT INTO events(
            task_id, attempt_id, event_type, actor, payload_json, occurred_at
          ) VALUES (?, NULL, 'task.ingested', ?, ?, ?)
        `).run(
          input.id,
          input.actor,
          serializeVersionedJson(input.eventPayload),
          input.createdAt
        );
      }).immediate();
      return this.requireTask(input.id);
    } catch (error) {
      throw normalizeStorageError(error, "write");
    }
  }

  getTask(id: string): TaskRecord | null {
    try {
      const row = this.database.prepare(`
        SELECT * FROM tasks WHERE id = ?
      `).get(id) as TaskRow | undefined;
      return row ? taskFromRow(row) : null;
    } catch (error) {
      throw normalizeStorageError(error, "read");
    }
  }

  transitionTask(input: TransitionTaskInput): TaskRecord {
    try {
      this.database.transaction(() => {
        const current = this.database.prepare(`
          SELECT * FROM tasks WHERE id = ?
        `).get(input.taskId) as TaskRow | undefined;
        if (!current) {
          throw new StorageError("not_found", "Task does not exist");
        }
        const task = taskFromRow(current);
        if (task.revision !== input.expectedRevision) {
          throw new StorageError(
            "stale_revision",
            "Task revision did not match the expected revision"
          );
        }
        if (!legalTaskTransitions[task.state].includes(input.to)) {
          throw new StorageError(
            "invalid_transition",
            `Task transition ${task.state} to ${input.to} is not allowed`
          );
        }
        const nextRevision = task.revision + 1;
        const result = this.database.prepare(`
          UPDATE tasks
          SET state = ?, revision = ?, updated_at = ?
          WHERE id = ? AND revision = ?
        `).run(
          input.to,
          nextRevision,
          input.occurredAt,
          input.taskId,
          input.expectedRevision
        );
        if (result.changes !== 1) {
          throw new StorageError(
            "stale_revision",
            "Task revision did not match the expected revision"
          );
        }
        const payload = serializeVersionedJson({
          ...input.payload,
          from: task.state,
          to: input.to,
          revision: nextRevision
        });
        this.database.prepare(`
          INSERT INTO events(
            task_id, attempt_id, event_type, actor, payload_json, occurred_at
          ) VALUES (?, ?, 'task.state_changed', ?, ?, ?)
        `).run(
          input.taskId,
          input.attemptId ?? null,
          input.actor,
          payload,
          input.occurredAt
        );
      }).immediate();
      return this.requireTask(input.taskId);
    } catch (error) {
      throw normalizeStorageError(error, "write");
    }
  }

  eventsForTask(taskId: string): TaskEventRecord[] {
    try {
      return this.database.prepare(`
        SELECT * FROM events WHERE task_id = ? ORDER BY sequence
      `).all(taskId).map((row) => eventFromRow(row as EventRow));
    } catch (error) {
      throw normalizeStorageError(error, "read");
    }
  }

  private requireRepository(id: string): RepositoryRecord {
    const repository = this.getRepository(id);
    if (!repository) {
      throw new StorageError("not_found", "Repository does not exist");
    }
    return repository;
  }

  private requireTask(id: string): TaskRecord {
    const task = this.getTask(id);
    if (!task) throw new StorageError("not_found", "Task does not exist");
    return task;
  }
}
