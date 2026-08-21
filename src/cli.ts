#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { SpawnCommandRunner } from "./core/command-runner.js";
import { runDoctor } from "./doctor.js";
import { runCodexLiveProbe } from "./probes/codex-live.js";
import { renderDoctor } from "./reporting/render-doctor.js";

const program = new Command();

program
  .name("switchyard")
  .description("Local-first orchestration for subscription-backed coding agents")
  .version("0.0.0");

program
  .command("doctor")
  .description("Probe Git and installed coding-agent CLIs without reading credentials")
  .option("--json", "emit the normalized report as JSON")
  .option("-C, --cwd <path>", "working directory to inspect", process.cwd())
  .option("--timeout <milliseconds>", "per-command timeout", "15000")
  .action(async (options: { json?: boolean; cwd: string; timeout: string }) => {
    const timeoutMs = Number.parseInt(options.timeout, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new Error("--timeout must be a positive integer");
    }

    const report = await runDoctor({ cwd: options.cwd, timeoutMs });
    process.stdout.write(
      options.json ? `${JSON.stringify(report, null, 2)}\n` : renderDoctor(report)
    );
    if (report.overall === "unavailable") process.exitCode = 1;
  });

program
  .command("probe")
  .description("Run an explicit, bounded provider protocol experiment")
  .argument("<provider>", "provider to probe; currently codex")
  .requiredOption("--live", "acknowledge that this sends a fixed read-only prompt")
  .requiredOption("-C, --cwd <path>", "disposable fixture directory")
  .option("--timeout <milliseconds>", "probe deadline", "60000")
  .action(
    async (
      provider: string,
      options: { live: boolean; cwd: string; timeout: string }
    ) => {
      if (provider !== "codex") {
        throw new Error(`Unsupported live probe provider: ${provider}`);
      }
      const timeoutMs = Number.parseInt(options.timeout, 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
        throw new Error("--timeout must be a positive integer");
      }
      const report = await runCodexLiveProbe({
        cwd: resolve(options.cwd),
        timeoutMs,
        runner: new SpawnCommandRunner()
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.state !== "completed") process.exitCode = 1;
    }
  );

await program.parseAsync();
