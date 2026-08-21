import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../src/providers/codex.js";
import { codexIdentity } from "../../src/config/codex-identities.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/codex-doctor-ready.json", import.meta.url)
);
const unauthenticatedFixturePath = fileURLToPath(
  new URL("../fixtures/codex-doctor-unauthenticated.json", import.meta.url)
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

    const probe = await new CodexAdapter(codexIdentity("codex-default")).probe({
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

    const probe = await new CodexAdapter(codexIdentity("codex-default")).probe({
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

  it("passes the selected identity environment to every Codex command", async () => {
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("codex", ["--version"]),
          commandResult({ exitCode: null, errorCode: "ENOENT" })
        ]
      ])
    );
    const identity = codexIdentity("codex-isolated", {
      stateRoot: "/switchyard-state"
    });

    await new CodexAdapter(identity).probe({
      cwd: "/fixture",
      timeoutMs: 1_000,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      runner
    });

    expect(runner.calls[0]?.environment).toEqual(identity.environment);
  });

  it("accepts non-string doctor details from a fresh isolated home", async () => {
    const fixture = await readFile(unauthenticatedFixturePath, "utf8");
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("codex", ["--version"]),
          commandResult({ stdout: "codex-cli 0.148.0-alpha.15\n" })
        ],
        [
          commandKey("codex", ["doctor", "--json"]),
          commandResult({ exitCode: 1, stdout: fixture })
        ]
      ])
    );

    const probe = await new CodexAdapter(
      codexIdentity("codex-isolated", { stateRoot: "/switchyard-state" })
    ).probe({
      cwd: "/fixture",
      timeoutMs: 1_000,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      runner
    });

    expect(probe).toMatchObject({
      id: "codex-isolated",
      state: "unauthenticated",
      authenticated: false,
      authMode: "unknown",
      canRun: false
    });
  });
});
