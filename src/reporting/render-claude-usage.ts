import type { ClaudeUsageProxyReport } from "../usage/claude-transcript.js";

function rounded(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function renderClaudeUsage(report: ClaudeUsageProxyReport): string {
  const window = report.usage.windows[0];
  const lines = [
    `Claude usage proxy: ${report.usage.state} (${report.usage.confidence})`,
    `source available: ${report.sourceAvailable ? "yes" : "no"}`,
    `last ${report.windowHours}h: ${report.requestCount} requests in ${report.filesScanned} files`,
    `  output ${rounded(report.totals.output)}  input ${rounded(report.totals.input)}  cache-created ${rounded(report.totals.cacheCreation)}  cache-read ${rounded(report.totals.cacheRead)}`,
    `  weighted units: ${rounded(report.weightedUnits)}`
  ];
  if (window?.usedPercent !== undefined) {
    lines.push(`  estimate: ~${window.usedPercent.toFixed(1)}%`);
  }
  if (report.burnPercentPer15Minutes !== undefined) {
    lines.push(`  burn: ~${report.burnPercentPer15Minutes.toFixed(1)}% per 15min`);
  }
  if (report.minutesTo90Percent !== undefined) {
    lines.push(`  estimated time to 90%: ~${report.minutesTo90Percent.toFixed(0)} min`);
  }
  if (report.usage.note) lines.push(`  note: ${report.usage.note}`);
  if (report.malformedLines || report.readErrors) {
    lines.push(
      `  diagnostics: ${report.malformedLines} malformed lines, ${report.readErrors} unreadable files`
    );
  }
  return `${lines.join("\n")}\n`;
}
