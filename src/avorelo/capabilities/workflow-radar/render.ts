import type { WorkflowRadarAssessment, WorkflowRadarPathCheck } from "./types.ts";

export function renderWorkflowRadarAssessment(assessment: WorkflowRadarAssessment): string {
  const lines = [
    "Workflow Radar",
    `  Decision:   ${assessment.decisionState} Â· risk=${assessment.riskLevel} Â· next=${assessment.recommendedNextAction}`,
    `  Objective:  ${assessment.objectiveSummary}`,
    `  Changes:    ${assessment.changedPaths.totalCount} path(s) Â· staged=${assessment.changedPaths.stagedCount} Â· unstaged=${assessment.changedPaths.unstagedCount} Â· untracked=${assessment.changedPaths.untrackedCount}`,
    `  Scope:      expected=${assessment.expectedScope.available} Â· drift=${assessment.changedPaths.unexpectedCount} Â· generated=${assessment.changedPaths.generatedOutputCount} Â· runtime=${assessment.changedPaths.runtimeArtifactCount}`,
    `  Evidence:   validationMissing=${assessment.validation.missing} Â· evidenceMissing=${assessment.evidence.missing} Â· review=${assessment.humanReviewRequired}`,
    `  Next:       ${assessment.safeNextAction}`,
    ...assessment.validation.expectedCommands.slice(0, 3).map((item) => `  Validate:   ${item.command}`),
  ];
  return lines.join("\n") + "\n";
}

export function renderWorkflowRadarPathCheck(check: WorkflowRadarPathCheck): string {
  const lines = [
    "Workflow Radar Path Check",
    `  Path:       ${check.normalizedPath || check.inputPath}`,
    `  Decision:   ${check.decisionState} Â· risk=${check.riskLevel} Â· next=${check.recommendedNextAction}`,
    `  Scope:      expected=${check.expectedScopeAvailable} Â· inScope=${check.inExpectedScope}`,
    `  Mode:       expected=${check.expectedMode ?? "none"} Â· actual=${check.actualRequiredMode}`,
    `  Summary:    ${check.summary}`,
    `  Next:       ${check.safeNextAction}`,
  ];
  return lines.join("\n") + "\n";
}
