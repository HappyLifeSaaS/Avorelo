// Avorelo Secret Boundary v1 (Phase 2) — orchestration + public surface of the capability.
// Order of operations (the product principle): detect → redact (before model) → block (before action) →
// persist only redacted receipts → sync only sanitized allowlist metadata → safe references, never raw values.
//
// Built ON Phase 1: SafeReference (shared/safe-reference), receipt validation (kernel/receipts/validation),
// redaction policy (shared/redaction/policy), receipt safety gate (kernel/receipts/eligibility).

export * from "./detector.ts";
export * from "./redactor.ts";
export * from "./source-trust.ts";
export * from "./instruction-risk.ts";
export * from "./intake-risk.ts";
export * from "./safe-run.ts";
export * from "./remediation.ts";
export * from "./runtime-gate.ts";
export * from "./handoff.ts";
export * from "./receipt.ts";

import { redactValue } from "./redactor.ts";
import type { SecretSourceKind, SecretFinding } from "./detector.ts";
import { hasCriticalFinding } from "./detector.ts";
import { buildRemediation, type RemediationPlan } from "./remediation.ts";
import { buildSecretBoundaryReceipt, buildSyncPayload, type SecretBoundaryDecision, type BuiltReceipt } from "./receipt.ts";
import type { SafeReference } from "../../shared/schemas/index.ts";

export type ScanInput = {
  content: unknown;
  sourceKind?: SecretSourceKind;
  receiptId?: string;
  createdAt?: string; // injectable ISO for deterministic tests
};

export type ScanResult = {
  decision: SecretBoundaryDecision;
  redacted: unknown; // same shape, secrets gone
  findings: SecretFinding[];
  safeReferences: SafeReference[];
  remediation: RemediationPlan | null;
  receipt: BuiltReceipt["receipt"];
  cloudEligible: boolean;
  syncPayload: Record<string, unknown>;
};

let counter = 0;

/**
 * Scan content end-to-end: redact, decide, remediate, and build a redacted, eligibility-checked receipt.
 * Deterministic and local. The model only ever sees `redacted` / `safeReferences`, never the raw value.
 */
export function scanContent(input: ScanInput): ScanResult {
  const out = redactValue(input.content, input.sourceKind ?? "unknown");
  const hasFindings = out.findings.length > 0;
  const critical = hasCriticalFinding(out.findings);

  const decision: SecretBoundaryDecision = !hasFindings ? "allow" : critical ? "block" : "redact";
  const remediation = hasFindings ? buildRemediation(out.findings) : null;
  const actions = remediation ? remediation.actions : [];

  const receiptId = input.receiptId ?? `rcpt_sb_${++counter}`;
  const built = buildSecretBoundaryReceipt({ receiptId, decision, findings: out.findings, actions, safeReferences: out.safeReferences, createdAt: input.createdAt });

  return {
    decision,
    redacted: out.redacted,
    findings: out.findings,
    safeReferences: out.safeReferences,
    remediation,
    receipt: built.receipt,
    cloudEligible: built.cloudEligible,
    syncPayload: buildSyncPayload(built.receipt),
  };
}
