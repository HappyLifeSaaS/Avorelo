// Tool execution planner. Selects the safest sufficient adapter for a task.
// Pattern: unified adapter interface (Vercel AI Gateway), cascade/fallback (LiteLLM/Nadir-like),
// provider order + data policy deny (OpenRouter).

import type {
  ToolAdapterId, ToolExecutionPlan, ToolAvailability,
  AdapterPolicyConstraints, ExecutionMode, AdapterSafeCommandPreview, ToolRoutingProjection,
} from "./types.ts";
import { getDescriptor, isAdapterHealthy } from "./registry.ts";
import { isAdapterAllowed, isFallbackSafe, defaultPolicyConstraints, classifyTask, getTaskClassPolicy, type TaskClass } from "./policies.ts";
import { getEffectiveAvailability } from "./detect.ts";
import { getDelegatedAdapterConfig } from "./executor.ts";

export type PlanInput = {
  taskType: string;
  riskClass: string;
  paymentTouched: boolean;
  authTouched: boolean;
  productionImpactPossible: boolean;
  deterministicEvidenceAvailable: boolean;
  deepMode: boolean;
  secretsPossible: boolean;
  browserProofRequested?: boolean;
  ciVerificationRequested?: boolean;
  dir: string;
  now: number;
  availability?: ToolAvailability[];
  policyOverrides?: Partial<AdapterPolicyConstraints>;
};

export function planToolExecution(input: PlanInput): ToolExecutionPlan {
  const taskClass = classifyTask(input.taskType, input.riskClass, input);
  const basePolicy = defaultPolicyConstraints();
  const taskPolicy = getTaskClassPolicy(taskClass);
  const constraints: AdapterPolicyConstraints = { ...basePolicy, ...taskPolicy, ...input.policyOverrides };

  const availability = getEffectiveAvailability(input.dir, input.now);
  const reasonCodes: string[] = [`TASK_CLASS:${taskClass}`];
  const forbiddenActions: string[] = [];

  if (input.secretsPossible) forbiddenActions.push("persist_raw_secret", "expose_secret_to_adapter");
  if (input.productionImpactPossible) forbiddenActions.push("model_owns_production_readiness", "tool_approves_deploy");

  const preferenceOrder = constraints.preferenceOrder;
  let selectedAdapter: ToolAdapterId = "manual-gate";
  let executionMode: ExecutionMode = "manual_gate";
  const fallbackAdapters: ToolAdapterId[] = [];
  let approvalRequired = false;
  let proofRequired = constraints.requireProofCollection;
  let commandPreview: AdapterSafeCommandPreview | null = null;
  let toolMayExecute = false;

  for (const candidateId of preferenceOrder) {
    const desc = getDescriptor(candidateId);
    if (!desc) continue;
    if (!isAdapterAllowed(candidateId, constraints)) {
      reasonCodes.push(`ADAPTER_DENIED:${candidateId}`);
      continue;
    }

    const status = availability[candidateId];
    if (status !== "available") {
      reasonCodes.push(`ADAPTER_UNAVAILABLE:${candidateId}:${status}`);
      continue;
    }

    if (!isAdapterHealthy(candidateId, input.now)) {
      reasonCodes.push(`ADAPTER_UNHEALTHY:${candidateId}`);
      continue;
    }

    if (desc.requiresNetwork && constraints.localOnly) {
      reasonCodes.push(`ADAPTER_REQUIRES_NETWORK:${candidateId}`);
      continue;
    }

    selectedAdapter = candidateId;
    executionMode = resolveExecutionMode(candidateId, taskClass);
    toolMayExecute = executionMode === "real" || executionMode === "deterministic" || executionMode === "scanner" || executionMode === "proof";
    approvalRequired = taskClass === "production_deploy" || taskClass === "billing_payment" || desc.irreversibleActionPolicy === "approval_required";
    proofRequired = constraints.requireProofCollection || input.riskClass === "high";

    const delegatedConfig = getDelegatedAdapterConfig(candidateId);
    if (delegatedConfig) {
      commandPreview = {
        adapterId: candidateId,
        command: delegatedConfig.binaryName,
        args: ["--dry-run"],
        safe: true,
        requiresApproval: approvalRequired,
        estimatedDuration: "planned",
      };
    } else {
      commandPreview = buildBuiltInCommandPreview(candidateId, approvalRequired);
    }

    reasonCodes.push(`ADAPTER_SELECTED:${candidateId}`);
    break;
  }

  // Build fallback chain — only equal-or-safer adapters
  const selectedDesc = getDescriptor(selectedAdapter);
  if (selectedDesc && constraints.allowFallback) {
    for (const candidateId of preferenceOrder) {
      if (candidateId === selectedAdapter) continue;
      const desc = getDescriptor(candidateId);
      if (!desc) continue;
      if (!isAdapterAllowed(candidateId, constraints)) continue;
      if (availability[candidateId] !== "available") continue;
      if (!isFallbackSafe(selectedDesc, desc, constraints)) {
        reasonCodes.push(`FALLBACK_UNSAFE:${candidateId}`);
        continue;
      }
      fallbackAdapters.push(candidateId);
    }
  }

  if (selectedAdapter === "manual-gate") {
    executionMode = "manual_gate";
    approvalRequired = true;
    toolMayExecute = false;
    reasonCodes.push("MANUAL_GATE_SELECTED");
  }

  forbiddenActions.push("persist_raw_prompt", "persist_raw_source", "persist_raw_output");

  return {
    selectedAdapter,
    executionMode,
    fallbackAdapters,
    approvalRequired,
    proofRequired,
    commandPreview,
    reasonCodes,
    forbiddenActions,
    policyConstraints: constraints,
    toolMayExecute,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
  };
}

