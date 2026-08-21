import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../src/providers/codex.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/codex-doctor-ready.json", import.meta.url)
);

describe("CodexAdapter", () => {
  it("accepts a redacted doctor report even when doctor exits nonzero", async () => {
    const fixture = await readFile(fixturePath, "utf8");
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("codex", ["--version"]),
          commandResult({ stdout: "codex-cli 0.148.0-alpha.15\n" })
        ],
        [
          commandKey("codex", ["doctor", "--json"]),
          commandResult({
            exitCode: 1,
            stdout: fixture,
            stderr: "warning: optional setup issue\n"
          })
        ]
      ])
    );

    const probe = await new CodexAdapter().probe({
      cwd: "/fixture",
      timeoutMs: 1_000,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      runner
    });

    expect(probe).toMatchObject({
      state: "ready",
      installed: true,
      authenticated: true,
      authMode: "subscription",
      reachable: true,
      canRun: true,
      version: "codex-cli 0.148.0-alpha.15",
      usage: { state: "unknown", confidence: "unknown" }
    });
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({ id: "codex.mcp.config", status: "warning" })
    );
  });

  it("reports a missing installation", async () => {
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("codex", ["--version"]),
          commandResult({ exitCode: null, errorCode: "ENOENT" })
        ]
      ])
    );

    const probe = await new CodexAdapter().probe({
      cwd: "/fixture",
      timeoutMs: 1_000,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      runner
    });

    expect(probe).toMatchObject({
      state: "not_installed",
      installed: false,
      authMode: "unknown",
      canRun: false
    });
  });
});
