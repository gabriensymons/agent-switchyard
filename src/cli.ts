#!/usr/bin/env node
import { Command } from "commander";
import { randomUUID } from "node:crypto";
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
import {
  CODEX_DEFAULT_IDENTITY,
  CODEX_ISOLATED_IDENTITY,
  codexIdentity
} from "./config/codex-identities.js";
import { loginCodexIdentity, prepareCodexIdentity } from "./auth/codex.js";
import { CLAUDE_SUBSCRIPTION_IDENTITY } from "./config/claude-identities.js";
import { switchyardStateRoot } from "./config/state.js";
import { RunLifecycle } from "./runs/lifecycle.js";
import { RunStore } from "./runs/store.js";

const program = new Command();

type ProviderName = "codex" | "claude";

function providerName(value: string): ProviderName {
  if (value !== "codex" && value !== "claude") {
    throw new Error(`Unsupported provider: ${value}`);
  }
  return value;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function providerIdentity(
  provider: ProviderName,
  requested?: string
): string {
  if (provider === "codex") {
    const identityId = requested ?? CODEX_DEFAULT_IDENTITY;
    codexIdentity(identityId);
    return identityId;
  }
  const identityId = requested ?? CLAUDE_SUBSCRIPTION_IDENTITY;
  if (identityId !== CLAUDE_SUBSCRIPTION_IDENTITY) {
    throw new Error(
      `Unknown Claude identity: ${identityId}. Expected ${CLAUDE_SUBSCRIPTION_IDENTITY}.`
    );
  }
  return identityId;
}

async function runFixedProbe(options: {
  provider: ProviderName;
  identityId: string;
  cwd: string;
  timeoutMs: number;
  terminationGraceMs?: number;
  signal?: AbortSignal;
  runner: SpawnCommandRunner;
}) {
  const shared = {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    runner: options.runner,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.terminationGraceMs === undefined
      ? {}
      : { terminationGraceMs: options.terminationGraceMs })
  };
  return options.provider === "codex"
    ? await runCodexLiveProbe({
        ...shared,
        identityId: options.identityId,
        environment: codexIdentity(options.identityId).environment
      })
    : await runClaudeLiveProbe({
        ...shared,
        identityId: options.identityId
      });
}

program
  .name("switchyard")
  .description("Local-first orchestration for subscription-backed coding agents")
  .version("0.0.0");

