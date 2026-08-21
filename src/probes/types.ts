import type { Diagnostic } from "../core/types.js";

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface LiveProbeReport {
  schemaVersion: 1;
  provider: "codex";
  state: "completed" | "failed" | "timed_out";
  generatedAt: string;
  durationMs: number;
  exitCode: number | null;
  eventCount: number;
  eventTypes: Record<string, number>;
  expectedMarkerObserved: boolean;
  usage: TokenUsage | null;
  diagnostics: Diagnostic[];
}
