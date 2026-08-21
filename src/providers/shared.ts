import type { UsageSnapshot } from "../core/types.js";

export function unknownUsage(
  observedAt: string,
  source: string,
  note: string
): UsageSnapshot {
  return {
    state: "unknown",
    confidence: "unknown",
    source,
    observedAt,
    windows: [],
    note
  };
}

export function cleanVersion(output: string): string | undefined {
  const firstLine = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || undefined;
}
