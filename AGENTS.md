# Agent Switchyard agent instructions

## Start here

Before exploring the repository, read:

1. `lode/lode-map.md`
2. `lode/summary.md`
3. `lode/terminology.md`
4. The focused lode files relevant to the task

The implementation and tests are the source of truth. If the lode disagrees with the code, report the discrepancy and propose a correction instead of silently following stale documentation.

## Project objective

Agent Switchyard is a local-first, quota-aware scheduler for official subscription-backed coding-agent CLIs. It is currently an M0 feasibility spike; it does not yet dispatch unattended implementation work.

## Development workflow

- Preserve pre-existing changes in the working tree.
- Keep changes incremental and bounded to the active task.
- Use Node.js 22 or newer.
- Run `npm run check` before handing off code changes.
- Use fixture-backed tests for provider output parsing.
- Treat live provider probes as explicit experiments: they consume quota and must remain bounded, read-only, ephemeral, and transcript-free.
- Do not commit, push, publish, open pull requests, or modify external repositories unless the user asks.

## Security and provider invariants

- Never read, copy, print, log, commit, or place provider credentials in prompts or handoffs.
- Use official provider CLIs authenticated independently by the operator.
- Provider identity must be explicit; vendor name alone is insufficient for dispatch.
- `codex-default` is pinned to the existing default Codex home at `~/.codex`.
- `codex-isolated` uses a separate Switchyard-managed home and must not inherit `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN`.
- Usage percentages must state their provenance and confidence. Never present a calibrated proxy as an authoritative provider percentage.
- Do not begin unattended dispatch until cancellation, interruption, restart, and durable handoff behavior have been verified.

## Lode maintenance

The `lode/` directory is durable, vendor-neutral project memory.

- Keep it focused on the system's current behavior, invariants, terminology, and active plans—not a changelog.
- Update the relevant lode file when an accepted change alters architecture, contracts, safety rules, or recurring practices.
- Keep one topic per file and add it to `lode/lode-map.md`.
- Add examples or Mermaid diagrams only when they materially clarify the topic.
- Put active durable plans in `lode/plans/`.
- Put session-specific handoffs and scraps in `lode/tmp/`; that directory is git-ignored.
- Prefer correcting an existing document over creating overlapping documentation.

## Current next step

M0 provider feasibility and lifecycle verification are complete for the isolated Codex identity and Claude. Review the coherent M0 change set before selecting the next milestone. Unattended dispatch remains disabled until the remaining safety gates—especially scheduling policy for usage confidence and queued operator questions—have their own accepted plan and verification.
