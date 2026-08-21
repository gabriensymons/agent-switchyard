# ADR 0002: Prove local task state before GitHub integration

- Status: Accepted for M0
- Date: 2026-08-21

## Context

GitHub Issues and Projects are intended task sources, but remote synchronization, duplicate delivery, permissions, and rate limits would obscure scheduler and recovery failures during the first milestone.

## Decision

The deterministic MVP will first persist local tasks and events. GitHub Issues will be the first remote adapter after leases, handoffs, and restart recovery work locally. GitHub Projects will remain a portfolio view rather than the initial durable task identity.

## Consequences

- M0 has no remote write path.
- Recovery tests can run entirely against disposable fixtures.
- GitHub synchronization will need explicit idempotency and audit tests later.
