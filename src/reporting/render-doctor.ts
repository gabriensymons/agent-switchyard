import type { DoctorReport, ProviderProbe } from "../core/types.js";

function yesNoUnknown(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "yes" : "no";
}

function renderProvider(provider: ProviderProbe): string[] {
  const lines = [
    `${provider.displayName}: ${provider.state}`,
    `  installed: ${provider.installed ? "yes" : "no"}`,
    `  version: ${provider.version ?? "unknown"}`,
    `  authenticated: ${yesNoUnknown(provider.authenticated)}`,
    `  auth mode: ${provider.authMode}`,
    `  reachable: ${yesNoUnknown(provider.reachable)}`,
    `  runnable: ${provider.canRun ? "yes" : "no"}`,
    `  usage: ${provider.usage.state} (${provider.usage.source})`
  ];

  if (provider.usage.note) lines.push(`  usage note: ${provider.usage.note}`);
  for (const diagnostic of provider.diagnostics) {
    lines.push(`  [${diagnostic.status}] ${diagnostic.summary}`);
  }
  return lines;
}

export function renderDoctor(report: DoctorReport): string {
  const lines = [
    `Switchyard doctor: ${report.overall}`,
    "",
    `Repository: ${report.git.state}`,
    `  root: ${report.git.root ?? report.cwd}`,
    `  branch: ${report.git.branch ?? "unknown"}`,
    `  clean: ${yesNoUnknown(report.git.clean)}`
  ];

  for (const diagnostic of report.git.diagnostics) {
    lines.push(`  [${diagnostic.status}] ${diagnostic.summary}`);
  }

  for (const provider of report.providers) {
    lines.push("", ...renderProvider(provider));
  }

  return `${lines.join("\n")}\n`;
}
