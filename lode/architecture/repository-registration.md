# Repository registration and policy

## Boundary

Repository registration is a domain/storage service; it is not yet exposed through the CLI and does not create task worktrees. Registration resolves one canonical primary Git worktree, one separate worktree-container root, one expected local default branch, and one immutable versioned policy snapshot. It invokes only bounded local Git inspection commands and never fetches, pulls, pushes, clones, or changes repository content.

## Root validation

Both roots must already exist and be supplied as their canonical real paths. Symbolic-link aliases, filesystem roots, the operator home, non-Git repositories, linked or bare worktrees as the canonical repository, and a worktree container located inside any Git worktree are rejected.

Repository and worktree roots may not overlap each other, any existing registered repository or worktree root, the Switchyard state or intake roots, provider homes, or known credential and configuration homes. Nested registered repositories are therefore not allowed. The validated absolute roots are stored in normalized repository columns; callers cannot use the storage layer alone as a substitute for registration validation.

## Policy snapshot

Repository policy schema version 1 fixes `operatingMode` to `local-only` and records:

- allowed and forbidden repository-relative path patterns;
- explicit provider identities;
- registered verification commands;
- maximum runtime, attempt, changed-file, diff-line, changed-file-size, and captured-command-output limits.

Repository maxima cannot exceed the approved M1 system ceilings. Policy parsing is strict at every level, and SQLite rejects unsupported policy shapes on both writes and reads. There is no policy-update workflow in this slice.

Allowed path patterns use portable POSIX separators and a deliberately limited dialect: literal segments, `*` within one segment, and `**` as a complete segment. The first segment must be literal. Absolute paths, traversal, backslashes, negation, character classes, braces, extglobs, and ambiguous empty segments are rejected. Permanent system protection still denies Git metadata, credential/configuration homes, environment and signing material, publication metadata, and deployment paths even if a broader allowed pattern would otherwise match.

## Verification command boundary

A registered verification command contains an ID, executable name, literal argv array, fixed repository-relative working directory, and timeout. It has no shell string, environment map, runtime substitution, or worktree token; future execution supplies the validated worktree as the command working-directory base.

Shells, command indirection, remote/network administration tools, inline Node evaluation, and argv that requests known destructive, publication, deployment, or remote-mutation operations are rejected. Registration records definitions only; no verification command is executed in this slice.
