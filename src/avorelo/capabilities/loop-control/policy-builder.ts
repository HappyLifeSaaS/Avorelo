// Avorelo Loop Policy Builder (V1). Turns readiness + user inputs into a bounded V1 policy.
// V1 modes: single_run, bounded_loop. No human_gated_loop, analysis_only, or scheduled.

import { randomUUID } from "node:crypto";
import type {
  LoopPolicy, LoopReadinessResult, LoopCheckResult, LoopEscalationRule,
  LoopStopCondition, RiskClass, LoopMode,
} from "../../shared/schemas/index.ts";
import { detectCheckCommands, detectedChecksToLoopChecks } from "./check-detection.ts";

export type BuildPolicyInput = {
  readiness: LoopReadinessResult;
  userChecks?: { label: string; command: string; type?: LoopCheckResult["type"] }[];
  userMaxIterations?: number;
  userMaxRuntimeMinutes?: number;
  allowedCommands?: string[];
  blockedCommands?: string[];
  receiptLevel?: "compact" | "detailed";
  cwd?: string;
};

function defaultEscalationRules(): LoopEscalationRule[] {
  return [
    { condition: "blocked_path_touched", action: "stop", message: "Agent changed a file in the blocked paths. Loop stopped." },
    { condition: "secret_detected", action: "stop", message: "Secret detected in agent output. Loop stopped." },
  ];
}

function defaultStopConditions(): LoopStopCondition[] {
  return [
    { conditionId: "sc_success", type: "success", condition: "All required checks passed", enabled: true },
    { conditionId: "sc_repeated", type: "failure", condition: "Same check failure repeats 2 consecutive iterations", enabled: true },
    { conditionId: "sc_blocked_path", type: "safety", condition: "File in disallowed paths changed", enabled: true },
    { conditionId: "sc_secret", type: "safety", condition: "Secret detected in agent output", enabled: true },
    { conditionId: "sc_destructive", type: "safety", condition: "Destructive command attempted", enabled: true },
    { conditionId: "sc_max_iter", type: "budget", condition: "Max iterations reached", enabled: true },
    { conditionId: "sc_max_runtime", type: "budget", condition: "Max runtime exceeded", enabled: true },
  ];
}

function buildChecks(userChecks?: BuildPolicyInput["userChecks"], cwd?: string): LoopCheckResult[] {
  const checks: LoopCheckResult[] = [];
  let idx = 1;

  if (userChecks && userChecks.length > 0) {
    for (const uc of userChecks) {
      checks.push({
        checkId: `chk_${String(idx++).padStart(2, "0")}`,
        label: uc.label,
        command: uc.command,
        type: uc.type ?? "custom",
        required: true,
        lastResult: "not_run",
        lastOutput: null,
      });
    }
  } else if (cwd) {
    const detected = detectedChecksToLoopChecks(detectCheckCommands(cwd));
    for (const dc of detected) {
      checks.push({ ...dc, checkId: `chk_${String(idx++).padStart(2, "0")}` });
    }
  }

  checks.push({
    checkId: `chk_${String(idx++).padStart(2, "0")}`,
    label: "scope check",
    command: null,
    type: "scope_check",
    required: true,
    lastResult: "not_run",
    lastOutput: null,
  });

  return checks;
}

export function buildLoopPolicy(input: BuildPolicyInput): LoopPolicy {
  const { readiness } = input;

  let mode: LoopMode = readiness.recommendedMode;
  let maxIterations = readiness.recommendedMaxIterations;
  let maxRuntime = readiness.recommendedMaxRuntimeMinutes;

  if (readiness.classification === "needs_human_gate" || readiness.classification === "blocked") {
    mode = "single_run";
    maxIterations = 1;
  }

  if (input.userMaxIterations !== undefined) {
    maxIterations = Math.min(input.userMaxIterations, 10);
  }
  if (input.userMaxRuntimeMinutes !== undefined) {
    maxRuntime = Math.min(input.userMaxRuntimeMinutes, 60);
  }

  if (mode === "single_run") maxIterations = 1;

  return {
    policyId: `pol_${randomUUID().slice(0, 8)}`,
    mode,
    maxIterations,
    maxRuntimeMinutes: maxRuntime,
    maxTokenBudget: null,
    allowedCommands: input.allowedCommands ?? [],
    blockedCommands: input.blockedCommands ?? ["npm publish", "git push", "git push --force"],
    requiredChecks: buildChecks(input.userChecks, input.cwd),
    stopConditions: defaultStopConditions(),
    escalationRules: defaultEscalationRules(),
    receiptLevel: input.receiptLevel ?? "compact",
    riskTier: readiness.riskTier,
  };
}
