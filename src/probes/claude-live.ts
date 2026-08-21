import type { CommandRunner } from "../core/command-runner.js";
import type { Diagnostic } from "../core/types.js";
import type { LiveProbeReport, TokenUsage } from "./types.js";

export const CLAUDE_PROBE_MARKER = "SWITCHYARD_READ_ONLY_PROBE_V1";

export interface ClaudeLiveProbeOptions {
  cwd: string;
  timeoutMs: number;
  runner: CommandRunner;
  now?: () => Date;
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
    timeoutMs: options.timeoutMs
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
      if (line.includes(CLAUDE_PROBE_MARKER)) expectedMarkerObserved = true;
      usage = findUsage(event) ?? usage;
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
  if (!expectedMarkerObserved) {
    diagnostics.push({
      id: "claude.probe.marker",
      status: "fail",
      summary: "The expected read-only probe marker was not observed"
    });
  }
  if (result.stderr.trim()) {
    diagnostics.push({
      id: "claude.probe.stderr",
      status: result.exitCode === 0 ? "warning" : "fail",
      summary: "Claude emitted diagnostic output on stderr"
    });
  }

  const state: LiveProbeReport["state"] = result.timedOut
    ? "timed_out"
    : result.exitCode === 0 && expectedMarkerObserved
      ? "completed"
      : "failed";

  return {
    schemaVersion: 1,
    provider: "claude",
    state,
    generatedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    exitCode: result.exitCode,
    eventCount,
    eventTypes,
    expectedMarkerObserved,
    usage,
    diagnostics
  };
}
