import type { DiagnosticStatus } from "../core/types.js";

export type SanitizedStderrCategory =
  | "invocation"
  | "authentication"
  | "network"
  | "local_permission"
  | "configuration"
  | "diagnostic_output";

export function sanitizedStderrDiagnostic(options: {
  provider: "codex" | "claude";
  stderr: string;
  status: DiagnosticStatus;
}): {
  id: string;
  status: DiagnosticStatus;
  summary: string;
} {
  const normalized = options.stderr.toLowerCase();
  let category: SanitizedStderrCategory = "diagnostic_output";
  if (
    /unexpected argument|unknown (argument|option)|usage:/u.test(normalized)
  ) {
    category = "invocation";
  } else if (
    /not (authenticated|logged in)|authentication required|login required/u.test(
      normalized
    )
  ) {
    category = "authentication";
  } else if (
    /network|connect|dns|timed out|unreachable|websocket|http request/u.test(
      normalized
    )
  ) {
    category = "network";
  } else if (
    /permission denied|operation not permitted|read-only file system/u.test(
      normalized
    )
  ) {
    category = "local_permission";
  } else if (/config|configuration/u.test(normalized)) {
    category = "configuration";
  }
  const displayName = options.provider === "codex" ? "Codex" : "Claude";
  const summaries: Record<SanitizedStderrCategory, string> = {
    invocation: `${displayName} rejected the probe command shape`,
    authentication: `${displayName} requires provider authentication`,
    network: `${displayName} could not reach a required provider endpoint`,
    local_permission: `${displayName} encountered a local permission boundary`,
    configuration: `${displayName} reported a local configuration problem`,
    diagnostic_output: `${displayName} emitted diagnostic output on stderr`
  };
  return {
    id: `${options.provider}.probe.stderr`,
    status: options.status,
    summary: summaries[category]
  };
}
