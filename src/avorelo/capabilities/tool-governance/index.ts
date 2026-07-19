// Avorelo Tool Governance + Progressive Exposure Planner (Slice 4.5). Deterministic.
// THE ONE RULE: owns no policy/evidence/receipt truth. Produces an exposure plan
// based on work contract, tool metadata, context budget, and risk classification.
// Decision: not just "is this tool allowed?" but also "is it needed now? how much
// context does it burn? should it be deferred?"

import type { ToolGovernance, ExposurePlan, ToolExposure, WorkContract } from "../../shared/schemas/index.ts";

export type ExposurePlanInput = {
  contract: WorkContract;
  tools: ToolGovernance[];
  workflowStage: "intake" | "plan" | "read_only" | "edit" | "verify" | "proof" | "done";
  contextBudgetRemaining?: number; // optional
};

// Stage-based exposure rules: what tool types are exposed at each stage
const STAGE_ALLOWED_TYPES: Record<string, Set<string>> = {
  intake: new Set(["read"]),
  plan: new Set(["read", "reason"]),
  read_only: new Set(["read"]),
  edit: new Set(["read", "reason", "action"]),
  verify: new Set(["read", "reason"]),
  proof: new Set(["read", "reason", "action"]),
  done: new Set(["read"]),
};

/**
 * Build a progressive exposure plan: which tools are exposed, deferred, blocked,
 * or approval-required for the current workflow stage and context budget.
 * Deterministic. No LLM. No network.
 */
export function buildExposurePlan(input: ExposurePlanInput): ExposurePlan {
  const { contract, tools, workflowStage } = input;
  const allowedTypes = STAGE_ALLOWED_TYPES[workflowStage] ?? new Set(["read"]);

  const exposed: ToolGovernance[] = [];
  const deferred: ToolGovernance[] = [];
  const blocked: ToolGovernance[] = [];
  const approvalRequired: ToolGovernance[] = [];
  const reasonCodes: string[] = [];

  for (const tool of tools) {
    // 1. Hard blocks first
    if (tool.defaultExposure === "blocked") {
      blocked.push(tool);
      continue;
    }

    // 2. Approval-required tools
    if (tool.defaultExposure === "approval") {
      approvalRequired.push(tool);
      continue;
    }

    // 3. Stage-based gating: action tools deferred outside edit/proof stages
    if (!allowedTypes.has(tool.toolType)) {
      deferred.push(tool);
      reasonCodes.push(`DEFERRED_STAGE:${tool.toolId}:${workflowStage}`);
      continue;
    }

    // 4. On-demand tools: only expose if contract explicitly needs them
    if (tool.defaultExposure === "on_demand") {
      const needed = contract.requestedOutputs.some(o =>
        o.toLowerCase().includes(tool.toolName.toLowerCase())
      );
      if (!needed) {
        deferred.push(tool);
        reasonCodes.push(`DEFERRED_ON_DEMAND:${tool.toolId}`);
        continue;
      }
    }

    // 5. High-cost tools: defer if context budget is tight
    if (tool.contextCost === "high" && input.contextBudgetRemaining !== undefined && input.contextBudgetRemaining < 3) {
      deferred.push(tool);
      reasonCodes.push(`DEFERRED_BUDGET:${tool.toolId}`);
      continue;
    }

    // 6. Expose
    exposed.push(tool);
  }

  const contextCostSummary = {
    low: exposed.filter(t => t.contextCost === "low").length,
    medium: exposed.filter(t => t.contextCost === "medium").length,
    high: exposed.filter(t => t.contextCost === "high").length,
  };

  return {
    planId: `exp_${contract.contractId}_${workflowStage}`,
    contractId: contract.contractId,
    exposed,
    deferred,
    blocked,
    approvalRequired,
    contextCostSummary,
    reasonCodes,
  };
}
