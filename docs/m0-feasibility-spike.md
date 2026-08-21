# M0 feasibility spike

## Goal

Verify that Switchyard can discover official local coding-agent CLIs, check readiness without accessing credentials, capture stable structured output, and represent unavailable quota telemetry honestly.

M0 is deliberately read-only. No model prompt is sent by `switchyard doctor`.

## Initial local observations

Observed on 2026-08-21:

| Provider | Local result | Machine-readable health/auth | Machine-readable quota |
| --- | --- | --- | --- |
| Codex | Installed (`0.148.0-alpha.15`), API-key auth | `codex doctor --json` | Not observed |
| Claude Code | Installed (`2.1.238`), Claude Pro via `claude.ai` | Auth and live stream schema verified | Status/reset observed; utilization absent while allowed |

Codex's doctor command can exit nonzero while still returning valid redacted JSON because unrelated checks may fail. The adapter therefore parses the report first and evaluates the authentication and provider-reachability checks explicitly.

The live Codex experiment completed successfully against the disposable fixture in 4.3 seconds. It produced `thread.started`, `turn.started`, `item.completed`, and `turn.completed` events, observed the expected marker, and exposed token counts. The summarized report discarded the thread identifier and transcript. Token counts describe one turn; they do not establish remaining subscription allowance or reset time.

The local Codex installation used API-key authentication for this experiment. That validates the process and event protocol, but not ChatGPT Business subscription quota behavior. Authentication mode is therefore part of the normalized provider report and must gate any subscription-specific quota policy.

## Codex identity isolation

The `codex-default` identity deliberately leaves the current Codex home unchanged, preserving whichever operator-selected authentication is active there. Its stable name is a routing identifier, not a guarantee of any authentication mode. The `codex-isolated` identity has a separate `CODEX_HOME` under Switchyard's local state directory and forces file-backed credential storage there. Its process environment removes inherited OpenAI API keys and Codex access tokens so they cannot silently take precedence over the independent ChatGPT login.

Provider identity is now explicit in doctor reports and live Codex probes. This is the first routing boundary the scheduler will use: tasks must select a provider identity, not merely a vendor. Credential files remain opaque to Switchyard.

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
- [x] A streaming Claude transcript usage proxy is fixture-tested and cannot emit transcript content or session identifiers.
- [x] Claude Code is installed and its real auth output is normalized without retaining account identifiers.
- [x] Claude Code is authenticated and its live event output is captured in a sanitized fixture.
- [x] Codex completes a read-only no-op prompt with JSONL events recorded and sanitized.
- [x] Claude completes the same read-only no-op prompt.
- [x] Claude live timeout terminates the process and reports `timed_out`.
- [x] Explicit cancellation and restart behavior are verified against both live CLIs.

All M0 exit criteria are satisfied with fixture, integration, and bounded live evidence.

## Claude usage proxy

Claude Code's local JSONL transcripts contain per-request token fields but not the client `/usage` percentage. The optional proxy streams those files and retains only timestamps and input, output, cache-creation, and cache-read token counts. It intentionally omits transcript content, file paths, project names, and session identifiers from its report.

The proxy uses the operator-provided weighting formula: output × 10, cache creation × 1.25, input × 1, and cache read × 0.1. Without a calibration observation it reports weighted units with `unknown` confidence. With one or more `ISO=pct` observations, the newest point sets the scale and the result is marked `estimated`. The scheduler must treat this differently from an exact provider signal and expose calibration residuals when multiple observations are available.

The proxy does not infer a provider reset timestamp. A rolling transcript window has many token-expiry times, and those expirations are not proof of Anthropic's account-level reset behavior.

## Claude rate-limit events

The authenticated live probe emitted a documented `rate_limit_event`. Switchyard retains only its status, rate-limit type, reset timestamp, optional utilization, and overage state; it drops session and event identifiers. Anthropic's SDK schema documents `allowed`, `allowed_warning`, and `rejected` statuses plus optional `resetsAt` and `utilization`. In practice, utilization may be omitted for an `allowed` event, so the event can provide an authoritative status/reset without an authoritative percentage. The calibrated transcript proxy remains a fallback trend estimate, not a replacement for this provider signal.

The live Pro probe on 2026-08-21 returned `allowed` for the `five_hour` limit, an exact reset timestamp, `overageStatus: allowed`, and `isUsingOverage: false`. It did not include utilization. The probe completed in ephemeral mode and did not create a local transcript.

## Cancellation and restart

Switchyard now persists schema-versioned run records and sanitized handoffs under its private local state root. Attempts distinguish `completed`, `failed`, `cancelled`, `interrupted`, and `timed_out`; restart creates a new linked attempt. The command runner uses a dedicated POSIX process group, sends `SIGTERM`, escalates to `SIGKILL` after a bounded grace period, and records one termination outcome.

On 2026-08-21, the isolated Codex identity's cancellation experiment stopped in 506 ms through process-group `SIGTERM`. A process-list check found no fixture-associated process. The disposable Git worktree remained clean, so restart created a second attempt linked to the cancelled attempt and its handoff. The fresh attempt completed in 6.4 seconds with the expected marker and `turn.completed` event.

Claude cancellation also completed in 506 ms through process-group `SIGTERM`, with no fixture-associated process afterward. Its clean-worktree restart created a linked second attempt and completed in 9.65 seconds with the expected marker and deterministic result evidence. The live report retained only event types, token counts, and normalized rate-limit fields.

An earlier doctor run inside the restricted app sandbox reported Claude unauthenticated because that context could not see the keychain-backed CLI login. Repeating the normalized doctor check with scoped host access returned `overall: ready` and confirmed the Claude subscription identity was authenticated and runnable. No credential files or account identifiers were read.

## Milestone closeout

M0 is complete. The next milestone should be planned separately. Unattended dispatch remains disabled until the remaining safety gates, including scheduling policy for exact, estimated, and unknown usage plus queued operator questions, are implemented and verified.
