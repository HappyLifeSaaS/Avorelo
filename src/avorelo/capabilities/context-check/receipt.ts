// Avorelo Context Check — Receipt builder. Builds an `avorelo.contextCheck.v1` receipt
// from scan results. Carries coded findings + counts only — never raw instruction content,
// secrets, or full file content. Follows the secret-boundary receipt pattern.

import { validateReceiptSafety } from "../../kernel/receipts/validation.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import type { ContextCheckResult, CheckStatus, RiskLevel, FindingCode } from "./types.ts";

export type ContextCheckReceipt = {
  contract: "avorelo.contextCheck.v1";
  schemaVersion: 1;
  receiptId: string;
  createdAt: string;
  redacted: true;
  rawInstructionContentPersisted: false;
  rawSecretPersisted: false;
  status: CheckStatus;
  riskLevel: RiskLevel;
  sourcesChecked: number;
  agentFamiliesDetected: string[];
  findingSummary: ContextCheckFindingSummary[];
  scanDurationMs: number;
  workContractProvided: boolean;
  syncPolicy: { cloudEligible: boolean; allowlistOnly: true; containsRawContent: false };
};

export type ContextCheckFindingSummary = {
  code: FindingCode;
  severity: string;
  confidence: string;
  path: string;
};

function safeReasonCodes(status: CheckStatus): string[] {
  const codes = ["REDACTED"];
  if (status === "needs_attention") codes.push("STOP_BLOCKED");
  else codes.push("CONTINUE");
  return codes;
}

export type BuildContextCheckReceiptInput = {
  receiptId: string;
  result: ContextCheckResult;
  createdAt?: string;
};

export type BuiltContextCheckReceipt = {
  receipt: ContextCheckReceipt;
  cloudEligible: boolean;
  eligibilityReasons: string[];
  validationReasons: string[];
};

export function buildSyncPayload(receipt: ContextCheckReceipt): Record<string, unknown> {
  return {
    receiptId: receipt.receiptId,
    status: receipt.status,
    riskLevel: receipt.riskLevel,
    sourcesChecked: receipt.sourcesChecked,
    findingCodes: receipt.findingSummary.map(f => f.code),
    count: receipt.findingSummary.length,
    redacted: true,
    timestamp: receipt.createdAt,
  };
}

export function buildContextCheckReceipt(input: BuildContextCheckReceiptInput): BuiltContextCheckReceipt {
  const { result } = input;
  const reasonCodes = safeReasonCodes(result.status);

  const receipt: ContextCheckReceipt = {
    contract: "avorelo.contextCheck.v1",
    schemaVersion: 1,
    receiptId: input.receiptId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    redacted: true,
    rawInstructionContentPersisted: false,
    rawSecretPersisted: false,
    status: result.status,
    riskLevel: result.riskLevel,
    sourcesChecked: result.sourcesChecked,
    agentFamiliesDetected: result.evidence.agentFamiliesDetected,
    findingSummary: result.findings.map(f => ({
      code: f.code,
      severity: f.severity,
      confidence: f.confidence,
      path: f.path,
    })),
    scanDurationMs: result.evidence.scanDurationMs,
    workContractProvided: result.evidence.workContractProvided,
    syncPolicy: { cloudEligible: false, allowlistOnly: true, containsRawContent: false },
  };

  const validation = validateReceiptSafety({
    schemaName: receipt.contract,
    schemaVersion: String(receipt.schemaVersion),
    redacted: true,
    payload: { findingSummary: receipt.findingSummary },
    reasonCodes,
  });

  const syncPayload = buildSyncPayload(receipt);
  const elig = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: syncPayload, reasonCodes });

  const cloudEligible = validation.cloudEligible && elig.eligible;
  receipt.syncPolicy.cloudEligible = cloudEligible;

  return { receipt, cloudEligible, eligibilityReasons: elig.reasons, validationReasons: validation.reasons };
}
