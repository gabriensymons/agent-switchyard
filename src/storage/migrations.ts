import type Database from "better-sqlite3";
import { StorageError } from "./errors.js";

export interface Migration {
  version: number;
  up(database: Database.Database): void;
}

const initialSchema = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE repositories (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    alias TEXT NOT NULL UNIQUE CHECK (length(alias) > 0),
    canonical_root TEXT NOT NULL UNIQUE CHECK (length(canonical_root) > 0),
    worktree_root TEXT NOT NULL UNIQUE CHECK (length(worktree_root) > 0),
    default_branch TEXT NOT NULL CHECK (length(default_branch) > 0),
    policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    source_path TEXT NOT NULL CHECK (length(source_path) > 0),
    source_hash TEXT NOT NULL CHECK (length(source_hash) > 0),
    source_revision INTEGER NOT NULL CHECK (source_revision > 0),
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(title) > 0),
    objective TEXT NOT NULL CHECK (length(objective) > 0),
    state TEXT NOT NULL CHECK (state IN (
      'ingested', 'ready', 'preparing', 'running', 'verifying', 'review',
      'needs_human', 'failed', 'cancelled', 'interrupted'
    )),
    limits_json TEXT NOT NULL CHECK (json_valid(limits_json)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_path, source_revision)
  ) STRICT;

  CREATE TABLE attempts (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    prior_attempt_id TEXT,
    provider_identity TEXT NOT NULL CHECK (length(provider_identity) > 0),
    state TEXT NOT NULL CHECK (state IN (
      'queued', 'preparing', 'running', 'verifying', 'completed', 'failed',
      'cancelled', 'interrupted', 'timed_out'
    )),
    worktree_path TEXT,
    branch_name TEXT,
    pid INTEGER CHECK (pid IS NULL OR pid > 0),
    process_group_id INTEGER CHECK (process_group_id IS NULL OR process_group_id > 0),
    process_started_at TEXT,
    lease_token TEXT,
    started_at TEXT,
    finished_at TEXT,
    exit_code INTEGER,
    signal TEXT,
    termination_json TEXT CHECK (termination_json IS NULL OR json_valid(termination_json)),
    UNIQUE (task_id, id),
    UNIQUE (task_id, sequence),
    CHECK (prior_attempt_id IS NULL OR prior_attempt_id <> id),
    FOREIGN KEY (task_id, prior_attempt_id)
      REFERENCES attempts(task_id, id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    attempt_id TEXT,
    event_type TEXT NOT NULL CHECK (length(event_type) > 0),
    actor TEXT NOT NULL CHECK (length(actor) > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (task_id, attempt_id)
      REFERENCES attempts(task_id, id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE questions (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    attempt_id TEXT,
    prompt TEXT NOT NULL CHECK (length(prompt) > 0),
    status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'dismissed')),
    answer TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT,
    CHECK (
      (status = 'answered' AND answer IS NOT NULL AND answered_at IS NOT NULL)
      OR (status <> 'answered' AND answer IS NULL AND answered_at IS NULL)
    ),
    FOREIGN KEY (task_id, attempt_id)
      REFERENCES attempts(task_id, id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE artifacts (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    attempt_id TEXT,
    kind TEXT NOT NULL CHECK (length(kind) > 0),
    absolute_path TEXT NOT NULL UNIQUE CHECK (length(absolute_path) > 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) > 0),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    media_type TEXT NOT NULL CHECK (length(media_type) > 0),
    created_at TEXT NOT NULL,
    UNIQUE (task_id, id),
    UNIQUE (task_id, attempt_id, id),
    FOREIGN KEY (task_id, attempt_id)
      REFERENCES attempts(task_id, id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE verifications (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    attempt_id TEXT,
    command_id TEXT NOT NULL CHECK (length(command_id) > 0),
    argv_json TEXT NOT NULL CHECK (json_valid(argv_json)),
    cwd_relative TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'pending', 'running', 'passed', 'failed', 'timed_out', 'cancelled'
    )),
    exit_code INTEGER,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    stdout_artifact_id TEXT,
    stderr_artifact_id TEXT,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (task_id, attempt_id)
      REFERENCES attempts(task_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (task_id, stdout_artifact_id)
      REFERENCES artifacts(task_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (task_id, stderr_artifact_id)
      REFERENCES artifacts(task_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (task_id, attempt_id, stdout_artifact_id)
      REFERENCES artifacts(task_id, attempt_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (task_id, attempt_id, stderr_artifact_id)
      REFERENCES artifacts(task_id, attempt_id, id) ON DELETE RESTRICT
  ) STRICT;

  CREATE INDEX tasks_repository_state_idx ON tasks(repository_id, state);
  CREATE INDEX tasks_source_hash_idx ON tasks(source_hash);
  CREATE INDEX attempts_task_idx ON attempts(task_id, sequence);
  CREATE INDEX events_task_idx ON events(task_id, sequence);
  CREATE INDEX events_attempt_idx ON events(attempt_id, sequence);
  CREATE INDEX questions_task_status_idx ON questions(task_id, status);
  CREATE INDEX verifications_attempt_idx ON verifications(attempt_id);
  CREATE INDEX artifacts_attempt_idx ON artifacts(attempt_id);

  CREATE TRIGGER events_are_append_only_update
  BEFORE UPDATE ON events
  BEGIN
    SELECT RAISE(ABORT, 'events are append-only');
  END;

  CREATE TRIGGER events_are_append_only_delete
  BEFORE DELETE ON events
  BEGIN
    SELECT RAISE(ABORT, 'events are append-only');
  END;

  CREATE TRIGGER terminal_attempts_are_immutable_update
  BEFORE UPDATE ON attempts
  WHEN OLD.state IN ('completed', 'failed', 'cancelled', 'interrupted', 'timed_out')
  BEGIN
    SELECT RAISE(ABORT, 'terminal attempts are immutable');
  END;

  CREATE TRIGGER terminal_attempts_are_immutable_delete
  BEFORE DELETE ON attempts
  WHEN OLD.state IN ('completed', 'failed', 'cancelled', 'interrupted', 'timed_out')
  BEGIN
    SELECT RAISE(ABORT, 'terminal attempts are immutable');
  END;
`;

export const migrations: readonly Migration[] = [
  {
    version: 1,
    up(database) {
      database.exec(initialSchema);
    }
  }
];

function migrationTableExists(database: Database.Database): boolean {
  const row = database.prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).get() as { present: number } | undefined;
  return row?.present === 1;
}

function validateMigrationList(list: readonly Migration[]): void {
  for (const [index, migration] of list.entries()) {
    if (migration.version !== index + 1) {
      throw new StorageError(
        "schema_incompatible",
        "Storage migrations must be contiguous and start at version 1"
      );
    }
  }
}

export function migrateDatabase(
  database: Database.Database,
  appliedAt: string,
  list: readonly Migration[] = migrations
): void {
  validateMigrationList(list);
  let appliedVersions: number[] = [];
  try {
    if (migrationTableExists(database)) {
      appliedVersions = database
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((row) => (row as { version: number }).version);
    }
  } catch {
    throw new StorageError(
      "schema_incompatible",
      "Switchyard storage schema could not be read"
    );
  }

  for (const [index, version] of appliedVersions.entries()) {
    if (version !== index + 1 || version > list.length) {
      throw new StorageError(
        "schema_incompatible",
        "Switchyard storage schema is newer or incompatible"
      );
    }
  }

  for (const migration of list.slice(appliedVersions.length)) {
    try {
      database.transaction(() => {
        migration.up(database);
        database.prepare(`
          INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)
        `).run(migration.version, appliedAt);
      }).immediate();
    } catch {
      throw new StorageError(
        "migration_failed",
        `Switchyard storage migration ${migration.version} failed`
      );
    }
  }
}

export function currentSchemaVersion(): number {
  return migrations.at(-1)?.version ?? 0;
}
