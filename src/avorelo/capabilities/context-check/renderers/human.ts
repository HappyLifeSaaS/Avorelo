// Avorelo Agent Context Check — compact human-readable renderer.

import type { ContextCheckResult } from "../types.ts";

export function renderHuman(result: ContextCheckResult): string {
  const lines: string[] = [""];

  if (result.status === "pass") {
    lines.push("Context Check passed");
    lines.push(`  ${result.sourcesChecked} instruction source(s) checked`);
    lines.push("  No stale, broken, or broad-risk instructions found");
  } else {
    const count = result.findings.length;
    const label = result.status === "needs_attention" ? "needs attention" : result.status;
    lines.push(`Context Check: ${label} (${count} finding${count !== 1 ? "s" : ""})`);
    for (const f of result.findings.slice(0, 5)) {
      const icon = f.severity === "needs_attention" ? "!" : f.severity === "warning" ? "~" : "-";
      lines.push(`  ${icon} [${f.confidence}] ${f.message}`);
      lines.push(`    ${f.path}`);
    }
    if (result.findings.length > 5) {
      lines.push(`  ... and ${result.findings.length - 5} more`);
    }
  }

  if (result.recommendedActions.length > 0) {
    lines.push("");
    lines.push("  Recommended:");
    for (const a of result.recommendedActions.slice(0, 3)) {
      lines.push(`    ${a}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
