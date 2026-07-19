// Avorelo Secret Boundary — Receipt builder (Phase 2). Builds an `avorelo.secretBoundary.v1` receipt and
// derives cloud eligibility THROUGH the Phase 1 policy (no parallel receipt/sync truth). Receipts carry coded
// findings + SafeReferences only — never raw secrets/prompts/source/env/logs/diffs/paths.

import { validateReceiptSafety } from "../../kernel/receipts/validation.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import type { SecretFinding } from "./detector.ts";
import type { SafeReference } from "../../shared/schemas/index.ts";

export type SecretBoundaryDecision = "allow" | "redact" | "block" | "require_approval" | "remediate";

export type SecretBoundaryReceipt = {
  contract: "avorelo.secretBoundary.v1";
  schemaVersion: 1;
  receiptId: string;
  createdAt: string; // ISO
  redacted: true;
  rawSecretPersisted: false;
  rawSecretSynced: false;
  modelSawSecret: false;
  decision: SecretBoundaryDecision;
  findings: SecretFinding[]; // coded; no raw values
  actions: string[];
  safeReferences: SafeReference[];
  syncPolicy: { cloudEligible: boolean; allowlistOnly: true; containsRawSecrets: false };
};

// Map a boundary decision to a sanctioned (allowlisted) reason code for the Phase 1 eligibility check.
function safeReasonCodes(decision: SecretBoundaryDecision, hasFindings: boolean): string[] {
  const codes = ["REDACTED"];
  if (hasFindings) codes.push("SECRET_DETECTED");
  if (decision === "block" || decision === "require_approval") codes.push("STOP_BLOCKED");
  else codes.push("CONTINUE");
  return codes;
}

export type BuildReceiptInput = {
  receiptId: string;
  decision: SecretBoundaryDecision;
  findings: SecretFinding[];
  actions: string[];
  safeReferences: SafeReference[];
  createdAt?: string; // injectable ISO for deterministic tests
};

export type BuiltReceipt = {
  receipt: SecretBoundaryReceipt;
  cloudEligible: boolean;
  eligibilityReasons: string[];
  validationReasons: string[];
};

/** The sanitized, allowlist-only sync payload for a boundary receipt (codes/counts/actions only). */
export function buildSyncPayload(receipt: SecretBoundaryReceipt): Record<string, unknown> {
  return {
    receiptId: receipt.receiptId,
    decision: receipt.decision,
    findingCodes: receipt.findings.map((f) => f.code),
    severities: receipt.findings.map((f) => f.severity),
    count: receipt.findings.length,
    safeActions: receipt.actions,
    redacted: true,
    timestamp: receipt.createdAt,
  };
}

/** Build the receipt and derive cloud eligibility via the Phase 1 policy. */
export function buildSecretBoundaryReceipt(input: BuildReceiptInput): BuiltReceipt {
  const hasFindings = input.findings.length > 0;
  const reasonCodes = safeReasonCodes(input.decision, hasFindings);

  const receipt: SecretBoundaryReceipt = {
    contract: "avorelo.secretBoundary.v1",
    schemaVersion: 1,
    receiptId: input.receiptId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    redacted: true,
    rawSecretPersisted: false,
    rawSecretSynced: false,
    modelSawSecret: false,
    decision: input.decision,
    findings: input.findings,
    actions: input.actions,
    safeReferences: input.safeReferences,
    syncPolicy: { cloudEligible: false, allowlistOnly: true, containsRawSecrets: false },
  };

  // Validate the receipt's safety envelope through Phase 1 (defense in depth: re-classify findings payload).
  const validation = validateReceiptSafety({
    schemaName: receipt.contract,
    schemaVersion: String(receipt.schemaVersion),
    redacted: true,
    payload: { findings: receipt.findings, actions: receipt.actions },
    reasonCodes,
  });

  // Cloud eligibility for the SANITIZED sync payload, through the Phase 1 allowlist-only gate.
  const syncPayload = buildSyncPayload(receipt);
  const elig = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: syncPayload, reasonCodes });

  const cloudEligible = validation.cloudEligible && elig.eligible;
  receipt.syncPolicy.cloudEligible = cloudEligible;

  return { receipt, cloudEligible, eligibilityReasons: elig.reasons, validationReasons: validation.reasons };
}
