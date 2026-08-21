import type { CommandRunner } from "../core/command-runner.js";
import type { Diagnostic } from "../core/types.js";
import type {
  LiveProbeReport,
  ProviderRateLimitInfo,
  TokenUsage
} from "./types.js";
import { CLAUDE_SUBSCRIPTION_IDENTITY } from "../config/claude-identities.js";
import { sanitizedStderrDiagnostic } from "./diagnostics.js";

export const CLAUDE_PROBE_MARKER = "SWITCHYARD_READ_ONLY_PROBE_V1";

export interface ClaudeLiveProbeOptions {
  identityId?: string;
  cwd: string;
  timeoutMs: number;
  runner: CommandRunner;
  now?: () => Date;
  signal?: AbortSignal;
  terminationGraceMs?: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericField(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function findUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.usage) ? value.usage : value;
  const inputTokens = numericField(candidate, "input_tokens");
  const outputTokens = numericField(candidate, "output_tokens");
  const cacheCreationInputTokens = numericField(
    candidate,
    "cache_creation_input_tokens"
  );
  const cacheReadInputTokens = numericField(candidate, "cache_read_input_tokens");

  if (
    inputTokens !== undefined ||
    outputTokens !== undefined ||
    cacheCreationInputTokens !== undefined ||
    cacheReadInputTokens !== undefined
  ) {
    return {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(cacheCreationInputTokens === undefined
        ? {}
        : { cacheCreationInputTokens }),
      ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens })
    };
  }

  for (const child of Object.values(value)) {
    const nested = findUsage(child);
    if (nested) return nested;
  }
  return null;
}

function epochToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  return new Date(milliseconds).toISOString();
}

function rateLimitFromEvent(event: JsonRecord): ProviderRateLimitInfo | undefined {
  if (event.type !== "rate_limit_event" || !isRecord(event.rate_limit_info)) {
    return undefined;
  }
  const info = event.rate_limit_info;
  const rawStatus = typeof info.status === "string" ? info.status : "unknown";
  const status = ["allowed", "allowed_warning", "rejected"].includes(rawStatus)
    ? (rawStatus as ProviderRateLimitInfo["status"])
    : "unknown";
  const resetsAt = epochToIso(info.resetsAt);
  return {
    status,
    ...(typeof info.rateLimitType === "string"
      ? { rateLimitType: info.rateLimitType }
      : {}),
    ...(resetsAt ? { resetsAt } : {}),
    ...(typeof info.utilization === "number"
      ? { utilization: info.utilization }
      : {}),
    ...(typeof info.overageStatus === "string"
      ? { overageStatus: info.overageStatus }
      : {}),
    ...(typeof info.isUsingOverage === "boolean"
      ? { isUsingOverage: info.isUsingOverage }
      : {})
  };
}

export async function runClaudeLiveProbe(
  options: ClaudeLiveProbeOptions
): Promise<LiveProbeReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const result = await options.runner.run({
    command: "claude",
    args: [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--safe-mode",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--tools",
      "Read",
      "--permission-mode",
      "plan",
      `Read README.md only. Reply with exactly ${CLAUDE_PROBE_MARKER} and do not run commands or modify files.`
    ],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
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
  let rateLimit: ProviderRateLimitInfo | undefined;

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
      if (line.includes(CLAUDE_PROBE_MARKER)) expectedMarkerObserved = true;
      usage = findUsage(event) ?? usage;
      rateLimit = rateLimitFromEvent(event) ?? rateLimit;
    } catch {
      malformedLines += 1;
    }
  }

  if (malformedLines > 0) {
    diagnostics.push({
      id: "claude.probe.malformed_events",
      status: "warning",
      summary: `${malformedLines} output line(s) were not JSON events`
    });
  }
  if (result.termination.cause === "timed_out") {
    diagnostics.push({
      id: "claude.probe.timeout",
      status: "fail",
      summary: "Claude probe exceeded its deadline and was terminated"
    });
  } else if (result.termination.cause === "cancelled") {
    diagnostics.push({
      id: "claude.probe.cancelled",
      status: "warning",
      summary: "Claude probe was intentionally cancelled by Switchyard"
    });
  } else if (result.termination.cause === "interrupted") {
    diagnostics.push({
      id: "claude.probe.interrupted",
      status: "fail",
      summary: "Claude stopped without a confirmed terminal outcome"
    });
  } else if (!expectedMarkerObserved) {
    diagnostics.push({
      id: "claude.probe.marker",
      status: "fail",
      summary: "The expected read-only probe marker was not observed"
    });
  }
  if (result.stderr.trim()) {
    diagnostics.push(
      sanitizedStderrDiagnostic({
        provider: "claude",
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
    provider: "claude",
    identityId: options.identityId ?? CLAUDE_SUBSCRIPTION_IDENTITY,
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
    ...(rateLimit ? { rateLimit } : {}),
    diagnostics
  };
}
