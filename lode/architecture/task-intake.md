# Local task intake

## Boundary

Task intake is an explicit domain/storage service over a configured intake root. It has no CLI wiring and does not move a task beyond `ingested`, create a worktree or branch, execute a registered command, invoke a provider, or enable unattended dispatch.

## Version 1 document

A task source is at most 64 KiB of exact bytes and contains one YAML 1.2 core frontmatter document followed by a nonempty Markdown objective. `schemaVersion`, `title`, `repository`, `providerIdentity`, `allowedPaths`, `verification`, and `acceptanceCriteria` are required; `id` and the complete six-field `limits` object are optional. Unknown keys are rejected at every level.

The parser rejects invalid UTF-8, a UTF-8 BOM, duplicate keys, parser warnings, directives, anchors, aliases, explicit tags, merge keys, and multiple frontmatter documents. Task paths are concrete repository-relative POSIX file paths, and verification entries are registered command IDs rather than executable text.

## Source-file safety

The service requires an explicit absolute intake root and never resolves that trust boundary from the current working directory. It binds the lexical and canonical root to matching device/inode metadata, rechecks root stability before and after reading, performs lexical containment checks, walks source components with `lstat`, rejects symbolic-link traversal, verifies realpath containment, opens with no-follow and nonblocking semantics where supported, requires a regular file, reads at most 64 KiB plus one byte, and compares bigint device/inode plus nanosecond path and handle metadata before and after reading. Replacement or mutation races fail closed.

LF and CRLF documents are accepted, but SHA-256 covers the exact original bytes. Their hashes therefore differ.

## Policy resolution

The repository alias resolves through registered storage. Missing and rejected aliases use the same generic policy error. The task provider identity must be permitted, every concrete allowed path must fit an allowed repository pattern without matching a repository or system hard deny, and allowed paths must also be case-insensitively unique and checked against case-folded forbidden patterns for conservative behavior on case-insensitive filesystems. Every verification ID must resolve to its registered literal executable-plus-argv definition. Missing task limits inherit repository maxima; supplied limits may only lower every maximum, and a selected command timeout may not exceed the effective task runtime.

The persisted request is a fully resolved immutable snapshot containing repository identity, title, objective, acceptance criteria, exact allowed paths, forbidden patterns, provider identity, selected registered command definitions, and effective limits. Storage strictly validates this discriminated request, cross-checks duplicated task columns and limits, and returns deeply frozen JSON snapshots. Untrusted source text alone is not the execution contract.

## Source revisions

An explicit task `id` creates source identity `id:<value>`; otherwise identity is `path:<canonical-absolute-source-path>`. Exact identity-plus-byte-hash re-import returns the historical task without a write. New bytes receive a new internal task ID and `max(source_revision) + 1`, begin in `ingested`, and append exactly one `task.ingested` event in the same SQLite transaction.

SQLite unique indexes on identity-plus-revision and identity-plus-hash, immediate transactions, and conflict lookup provide cross-process convergence. The hash index applies to all new `id:` and `path:` identities; migrated `legacy-path:` histories are excluded so schema-valid version-1 duplicate hashes remain retained. There is no in-process-only intake lock. Public intake errors distinguish invalid documents, unsafe source files, policy rejection, and storage conflicts without exposing parser, provider, repository-existence, or stored-data details.