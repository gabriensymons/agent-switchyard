import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClaudeAdapter } from "../../src/providers/claude.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/claude-auth-ready.json", import.meta.url)
);

describe("ClaudeAdapter", () => {
  it("normalizes a machine-readable authenticated status", async () => {
    const fixture = await readFile(fixturePath, "utf8");
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("claude", ["--version"]),
          commandResult({ stdout: "2.1.0 (Claude Code)\n" })
        ],
        [
          commandKey("claude", ["auth", "status", "--json"]),
          commandResult({ stdout: fixture })
        ]
      ])
    );

    const probe = await new ClaudeAdapter().probe({
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
      canRun: true,
      version: "2.1.0 (Claude Code)",
      usage: { state: "unknown" },
      capabilities: { machineReadableUsage: true }
    });
  });

  it("treats an absent optional CLI as not installed", async () => {
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("claude", ["--version"]),
          commandResult({ exitCode: null, errorCode: "ENOENT" })
        ]
      ])
    );

    const probe = await new ClaudeAdapter().probe({
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

  it("reports an installed but logged-out CLI with remediation", async () => {
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("claude", ["--version"]),
          commandResult({ stdout: "2.1.238 (Claude Code)\n" })
        ],
        [
          commandKey("claude", ["auth", "status", "--json"]),
          commandResult({
            exitCode: 1,
            stdout: '{"loggedIn":false,"authMethod":"none"}\n'
          })
        ]
      ])
    );

    const probe = await new ClaudeAdapter().probe({
      cwd: "/fixture",
      timeoutMs: 1_000,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      runner
    });

    expect(probe).toMatchObject({
      state: "unauthenticated",
      installed: true,
      authenticated: false,
      authMode: "none",
      canRun: false
    });
    expect(probe.diagnostics).toContainEqual(
      expect.objectContaining({ id: "claude.auth", status: "fail" })
    );
  });
});
