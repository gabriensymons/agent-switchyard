# M0 cancellation and restart plan

Status: complete  
Updated: 2026-08-21

## Objective

Prove that Switchyard can stop, classify, persist, and safely resume Codex and Claude runs before any unattended implementation dispatch is introduced.

## Scope

Define and exercise a provider-neutral run lifecycle with these terminal distinctions:

- `completed` — provider emitted deterministic completion evidence and exited successfully;
- `failed` — provider exited or produced deterministic failure evidence;
- `cancelled` — Switchyard intentionally stopped the run;
- `interrupted` — the process or Switchyard stopped without a confirmed terminal outcome;
- `timed_out` — the configured deadline caused termination.

Queued and running states are non-terminal. Restart creates a new attempt linked to the interrupted or cancelled attempt; it does not rewrite history.

## Implementation sequence

### 1. Durable run contract

- Add normalized run, attempt, state-transition, and termination-reason types.
- Persist sanitized records under Switchyard local state, outside the target repository.
- Use atomic writes and a schema version.
- Record provider identity, repository/worktree path, timestamps, exit evidence, and handoff path without transcripts or credentials.

### 2. Process lifecycle control

- Extend the command runner with an abort signal and observable termination metadata.
- Send graceful termination first, followed by a bounded forced kill.
- Verify timers and child listeners cannot report multiple terminal outcomes.
- Determine and test the macOS process-group strategy needed to avoid orphaned descendants.

### 3. Provider experiments

- Add explicit cancellation experiments for Codex and Claude using fixed, non-mutating prompts.
- Sanitize and fixture the stable event envelope and termination result.
- Confirm neither CLI reports a cancelled turn as completed.
- Confirm a subsequent fresh probe still works for the same identity.

### 4. Restart and handoff

- Generate a small sanitized handoff for interrupted attempts.
- Refuse automatic restart if worktree state is ambiguous.
- Start a new attempt using explicit prior-attempt and handoff references.
- Keep restart policy separate from provider adapters so quota and operator policy can govern it later.

### 5. Verification and closeout

- Add unit tests for every legal and illegal state transition.
- Add integration tests for graceful cancellation, forced termination, timeout, and fresh restart.
- Run the full repository check.
- Update the M0 feasibility notes and lode to match observed behavior.

## Exit criteria

- Codex and Claude cancellation finish within a documented deadline.
- No orphan provider process remains after cancellation or timeout.
- Persisted records survive a new Switchyard process and correctly classify the previous attempt.
- A fresh attempt can restart safely from an interrupted run's handoff.
- Provider identity and credential isolation remain intact across cancellation and restart.
- Reports contain no prompt transcript, session identifier, account identifier, or credential material.
- M0's cancellation/restart checklist item can be marked complete with evidence.

## Verification status

- Provider-neutral lifecycle, atomic private persistence, interruption recovery, handoff generation, and clean-worktree restart are implemented.
- The test suite exercises all state-transition pairs plus graceful cancellation, forced termination, timeout, process-group descendant cleanup, persistence across store instances, ambiguous-worktree refusal, and fresh restart.
- The isolated Codex identity's live cancellation completed in 506 ms through process-group `SIGTERM`; no fixture-associated process remained. A new linked attempt then completed the fixed probe in 6.4 seconds with deterministic marker and turn-completion evidence.
- Claude live cancellation completed in 506 ms through process-group `SIGTERM`; no fixture-associated process remained. A new linked attempt completed the fixed probe in 9.65 seconds with deterministic marker and result evidence.
- A host-context doctor report returned `overall: ready` with the Codex default, Codex isolated, and Claude subscription identities authenticated and runnable. A restricted sandbox can hide keychain-backed Claude authentication, so an unauthenticated result from that context is not authoritative until repeated with the required host access.
- All M0 lifecycle exit criteria are satisfied. Unattended implementation dispatch remains disabled because later safety gates are outside this plan.

## Deferred

- GitHub Projects and Trello ingestion.
- Quota-driven scheduling and the 90% handoff policy.
- Parallel worktree dispatch.
- Overnight autonomous implementation.
- Pull-request creation and task-board mutation.
