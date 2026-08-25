# Storage foundation

## Boundary

M1 state uses `better-sqlite3` behind the project-owned `SwitchyardStorage` interface. Storage lives under an operator-selected private state root, outside registered repositories:

```text
<state-root>/
  switchyard.sqlite3
  artifacts/
```

The state and artifact directories are forced to owner-only mode, as is the main database file on POSIX platforms. Empty state-root paths and symbolic links at the state root, artifact directory, or database path are rejected. File-backed connections require WAL mode, foreign keys, and a 5000 ms busy timeout. Opening storage fails closed if these safeguards cannot be enabled.

## Schema and migration contract

Numbered migrations are contiguous, start at version 1, and run one at a time inside explicit transactions. Applied versions and timestamps live in `schema_migrations`. Reopening the current schema is idempotent. An unknown, discontinuous, or newer version is rejected; Switchyard never auto-downgrades.

The initial schema contains:

- `repositories` with canonical repository/worktree roots and a versioned policy JSON snapshot;
- `tasks` with normalized source identity, state, limits, and an optimistic `revision`;
- immutable linked `attempts` with process and termination evidence fields;
- append-only `events` as the task audit spine;
- `questions`, `verifications`, and `artifacts` for later M1 slices.

Foreign keys, state checks, uniqueness constraints, JSON validity checks, and query indexes enforce invariants near the data, including same-task and same-attempt ownership for verification artifacts. Attempt states include the preparing and verifying phases needed by later deterministic recovery. Database triggers reject event updates/deletes and updates/deletes of terminal attempt rows.

## Transaction contract

A new task and its `task.ingested` event commit together. A later legal task transition updates only the expected optimistic revision and inserts a `task.state_changed` event in the same transaction. A stale revision, illegal transition, failed foreign key, or failed event insert leaves both task state and event history unchanged.

JSON is reserved for versioned policy, limits, and event payloads. Task state, revisions, source identity, relationships, and timestamps remain normalized columns. Storage and migration errors expose stable project-owned codes and generic messages rather than underlying SQLite messages or stored values.

This slice does not yet expose task intake, attempt mutation, questions, verification, artifacts, recovery, or CLI workflows. The existing M0 JSON run store remains in place until a later reviewed slice composes lifecycle execution with this database.
