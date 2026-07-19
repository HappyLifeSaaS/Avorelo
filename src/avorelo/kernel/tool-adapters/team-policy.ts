import type { ToolAdapterId, RiskCeiling, DataPolicy, AdapterPolicyConstraints } from "./types.ts";

export type TeamPolicyRule = {
  ruleId: string;
  description: string;
  effect: "deny" | "require_approval" | "allow";
  conditions: {
    adapters?: ToolAdapterId[];
    riskCeilingAbove?: RiskCeiling;
    dataPolicies?: DataPolicy[];
    taskTypes?: string[];
    requireSandbox?: boolean;
    requireProof?: boolean;
  };
  containsRawPrompt: false;
  containsRawSecret: false;
};

export type TeamPolicy = {
  contract: "avorelo.teamPolicy.v1";
  policyId: string;
  teamName: string;
  rules: TeamPolicyRule[];
  defaultEffect: "deny" | "require_approval" | "allow";
  allowedAdapters: ToolAdapterId[] | null;
  deniedAdapters: ToolAdapterId[] | null;
  maxRiskCeiling: RiskCeiling;
  requireLocalOnly: boolean;
  requireSandbox: boolean;
  requireProofCollection: boolean;
  denyDataCollection: boolean;
  createdAt: number;
  updatedAt: number;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
};

export type TeamPolicyEvaluation = {
  policyId: string;
  adapterId: ToolAdapterId;
  effect: "deny" | "require_approval" | "allow";
  matchedRules: string[];
  reasonCodes: string[];
  containsRawPrompt: false;
  containsRawSecret: false;
};

const RISK_ORDER: Record<RiskCeiling, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function createDefaultTeamPolicy(teamName: string): TeamPolicy {
  const now = Date.now();
  return {
    contract: "avorelo.teamPolicy.v1",
    policyId: `policy-${teamName}-${now}`,
    teamName,
    rules: [],
    defaultEffect: "allow",
    allowedAdapters: null,
    deniedAdapters: null,
    maxRiskCeiling: "high",
    requireLocalOnly: false,
    requireSandbox: false,
    requireProofCollection: false,
    denyDataCollection: false,
    createdAt: now,
    updatedAt: now,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
  };
}

export function createStrictTeamPolicy(teamName: string): TeamPolicy {
  const policy = createDefaultTeamPolicy(teamName);
  return {
    ...policy,
    policyId: `policy-strict-${teamName}-${policy.createdAt}`,
    maxRiskCeiling: "medium",
    requireLocalOnly: true,
    requireSandbox: true,
    requireProofCollection: true,
    denyDataCollection: true,
    deniedAdapters: ["cursor"],
    rules: [
      {
        ruleId: "strict-deny-training",
        description: "Deny adapters that include training in data policy",
        effect: "deny",
        conditions: { dataPolicies: ["training_included"] },
        containsRawPrompt: false,
        containsRawSecret: false,
      },
      {
        ruleId: "strict-require-approval-high-risk",
        description: "Require approval for high-risk tasks",
        effect: "require_approval",
        conditions: { riskCeilingAbove: "medium" },
        containsRawPrompt: false,
        containsRawSecret: false,
      },
    ],
  };
}