program
  .command("auth")
  .description("Prepare or authenticate an isolated provider identity")
  .argument("<action>", "prepare or login")
  .argument("<identity>", "provider identity; currently codex-isolated")
  .option("--device-auth", "use Codex device-code authentication")
  .option("--state-root <path>", "override Switchyard's local state root")
  .action(
    async (
      action: string,
      identityId: string,
      options: { deviceAuth?: boolean; stateRoot?: string }
    ) => {
      if (action !== "prepare" && action !== "login") {
        throw new Error(`Unsupported auth action: ${action}`);
      }
      if (identityId !== CODEX_ISOLATED_IDENTITY) {
        throw new Error(
          "Switchyard only manages the codex-isolated identity; codex-default is never modified."
        );
      }
      const identity = codexIdentity(identityId, {
        ...(options.stateRoot ? { stateRoot: options.stateRoot } : {})
      });
      if (action === "prepare") {
        const result = await prepareCodexIdentity(identity);
        process.stdout.write(
          `Prepared ${result.id} at ${result.codexHome} (${result.createdConfig ? "created" : "kept"} config.toml).\n`
        );
        return;
      }

      const exitCode = await loginCodexIdentity(identity, {
        ...(options.deviceAuth === undefined
          ? {}
          : { deviceAuth: options.deviceAuth })
      });
      if (exitCode !== 0) process.exitCode = exitCode;
    }
  );

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
  .option(
    "--identity <id>",
    "provider identity to invoke"
  )
  .option("--timeout <milliseconds>", "probe deadline", "60000")
  .action(
    async (
      provider: string,
      options: {
        live: boolean;
        cwd: string;
        identity?: string;
        timeout: string;
      }
    ) => {
      const selectedProvider = providerName(provider);
      const timeoutMs = positiveInteger(options.timeout, "--timeout");
      const identityId = providerIdentity(
        selectedProvider,
        options.identity
      );
      const report = await runFixedProbe({
        provider: selectedProvider,
        identityId,
        cwd: resolve(options.cwd),
        timeoutMs,
        runner: new SpawnCommandRunner()
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.state !== "completed") process.exitCode = 1;
    }
  );

const experiment = program
  .command("experiment")
  .description("Run explicit, bounded lifecycle experiments");

experiment
  .command("cancel")
  .description("Cancel a fixed read-only provider probe and persist its run state")
  .argument("<provider>", "codex or claude")
  .requiredOption("--live", "acknowledge that this sends a fixed read-only prompt")
  .requiredOption("-C, --cwd <path>", "disposable Git worktree root")
  .option("--identity <id>", "provider identity to invoke")
  .option("--timeout <milliseconds>", "absolute probe deadline", "60000")
  .option("--cancel-after <milliseconds>", "intentional cancellation delay", "500")
  .option("--termination-grace <milliseconds>", "SIGTERM grace period", "1000")
  .option("--state-root <path>", "override Switchyard's local state root")
  .action(
    async (
      provider: string,
      options: {
        live: boolean;
        cwd: string;
        identity?: string;
        timeout: string;
        cancelAfter: string;
        terminationGrace: string;
        stateRoot?: string;
      }
    ) => {
      const selectedProvider = providerName(provider);
      const identityId = providerIdentity(
        selectedProvider,
        options.identity
      );
      const timeoutMs = positiveInteger(options.timeout, "--timeout");
      const cancelAfterMs = positiveInteger(
        options.cancelAfter,
        "--cancel-after"
      );
      const terminationGraceMs = positiveInteger(
        options.terminationGrace,
        "--termination-grace"
      );
      if (cancelAfterMs >= timeoutMs) {
        throw new Error("--cancel-after must be less than --timeout");
      }
      const stateRoot = switchyardStateRoot(options.stateRoot);
      const worktreePath = resolve(options.cwd);
      const runner = new SpawnCommandRunner();
      const lifecycle = new RunLifecycle({ stateRoot, runner });
      const controller = new AbortController();
      const result = await lifecycle.start({
        runId: randomUUID(),
        attemptId: randomUUID(),
        provider: selectedProvider,
        identityId,
        repositoryPath: worktreePath,
        worktreePath,
        execute: async () => {
          const cancel = setTimeout(
            () => controller.abort(),
            cancelAfterMs
          );
          try {
            return await runFixedProbe({
              provider: selectedProvider,
              identityId,
              cwd: worktreePath,
              timeoutMs,
              terminationGraceMs,
              signal: controller.signal,
              runner
            });
          } finally {
            clearTimeout(cancel);
          }
        }
      });
      process.stdout.write(
        `${JSON.stringify({ run: result.record, probe: result.report }, null, 2)}\n`
      );
      if (result.report.state !== "cancelled") process.exitCode = 1;
    }
  );

experiment
  .command("restart")
  .description("Start a fresh probe attempt from a cancelled or interrupted run")
  .argument("<run-id>", "persisted run identifier")
  .requiredOption("--live", "acknowledge that this sends a fixed read-only prompt")
  .option("--timeout <milliseconds>", "probe and worktree-check deadline", "60000")
  .option("--state-root <path>", "override Switchyard's local state root")
  .action(
    async (
      runId: string,
      options: { live: boolean; timeout: string; stateRoot?: string }
    ) => {
      const timeoutMs = positiveInteger(options.timeout, "--timeout");
      const stateRoot = switchyardStateRoot(options.stateRoot);
      const runner = new SpawnCommandRunner();
      const lifecycle = new RunLifecycle({ stateRoot, runner });
      const store = new RunStore(stateRoot);
      const persisted = await store.load(runId);
      const result = await lifecycle.restart({
        runId,
        attemptId: randomUUID(),
        worktreeCheckTimeoutMs: timeoutMs,
        execute: async () =>
          await runFixedProbe({
            provider: persisted.provider,
            identityId: persisted.identityId,
            cwd: persisted.worktreePath,
            timeoutMs,
            runner
          })
      });
      process.stdout.write(
        `${JSON.stringify({ run: result.record, probe: result.report }, null, 2)}\n`
      );
      if (result.report.state !== "completed") process.exitCode = 1;
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
