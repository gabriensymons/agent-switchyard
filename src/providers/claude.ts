import { z } from "zod";
import { extractJsonObject } from "../core/json.js";
import type {
  Diagnostic,
  ProviderAuthMode,
  ProviderProbe
} from "../core/types.js";
import type { ProbeContext, ProviderAdapter } from "./provider.js";
import { cleanVersion, unknownUsage } from "./shared.js";

const claudeAuthSchema = z
  .object({
    authenticated: z.boolean().optional(),
    authMethod: z.string().optional(),
    loggedIn: z.boolean().optional(),
    status: z.string().optional()
  })
  .passthrough();

function authValue(value: z.infer<typeof claudeAuthSchema>): boolean | null {
  if (value.authenticated !== undefined) return value.authenticated;
  if (value.loggedIn !== undefined) return value.loggedIn;
  if (value.status) {
    const normalized = value.status.toLowerCase();
    if (["authenticated", "logged_in", "ready"].includes(normalized)) return true;
    if (["unauthenticated", "logged_out", "not_logged_in"].includes(normalized)) return false;
  }
  return null;
}

function authMode(value: z.infer<typeof claudeAuthSchema>): ProviderAuthMode {
  const method = value.authMethod?.toLowerCase();
  if (method?.includes("api")) return "api_key";
  if (method?.includes("token")) return "access_token";
  if (method?.includes("subscription") || method?.includes("oauth")) {
    return "subscription";
  }
  return "unknown";
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly id = "claude" as const;

  async probe(context: ProbeContext): Promise<ProviderProbe> {
    const observedAt = context.now().toISOString();
    const base = {
      id: this.id,
      displayName: "Claude Code",
      command: "claude",
      observedAt,
      capabilities: {
        nonInteractive: true,
        structuredEvents: true,
        machineReadableAuth: true,
        machineReadableHealth: false,
        machineReadableUsage: false
      },
      usage: unknownUsage(
        observedAt,
        "claude auth status --json",
        "No stable machine-readable subscription quota was observed during M0; usage must remain unknown until a supported signal is verified."
      )
    } satisfies Partial<ProviderProbe>;

    const versionResult = await context.runner.run({
      command: "claude",
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
        authMode: "unknown",
        reachable: null,
        canRun: false,
        diagnostics: [
          {
            id: "claude.installation",
            status: "warning",
            summary: "Claude Code CLI was not found on PATH",
            remediation: "Install Claude Code and authenticate it independently to enable this optional adapter."
          }
        ]
      } as ProviderProbe;
    }

    const version = cleanVersion(versionResult.stdout || versionResult.stderr);
    const authResult = await context.runner.run({
      command: "claude",
      args: ["auth", "status", "--json"],
      cwd: context.cwd,
      timeoutMs: context.timeoutMs
    });
    const diagnostics: Diagnostic[] = [];
    let authenticated: boolean | null = null;
    let detectedAuthMode: ProviderAuthMode = "unknown";

    if (authResult.timedOut) {
      diagnostics.push({
        id: "claude.auth.timeout",
        status: "fail",
        summary: "claude auth status timed out"
      });
    } else {
      try {
        const auth = claudeAuthSchema.parse(
          extractJsonObject(`${authResult.stdout}\n${authResult.stderr}`)
        );
        authenticated = authValue(auth);
        detectedAuthMode = authMode(auth);
      } catch (error) {
        diagnostics.push({
          id: "claude.auth.parse",
          status: "warning",
          summary: `Could not verify Claude authentication: ${error instanceof Error ? error.message : String(error)}`,
          remediation: "Check adapter compatibility with the installed Claude Code version."
        });
      }
    }

    let state: ProviderProbe["state"] = "degraded";
    if (authenticated === false) state = "unauthenticated";
    else if (authenticated === true) state = "ready";

    return {
      ...base,
      state,
      installed: true,
      authenticated,
      authMode: detectedAuthMode,
      reachable: null,
      canRun: authenticated === true,
      ...(version ? { version } : {}),
      diagnostics
    } as ProviderProbe;
  }
}
