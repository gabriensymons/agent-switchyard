# Lode map

Use this index before searching the codebase. Read only the focused documents relevant to the task.

## Foundation

- [Project summary](summary.md): purpose, current milestone, and system shape.
- [Terminology](terminology.md): normalized domain language.
- [Practices](practices.md): engineering, testing, telemetry, and documentation rules.

## Architecture and safety

- [Provider identities](architecture/provider-identities.md): default, isolated, and subscription-backed credential routing.
- [Repository registration](architecture/repository-registration.md): canonical roots, immutable policy ceilings, path syntax, and registered argv verification commands.
- [Local task intake](architecture/task-intake.md): strict Markdown/YAML sources, safe exact-byte reads, policy narrowing, and immutable source revisions.
- [Run lifecycle](architecture/run-lifecycle.md): durable attempts, process termination, sanitized handoffs, and restart gates.
- [Storage foundation](architecture/storage-foundation.md): private SQLite state, forward-only migrations, optimistic task revisions, and atomic task events.
- [Safety boundaries](architecture/safety-boundaries.md): current implemented permissions, credential rules, and gates for unattended work.

## Active plans

- [M0 cancellation and restart](plans/m0-cancellation-restart.md): completed lifecycle foundation and exit criteria.

## Temporary material

Session handoffs and short-lived working notes belong in `tmp/`, which is intentionally git-ignored and is not durable project documentation.
