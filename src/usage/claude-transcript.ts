import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { UsageSnapshot } from "../core/types.js";

export interface ClaudeTokenTotals {
  output: number;
  input: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface UsageCalibration {
  at: number;
  percent: number;
  label: string;
}

export interface CalibrationResidual {
  label: string;
  actualPercent: number;
  predictedPercent: number;
}

export interface ClaudeUsageProxyReport {
  schemaVersion: 1;
  provider: "claude";
  method: "transcript_weighted_proxy";
  windowHours: number;
  generatedAt: string;
  requestCount: number;
  sourceAvailable: boolean;
  filesScanned: number;
  malformedLines: number;
  readErrors: number;
  totals: ClaudeTokenTotals;
  weightedUnits: number;
  usage: UsageSnapshot;
  calibrationResiduals: CalibrationResidual[];
  burnPercentPer15Minutes?: number;
  minutesTo90Percent?: number;
}

interface UsageRow extends ClaudeTokenTotals {
  timestamp: number;
}

interface TranscriptRecord {
  timestamp?: unknown;
  message?: {
    usage?: {
      output_tokens?: unknown;
      input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
      cache_read_input_tokens?: unknown;
    };
  };
}

export interface ClaudeUsageProxyOptions {
  root: string;
  windowHours?: number;
  calibrations?: UsageCalibration[];
  now?: () => Date;
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function weight(row: ClaudeTokenTotals): number {
  return (
    row.output * 10 +
    row.cacheCreation * 1.25 +
    row.input +
    row.cacheRead * 0.1
  );
}

async function jsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await jsonlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

async function rowsFromFile(
  path: string
): Promise<{ rows: UsageRow[]; malformedLines: number }> {
  const rows: UsageRow[] = [];
  let malformedLines = 0;
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line) continue;
    try {
      const record = JSON.parse(line) as TranscriptRecord;
      const usage = record.message?.usage;
      const timestamp =
        typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
      if (!usage || !Number.isFinite(timestamp)) continue;
      rows.push({
        timestamp,
        output: tokenCount(usage.output_tokens),
        input: tokenCount(usage.input_tokens),
        cacheCreation: tokenCount(usage.cache_creation_input_tokens),
        cacheRead: tokenCount(usage.cache_read_input_tokens)
      });
    } catch {
      malformedLines += 1;
    }
  }

  return { rows, malformedLines };
}

export function parseCalibrations(value: string): UsageCalibration[] {
  if (!value.trim()) return [];
  return value.split(",").map((pair) => {
    const separator = pair.lastIndexOf("=");
    if (separator < 1) throw new Error(`Invalid calibration point: ${pair}`);
    const label = pair.slice(0, separator).trim();
    const percent = Number(pair.slice(separator + 1));
    const at = Date.parse(label);
    if (!Number.isFinite(at) || !Number.isFinite(percent) || percent <= 0) {
      throw new Error(`Invalid calibration point: ${pair}`);
    }
    return { at, percent, label };
  });
}

export async function estimateClaudeUsage(
  options: ClaudeUsageProxyOptions
): Promise<ClaudeUsageProxyReport> {
  const now = options.now ?? (() => new Date());
  const generatedAt = now();
  const nowMs = generatedAt.getTime();
  const windowHours = options.windowHours ?? 5;
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new Error("windowHours must be a positive number");
  }
  const windowMs = windowHours * 3_600_000;
  let files: string[] = [];
  let sourceAvailable = true;
  try {
    files = await jsonlFiles(options.root);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    if (code !== "ENOENT") throw error;
    sourceAvailable = false;
  }
  const rows: UsageRow[] = [];
  let malformedLines = 0;
  let readErrors = 0;

  for (const file of files) {
    try {
      const parsed = await rowsFromFile(file);
      rows.push(...parsed.rows);
      malformedLines += parsed.malformedLines;
    } catch {
      readErrors += 1;
    }
  }
  rows.sort((left, right) => left.timestamp - right.timestamp);

  const windowTotal = (at: number): number =>
    rows
      .filter((row) => row.timestamp >= at - windowMs && row.timestamp <= at)
      .reduce((sum, row) => sum + weight(row), 0);
  const recent = rows.filter(
    (row) => row.timestamp >= nowMs - windowMs && row.timestamp <= nowMs
  );
  const totals = recent.reduce<ClaudeTokenTotals>(
    (sum, row) => ({
      output: sum.output + row.output,
      input: sum.input + row.input,
      cacheCreation: sum.cacheCreation + row.cacheCreation,
      cacheRead: sum.cacheRead + row.cacheRead
    }),
    { output: 0, input: 0, cacheCreation: 0, cacheRead: 0 }
  );
  const weightedUnits = recent.reduce((sum, row) => sum + weight(row), 0);
  const calibrations = [...(options.calibrations ?? [])].sort(
    (left, right) => left.at - right.at
  );
  const anchor = calibrations.at(-1);
  let usage: UsageSnapshot = {
    state: "unknown",
    confidence: "unknown",
    source: "claude transcript weighted proxy",
    observedAt: generatedAt.toISOString(),
    windows: [{ name: `${windowHours}h rolling` }],
    note: sourceAvailable
      ? "Weighted transcript tokens are available, but no calibration point was supplied; no percentage was inferred."
      : "The Claude Code transcript directory does not exist yet; complete a persisted CLI session before using this proxy."
  };
  const calibrationResiduals: CalibrationResidual[] = [];
  let burnPercentPer15Minutes: number | undefined;
  let minutesTo90Percent: number | undefined;

  if (anchor) {
    const anchorTotal = windowTotal(anchor.at);
    const unitsPerPercent = anchorTotal / anchor.percent;
    if (!Number.isFinite(unitsPerPercent) || unitsPerPercent <= 0) {
      throw new Error("The newest calibration point has no weighted usage in its window");
    }
    for (const older of calibrations.slice(0, -1)) {
      calibrationResiduals.push({
        label: older.label,
        actualPercent: older.percent,
        predictedPercent: windowTotal(older.at) / unitsPerPercent
      });
    }
    const estimatedPercent = weightedUnits / unitsPerPercent;
    const state =
      estimatedPercent >= 90
        ? "paused"
        : estimatedPercent >= 85
          ? "draining"
          : "available";
    usage = {
      state,
      confidence: "estimated",
      source: "claude transcript weighted proxy with operator calibration",
      observedAt: generatedAt.toISOString(),
      windows: [
        {
          name: `${windowHours}h rolling`,
          usedPercent: estimatedPercent
        }
      ],
      note: "Estimated from local transcript token fields and operator calibration; it is not Anthropic's plan-usage value."
    };
    const previousTotal = windowTotal(nowMs - 15 * 60_000);
    const burn = (weightedUnits - previousTotal) / unitsPerPercent;
    if (burn > 0) {
      burnPercentPer15Minutes = burn;
      if (estimatedPercent < 90) {
        minutesTo90Percent = ((90 - estimatedPercent) / burn) * 15;
      }
    }
  }

  return {
    schemaVersion: 1,
    provider: "claude",
    method: "transcript_weighted_proxy",
    windowHours,
    generatedAt: generatedAt.toISOString(),
    requestCount: recent.length,
    sourceAvailable,
    filesScanned: files.length,
    malformedLines,
    readErrors,
    totals,
    weightedUnits,
    usage,
    calibrationResiduals,
    ...(burnPercentPer15Minutes === undefined ? {} : { burnPercentPer15Minutes }),
    ...(minutesTo90Percent === undefined ? {} : { minutesTo90Percent })
  };
}
