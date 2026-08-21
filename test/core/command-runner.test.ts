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

  it("can add and remove environment values for an isolated provider", async () => {
    process.env["SWITCHYARD_TEST_INHERITED"] = "must-not-leak";
    try {
      const result = await runner.run({
        command: process.execPath,
        args: [
          "-e",
          'process.stdout.write(`${process.env.SWITCHYARD_TEST_ADDED}:${process.env.SWITCHYARD_TEST_INHERITED ?? "missing"}`)'
        ],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        environment: {
          SWITCHYARD_TEST_ADDED: "isolated",
          SWITCHYARD_TEST_INHERITED: undefined
        }
      });

      expect(result.stdout).toBe("isolated:missing");
    } finally {
      delete process.env["SWITCHYARD_TEST_INHERITED"];
    }
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
    expect(result.termination.cause).toBe("timed_out");
  });

  it("reports caller cancellation separately from timeout", async () => {
    const controller = new AbortController();
    const pending = runner.run({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      timeoutMs: 1_000,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 25);

    const result = await pending;

    expect(result).toMatchObject({
      timedOut: false,
      termination: {
        cause: "cancelled",
        requestedSignal: "SIGTERM",
        forced: false
      }
    });
  });

  it("forces termination after the graceful deadline", async () => {
    const controller = new AbortController();
    const pending = runner.run({
      command: process.execPath,
      args: [
        "-e",
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
      ],
      cwd: process.cwd(),
      timeoutMs: 2_000,
      terminationGraceMs: 25,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 100);

    const result = await pending;

    expect(result.signal).toBe("SIGKILL");
    expect(result.termination).toMatchObject({
      cause: "cancelled",
      requestedSignal: "SIGKILL",
      forced: true
    });
  });

  it.skipIf(process.platform === "win32")(
    "terminates descendants in the command process group",
    async () => {
      const controller = new AbortController();
      const descendantScript =
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)';
      const script = [
        'const { spawn } = require("node:child_process");',
        'process.on("SIGTERM", () => {});',
        `const child = spawn(process.execPath, ["-e", ${JSON.stringify(
          descendantScript
        )}], { stdio: "ignore" });`,
        'process.stdout.write(String(child.pid));',
        "setInterval(() => {}, 1000);"
      ].join("");
      const pending = runner.run({
        command: process.execPath,
        args: ["-e", script],
        cwd: process.cwd(),
        timeoutMs: 2_000,
        terminationGraceMs: 25,
        signal: controller.signal
      });
      setTimeout(() => controller.abort(), 100);

      const result = await pending;
      const descendantPid = Number.parseInt(result.stdout, 10);
      let descendantExists = true;
      try {
        process.kill(descendantPid, 0);
      } catch {
        descendantExists = false;
      }

      expect(result.termination).toMatchObject({
        cause: "cancelled",
        forced: true,
        processGroup: true
      });
      expect(descendantExists).toBe(false);
    }
  );

  it("does not spawn a command for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run({
      command: "switchyard-command-that-must-not-run",
      args: [],
      cwd: process.cwd(),
      timeoutMs: 1_000,
      signal: controller.signal
    });

    expect(result).toMatchObject({
      exitCode: null,
      termination: {
        cause: "cancelled",
        requestedSignal: null,
        forced: false,
        processGroup: false
      }
    });
  });
});
