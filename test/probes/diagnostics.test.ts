import { describe, expect, it } from "vitest";
import { sanitizedStderrDiagnostic } from "../../src/probes/diagnostics.js";

describe("sanitizedStderrDiagnostic", () => {
  it.each([
    ["error: unexpected argument", "Codex rejected the probe command shape"],
    ["authentication required", "Codex requires provider authentication"],
    [
      "failed to connect to provider endpoint",
      "Codex could not reach a required provider endpoint"
    ],
    [
      "operation not permitted",
      "Codex encountered a local permission boundary"
    ],
    [
      "invalid configuration",
      "Codex reported a local configuration problem"
    ]
  ])("normalizes %s without returning it", (stderr, summary) => {
    const diagnostic = sanitizedStderrDiagnostic({
      provider: "codex",
      stderr,
      status: "fail"
    });

    expect(diagnostic).toEqual({
      id: "codex.probe.stderr",
      status: "fail",
      summary
    });
    expect(diagnostic.summary).not.toContain(stderr);
  });
});
