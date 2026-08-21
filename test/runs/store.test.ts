import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { RunStore } from "../../src/runs/store.js";
import {
  createRunRecord,
  transitionCurrentAttempt,
  type RunRecord
} from "../../src/runs/types.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchyard-run-store-"));
  temporaryRoots.push(root);
  return root;
}

function queuedRecord(): RunRecord {
  return createRunRecord({
    runId: "run-1",
    attemptId: "attempt-1",
    provider: "claude",
    identityId: "claude-subscription",
    repositoryPath: "/repo",
    worktreePath: "/repo",
    at: "2026-08-21T00:00:00.000Z"
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => await rm(root, {
      recursive: true,
      force: true
    }))
  );
});

describe("RunStore", () => {
  it("atomically persists a versioned private record that survives reloading", async () => {
    const root = await temporaryRoot();
    const store = new RunStore(root);
    await store.save(queuedRecord());

    const reloaded = await new RunStore(root).load("run-1");
    const file = join(root, "runs", "run-1.json");
    const mode = (await stat(file)).mode & 0o777;
    const entries = await readdir(join(root, "runs"));

    expect(reloaded).toEqual(queuedRecord());
    expect(mode).toBe(0o600);
    expect(entries).toEqual(["run-1.json"]);
  });

  it("rejects path traversal in run identifiers", async () => {
    const store = new RunStore(await temporaryRoot());
    await expect(store.load("../credentials")).rejects.toThrow(
      /Unsafe run identifier/u
    );
  });

  it("rejects fields outside the transcript-free schema", async () => {
    const store = new RunStore(await temporaryRoot());
    const unsafe = {
      ...queuedRecord(),
      transcript: "must not persist"
    } as RunRecord;

    await expect(store.save(unsafe)).rejects.toThrow();
  });

  it("recovers a persisted running attempt as interrupted", async () => {
    const root = await temporaryRoot();
    const store = new RunStore(root);
    const running = transitionCurrentAttempt(queuedRecord(), {
      to: "running",
      at: "2026-08-21T00:00:01.000Z",
      reason: "dispatched"
    });
    await store.save(running);

    const recovered = await store.recoverInterrupted(
      "run-1",
      "2026-08-21T00:01:00.000Z"
    );

    expect(recovered).toMatchObject({
      state: "interrupted",
      attempts: [
        {
          state: "interrupted",
          exitEvidence: {
            completionEvidence: false,
            termination: { cause: "interrupted" }
          }
        }
      ]
    });
    expect((await new RunStore(root).load("run-1")).state).toBe(
      "interrupted"
    );
  });
});
