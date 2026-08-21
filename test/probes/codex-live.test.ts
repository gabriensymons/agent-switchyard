import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCodexLiveProbe } from "../../src/probes/codex-live.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/codex-exec-events.jsonl", import.meta.url)
);

describe("runCodexLiveProbe", () => {
  it("stores event envelopes and usage without returning the transcript", async () => {
    const fixture = await readFile(fixturePath, "utf8");
    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-C",
      "/fixture",
      "Read README.md only. Reply with exactly SWITCHYARD_READ_ONLY_PROBE_V1 and do not run commands or modify files."
    ];
    const runner = new FakeCommandRunner(
      new Map([
        [commandKey("codex", args), commandResult({ stdout: fixture })]
      ])
    );
    const times = [
      new Date("2026-08-21T00:00:00.000Z"),
      new Date("2026-08-21T00:00:02.000Z")
    ];

    const report = await runCodexLiveProbe({
      cwd: "/fixture",
      timeoutMs: 10_000,
      runner,
      now: () => times.shift() ?? new Date("2026-08-21T00:00:02.000Z")
    });

    expect(report).toEqual({
      schemaVersion: 1,
      provider: "codex",
      state: "completed",
      generatedAt: "2026-08-21T00:00:02.000Z",
      durationMs: 2_000,
      exitCode: 0,
      eventCount: 4,
      eventTypes: {
        "thread.started": 1,
        "turn.started": 1,
        "item.completed": 1,
        "turn.completed": 1
      },
      expectedMarkerObserved: true,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 10
      },
      diagnostics: []
    });
    expect(report).not.toHaveProperty("transcript");
  });

  it("fails when completion is not evidenced by the marker", async () => {
    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-C",
      "/fixture",
      "Read README.md only. Reply with exactly SWITCHYARD_READ_ONLY_PROBE_V1 and do not run commands or modify files."
    ];
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("codex", args),
          commandResult({ stdout: '{"type":"turn.completed"}\n' })
        ]
      ])
    );

    const report = await runCodexLiveProbe({
      cwd: "/fixture",
      timeoutMs: 10_000,
      runner,
      now: () => new Date("2026-08-21T00:00:00.000Z")
    });

    expect(report.state).toBe("failed");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ id: "codex.probe.marker", status: "fail" })
    );
  });
});
