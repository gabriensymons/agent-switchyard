import type { CommandRunner } from "../core/command-runner.js";
import type { ProviderProbe } from "../core/types.js";

export interface ProbeContext {
  cwd: string;
  timeoutMs: number;
  now: () => Date;
  runner: CommandRunner;
}

export interface ProviderAdapter {
  readonly id: string;
  probe(context: ProbeContext): Promise<ProviderProbe>;
}
