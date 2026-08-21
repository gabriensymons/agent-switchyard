import { describe, expect, it } from "vitest";
import type { DoctorReport } from "../../src/core/types.js";
import { renderDoctor } from "../../src/reporting/render-doctor.js";

describe("renderDoctor", () => {
  it("renders unknown usage without inventing a percentage", () => {
    const report: DoctorReport = {
      schemaVersion: 1,
      overall: "degraded",
      cwd: "/fixture",
      generatedAt: "2026-08-21T00:00:00.000Z",
      git: {
        state: "ready",
        installed: true,
        isRepository: true,
        clean: true,
        root: "/fixture",
        branch: "spike",
        observedAt: "2026-08-21T00:00:00.000Z",
        diagnostics: []
      },
      providers: [
        {
          id: "codex",
          displayName: "Codex",
          command: "codex",
          state: "ready",
          installed: true,
          authenticated: true,
          reachable: true,
          canRun: true,
          capabilities: {
            nonInteractive: true,
            structuredEvents: true,
            machineReadableAuth: true,
            machineReadableHealth: true,
            machineReadableUsage: false
          },
          usage: {
            state: "unknown",
            confidence: "unknown",
            source: "fixture",
            observedAt: "2026-08-21T00:00:00.000Z",
            windows: []
          },
          diagnostics: [],
          observedAt: "2026-08-21T00:00:00.000Z"
        }
      ]
    };

    const output = renderDoctor(report);
    expect(output).toContain("usage: unknown");
    expect(output).not.toMatch(/\d+%/u);
  });
});
