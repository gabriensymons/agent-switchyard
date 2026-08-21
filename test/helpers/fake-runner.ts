import type {
  CommandRequest,
  CommandResult,
  CommandRunner
} from "../../src/core/command-runner.js";

export function commandKey(command: string, args: string[]): string {
  return [command, ...args].join("\u0000");
}

export function commandResult(
  overrides: Partial<CommandResult> = {}
): CommandResult {
  const termination = overrides.termination ?? {
    cause: overrides.timedOut
      ? ("timed_out" as const)
      : overrides.signal
        ? ("interrupted" as const)
        : ("exited" as const),
    requestedSignal: overrides.timedOut ? ("SIGTERM" as const) : null,
    forced: false,
    processGroup: false
  };
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    signal: null,
    ...overrides,
    termination
  };
}

export class FakeCommandRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  constructor(private readonly results: Map<string, CommandResult>) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const result = this.results.get(commandKey(request.command, request.args));
    if (!result) {
      throw new Error(`Missing fake result for ${request.command} ${request.args.join(" ")}`);
    }
    return result;
  }
}
