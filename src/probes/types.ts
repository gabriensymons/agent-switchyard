import type { Diagnostic } from "../core/types.js";
import type { CommandTermination } from "../core/command-runner.js";

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
}

export interface ProviderRateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected" | "unknown";
  rateLimitType?: string;
  resetsAt?: string;
  utilization?: number;
  overageStatus?: string;
  isUsingOverage?: boolean;
}

export interface LiveProbeReport {
  schemaVersion: 1;
  provider: "codex" | "claude";
  identityId: string;
  state:
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "timed_out";
  generatedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  termination: CommandTermination;
  eventCount: number;
  eventTypes: Record<string, number>;
  expectedMarkerObserved: boolean;
  usage: TokenUsage | null;
  rateLimit?: ProviderRateLimitInfo;
  diagnostics: Diagnostic[];
}
