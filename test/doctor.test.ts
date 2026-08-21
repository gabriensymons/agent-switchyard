import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "./helpers/fake-runner.js";

const codexFixturePath = fileURLToPath(
  new URL("./fixtures/codex-doctor-ready.json", import.meta.url)
);

function readyGitResults(): Array<[string, ReturnType<typeof commandResult>]> {
  return [
    [commandKey("git", ["--version"]), commandResult({ stdout: "git version 2.50.1\n" })],
    [commandKey("git", ["rev-parse", "--show-toplevel"]), commandResult({ stdout: "/fixture\n" })],
    [commandKey("git", ["branch", "--show-current"]), commandResult({ stdout: "spike\n" })],
    [commandKey("git", ["status", "--porcelain=v1", "--untracked-files=normal"]), commandResult()]
  ];
}

describe("runDoctor", () => {
  it("is degraded, not unavailable, when one optional provider is absent", async () => {
    const codexFixture = await readFile(codexFixturePath, "utf8");
    const runner = new FakeCommandRunner(
      new Map([
        ...readyGitResults(),
        [
          commandKey("codex", ["--version"]),
          commandResult({ stdout: "codex-cli 0.148.0-alpha.15\n" })
        ],
        [
          commandKey("codex", ["doctor", "--json"]),
          commandResult({ stdout: codexFixture })
        ],
        [
          commandKey("claude", ["--version"]),
          commandResult({ exitCode: null, errorCode: "ENOENT" })
        ]
      ])
    );

    const report = await runDoctor({
      cwd: "/fixture",
      runner,
      now: () => new Date("2026-08-21T00:00:00.000Z")
    });

    expect(report.overall).toBe("degraded");
    expect(report.git).toMatchObject({ state: "ready", clean: true });
    expect(report.providers).toEqual([
      expect.objectContaining({ id: "codex", state: "ready", canRun: true }),
      expect.objectContaining({
        id: "claude",
        state: "not_installed",
        canRun: false
      })
    ]);
  });

  it("is unavailable when no provider CLI is installed", async () => {
    const missing = commandResult({ exitCode: null, errorCode: "ENOENT" });
    const runner = new FakeCommandRunner(
      new Map([
        ...readyGitResults(),
        [commandKey("codex", ["--version"]), missing],
        [commandKey("claude", ["--version"]), missing]
      ])
    );

    const report = await runDoctor({
      cwd: "/fixture",
      runner,
      now: () => new Date("2026-08-21T00:00:00.000Z")
    });

    expect(report.overall).toBe("unavailable");
  });
});
