# M0 feasibility spike

## Goal

Verify that Switchyard can discover official local coding-agent CLIs, check readiness without accessing credentials, capture stable structured output, and represent unavailable quota telemetry honestly.

M0 is deliberately read-only. No model prompt is sent by `switchyard doctor`.

## Initial local observations

Observed on 2026-08-21:

| Provider | Local result | Machine-readable health/auth | Machine-readable quota |
| --- | --- | --- | --- |
| Codex | Installed (`0.148.0-alpha.15`), API-key auth | `codex doctor --json` | Not observed |
| Claude Code | Not installed | To verify after installation | Not observed |

Codex's doctor command can exit nonzero while still returning valid redacted JSON because unrelated checks may fail. The adapter therefore parses the report first and evaluates the authentication and provider-reachability checks explicitly.

The live Codex experiment completed successfully against the disposable fixture in 4.3 seconds. It produced `thread.started`, `turn.started`, `item.completed`, and `turn.completed` events, observed the expected marker, and exposed token counts. The summarized report discarded the thread identifier and transcript. Token counts describe one turn; they do not establish remaining subscription allowance or reset time.

The local Codex installation used API-key authentication for this experiment. That validates the process and event protocol, but not ChatGPT Business subscription quota behavior. Authentication mode is therefore part of the normalized provider report and must gate any subscription-specific quota policy.

## Normalized probe contract

Every provider probe reports:

- Installation and version.
- Authentication as `true`, `false`, or `null` when unknown.
- Reachability as `true`, `false`, or `null` when not measurable.
- Whether the provider is currently safe to invoke.
- Supported non-interactive and structured-output capabilities.
- Usage state, source, confidence, observed time, and zero or more quota windows.
- Sanitized diagnostics without credential values or raw configuration details.

Provider states are `ready`, `degraded`, `not_installed`, `unauthenticated`, `unreachable`, and `error`.

## Exit criteria

- [x] Git, Codex, and Claude installations can be detected.
- [x] Missing optional providers are normalized without crashing.
- [x] Codex redacted doctor JSON can be parsed even after a nonzero exit.
- [x] Commands have bounded output and deadlines.
- [x] Fixture tests cover successful and missing-provider paths.
- [x] A transcript-free Codex JSONL envelope and token-usage parser is fixture-tested.
- [ ] Claude Code is installed and its real auth/event output is captured in a sanitized fixture.
- [x] Codex completes a read-only no-op prompt with JSONL events recorded and sanitized.
- [ ] Claude completes the same read-only no-op prompt.
- [ ] Cancellation and restart behavior are verified against both live CLIs.

The unchecked items intentionally require provider installation and explicit model invocations. They are the second half of M0, not assumptions hidden in the adapter.

## Next experiment

After reviewing the doctor output:

1. Install and authenticate Claude Code independently.
2. Add an explicit `switchyard probe codex` command that runs a fixed read-only prompt under a temporary fixture repository and records only the event envelope.
3. Repeat for Claude.
4. Add timeout and cancellation experiments using those live probes.
5. Do not begin unattended dispatch until both providers produce deterministic completion and failure signals.