function resolveExecutionMode(adapterId: ToolAdapterId, taskClass: TaskClass): ExecutionMode {
  if (adapterId === "deterministic-local") return "deterministic";
  if (adapterId === "scanner") return "scanner";
  if (adapterId === "semgrep" || adapterId === "playwright-proof" || adapterId === "github-actions") return "proof";
  if (adapterId === "manual-gate") return "manual_gate";
  if (taskClass === "production_deploy") return "manual_gate";
  if (taskClass === "billing_payment" || taskClass === "security_review") return "manual_gate";
  if (taskClass === "low_risk_code" || taskClass === "code_review" || taskClass === "long_context_refactor") return "real";
  return "dry_run";
}

function buildBuiltInCommandPreview(adapterId: ToolAdapterId, approvalRequired: boolean): AdapterSafeCommandPreview | null {
  switch (adapterId) {
    case "deterministic-local":
      return {
        adapterId,
        command: "node",
        args: ["src/avorelo/surfaces/cli/avorelo.ts", "status"],
        safe: true,
        requiresApproval: approvalRequired,
        estimatedDuration: "planned",
      };
    case "scanner":
      return {
        adapterId,
        command: "node",
        args: ["tools/naming-check.ts"],
        safe: true,
        requiresApproval: approvalRequired,
        estimatedDuration: "planned",
      };
    case "semgrep":
      return {
        adapterId,
        command: "semgrep",
        args: ["--config", "local", "--json", "."],
        safe: true,
        requiresApproval: approvalRequired,
        estimatedDuration: "planned",
      };
    case "playwright-proof":
      return {
        adapterId,
        command: "node",
        args: ["src/avorelo/kernel/tool-adapters/playwright-proof-runner.mjs", "fixture"],
        safe: true,
        requiresApproval: approvalRequired,
        estimatedDuration: "planned",
      };
    case "github-actions":
      return {
        adapterId,
        command: "gh",
        args: ["api", "repos/<owner>/<repo>/actions/runs?per_page=5"],
        safe: true,
        requiresApproval: approvalRequired,
        estimatedDuration: "planned",
      };
    default:
      return null;
  }
}

export function buildToolRoutingProjection(plan: ToolExecutionPlan, availability: Record<ToolAdapterId, "available" | "unavailable" | "unknown" | "cooldown">): ToolRoutingProjection {
  return {
    selectedAdapter: plan.selectedAdapter,
    executionMode: plan.executionMode,
    fallbackAdapters: plan.fallbackAdapters,
    adapterAvailability: availability,
    approvalRequired: plan.approvalRequired,
    proofRequired: plan.proofRequired,
    reasonCodes: plan.reasonCodes,
    forbiddenActions: plan.forbiddenActions,
    toolMayExecute: plan.toolMayExecute,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
  };
}
