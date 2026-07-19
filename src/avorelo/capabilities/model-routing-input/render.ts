import type { ModelRoutingInputCheck, ModelRoutingInputProfile } from "./types.ts";

export function renderModelRoutingInputProfile(profile: ModelRoutingInputProfile): string {
  const lines = [
    "Model Routing Input",
    `  Mode:       ${profile.recommendedMode}`,
    `  Objective:  ${profile.objectiveSummary}`,
    `  Work:       ${profile.workType} · complexity=${profile.taskComplexity} · pathRisk=${profile.pathRisk}`,
    `  Context:    ${profile.expectedContextSize} · confidence=${profile.confidence} · contextEfficiency=${profile.contextEfficiency.source}`,
    `  Next:       ${profile.safeNextAction}`,
    ...profile.recommendedValidation.commands.slice(0, 3).map((item) => `  Validate:   ${item.command}`),
  ];
  return lines.join("\n") + "\n";
}

export function renderModelRoutingInputPathCheck(check: ModelRoutingInputCheck): string {
  const lines = [
    "Model Routing Path Check",
    `  Path:       ${check.normalizedPath || check.inputPath}`,
    `  Mode:       ${check.recommendedMode} · pathRisk=${check.pathRisk}`,
    `  Summary:    ${check.summary}`,
    `  Next:       ${check.safeNextAction}`,
    ...check.recommendedValidation.commands.slice(0, 3).map((item) => `  Validate:   ${item.command}`),
  ];
  return lines.join("\n") + "\n";
}
