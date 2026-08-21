import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderRunHandoff,
  writeRunHandoff
} from "../../src/runs/handoff.js";
import {
  createRunRecord,
  transitionCurrentAttempt
} from "../../src/runs/types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => await rm(root, {
      recursive: true,
      force: true
    }))
  );
});

function cancelledRecord() {
  let record = createRunRecord({
    runId: "run-1",
    attemptId: "attempt-1",
    provider: "codex",
    identityId: "codex-isolated",
    repositoryPath: "/repo",
    worktreePath: "/repo",
    at: "2026-08-21T00:00:00.000Z"
  });
  record = transitionCurrentAttempt(record, {
    to: "running",
    at: "2026-08-21T00:00:01.000Z",
    reason: "dispatched"
  });
  return transitionCurrentAttempt(record, {
    to: "cancelled",
    at: "2026-08-21T00:00:02.000Z",
    reason: "operator_cancelled",
    exitEvidence: {
      exitCode: null,
      signal: "SIGTERM",
      termination: {
        cause: "cancelled",
        requestedSignal: "SIGTERM",
        forced: false,
        processGroup: true
      },
      completionEvidence: false
    }
  });
}

describe("run handoffs", () => {
  it("contains sanitized lifecycle facts and an explicit next action", () => {
    const handoff = renderRunHandoff(cancelledRecord());

    expect(handoff).toContain("Provider identity: codex-isolated (codex)");
    expect(handoff).toContain("State: cancelled");
    expect(handoff).toContain("Do not infer provider completion");
    expect(handoff).not.toMatch(
      /["']?(sessionId|accountId|threadId)["']?\s*:|\/auth\.json/iu
    );
  });

  it("writes the handoff outside the repository with private permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchyard-handoff-"));
    temporaryRoots.push(root);

    const path = await writeRunHandoff(root, cancelledRecord());

    expect(path).toBe(join(root, "handoffs", "run-1", "attempt-1.md"));
    expect(await readFile(path, "utf8")).toBe(
      renderRunHandoff(cancelledRecord())
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
