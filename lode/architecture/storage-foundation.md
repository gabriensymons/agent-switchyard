# Storage foundation

## Boundary

M1 state uses `better-sqlite3` behind the project-owned `SwitchyardStorage` interface. Storage lives under an operator-selected private state root, outside registered repositories:

```text
<state-root>/
  switchyard.sqlite3
  artifacts/
```

The state and artifact directories are forced to owner-only mode, as is the main database file on POSIX platforms. Empty state-root paths and symbolic links at the state root, artifact directory, or database path are rejected. File-backed connections configure a 5000 ms busy timeout at connection creation before bounded WAL negotiation, then require WAL mode and foreign keys. Opening storage fails closed if these safeguards cannot be enabled.

## Schema and migration contract

Numbered migrations are contiguous, start at version 1, and run one at a time inside explicit immediate transactions. Each transaction re-reads applied versions after acquiring the write lock, so concurrent fresh or version-1 opens converge instead of applying a stale pending-migration plan. Applied versions and timestamps live in `schema_migrations`. Reopening the current schema is idempotent. An unknown, discontinuous, or newer version is rejected; Switchyard never auto-downgrades.

Schema version 2 contains:

- `repositories` with canonical repository/worktree roots and a versioned policy JSON snapshot;
- `tasks` with normalized source identity and revision, exact source hash and path, immutable resolved request JSON, state, limits, and an optimistic `revision`;
- immutable linked `attempts` with process and termination evidence fields;
- append-only `events` as the task audit spine;
- `questions`, `verifications`, and `artifacts` for later M1 slices.

Foreign keys, state checks, uniqueness constraints, JSON validity checks, and query indexes enforce invariants near the data, including same-task and same-attempt ownership for verification artifacts. Attempt states include the preparing and verifying phases needed by later deterministic recovery. Database triggers reject event updates/deletes and updates/deletes of terminal attempt rows.

Repository policy is parsed as the supported strict version-1 contract on both write and read. Storage exposes lookup by repository ID or alias and deterministic listing. Migration 2 deterministically backfills version-1 tasks with `legacy-path:<source_path>` identities and a versioned legacy request marker, then replaces path-based revision uniqueness with a unique identity-plus-revision index and an identity-plus-hash unique index for new non-legacy identities. The legacy exclusion retains schema-valid version-1 histories that repeated an exact hash across revisions.

## Transaction contract

A new source hash allocates `max(source_revision) + 1`, inserts an `ingested` task, and appends its one `task.ingested` event in an immediate transaction. An existing identity-plus-hash returns its historical task without a write. A later legal task transition updates only the expected optimistic revision and inserts a `task.state_changed` event in the same transaction. A stale revision, illegal transition, failed foreign key, failed source constraint, or failed event insert leaves both task state and event history unchanged.

JSON is reserved for versioned policy, resolved task requests, limits, and event payloads. New task writes require the strict resolved-request discriminator, reapply parser-equivalent nonempty and uniqueness invariants, and cross-check repository identity, title, objective, commands, paths, and limits against normalized task fields and immutable repository policy; reads accept only that contract or the exact migration-v2 legacy marker and deeply freeze returned payloads. Task state, revisions, source identity, relationships, and timestamps remain normalized columns. Storage and migration errors expose stable project-owned codes and generic messages rather than underlying SQLite messages or stored values.

Storage does not validate filesystem or Git identity; callers must use the repository-registration and task-intake services before persistence. Attempt mutation, questions, verification execution, artifacts, recovery, and M1 CLI workflows remain unimplemented. The existing M0 JSON run store remains in place until a later reviewed slice composes lifecycle execution with this database.
