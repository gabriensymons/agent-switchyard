# Project practices

## Provider integration

- Launch official provider CLIs instead of reproducing private protocols or browser automation.
- Normalize stable machine-readable output; tolerate unrelated diagnostic changes without weakening validation of fields Switchyard relies on.
- Give every command a deadline and bounded output capture.
- Keep provider identity explicit from selection through execution and reporting.
- Prefer fixture-backed parser tests before live experiments.

## Credentials and local state

- Treat credential material as opaque. Switchyard may prepare an isolated directory and start an official login flow, but it does not inspect or transport credentials.
- Run authentication-status probes in a context that can access the official CLI's OS credential store. Treat a restricted-sandbox unauthenticated result as inconclusive until a host-context normalized probe confirms it.
- Store Switchyard-managed credentials outside the repository with private filesystem permissions.
- Remove conflicting inherited authentication variables when launching an isolated identity.
- Never put account identifiers, session identifiers, prompt transcripts, or credential paths into public reports when a normalized status is sufficient.

## Telemetry

- Record provenance, observation time, and confidence for every usage signal.
- Distinguish exact provider rate-limit events from calibrated activity estimates.
- Unknown is a valid result; do not invent a percentage or reset time.
- Live probe reports retain event types, completion evidence, sanitized diagnostics, and token summaries—not transcripts.

## Lifecycle safety

- Persist state transitions before relying on unattended execution.
- Cancellation and process termination must be bounded and observable.
- An interrupted run must never be reported as completed or silently retried.
- Restart must use a durable sanitized handoff and a clean or explicitly preserved worktree.
- Work on different tasks must use isolated worktrees before parallel dispatch is enabled.

## Verification and documentation

- Run `npm run check` after code changes.
- Add regression fixtures for newly observed provider output shapes.
- Update lode documents when accepted changes alter current architecture, terminology, invariants, or recurring practices.
- Keep historical implementation narratives in Git history or temporary handoffs rather than durable lode documents.
