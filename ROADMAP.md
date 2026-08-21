# Roadmap

Agent Switchyard is being built toward a simple outcome: prepare bounded work before stepping away, let locally authenticated coding agents use available capacity safely, and return to a report of completed work, questions, and next actions.

This roadmap describes direction rather than release dates. Safety and recovery gates determine when each capability advances.

## M0 — provider feasibility

Complete on the M0 branch:

- Detect Git, Codex, and Claude Code readiness without reading credentials.
- Normalize provider capabilities and represent exact, estimated, and unknown usage honestly.
- Route default and isolated Codex identities without naming them after subscription tiers.
- Run bounded, read-only protocol experiments without retaining transcripts.
- Persist sanitized run records and handoffs.
- Cancel provider process groups and start fresh, linked attempts from clean worktrees.

M0 does not dispatch implementation tasks or run unattended.

## Now — deterministic local execution

- Accept bounded tasks from a local, durable task file.
- Create one isolated Git worktree and branch per task.
- Persist task state, attempts, verification evidence, checkpoints, questions, and audit events.
- Recover safely after Switchyard or a provider process stops.
- Leave changes for human review without merging, deploying, or publishing automatically.

The milestone is successful when one real but tightly scoped task reaches review with tests recorded and survives a forced restart.

## Next — quota-aware continuation

- Schedule around trustworthy provider capacity and reset signals.
- Treat unavailable or uncertain usage conservatively instead of inventing precision.
- Drain, checkpoint, pause, wake, and resume work without losing state.
- Continue eligible work while collecting decisions that require the operator.
- Produce a return report covering completed work, failures, questions, quota state, and what comes next.

## Later — integrations and product experience

- Add GitHub Issues, draft pull requests, and GitHub Projects after local task handling is reliable.
- Add more providers and task trackers through stable adapter contracts.
- Publish a credential-free playground that demonstrates the scheduling and report workflow.
- Record a short end-to-end video using the real local engine.
- Explore a desktop control app after the CLI, daemon, persistence, and safety policies have been proven through sustained dogfooding.

Any desktop experience should control the same local engine rather than introduce a second scheduler.

## Ongoing principles

- Use official, independently authenticated local CLIs; never scrape or export credentials.
- Keep provider identity separate from vendor and subscription-plan names.
- Isolate work by repository, worktree, branch, provider identity, and security domain.
- Preserve a durable, provider-neutral handoff instead of depending on private conversation history.
- Require human approval for merge, release, deployment, destructive actions, and other high-impact writes.
- Prefer honest uncertainty over unsupported quota claims.

## Not planned

- A hosted service that accepts or proxies users' subscription credentials.
- Automatic merging, production deployment, package publishing, or destructive database operations by default.
- A universal autonomous software engineer or an unrestricted agent runtime.
