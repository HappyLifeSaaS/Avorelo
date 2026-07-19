// Cascade verifier. Validates routing decisions against safety invariants.

import type { ModelProfile, ResolverResult, ModelRoutingProjection } from "./types.ts";
import type { RoutingTaskFrame } from "../../validation/model-routing/index.ts";

export type VerifierViolation = {
  code: string;
  severity: "error" | "warning";
  detail: string;
};

export type VerifierResult = {
  valid: boolean;
  violations: VerifierViolation[];
};

export function verifyRoutingDecision(
  frame: RoutingTaskFrame,
  profile: ModelProfile,
  resolver: ResolverResult,
  projection: ModelRoutingProjection,
): VerifierResult {
  const violations: VerifierViolation[] = [];

  // Invariant: modelMayDecide must always be false
  if (projection.modelMayDecide !== false) {
    violations.push({ code: "MODEL_MAY_DECIDE", severity: "error", detail: "modelMayDecide must be false" });
  }

  // Invariant: scannerMayDecide must always be false
  if (projection.scannerMayDecide !== false) {
    violations.push({ code: "SCANNER_MAY_DECIDE", severity: "error", detail: "scannerMayDecide must be false" });
  }

  // Invariant: finalDecisionOwner must be kernel
  if (projection.finalDecisionOwner !== "kernel/stop-continue-gate") {
    violations.push({ code: "WRONG_DECISION_OWNER", severity: "error", detail: "finalDecisionOwner must be kernel/stop-continue-gate" });
  }

  // Invariant: no raw content flags
  if (projection.containsRawPrompt !== false) {
    violations.push({ code: "RAW_PROMPT", severity: "error", detail: "containsRawPrompt must be false" });
  }
  if (projection.containsRawSource !== false) {
    violations.push({ code: "RAW_SOURCE", severity: "error", detail: "containsRawSource must be false" });
  }
  if (projection.containsRawSecret !== false) {
    violations.push({ code: "RAW_SECRET", severity: "error", detail: "containsRawSecret must be false" });
  }

  // Invariant: production impact must be stop_blocked
  if (frame.productionImpactPossible && projection.selectedPrimitive !== "stop_blocked") {
    violations.push({ code: "PRODUCTION_NOT_BLOCKED", severity: "error", detail: "production impact must route to stop_blocked" });
  }

  // Invariant: security-sensitive must have scanners in forbidden actions
  if ((frame.secretsPossible || frame.authTouched || frame.paymentTouched) && !projection.forbiddenActions.includes("model_owns_READY")) {
    violations.push({ code: "MISSING_FORBIDDEN_MODEL_READY", severity: "warning", detail: "security-sensitive route should forbid model_owns_READY" });
  }

  // Invariant: deterministic route should not select expensive model
  if (profile === "none" && resolver.selectedModel !== null) {
    violations.push({ code: "MODEL_FOR_DETERMINISTIC", severity: "warning", detail: "no_model profile should not resolve a model" });
  }

  // Invariant: fallback must not use training_included when data is sensitive
  if (frame.dataSensitivity === "high" && resolver.selectedModel?.dataPolicy === "training_included") {
    violations.push({ code: "TRAINING_DATA_SENSITIVE", severity: "error", detail: "sensitive data must not use training_included provider" });
  }

  return { valid: violations.filter(v => v.severity === "error").length === 0, violations };
}
