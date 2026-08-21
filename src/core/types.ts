export type DiagnosticStatus = "ok" | "warning" | "fail" | "unknown";

export interface Diagnostic {
  id: string;
  status: DiagnosticStatus;
  summary: string;
  remediation?: string;
}

export type ProviderState =
  | "ready"
  | "degraded"
  | "not_installed"
  | "unauthenticated"
  | "unreachable"
  | "error";

export interface UsageWindow {
  name: string;
  usedPercent?: number;
  resetsAt?: string;
}

export interface UsageSnapshot {
  state: "available" | "draining" | "paused" | "unknown";
  confidence: "exact" | "estimated" | "unknown";
  source: string;
  observedAt: string;
  windows: UsageWindow[];
  note?: string;
}

export interface ProviderCapabilities {
  nonInteractive: boolean;
  structuredEvents: boolean;
  machineReadableAuth: boolean;
  machineReadableHealth: boolean;
  machineReadableUsage: boolean;
}

export interface ProviderProbe {
  id: "codex" | "claude";
  displayName: string;
  command: string;
  state: ProviderState;
  installed: boolean;
  authenticated: boolean | null;
  reachable: boolean | null;
  canRun: boolean;
  version?: string;
  capabilities: ProviderCapabilities;
  usage: UsageSnapshot;
  diagnostics: Diagnostic[];
  observedAt: string;
}

export interface GitProbe {
  state: "ready" | "degraded" | "not_installed" | "error";
  installed: boolean;
  isRepository: boolean;
  clean: boolean | null;
  version?: string;
  root?: string;
  branch?: string;
  diagnostics: Diagnostic[];
  observedAt: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  overall: "ready" | "degraded" | "unavailable";
  cwd: string;
  generatedAt: string;
  git: GitProbe;
  providers: ProviderProbe[];
}
