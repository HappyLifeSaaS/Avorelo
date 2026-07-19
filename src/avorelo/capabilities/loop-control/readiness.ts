// Avorelo Loop Readiness Classifier (V1). Deterministic, no LLM.
// Classifies whether a task is suitable for looping. Conservative by default.

import type { EnrichedWorkContract, LoopReadinessResult, LoopMode, RiskClass } from "../../shared/schemas/index.ts";

const HIGH_RISK_KEYWORDS = [
  "auth", "login", "oauth", "permission", "acl", "role",
  "billing", "payment", "charge", "invoice", "subscription",
  "database", "migration", "schema", "drop", "truncate",
  "deploy", "production", "prod", "release",
  "secret", "credential", "key", "token", "password",
  "security", "encrypt", "decrypt", "certificate",
];

const BROAD_TASK_PATTERNS = [
  /\brefactor\s+(everything|the\s+app|the\s+whole|all)\b/i,
  /\bfix\s+everything\b/i,
  /\bimprove\s+(the\s+)?ux\b/i,
  /\bbuild\s+(the|a)\s+(new\s+)?feature\b/i,
  /\brewrite\b/i,
  /\bmake\s+it\s+better\b/i,
];

const DESTRUCTIVE_PATTERNS = [
  /\bdeploy\s+to\s+prod/i,
  /\bpush\s+to\s+(main|master|prod)/i,
  /\bmerge\s+to\s+(main|master)/i,
  /\bdelete\s+(all|the\s+database|prod)/i,
  /\bdrop\s+(table|database)/i,
];

function hasHighRiskKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return HIGH_RISK_KEYWORDS.some((kw) => lower.includes(kw));
}

function isBroadTask(text: string): boolean {
  return BROAD_TASK_PATTERNS.some((p) => p.test(text));
}

function isDestructiveTask(text: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(text));
}

function defaultIterations(risk: RiskClass): number {
  switch (risk) {
    case "low": return 5;
    case "medium": return 3;
    case "high": return 2;
    case "critical": return 1;
  }
}

function defaultRuntime(risk: RiskClass): number {
  switch (risk) {
    case "low": return 10;
    case "medium": return 15;
    case "high": return 20;
    case "critical": return 10;
  }
}

function defaultMode(risk: RiskClass): LoopMode {
  return risk === "critical" ? "single_run" : "bounded_loop";
}

function defaultProof(risk: RiskClass): string[] {
  switch (risk) {
    case "low": return ["typecheck"];
    case "medium": return ["tests", "typecheck", "scope_check"];
    case "high": return ["tests", "typecheck", "scope_check", "drift_check"];
    case "critical": return ["tests", "typecheck", "scope_check", "drift_check"];
  }
}

export type ClassifyReadinessInput = {
  task: string;
  enrichedContract?: EnrichedWorkContract;
  riskHints?: string[];
};

export function classifyLoopReadiness(input: ClassifyReadinessInput): LoopReadinessResult {
  const { task, enrichedContract } = input;
  const reasonCodes: string[] = [];
  const humanGateConditions: string[] = [];

  if (isDestructiveTask(task)) {
    reasonCodes.push("DESTRUCTIVE_TASK");
    return {
      classification: "blocked",
      riskTier: "critical",
      reasonCodes,
      recommendedMode: "single_run",
      recommendedMaxIterations: 1,
      recommendedMaxRuntimeMinutes: 10,
      requiredProof: ["tests", "typecheck", "scope_check", "drift_check"],
      humanGateConditions: ["Task involves destructive or production-write operations."],
    };
  }

  if (isBroadTask(task)) {
    reasonCodes.push("BROAD_TASK");
    return {
      classification: "not_suitable",
      riskTier: enrichedContract?.riskClass ?? "medium",
      reasonCodes,
      recommendedMode: "single_run",
      recommendedMaxIterations: 1,
      recommendedMaxRuntimeMinutes: 10,
      requiredProof: [],
      humanGateConditions: [],
    };
  }

  if (enrichedContract) {
    if (enrichedContract.route === "blocked") {
      reasonCodes.push("ROUTE_BLOCKED");
      return result("blocked", enrichedContract.riskClass, reasonCodes, []);
    }
    if (enrichedContract.route === "needs_decision") {
      reasonCodes.push("ROUTE_NEEDS_DECISION");
      return result("not_suitable", enrichedContract.riskClass, reasonCodes, []);
    }
    if (enrichedContract.approvalPolicy === "blocked") {
      reasonCodes.push("APPROVAL_BLOCKED");
      return result("blocked", enrichedContract.riskClass, reasonCodes, []);
    }
    if (enrichedContract.riskClass === "critical") {
      reasonCodes.push("CRITICAL_RISK");
      humanGateConditions.push("Critical risk task requires manual oversight.");
      return result("needs_human_gate", "critical", reasonCodes, humanGateConditions);
    }
    if (enrichedContract.riskClass === "high" || enrichedContract.approvalPolicy === "require_manual_review") {
      reasonCodes.push("HIGH_RISK");
      if (enrichedContract.safetyBoundary?.secretRiskCodes?.length > 0) {
        humanGateConditions.push("Secret-adjacent files may be affected.");
      }
      humanGateConditions.push("High-risk task — review changes before proceeding.");
      return result("needs_human_gate", "high", reasonCodes, humanGateConditions);
    }
    if (enrichedContract.allowedPaths.length > 20) {
      reasonCodes.push("SCOPE_TOO_WIDE");
      return result("not_suitable", enrichedContract.riskClass, reasonCodes, []);
    }
    if (enrichedContract.riskClass === "medium") {
      reasonCodes.push("MEDIUM_RISK");
      return result("safe_with_bounded_loop", "medium", reasonCodes, []);
    }
    reasonCodes.push("LOW_RISK");
    return result("safe_to_loop", "low", reasonCodes, []);
  }

  if (hasHighRiskKeyword(task)) {
    reasonCodes.push("HIGH_RISK_KEYWORD");
    humanGateConditions.push("Task mentions high-risk domain. Review scope before looping.");
    return result("needs_human_gate", "high", reasonCodes, humanGateConditions);
  }

  reasonCodes.push("DEFAULT_MEDIUM");
  return result("safe_with_bounded_loop", "medium", reasonCodes, []);
}

function result(classification: LoopReadinessResult["classification"], risk: RiskClass, reasonCodes: string[], humanGateConditions: string[]): LoopReadinessResult {
  return {
    classification,
    riskTier: risk,
    reasonCodes,
    recommendedMode: defaultMode(risk),
    recommendedMaxIterations: defaultIterations(risk),
    recommendedMaxRuntimeMinutes: defaultRuntime(risk),
    requiredProof: defaultProof(risk),
    humanGateConditions,
  };
}
