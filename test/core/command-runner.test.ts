import { describe, expect, it } from "vitest";
import { SpawnCommandRunner } from "../../src/core/command-runner.js";

describe("SpawnCommandRunner", () => {
  const runner = new SpawnCommandRunner();

  it("captures successful output", async () => {
    const result = await runner.run({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("ready")'],
      cwd: process.cwd(),
      timeoutMs: 1_000
    });

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "ready",
      timedOut: false
    });
  });

  it("reports a missing executable without throwing", async () => {
    const result = await runner.run({
      command: "switchyard-command-that-does-not-exist",
      args: [],
      cwd: process.cwd(),
      timeoutMs: 1_000
    });

    expect(result).toMatchObject({ exitCode: null, errorCode: "ENOENT" });
  });

  it("terminates a stalled command at its deadline", async () => {
    const result = await runner.run({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      timeoutMs: 25
    });

    expect(result.timedOut).toBe(true);
    expect(result.signal).not.toBeNull();
  });
});
