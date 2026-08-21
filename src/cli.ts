#!/usr/bin/env node
import { Command } from "commander";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { SpawnCommandRunner } from "./core/command-runner.js";
import { runDoctor } from "./doctor.js";
import { runClaudeLiveProbe } from "./probes/claude-live.js";
import { runCodexLiveProbe } from "./probes/codex-live.js";
import { renderDoctor } from "./reporting/render-doctor.js";
import { renderClaudeUsage } from "./reporting/render-claude-usage.js";
import {
  estimateClaudeUsage,
  parseCalibrations
} from "./usage/claude-transcript.js";

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
      if (provider !== "codex" && provider !== "claude") {
        throw new Error(`Unsupported live probe provider: ${provider}`);
      }
      const timeoutMs = Number.parseInt(options.timeout, 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
        throw new Error("--timeout must be a positive integer");
      }
      const probeOptions = {
        cwd: resolve(options.cwd),
        timeoutMs,
        runner: new SpawnCommandRunner()
      };
      const report =
        provider === "codex"
          ? await runCodexLiveProbe(probeOptions)
          : await runClaudeLiveProbe(probeOptions);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.state !== "completed") process.exitCode = 1;
    }
  );

program
  .command("usage")
  .description("Inspect an explicitly selected provider usage source")
  .argument("<provider>", "provider to inspect; currently claude")
  .option("--json", "emit the report as JSON")
  .option(
    "--root <path>",
    "Claude Code transcript root",
    resolve(homedir(), ".claude", "projects")
  )
  .option("--window-hours <hours>", "rolling window length", "5")
  .option(
    "--calibration <points>",
    "comma-separated ISO=pct observations; newest point sets the scale"
  )
  .action(
    async (
      provider: string,
      options: {
        json?: boolean;
        root: string;
        windowHours: string;
        calibration?: string;
      }
    ) => {
      if (provider !== "claude") {
        throw new Error(`Unsupported usage provider: ${provider}`);
      }
      const windowHours = Number(options.windowHours);
      const report = await estimateClaudeUsage({
        root: resolve(options.root),
        windowHours,
        calibrations: parseCalibrations(options.calibration ?? "")
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : renderClaudeUsage(report)
      );
    }
  );

await program.parseAsync();
