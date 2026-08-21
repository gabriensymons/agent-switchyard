# Run lifecycle

## Durable contract

Each run is a schema-versioned JSON record under the Switchyard state root, outside the target repository. It names the provider, explicit identity, repository and worktree paths, current state, and one or more attempts. Each attempt retains normalized transitions, timestamps, exit evidence, and an optional handoff path. The schema has no prompt, transcript, provider session, thread, or account fields.

Run records and handoffs use atomic replacement and private filesystem permissions. A Switchyard process that loads a record left in `running` can persist it as `interrupted`; it must never infer completion.

~~~mermaid
stateDiagram-v2
    [*] --> queued
    queued --> running
    queued --> cancelled
    running --> completed
    running --> failed
    running --> cancelled
    running --> interrupted
    running --> timed_out
    cancelled --> queued: new linked attempt
    interrupted --> queued: new linked attempt
~~~

Terminal attempts are immutable. The restart arrows represent a new attempt with `priorAttemptId` and the prior sanitized handoff path.

## Process termination

The command runner accepts an abort signal and a deadline. On POSIX, each command starts in its own process group. Cancellation or timeout sends `SIGTERM` to the group, waits a bounded grace period, and sends `SIGKILL` if necessary. One normalized termination result records the cause, requested signal, whether force was required, and whether process-group control was active.

Intentional cancellation, deadline expiry, unexpected signal interruption, provider failure, and deterministic completion remain distinct from the runner through provider reports and persisted attempt evidence.

## Handoff and restart gate

Cancelled and interrupted attempts receive a lifecycle-only Markdown handoff outside the repository. It contains normalized state and exit facts plus the next safe action, not task conversation content.

Restart is explicit. Switchyard first confirms that the recorded path is still the Git worktree root and that `git status --porcelain` is empty. Unknown, mismatched, or dirty state refuses automatic restart. A successful restart creates a fresh queued attempt and invokes the fixed ephemeral probe without resuming a provider session.

## Current verification

- Unit coverage exercises every state-transition pair and rejects terminal completion without deterministic evidence.
- Integration coverage exercises graceful cancellation, forced termination, timeout, descendant cleanup, record reload/recovery, private handoff persistence, dirty-worktree refusal, and a fresh restart in a real temporary Git worktree.
- The isolated Codex identity's live experiment cancelled in 506 ms with process-group `SIGTERM`, left no fixture-associated process, then completed a fresh linked attempt in 6.4 seconds.
- The Claude live experiment cancelled in 506 ms with process-group `SIGTERM`, left no fixture-associated process, then completed a fresh linked attempt in 9.65 seconds.
- A final host-context doctor report showed `overall: ready` with the Codex default, Codex isolated, and Claude subscription identities authenticated and runnable.
