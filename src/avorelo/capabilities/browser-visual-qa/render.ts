import type { BrowserQaArtifact } from "./types.ts";

export function renderBrowserQaSummary(artifact: BrowserQaArtifact): string {
  const lines = [
    "",
    `Browser QA: ${artifact.decision}`,
    `  Target:     ${artifact.target}`,
    `  Routes:     ${artifact.routesChecked} checked, ${artifact.failedRoutes} failed`,
    `  Warnings:   ${artifact.warningCount}`,
    `  Screens:    ${artifact.screenshotPolicy} (persisted=${artifact.screenshotsPersisted}, blocked=${artifact.unsafeCapturesBlocked})`,
  ];
  for (const finding of artifact.topFindings.slice(0, 5)) {
    lines.push(`  ${finding.severity.toUpperCase()}: ${finding.route} ${finding.reasonCode} â€” ${finding.safeSummary}`);
  }
  lines.push(`  Next:       ${artifact.nextSafeAction}`, "");
  return lines.join("\n");
}

export function renderBrowserQaExplain(artifact: BrowserQaArtifact): string {
  const lines = [
    "",
    `Browser QA decision: ${artifact.decision}`,
    `  Risk:       ${artifact.riskLevel}`,
    `  Target:     ${artifact.target}`,
    `  Routes:     ${artifact.routesChecked} checked, ${artifact.failedRoutes} failed`,
    `  Screenshot: ${artifact.screenshotPolicy}`,
  ];
  for (const route of artifact.routeSummaries) {
    lines.push(
      `  Route ${route.route}: loaded=${route.loaded} status=${route.httpStatus ?? "n/a"} findings=${route.findingCount} console=${route.consoleErrorCount}/${route.consoleWarningCount} screenshot=${route.screenshotPolicyResult}`,
    );
  }
  for (const finding of artifact.findings.slice(0, 8)) {
    lines.push(`  ${finding.severity.toUpperCase()}: ${finding.route} â€” ${finding.safeSummary}`);
  }
  lines.push(`  Next:       ${artifact.nextSafeAction}`, "");
  return lines.join("\n");
}
