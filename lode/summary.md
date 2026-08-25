# Project summary

Agent Switchyard is a local-first, quota-aware scheduler intended to coordinate official coding-agent CLIs across multiple subscription and API-backed identities. The scheduler will eventually accept work from a durable task source, assign isolated worktrees and provider identities, monitor trustworthy usage signals, pause before quota exhaustion, produce handoffs, and resume work after limits reset. M0 feasibility is complete: Git, Codex, and Claude installations and authentication can be probed; fixed read-only live prompts can be summarized without retaining transcripts; Claude usage can be represented by exact rate-limit events or a clearly labeled calibrated proxy; default and isolated Codex credentials are independently routable without assuming a plan tier; and provider-neutral attempts can be cancelled, persisted, recovered as interrupted, and restarted through sanitized handoffs. M1 now has private SQLite storage plus a tested repository-registration and policy domain service; task intake and implementation dispatch remain disabled.

## Current system shape

- `src/providers/` normalizes provider installation, health, authentication, capabilities, and usage readiness.
- `src/probes/` runs explicit bounded live protocol experiments and retains only event envelopes and token/rate-limit summaries.
- `src/usage/` contains the optional Claude transcript-derived usage proxy.
- `src/config/` defines provider identities and their process-environment boundaries.
- `src/auth/` prepares and authenticates Switchyard-managed credential homes without inspecting credentials.
- `src/core/command-runner.ts` executes bounded child processes with identity-specific environment additions and removals.
- `src/runs/` defines the versioned lifecycle state machine, private atomic storage, sanitized handoffs, clean-worktree restart gate, and probe lifecycle coordinator.
- `src/repositories/` defines canonical root overlap checks, the versioned local-only repository policy, path ceilings, and registration validation.
- `src/git/repository-inspector.ts` verifies primary local Git roots and expected local branches without remote operations.
- `src/storage/` defines the M1 SQLite schema, forward-only migrations, normalized storage errors, repository snapshots, optimistic task revisions, and atomic task-event writes.
- `switchyard doctor` reports Git and provider readiness; `switchyard probe` performs an explicitly acknowledged live experiment.
- `switchyard experiment cancel|restart` runs and persists explicitly acknowledged read-only lifecycle experiments.

## Milestone status

M0 provider feasibility and lifecycle control are complete. On 2026-08-21, both the isolated Codex identity and Claude cancelled through process-group `SIGTERM` in 506 ms, left no fixture-associated process, persisted private handoffs, and completed fresh linked attempts after the clean-worktree gate. Codex completed in 6.4 seconds and Claude in 9.65 seconds. A host-context doctor check reported all configured identities ready; the earlier sandboxed Claude unauthenticated result was caused by restricted keychain visibility, not an actual logout. M1 provides the durable schema and transactional repository/task/event primitives plus a domain service that validates and persists local-only repository policy. It does not ingest task files, create task worktrees, execute providers, recover M1 attempts, or expose M1 CLI workflows. Unattended implementation dispatch remains disabled.
