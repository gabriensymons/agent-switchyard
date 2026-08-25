# Safety boundaries

## Current implemented authority

Switchyard may:

- inspect Git repository state;
- run provider version, redacted health, and authentication-status commands;
- prepare a private Switchyard-managed credential home;
- start an official provider login flow;
- run an explicitly acknowledged fixed prompt against the disposable read-only fixture;
- intentionally cancel that fixed probe, persist sanitized lifecycle evidence, and start a fresh linked probe only after a clean-worktree check;
- read Claude transcript token-usage fields while discarding content, paths, projects, and session identifiers.
- initialize private local SQLite state and artifact directories;
- persist registered repository snapshots and normalized task metadata;
- commit an allowed task state transition and its append-only event atomically.

Switchyard does not yet:

- dispatch implementation prompts;
- ingest Markdown/YAML tasks or create M1 worktrees;
- modify target projects through provider agents;
- run unattended overnight;
- scrape browser sessions or undocumented usage panels;
- publish packages, push branches, create pull requests, or mutate task boards;
- copy or inspect credential files.

## Gates before unattended work

All of the following must be demonstrated before unattended dispatch is enabled:

1. Durable run-state transitions distinguish completion, failure, cancellation, and interruption. Implemented and fixture-tested.
2. Codex and Claude processes can be terminated within a deadline without orphaning child processes. Integration-tested and live-verified for both providers.
3. Restart behavior is explicit and uses a sanitized handoff rather than hidden conversation state. Implemented and Codex live-verified.
4. Worktree state is checked and preserved or quarantined before retry. Clean-worktree restart is implemented; dirty or ambiguous state is refused rather than retried.
5. Usage policy treats exact, estimated, and unknown signals differently.
6. Questions that require operator judgment are queued without blocking unrelated safe work.

## Credential boundary

Credential files are secrets even when they are stored locally. Switchyard can select their isolated home indirectly through the process environment, but application reports and logs must never contain credential values. Public fixtures must be constructed or sanitized and must not include account, organization, workspace, session, or thread identifiers.
