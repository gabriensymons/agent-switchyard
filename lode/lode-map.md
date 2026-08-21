# Lode map

Use this index before searching the codebase. Read only the focused documents relevant to the task.

## Foundation

- [Project summary](summary.md): purpose, current milestone, and system shape.
- [Terminology](terminology.md): normalized domain language.
- [Practices](practices.md): engineering, testing, telemetry, and documentation rules.

## Architecture and safety

- [Provider identities](architecture/provider-identities.md): default, isolated, and subscription-backed credential routing.
- [Run lifecycle](architecture/run-lifecycle.md): durable attempts, process termination, sanitized handoffs, and restart gates.
- [Safety boundaries](architecture/safety-boundaries.md): current M0 permissions, credential rules, and gates for unattended work.

## Active plans

- [M0 cancellation and restart](plans/m0-cancellation-restart.md): next implementation milestone and exit criteria.

## Temporary material

Session handoffs and short-lived working notes belong in `tmp/`, which is intentionally git-ignored and is not durable project documentation.
