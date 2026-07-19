// Avorelo Secret Boundary — Remediation v1 (Phase 2). Recommendations only. NO auto-rotation, NO external
// provider calls, NO claim that anything was rotated. Produces a safe, human-actionable checklist.

import type { SecretFinding } from "./detector.ts";
import { isCriticalCode } from "./detector.ts";

export type RemediationAction =
  | "redact_output"
  | "block_from_model_context"
  | "replace_with_env_placeholder"
  | "add_to_gitignore"
  | "write_safe_example_env"
  | "quarantine_source"
  | "treat_as_data_only"
  | "generate_rotation_checklist"
  | "require_manual_rotation"
  | "block_cloud_sync";

export type RemediationPlan = {
  actions: RemediationAction[];
  steps: string[]; // human-readable, ordered, no raw values
  autoRotation: false; // explicit: this tool never auto-rotates
  externalCalls: false; // explicit: no provider/network calls
};

const ENV_PLACEHOLDER = "process.env.<NAME>";

/** Build a safe remediation plan from coded findings. Never contains a raw value. */
export function buildRemediation(findings: SecretFinding[]): RemediationPlan {
  const actions = new Set<RemediationAction>(["redact_output", "block_from_model_context"]);
  const hasCritical = findings.some((f) => isCriticalCode(f.code));

  for (const f of findings) {
    if (f.code === "SEC_ENV_SECRET_ASSIGNMENT" || f.code === "SEC_DATABASE_URL_WITH_PASSWORD") {
      actions.add("replace_with_env_placeholder");
      actions.add("add_to_gitignore");
      actions.add("write_safe_example_env");
    }
    if (f.sourceKind === "instruction" || f.sourceKind === "tool_output") actions.add("treat_as_data_only");
  }
  if (hasCritical) {
    actions.add("generate_rotation_checklist");
    actions.add("require_manual_rotation");
    actions.add("block_cloud_sync");
  }

  const steps = [
    `Replace each raw value with an environment placeholder (${ENV_PLACEHOLDER}).`,
    "Add a non-secret placeholder to .env.example.",
    "Ensure .env is listed in .gitignore.",
    hasCritical ? "Rotate the exposed credential manually with the provider (Avorelo does not rotate credentials)." : "Review whether the value needs rotation.",
    "Re-run the Avorelo secret-boundary scan to confirm zero findings.",
  ];

  return { actions: Array.from(actions), steps, autoRotation: false, externalCalls: false };
}