export function evaluateTeamPolicy(
  policy: TeamPolicy,
  adapterId: ToolAdapterId,
  adapterRiskCeiling: RiskCeiling,
  adapterDataPolicy: DataPolicy,
  taskType?: string,
): TeamPolicyEvaluation {
  const matchedRules: string[] = [];
  const reasonCodes: string[] = [];
  let effect: "deny" | "require_approval" | "allow" = policy.defaultEffect;

  if (policy.deniedAdapters?.includes(adapterId)) {
    return {
      policyId: policy.policyId, adapterId, effect: "deny",
      matchedRules: ["adapter_denied_by_policy"],
      reasonCodes: ["TEAM_POLICY_ADAPTER_DENIED"],
      containsRawPrompt: false, containsRawSecret: false,
    };
  }

  if (policy.allowedAdapters !== null && !policy.allowedAdapters.includes(adapterId)) {
    return {
      policyId: policy.policyId, adapterId, effect: "deny",
      matchedRules: ["adapter_not_in_allowed_list"],
      reasonCodes: ["TEAM_POLICY_ADAPTER_NOT_ALLOWED"],
      containsRawPrompt: false, containsRawSecret: false,
    };
  }

  if (RISK_ORDER[adapterRiskCeiling] > RISK_ORDER[policy.maxRiskCeiling]) {
    matchedRules.push("risk_ceiling_exceeded");
    reasonCodes.push("TEAM_POLICY_RISK_CEILING_EXCEEDED");
    effect = "deny";
  }

  for (const rule of policy.rules) {
    let matches = true;

    if (rule.conditions.adapters && !rule.conditions.adapters.includes(adapterId)) {
      matches = false;
    }
    if (rule.conditions.riskCeilingAbove && matches) {
      if (RISK_ORDER[adapterRiskCeiling] <= RISK_ORDER[rule.conditions.riskCeilingAbove]) {
        matches = false;
      }
    }
    if (rule.conditions.dataPolicies && matches) {
      if (!rule.conditions.dataPolicies.includes(adapterDataPolicy)) {
        matches = false;
      }
    }
    if (rule.conditions.taskTypes && taskType && matches) {
      if (!rule.conditions.taskTypes.includes(taskType)) {
        matches = false;
      }
    }

    if (matches) {
      matchedRules.push(rule.ruleId);
      reasonCodes.push(`TEAM_RULE_${rule.ruleId.toUpperCase()}`);
      if (rule.effect === "deny") effect = "deny";
      else if (rule.effect === "require_approval" && effect !== "deny") effect = "require_approval";
    }
  }

  return {
    policyId: policy.policyId, adapterId, effect,
    matchedRules, reasonCodes,
    containsRawPrompt: false, containsRawSecret: false,
  };
}

export function applyTeamPolicyToConstraints(
  policy: TeamPolicy,
  base: AdapterPolicyConstraints,
): AdapterPolicyConstraints {
  return {
    ...base,
    localOnly: base.localOnly || policy.requireLocalOnly,
    denyDataCollection: base.denyDataCollection || policy.denyDataCollection,
    requireSandbox: base.requireSandbox || policy.requireSandbox,
    requireProofCollection: base.requireProofCollection || policy.requireProofCollection,
    maxRiskCeiling: RISK_ORDER[policy.maxRiskCeiling] < RISK_ORDER[base.maxRiskCeiling]
      ? policy.maxRiskCeiling
      : base.maxRiskCeiling,
    allowedAdapters: policy.allowedAdapters ?? base.allowedAdapters,
    deniedAdapters: mergeDenied(base.deniedAdapters, policy.deniedAdapters),
  };
}

function mergeDenied(a: ToolAdapterId[] | null, b: ToolAdapterId[] | null): ToolAdapterId[] | null {
  if (!a && !b) return null;
  const set = new Set([...(a ?? []), ...(b ?? [])]);
  return [...set];
}

export function validateTeamPolicy(policy: TeamPolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (policy.contract !== "avorelo.teamPolicy.v1") errors.push("invalid_contract");
  if (!policy.policyId) errors.push("missing_policy_id");
  if (!policy.teamName) errors.push("missing_team_name");
  if (policy.modelMayDecide !== false) errors.push("model_may_decide_must_be_false");
  if (policy.scannerMayDecide !== false) errors.push("scanner_may_decide_must_be_false");
  if (policy.finalDecisionOwner !== "kernel/stop-continue-gate") errors.push("invalid_final_decision_owner");
  if (policy.containsRawPrompt !== false) errors.push("contains_raw_prompt_must_be_false");
  if (policy.containsRawSecret !== false) errors.push("contains_raw_secret_must_be_false");

  for (const rule of policy.rules) {
    if (!rule.ruleId) errors.push(`rule_missing_id`);
    if (rule.containsRawPrompt !== false) errors.push(`rule_${rule.ruleId}_raw_prompt`);
    if (rule.containsRawSecret !== false) errors.push(`rule_${rule.ruleId}_raw_secret`);
  }

  return { valid: errors.length === 0, errors };
}
