import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  estimateClaudeUsage,
  parseCalibrations
} from "../../src/usage/claude-transcript.js";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/claude-transcripts", import.meta.url)
);

describe("Claude transcript usage proxy", () => {
  it("reports weighted activity without inventing a percentage", async () => {
    const report = await estimateClaudeUsage({
      root: fixtureRoot,
      windowHours: 5,
      now: () => new Date("2026-08-21T05:00:00.000Z")
    });

    expect(report).toMatchObject({
      requestCount: 2,
      sourceAvailable: true,
      filesScanned: 1,
      malformedLines: 1,
      totals: {
        output: 14,
        input: 20,
        cacheCreation: 0,
        cacheRead: 0
      },
      weightedUnits: 160,
      usage: {
        state: "unknown",
        confidence: "unknown",
        windows: [{ name: "5h rolling" }]
      }
    });
    expect(report.usage.windows[0]).not.toHaveProperty("usedPercent");
    expect(JSON.stringify(report)).not.toContain("session-secret");
    expect(JSON.stringify(report)).not.toContain("content is ignored");
  });

  it("reports a missing transcript root without crashing", async () => {
    const report = await estimateClaudeUsage({
      root: `${fixtureRoot}-missing`,
      now: () => new Date("2026-08-21T05:00:00.000Z")
    });

    expect(report).toMatchObject({
      sourceAvailable: false,
      requestCount: 0,
      filesScanned: 0,
      usage: { state: "unknown", confidence: "unknown" }
    });
  });

  it("produces an explicitly estimated percentage from an operator anchor", async () => {
    const report = await estimateClaudeUsage({
      root: fixtureRoot,
      windowHours: 5,
      calibrations: parseCalibrations("2026-08-21T04:40:00.000Z=55"),
      now: () => new Date("2026-08-21T05:00:00.000Z")
    });

    expect(report.usage).toMatchObject({
      state: "available",
      confidence: "estimated",
      windows: [expect.objectContaining({ usedPercent: 80 })]
    });
    expect(report.burnPercentPer15Minutes).toBe(25);
    expect(report.minutesTo90Percent).toBe(6);
  });

  it("rejects invalid or unusable calibration points", async () => {
    expect(() => parseCalibrations("not-a-point")).toThrow(
      "Invalid calibration point"
    );
    await expect(
      estimateClaudeUsage({
        root: fixtureRoot,
        calibrations: parseCalibrations("2026-08-20T00:00:00.000Z=50"),
        now: () => new Date("2026-08-21T05:00:00.000Z")
      })
    ).rejects.toThrow("no weighted usage");
  });
});
