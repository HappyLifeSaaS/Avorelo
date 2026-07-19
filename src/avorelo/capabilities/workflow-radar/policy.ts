import type { ModelRoutingInputMode } from "../model-routing-input/index.ts";
import type { WorkflowRadarDecisionState, WorkflowRadarRiskLevel } from "./types.ts";

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

export function pathIsInExpectedScope(path: string, scopeEntries: string[]): boolean {
  const normalizedPath = normalizePath(path);
  return scopeEntries.some((entry) => {
    const normalizedEntry = normalizePath(entry);
    if (!normalizedEntry) return false;
    if (normalizedEntry.endsWith("/**")) {
      const prefix = normalizedEntry.slice(0, -3);
      return normalizedPath.startsWith(prefix);
    }
    if (normalizedEntry.includes("*")) {
      const pattern = "^" + normalizedEntry.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
      return new RegExp(pattern).test(normalizedPath);
    }
    return normalizedPath === normalizedEntry || normalizedPath.startsWith(normalizedEntry + "/");
  });
}

export function maxRisk(a: WorkflowRadarRiskLevel, b: WorkflowRadarRiskLevel): WorkflowRadarRiskLevel {
  const order: Record<WorkflowRadarRiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return order[a] >= order[b] ? a : b;
}

export function isAuthOrDashboardSensitivePath(path: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase();
  return (
    /(^|\/)(auth|login|signup|session|permission|role|security|settings)(\/|$)/.test(normalizedPath) ||
    normalizedPath.includes("dashboard") ||
    normalizedPath.endsWith("login.html") ||
    normalizedPath.endsWith("signup.html")
  );
}

export function isProductionSensitivePath(path: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase();
  return (
    /(^|\/)(deploy|release|production|publish|netlify|railway)(\/|$)/.test(normalizedPath) ||
    normalizedPath === "netlify.toml" ||
    normalizedPath === "railway.json"
  );
}

export function actualWorkModeFromFlags(input: {
  blocked: boolean;
  review: boolean;
  guarded: boolean;
  changedCount: number;
}): ModelRoutingInputMode {
  if (input.blocked) return "blocked_needs_decision";
  if (input.review) return "human_review_required";
  if (input.guarded) return "guarded_high_risk";
  if (input.changedCount >= 6) return "deep_reasoning";
  if (input.changedCount > 0) return "standard_reasoning";
  return "simple_fast";
}

function modeRank(mode: ModelRoutingInputMode): number {
  switch (mode) {
    case "simple_fast": return 1;
    case "standard_reasoning": return 2;
    case "deep_reasoning": return 3;
    case "guarded_high_risk": return 4;
    case "human_review_required": return 5;
    case "blocked_needs_decision": return 6;
  }
}

export function modelRoutingModeIsConsistent(expected: ModelRoutingInputMode, actual: ModelRoutingInputMode): boolean {
  return modeRank(expected) >= modeRank(actual);
}

export function workflowRadarDecisionStateIsReady(state: WorkflowRadarDecisionState): boolean {
  return state === "ON_TRACK" || state === "ON_TRACK_WITH_WARNINGS";
}
