import type { ContextEfficiencyBrief, ContextEfficiencyPathCheck } from "./types.ts";

export function renderContextEfficiencyBrief(brief: ContextEfficiencyBrief): string {
  const lines = [
    "Context Efficiency",
    `  Decision:   ${brief.decisionState} · risk=${brief.riskLevel} · type=${brief.workType}`,
    `  Objective:  ${brief.objectiveSummary}`,
    `  Inspect:    ${brief.sourceOfTruthPaths.slice(0, 3).join(", ") || "none recorded"}`,
    `  Exclude:    ${brief.generatedOutputPaths.slice(0, 2).join(", ") || "none recorded"}`,
    `  Local-only: ${brief.runtimeArtifactPaths.slice(0, 2).join(", ") || "none recorded"}`,
    `  Next:       ${brief.safeNextAction}`,
    ...brief.validation.commands.slice(0, 3).map((item) => `  Validate:   ${item.command}`),
  ];
  return lines.join("\n") + "\n";
}

export function renderContextEfficiencyPathCheck(check: ContextEfficiencyPathCheck): string {
  const lines = [
    "Context Efficiency Path Check",
    `  Path:       ${check.normalizedPath || check.inputPath}`,
    `  Decision:   ${check.decisionState} · risk=${check.riskLevel} · action=${check.recommendation}`,
    `  Summary:    ${check.summary}`,
    `  Next:       ${check.safeNextAction}`,
    ...check.validation.commands.slice(0, 3).map((item) => `  Validate:   ${item.command}`),
  ];
  return lines.join("\n") + "\n";
}
