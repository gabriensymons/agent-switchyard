import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runClaudeLiveProbe } from "../../src/probes/claude-live.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/claude-stream-events.jsonl", import.meta.url)
);

const args = [
  "--print",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--safe-mode",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--tools",
  "Read",
  "--permission-mode",
  "plan",
  "Read README.md only. Reply with exactly SWITCHYARD_READ_ONLY_PROBE_V1 and do not run commands or modify files."
];

describe("runClaudeLiveProbe", () => {
  it("summarizes streaming events without returning transcript content", async () => {
    const fixture = await readFile(fixturePath, "utf8");
    const runner = new FakeCommandRunner(
      new Map([[commandKey("claude", args), commandResult({ stdout: fixture })]])
    );
    const times = [
      new Date("2026-08-21T00:00:00.000Z"),
      new Date("2026-08-21T00:00:03.000Z")
    ];

    const report = await runClaudeLiveProbe({
      cwd: "/fixture",
      timeoutMs: 10_000,
      runner,
      now: () => times.shift() ?? new Date("2026-08-21T00:00:03.000Z")
    });

    expect(report).toEqual({
      schemaVersion: 1,
      provider: "claude",
      identityId: "claude-subscription",
      state: "completed",
      generatedAt: "2026-08-21T00:00:03.000Z",
      durationMs: 3_000,
      exitCode: 0,
      signal: null,
      termination: {
        cause: "exited",
        requestedSignal: null,
        forced: false,
        processGroup: false
      },
      eventCount: 4,
      eventTypes: {
        system: 1,
        rate_limit_event: 1,
        assistant: 1,
        result: 1
      },
      expectedMarkerObserved: true,
      usage: {
        inputTokens: 2,
        outputTokens: 8,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 50
      },
      rateLimit: {
        status: "allowed_warning",
        rateLimitType: "five_hour",
        resetsAt: "2026-08-21T17:00:00.000Z",
        utilization: 0.86,
        overageStatus: "rejected",
        isUsingOverage: false
      },
      diagnostics: []
    });
    expect(report).not.toHaveProperty("transcript");
    expect(report).not.toHaveProperty("sessionId");
  });

  it("reports timeout without a misleading marker failure", async () => {
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("claude", args),
          commandResult({
            exitCode: null,
            timedOut: true,
            signal: "SIGTERM"
          })
        ]
      ])
    );

    const report = await runClaudeLiveProbe({
      cwd: "/fixture",
      timeoutMs: 1,
      runner,
      now: () => new Date("2026-08-21T00:00:00.000Z")
    });

    expect(report.state).toBe("timed_out");
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ id: "claude.probe.timeout", status: "fail" })
    ]);
  });

  it("classifies intentional cancellation without a marker failure", async () => {
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("claude", args),
          commandResult({
            exitCode: null,
            signal: "SIGKILL",
            termination: {
              cause: "cancelled",
              requestedSignal: "SIGKILL",
              forced: true,
              processGroup: true
            }
          })
        ]
      ])
    );

    const report = await runClaudeLiveProbe({
      identityId: "claude-subscription",
      cwd: "/fixture",
      timeoutMs: 10_000,
      runner,
      now: () => new Date("2026-08-21T00:00:00.000Z")
    });

    expect(report).toMatchObject({
      identityId: "claude-subscription",
      state: "cancelled",
      expectedMarkerObserved: false,
      termination: { cause: "cancelled", forced: true }
    });
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        id: "claude.probe.cancelled",
        status: "warning"
      })
    ]);
  });
});
