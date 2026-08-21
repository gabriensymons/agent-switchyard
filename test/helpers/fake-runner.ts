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
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    signal: null,
    ...overrides
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
