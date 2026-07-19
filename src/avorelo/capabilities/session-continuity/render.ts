import type { SessionContinuityHandoff, SessionContinuityPathCheck } from "./types.ts";

export function renderSessionContinuityHandoff(
  handoff: SessionContinuityHandoff,
  options: { includeContinuationPrompt?: boolean } = {},
): string {
  const lines = [
    "Session Continuity",
    `  Decision:   ${handoff.decisionState} | stage=${handoff.currentStage} | next=${handoff.recommendedNextAction}`,
    `  Workstream: ${handoff.workstreamName}`,
    `  Branch:     ${handoff.worktree.branch} | base=${handoff.worktree.dependency.selectedBase ?? "unknown"}`,
    `  Worktree:   ${handoff.worktree.path}`,
    `  Changes:    ${handoff.changedPaths.totalCount} path(s) | staged=${handoff.changedPaths.stagedCount} | unstaged=${handoff.changedPaths.unstagedCount}`,
    `  Inspect:    ${handoff.inspectFirst.slice(0, 4).join(", ") || "none recorded"}`,
    `  Avoid:      ${handoff.doNotTouch.slice(0, 4).join(", ") || "none recorded"}`,
    `  Next:       ${handoff.safeNextAction}`,
    ...handoff.validation.expectedCommands.slice(0, 3).map((item) => `  Validate:   ${item.command}`),
  ];
  if (options.includeContinuationPrompt) {
    lines.push("", "Continuation prompt:", handoff.continuationPrompt);
  }
  return lines.join("\n") + "\n";
}

export function renderSessionContinuityPathCheck(check: SessionContinuityPathCheck): string {
  const lines = [
    "Session Continuity Path Check",
    `  Path:       ${check.normalizedPath || check.inputPath}`,
    `  Category:   ${check.category}${check.authOrDashboardSensitive ? " | auth_or_dashboard_sensitive" : ""}`,
    `  Decision:   ${check.decisionState} | next=${check.recommendedNextAction}`,
    `  Summary:    ${check.summary}`,
    `  Next:       ${check.safeNextAction}`,
  ];
  return lines.join("\n") + "\n";
}
