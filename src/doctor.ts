import { resolve } from "node:path";
import { SpawnCommandRunner, type CommandRunner } from "./core/command-runner.js";
import type { DoctorReport } from "./core/types.js";
import { probeGit } from "./git/probe.js";
import { ClaudeAdapter } from "./providers/claude.js";
import { CodexAdapter } from "./providers/codex.js";

export interface DoctorOptions {
  cwd?: string;
  timeoutMs?: number;
  now?: () => Date;
  runner?: CommandRunner;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const timeoutMs = options.timeoutMs ?? 15_000;
  const now = options.now ?? (() => new Date());
  const runner = options.runner ?? new SpawnCommandRunner();
  const context = { cwd, timeoutMs, now, runner };

  const [git, codex, claude] = await Promise.all([
    probeGit(context),
    new CodexAdapter().probe(context),
    new ClaudeAdapter().probe(context)
  ]);
  const providers = [codex, claude];
  const installedProviders = providers.filter((provider) => provider.installed);

  let overall: DoctorReport["overall"] = "ready";
  if (!git.installed || !git.isRepository || installedProviders.length === 0) {
    overall = "unavailable";
  } else if (
    git.state !== "ready" ||
    providers.some((provider) => provider.state !== "ready")
  ) {
    overall = "degraded";
  }

  return {
    schemaVersion: 1,
    overall,
    cwd,
    generatedAt: now().toISOString(),
    git,
    providers
  };
}
