import type { ModeDetectionResult, AgentContextDecisionReceipt, WorkMode } from "./types.ts";
import { createAgentDecisionReceipt } from "./receipts.ts";

export interface GuardDecision {
  action: string;
  decision: "block" | "allow" | "downgrade";
  reason: string;
  mode: WorkMode;
  receipt: AgentContextDecisionReceipt;
}

export function evaluateAgentAction(
  action: string,
  mode: ModeDetectionResult,
): GuardDecision {
  const actionLower = action.toLowerCase();

  if (/npm\s+publish|npm\s+pkg\s+publish/.test(actionLower)) {
    return block(
      action,
      mode.detectedMode,
      "Owner-side npm publish only. Agent sessions must not publish packages.",
    );
  }

  if (/netlify\s+deploy\s+--prod/.test(actionLower)) {
    if (mode.detectedMode !== "production_release") {
      return block(
        action,
        mode.detectedMode,
        `Production deploy requires explicit owner-approved production-release mode. Current mode: ${mode.detectedMode}.`,
      );
    }
  }

  if (/railway\s+up|railway\s+deploy/.test(actionLower)) {
    if (mode.detectedMode !== "production_release") {
      return block(
        action,
        mode.detectedMode,
        `Railway production deploy blocked in ${mode.detectedMode} mode. Requires production_release with owner approval.`,
      );
    }
  }

  if (/npm\s+unpublish|npm\s+deprecate/.test(actionLower)) {
    return block(
      action,
      mode.detectedMode,
      "Package registry mutations are owner-side only.",
    );
  }

  if (/git\s+push\s+.*--force|git\s+push\s+-f/.test(actionLower)) {
    return block(
      action,
      mode.detectedMode,
      "Force push blocked — destructive remote operation.",
    );
  }

  return allow(action, mode.detectedMode);
}

export function evaluateCompletionClaim(
  claimText: string,
  hasVerificationReceipt: boolean,
  mode: ModeDetectionResult,
): GuardDecision {
  const claimLower = claimText.toLowerCase();
  const readyClaims = /\b(?:production[- ]?ready|deployed|verified|complete|done|shipped)\b/;

  if (readyClaims.test(claimLower) && !hasVerificationReceipt) {
    return downgrade(
      `completion claim: "${claimText.slice(0, 100)}"`,
      mode.detectedMode,
      'Completion claim without verification receipt — downgraded to "pending verification".',
    );
  }

  return allow(`completion claim: "${claimText.slice(0, 100)}"`, mode.detectedMode);
}

function block(action: string, mode: WorkMode, reason: string): GuardDecision {
  return {
    action,
    decision: "block",
    reason,
    mode,
    receipt: createAgentDecisionReceipt(action, "block", reason, mode),
  };
}

function allow(action: string, mode: WorkMode): GuardDecision {
  return {
    action,
    decision: "allow",
    reason: "Action permitted in current mode.",
    mode,
    receipt: createAgentDecisionReceipt(action, "allow", "Action permitted in current mode.", mode),
  };
}

function downgrade(action: string, mode: WorkMode, reason: string): GuardDecision {
  return {
    action,
    decision: "downgrade",
    reason,
    mode,
    receipt: createAgentDecisionReceipt(action, "downgrade", reason, mode),
  };
}
