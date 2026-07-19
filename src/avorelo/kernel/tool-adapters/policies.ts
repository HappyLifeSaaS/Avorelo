// Adapter policy constraints. Maps task classes to adapter selection rules.
// Pattern: provider order + allowFallbacks + data policy deny (OpenRouter),
// fallback cannot lower privacy/proof (Avorelo principle).

import type { AdapterPolicyConstraints, ToolAdapterId, RiskCeiling } from "./types.ts";

export function defaultPolicyConstraints(): AdapterPolicyConstraints {
  return {
    localOnly: false,
    denyDataCollection: true,
    requireSandbox: false,
    requireProofCollection: true,
    maxRiskCeiling: "high",
    allowedAdapters: null,
    deniedAdapters: null,
    preferenceOrder: ["deterministic-local", "scanner", "semgrep", "playwright-proof", "github-actions", "claude-code", "codex", "gemini-cli", "aider", "manual-gate"],
    allowFallback: true,
    fallbackCannotLowerPrivacy: true,
    fallbackCannotLowerProof: true,
  };
}

const RISK_RANK: Record<RiskCeiling, number> = { low: 0, medium: 1, high: 2, critical: 3 };

const DATA_POLICY_RANK: Record<string, number> = {
  local_only: 0,
  zdr: 1,
  no_training: 2,
  training_included: 3,
};

export function isAdapterAllowed(
  adapterId: ToolAdapterId,
  constraints: AdapterPolicyConstraints,
): boolean {
  if (constraints.allowedAdapters && !constraints.allowedAdapters.includes(adapterId)) return false;
  if (constraints.deniedAdapters && constraints.deniedAdapters.includes(adapterId)) return false;
  return true;
}

export function isFallbackSafe(
  from: { dataPolicy: string; riskCeiling: RiskCeiling },
  to: { dataPolicy: string; riskCeiling: RiskCeiling },
  constraints: AdapterPolicyConstraints,
): boolean {
  if (constraints.fallbackCannotLowerPrivacy) {
    if ((DATA_POLICY_RANK[to.dataPolicy] ?? 3) > (DATA_POLICY_RANK[from.dataPolicy] ?? 0)) return false;
  }
  if (constraints.fallbackCannotLowerProof) {
    if (RISK_RANK[to.riskCeiling] > RISK_RANK[from.riskCeiling]) return false;
  }
  return true;
}

export type TaskClass =
  | "deterministic_check"
  | "low_risk_code"
  | "code_review"
  | "security_review"
  | "browser_proof"
  | "ci_review"
  | "billing_payment"
  | "production_deploy"
  | "long_context_refactor"
  | "unknown";

export function classifyTask(taskType: string, riskClass: string, flags: {
  paymentTouched: boolean;
  authTouched: boolean;
  productionImpactPossible: boolean;
  deterministicEvidenceAvailable: boolean;
  deepMode: boolean;
  browserProofRequested?: boolean;
  ciVerificationRequested?: boolean;
}): TaskClass {
  if (flags.productionImpactPossible) return "production_deploy";
  if (flags.paymentTouched) return "billing_payment";
  if (flags.authTouched || riskClass === "high") return "security_review";
  if (flags.ciVerificationRequested) return "ci_review";
  if (flags.browserProofRequested) return "browser_proof";
  if (flags.deterministicEvidenceAvailable) return "deterministic_check";
  if (flags.deepMode) return "long_context_refactor";
  if (taskType === "code_generation" || taskType === "code") return "low_risk_code";
  if (taskType === "code_review") return "code_review";
  return "unknown";
}

export function getTaskClassPolicy(taskClass: TaskClass): Partial<AdapterPolicyConstraints> {
  switch (taskClass) {
    case "deterministic_check":
      return { preferenceOrder: ["deterministic-local", "scanner", "manual-gate"], maxRiskCeiling: "low" };
    case "low_risk_code":
      return { preferenceOrder: ["claude-code", "codex", "gemini-cli", "aider", "deterministic-local", "manual-gate"] };
    case "code_review":
      return { preferenceOrder: ["codex", "claude-code", "gemini-cli", "github-actions", "scanner", "manual-gate"] };
    case "security_review":
      return { preferenceOrder: ["semgrep", "scanner", "manual-gate", "claude-code", "codex"], requireProofCollection: true };
    case "browser_proof":
      return { preferenceOrder: ["playwright-proof", "manual-gate", "deterministic-local"], requireProofCollection: true };
    case "ci_review":
      return { preferenceOrder: ["github-actions", "manual-gate", "deterministic-local"], requireProofCollection: true };
    case "billing_payment":
      return { preferenceOrder: ["semgrep", "scanner", "manual-gate", "deterministic-local"], requireProofCollection: true };
    case "production_deploy":
      return { preferenceOrder: ["manual-gate", "deterministic-local"], maxRiskCeiling: "critical", allowFallback: false };
    case "long_context_refactor":
      return { preferenceOrder: ["claude-code", "codex", "gemini-cli", "aider", "deterministic-local", "manual-gate"] };
    default:
      return { preferenceOrder: ["deterministic-local", "scanner", "semgrep", "manual-gate"] };
  }
}
