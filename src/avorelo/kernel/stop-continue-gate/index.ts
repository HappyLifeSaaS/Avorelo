// Avorelo Stop/Continue Gate (Slice 1). The ONLY decider of CONTINUE/STOP_BLOCKED/STOP_DONE.
// Never STOP_DONE without OUTCOME+POST_ACTION (ADR-3); never with a policy block outstanding (ADR-4).
// Deterministic (Tier-D, no model). Capabilities/skills feed it; they never decide.

import { isReadyEligible, plausibleForReady, levelsPresent } from "../evidence/index.ts";
import type {
  GradedEvidence,
  GateDecision,
  PolicyVerdict,
  ReviewerVerdict,
  WorkContract,
  ConfidenceLabel,
} from "../../shared/schemas/index.ts";

export type GateInput = {
  contract: WorkContract;
  graded: GradedEvidence[];
  policyVerdict: PolicyVerdict;
  policyReasonCodes?: string[];
  reviewerVerdicts?: ReviewerVerdict[];
  stopConditionMet?: boolean;
  sampleSize?: number;
  // Slice 4: the environment that produced the evidence is compromised (dirty worktree, stale/served process,
  // session collision). Evidence gathered under a compromised environment cannot back a READY claim, so the
  // gate must NEVER return STOP_DONE while this is true — even with OUTCOME+POST_ACTION present.
  environmentCompromised?: boolean;
  environmentReasonCodes?: string[];
};

export type GateResult = {
  decision: GateDecision;
  safeNextActions: string[];
  reasonCodes: string[];
  confidence: ConfidenceLabel;
};

function confidenceFor(sampleSize: number): ConfidenceLabel {
  if (sampleSize <= 0) return "UNKNOWN";
  if (sampleSize === 1) return "LOW";
  if (sampleSize < 5) return "MED";
  return "HIGH";
}

export function decide(input: GateInput): GateResult {
  const reasonCodes: string[] = [];
  const sampleSize = input.sampleSize ?? 1;

  // 1) Policy block is supreme — model/evidence cannot override (ADR-4). Fail-closed.
  if (input.policyVerdict === "block") {
    reasonCodes.push("POLICY_BLOCK", ...(input.policyReasonCodes ?? []));
    return {
      decision: "STOP_BLOCKED",
      safeNextActions: ["resolve the policy block (e.g., remove/rotate secret, narrow to allowed paths)"],
      reasonCodes,
      confidence: "UNKNOWN",
    };
  }
  if (input.policyVerdict === "needs_approval") {
    reasonCodes.push("NEEDS_APPROVAL");
    return {
      decision: "STOP_BLOCKED",
      safeNextActions: ["request compact approval for the external/destructive action"],
      reasonCodes,
      confidence: "UNKNOWN",
    };
  }

  // 2) A NO_GO reviewer verdict blocks READY.
  const reviewerNoGo = (input.reviewerVerdicts ?? []).includes("NO_GO");
  if (reviewerNoGo) reasonCodes.push("REVIEWER_NO_GO");

  // 2b) Environment integrity (Slice 4): evidence from a compromised environment cannot back READY.
  const environmentCompromised = input.environmentCompromised === true;
  if (environmentCompromised) reasonCodes.push("ENVIRONMENT_COMPROMISED", ...(input.environmentReasonCodes ?? []));

  // 3) READY requires OUTCOME+POST_ACTION AND plausible evidence AND no reviewer NO_GO AND clean environment (ADR-3).
  const eligible = isReadyEligible(input.graded);
  const plausible = plausibleForReady(input.graded);
  const present = levelsPresent(input.graded);

  if (eligible && plausible && !reviewerNoGo && !environmentCompromised) {
    reasonCodes.push("OUTCOME_AND_POST_ACTION_PRESENT");
    return {
      decision: "STOP_DONE",
      safeNextActions: [],
      reasonCodes,
      confidence: confidenceFor(sampleSize),
    };
  }

  // 4) Not ready. If stop conditions met -> blocked; else continue with the missing levels as guidance.
  const missing: string[] = [];
  if (!present.includes("OUTCOME")) missing.push("OUTCOME");
  if (!present.includes("POST_ACTION")) missing.push("POST_ACTION");
  if (!plausible) reasonCodes.push("EVIDENCE_NOT_PLAUSIBLE");

  // If evidence is actually complete but the environment is compromised, the action is to clean it — not gather more.
  const nextAction = environmentCompromised && eligible && plausible
    ? "restore a clean environment (commit/stash the dirty worktree; stop stale/served processes), then re-verify"
    : `gather missing evidence levels: ${missing.join(", ") || "(plausible evidence)"}`;

  if (input.stopConditionMet) {
    reasonCodes.push("STOP_CONDITION_MET", "READY_NOT_MET");
    return { decision: "STOP_BLOCKED", safeNextActions: [nextAction], reasonCodes, confidence: "UNKNOWN" };
  }

  reasonCodes.push("READY_NOT_MET");
  return { decision: "CONTINUE", safeNextActions: [nextAction], reasonCodes, confidence: "UNKNOWN" };
}
