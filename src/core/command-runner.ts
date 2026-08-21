import { spawn } from "node:child_process";

export interface CommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
  terminationGraceMs?: number;
}

export type CommandTerminationCause =
  | "exited"
  | "cancelled"
  | "timed_out"
  | "interrupted"
  | "spawn_error";

export interface CommandTermination {
  cause: CommandTerminationCause;
  requestedSignal: NodeJS.Signals | null;
  forced: boolean;
  processGroup: boolean;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
  termination: CommandTermination;
  errorCode?: string;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

const MAX_CAPTURE_BYTES = 1024 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 500;

function appendBounded(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) {
    return current;
  }

  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
  return current + chunk.subarray(0, remaining).toString("utf8");
}

export class SpawnCommandRunner implements CommandRunner {
  async run(request: CommandRequest): Promise<CommandResult> {
    const useProcessGroup = process.platform !== "win32";
    if (request.signal?.aborted) {
      return {
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        signal: null,
        termination: {
          cause: "cancelled",
          requestedSignal: null,
          forced: false,
          processGroup: false
        }
      };
    }

    return await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let forced = false;
      let requestedCause: "cancelled" | "timed_out" | null = null;
      let forceKill: NodeJS.Timeout | undefined;
      let forceSettle: NodeJS.Timeout | undefined;
      let closeResult:
        | { exitCode: number | null; signal: NodeJS.Signals | null }
        | undefined;

      const environment: NodeJS.ProcessEnv = { ...process.env };
      for (const [name, value] of Object.entries(request.environment ?? {})) {
        if (value === undefined) delete environment[name];
        else environment[name] = value;
      }

      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: environment,
        detached: useProcessGroup,
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
        clearTimeout(deadline);
        if (forceKill) clearTimeout(forceKill);
        if (forceSettle) clearTimeout(forceSettle);
        request.signal?.removeEventListener("abort", cancel);
        resolve(result);
      };

      const signalProcess = (signal: NodeJS.Signals): boolean => {
        if (useProcessGroup && child.pid !== undefined) {
          try {
            process.kill(-child.pid, signal);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
          }
        }
        return child.kill(signal);
      };

      const processGroupExists = (): boolean => {
        if (!useProcessGroup || child.pid === undefined) return false;
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      const resultFor = (
        exitCode: number | null,
        signal: NodeJS.Signals | null,
        cause: CommandTerminationCause,
        errorCode?: string
      ): CommandResult => ({
        exitCode,
        stdout,
        stderr,
        timedOut,
        signal,
        termination: {
          cause,
          requestedSignal:
            requestedCause === null ? null : forced ? "SIGKILL" : "SIGTERM",
          forced,
          processGroup: useProcessGroup && child.pid !== undefined
        },
        ...(errorCode === undefined ? {} : { errorCode })
      });

      const requestTermination = (cause: "cancelled" | "timed_out"): void => {
        if (settled || requestedCause !== null) return;
        requestedCause = cause;
        timedOut = cause === "timed_out";
        signalProcess("SIGTERM");
        forceKill = setTimeout(() => {
          if (settled) return;
          forced = signalProcess("SIGKILL");
          forceSettle = setTimeout(() => {
            if (settled) return;
            const observed = closeResult ?? {
              exitCode: null,
              signal: forced ? ("SIGKILL" as const) : null
            };
            finish(
              resultFor(
                observed.exitCode,
                observed.signal,
                requestedCause ?? cause
              )
            );
          }, 250);
          forceSettle.unref();
        }, request.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
        forceKill.unref();
      };

      const cancel = (): void => requestTermination("cancelled");
      request.signal?.addEventListener("abort", cancel, { once: true });

      const deadline = setTimeout(
        () => requestTermination("timed_out"),
        request.timeoutMs
      );
      deadline.unref();

      child.once("error", (error: NodeJS.ErrnoException) => {
        finish(resultFor(null, null, "spawn_error", error.code));
      });

      child.once("close", (exitCode, signal) => {
        closeResult = { exitCode, signal };
        if (
          requestedCause !== null &&
          !forced &&
          useProcessGroup &&
          processGroupExists()
        ) {
          return;
        }
        const cause =
          requestedCause ??
          (signal === null ? ("exited" as const) : ("interrupted" as const));
        finish(resultFor(exitCode, signal, cause));
      });
    });
  }
}
