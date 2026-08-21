import { spawn } from "node:child_process";

export interface CommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
  errorCode?: string;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

const MAX_CAPTURE_BYTES = 1024 * 1024;

function appendBounded(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) {
    return current;
  }

  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
  return current + chunk.subarray(0, remaining).toString("utf8");
}

export class SpawnCommandRunner implements CommandRunner {
  async run(request: CommandRequest): Promise<CommandResult> {
    return await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk);
      });

      const finish = (result: CommandResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => child.kill("SIGKILL"), 500);
        forceKill.unref();
      }, request.timeoutMs);
      timeout.unref();

      child.once("error", (error: NodeJS.ErrnoException) => {
        finish({
          exitCode: null,
          stdout,
          stderr,
          timedOut,
          signal: null,
          ...(error.code === undefined ? {} : { errorCode: error.code })
        });
      });

      child.once("close", (exitCode, signal) => {
        finish({ exitCode, stdout, stderr, timedOut, signal });
      });
    });
  }
}
