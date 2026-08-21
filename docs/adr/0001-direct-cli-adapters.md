# ADR 0001: Start with direct official CLI adapters

- Status: Accepted for M0
- Date: 2026-08-21

## Context

Switchyard needs provider-neutral orchestration while preserving each operator's independently installed and authenticated Codex and Claude Code CLI. Existing orchestration projects are useful references, but adopting one as the execution backend would add another state model before provider behavior has been measured locally.

## Decision

M0 invokes official provider CLIs through a small `ProviderAdapter` interface. Commands are bounded by time and captured-output limits. The adapter stores normalized results and sanitized diagnostics, not credentials or complete transcripts.

## Consequences

- Actual CLI behavior and compatibility boundaries remain visible.
- Provider-specific parsing is isolated and fixture-tested.
- A future orchestrator backend can be added behind the same interface.
- Switchyard must track provider CLI compatibility and fail closed when output changes.
