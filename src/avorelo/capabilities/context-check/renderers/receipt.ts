// Avorelo Agent Context Check — receipt renderer. Compact proof lines for Session Receipt.
// No raw prompts, no secrets, no full file contents.

import type { ContextCheckResult } from "../types.ts";

export function renderReceiptLines(result: ContextCheckResult): string[] {
  const lines: string[] = [
    `context_check: status=${result.status} risk=${result.riskLevel} sources=${result.sourcesChecked}`,
  ];

  const topFindings = result.findings
    .filter(f => f.severity === "needs_attention" || f.severity === "warning")
    .slice(0, 3);

  for (const f of topFindings) {
    lines.push(`  finding: ${f.code} severity=${f.severity} confidence=${f.confidence} path=${f.path}`);
  }

  if (result.findings.length === 0) {
    lines.push("  no stale or broken instructions found");
  }

  if (result.recommendedActions.length > 0) {
    lines.push(`  action: ${result.recommendedActions[0]}`);
  }

  return lines;
}
