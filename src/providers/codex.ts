import { z } from "zod";
import { extractJsonObject } from "../core/json.js";
import type { Diagnostic, ProviderProbe } from "../core/types.js";
import type { ProbeContext, ProviderAdapter } from "./provider.js";
import { cleanVersion, unknownUsage } from "./shared.js";

const codexCheckSchema = z.object({
  status: z.enum(["ok", "warning", "fail"]),
  summary: z.string(),
  remediation: z.string().nullable().optional()
});

const codexDoctorSchema = z.object({
  checks: z.record(z.string(), codexCheckSchema)
});

function diagnosticsFromDoctor(
  checks: Record<string, z.infer<typeof codexCheckSchema>>
): Diagnostic[] {
  return Object.entries(checks)
    .filter(([, check]) => check.status !== "ok")
    .map(([id, check]) => ({
      id: `codex.${id}`,
      status: check.status,
      summary: check.summary,
      ...(check.remediation ? { remediation: check.remediation } : {})
    }));
}

export class CodexAdapter implements ProviderAdapter {
  readonly id = "codex" as const;

  async probe(context: ProbeContext): Promise<ProviderProbe> {
    const observedAt = context.now().toISOString();
    const base = {
      id: this.id,
      displayName: "Codex",
      command: "codex",
      observedAt,
      capabilities: {
        nonInteractive: true,
        structuredEvents: true,
        machineReadableAuth: true,
        machineReadableHealth: true,
        machineReadableUsage: false
      },
      usage: unknownUsage(
        observedAt,
        "codex doctor --json",
        "This Codex version reports health and authentication, but not remaining subscription usage in machine-readable output."
      )
    } satisfies Partial<ProviderProbe>;

    const versionResult = await context.runner.run({
      command: "codex",
      args: ["--version"],
      cwd: context.cwd,
      timeoutMs: context.timeoutMs
    });

    if (versionResult.errorCode === "ENOENT") {
      return {
        ...base,
        state: "not_installed",
        installed: false,
        authenticated: null,
        reachable: null,
        canRun: false,
        diagnostics: [
          {
            id: "codex.installation",
            status: "fail",
            summary: "Codex CLI was not found on PATH",
            remediation: "Install Codex and authenticate it independently before enabling this adapter."
          }
        ]
      } as ProviderProbe;
    }

    const version = cleanVersion(versionResult.stdout || versionResult.stderr);
    const doctorResult = await context.runner.run({
      command: "codex",
      args: ["doctor", "--json"],
      cwd: context.cwd,
      timeoutMs: context.timeoutMs
    });

    if (doctorResult.timedOut) {
      return {
        ...base,
        state: "error",
        installed: true,
        authenticated: null,
        reachable: null,
        canRun: false,
        ...(version ? { version } : {}),
        diagnostics: [
          {
            id: "codex.doctor.timeout",
            status: "fail",
            summary: "codex doctor timed out"
          }
        ]
      } as ProviderProbe;
    }

    try {
      const doctor = codexDoctorSchema.parse(
        extractJsonObject(`${doctorResult.stdout}\n${doctorResult.stderr}`)
      );
      const auth = doctor.checks["auth.credentials"];
      const reachability = doctor.checks["network.provider_reachability"];
      const authenticated = auth ? auth.status === "ok" : null;
      const reachable = reachability ? reachability.status === "ok" : null;
      const canRun = authenticated === true && reachable !== false;

      let state: ProviderProbe["state"] = "degraded";
      if (authenticated === false) state = "unauthenticated";
      else if (reachable === false) state = "unreachable";
      else if (authenticated === true && reachable === true) state = "ready";

      return {
        ...base,
        state,
        installed: true,
        authenticated,
        reachable,
        canRun,
        ...(version ? { version } : {}),
        diagnostics: diagnosticsFromDoctor(doctor.checks)
      } as ProviderProbe;
    } catch (error) {
      return {
        ...base,
        state: "error",
        installed: true,
        authenticated: null,
        reachable: null,
        canRun: false,
        ...(version ? { version } : {}),
        diagnostics: [
          {
            id: "codex.doctor.parse",
            status: "fail",
            summary: `Could not parse codex doctor output: ${error instanceof Error ? error.message : String(error)}`,
            remediation: "Check adapter compatibility with the installed Codex version."
          }
        ]
      } as ProviderProbe;
    }
  }
}
