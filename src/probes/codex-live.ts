import type { CommandRunner } from "../core/command-runner.js";
import type { Diagnostic } from "../core/types.js";
import type { LiveProbeReport, TokenUsage } from "./types.js";
import { sanitizedStderrDiagnostic } from "./diagnostics.js";

export const CODEX_PROBE_MARKER = "SWITCHYARD_READ_ONLY_PROBE_V1";

export interface CodexLiveProbeOptions {
  identityId: string;
  cwd: string;
  timeoutMs: number;
  runner: CommandRunner;
  now?: () => Date;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
  terminationGraceMs?: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericField(record: JsonRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function findUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.usage) ? value.usage : value;
  const inputTokens = numericField(candidate, "input_tokens", "inputTokens");
  const cachedInputTokens = numericField(
    candidate,
    "cached_input_tokens",
    "cachedInputTokens"
  );
  const outputTokens = numericField(candidate, "output_tokens", "outputTokens");

  if (
    inputTokens !== undefined ||
    cachedInputTokens !== undefined ||
    outputTokens !== undefined
  ) {
    return {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens })
    };
  }

  for (const child of Object.values(value)) {
    const nested = findUsage(child);
    if (nested) return nested;
  }
  return null;
}

export async function runCodexLiveProbe(
  options: CodexLiveProbeOptions
): Promise<LiveProbeReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const result = await options.runner.run({
    command: "codex",
    args: [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-C",
      options.cwd,
      `Read README.md only. Reply with exactly ${CODEX_PROBE_MARKER} and do not run commands or modify files.`
    ],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.terminationGraceMs === undefined
      ? {}
      : { terminationGraceMs: options.terminationGraceMs })
  });
  const finishedAt = now();
  const eventTypes: Record<string, number> = {};
  const diagnostics: Diagnostic[] = [];
  let eventCount = 0;
  let malformedLines = 0;
  let expectedMarkerObserved = false;
  let usage: TokenUsage | null = null;

  for (const line of result.stdout.split(/\r?\n/u).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as unknown;
      if (!isRecord(event)) {
        malformedLines += 1;
        continue;
      }
      eventCount += 1;
      const type = typeof event.type === "string" ? event.type : "unknown";
      eventTypes[type] = (eventTypes[type] ?? 0) + 1;
      if (line.includes(CODEX_PROBE_MARKER)) expectedMarkerObserved = true;
      usage = findUsage(event) ?? usage;
    } catch {
      malformedLines += 1;
    }
  }

  if (malformedLines > 0) {
    diagnostics.push({
      id: "codex.probe.malformed_events",
      status: "warning",
      summary: `${malformedLines} output line(s) were not JSON events`
    });
  }
  if (result.termination.cause === "timed_out") {
    diagnostics.push({
      id: "codex.probe.timeout",
      status: "fail",
      summary: "Codex probe exceeded its deadline and was terminated"
    });
  } else if (result.termination.cause === "cancelled") {
    diagnostics.push({
      id: "codex.probe.cancelled",
      status: "warning",
      summary: "Codex probe was intentionally cancelled by Switchyard"
    });
  } else if (result.termination.cause === "interrupted") {
    diagnostics.push({
      id: "codex.probe.interrupted",
      status: "fail",
      summary: "Codex stopped without a confirmed terminal outcome"
    });
  } else if (!expectedMarkerObserved) {
    diagnostics.push({
      id: "codex.probe.marker",
      status: "fail",
      summary: "The expected read-only probe marker was not observed"
    });
  }
  if (result.stderr.trim()) {
    diagnostics.push(
      sanitizedStderrDiagnostic({
        provider: "codex",
        stderr: result.stderr,
        status:
        result.exitCode === 0 ||
        result.termination.cause === "cancelled" ||
        result.termination.cause === "timed_out"
          ? "warning"
          : "fail"
      })
    );
  }

  const state: LiveProbeReport["state"] =
    result.termination.cause === "timed_out"
      ? "timed_out"
      : result.termination.cause === "cancelled"
        ? "cancelled"
        : result.termination.cause === "interrupted"
          ? "interrupted"
          : result.exitCode === 0 && expectedMarkerObserved
            ? "completed"
            : "failed";

  return {
    schemaVersion: 1,
    provider: "codex",
    identityId: options.identityId,
    state,
    generatedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    exitCode: result.exitCode,
    signal: result.signal,
    termination: result.termination,
    eventCount,
    eventTypes,
    expectedMarkerObserved,
    usage,
    diagnostics
  };
}
