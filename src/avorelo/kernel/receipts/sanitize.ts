// Canonical receipt sanitization (local receipt layer). Reduces a local receipt to a safe, allowlisted
// projection. NEVER includes raw prompts, model responses, source code, secrets, full paths, or git diffs:
// only explicitly allowlisted fields (ids, decision, evidence levels, allowlisted reason codes, capability
// name, timestamp, measured counters, detected states) survive. Pure local; no network, no hosted schema.
// (Relocated from capabilities/cloud-sync/sync-policy.ts; behavior is identical.)

export type LocalReceipt = {
  receiptId: string;
  contractId?: string;
  decision?: string;
  confidence?: string;
  reasonCodes?: string[];
  graded?: Array<{ artifactId: string; level: string; ref?: string }>;
  safeNextActions?: string[];
  decisionBasis?: {
    method?: string;
    confidence?: string;
    evidenceRefs?: string[];
    reasonCodes?: string[];
    fallbackUsed?: boolean;
  };
  sampleSize?: number;
  timestamp?: string;
  redactionClasses?: string[];
  [key: string]: unknown;
};

export type SanitizedReceipt = {
  localReceiptId: string;
  decision: string;
  evidenceLevels: string[];
  reasonCodes: string[];
  capabilityName: string | null;
  sessionTimestamp: Date | null;
  measuredCounters: Record<string, number>;
  estimatedFields: Record<string, unknown>;
  detectedStates: Record<string, unknown>;
};

export const SAFE_REASON_CODES = new Set([
  "FULL_ACTIVATION_V2", "ACTIVATION_COMPLETE", "KERNEL_PROOF",
  "EVIDENCE_SUFFICIENT", "EVIDENCE_INSUFFICIENT", "READINESS_VERIFIED",
  "SECRET_DETECTED", "REDACTED", "HOOK_INSTALLED", "HOOK_BLOCKED",
  "CONFIDENCE_HIGH", "CONFIDENCE_LOW", "SAMPLE_SIZE_OK",
  "STOP_DONE", "STOP_BLOCKED", "CONTINUE",
]);

export function sanitizeReceipt(receipt: LocalReceipt): SanitizedReceipt {
  const evidenceLevels = (receipt.graded ?? [])
    .map(g => g.level)
    .filter((l): l is string => typeof l === "string");

  const reasonCodes = (receipt.reasonCodes ?? receipt.decisionBasis?.reasonCodes ?? [])
    .filter(code => SAFE_REASON_CODES.has(code));

  const capabilityName = typeof receipt.contractId === "string"
    ? receipt.contractId.replace(/^cli_|^hook_|^canonical-/, "")
    : null;

  const sessionTimestamp = receipt.timestamp ? new Date(receipt.timestamp) : null;

  return {
    localReceiptId: receipt.receiptId,
    decision: receipt.decision ?? "unknown",
    evidenceLevels,
    reasonCodes,
    capabilityName,
    sessionTimestamp,
    measuredCounters: extractMeasuredCounters(receipt),
    estimatedFields: {},
    detectedStates: extractDetectedStates(receipt),
  };
}

function extractMeasuredCounters(receipt: LocalReceipt): Record<string, number> {
  const counters: Record<string, number> = {};
  if (typeof receipt.sampleSize === "number") counters.sampleSize = receipt.sampleSize;
  const graded = receipt.graded ?? [];
  if (graded.length > 0) counters.artifactCount = graded.length;
  return counters;
}

function extractDetectedStates(receipt: LocalReceipt): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  if (receipt.decisionBasis?.fallbackUsed !== undefined) {
    states.fallbackUsed = receipt.decisionBasis.fallbackUsed;
  }
  if (receipt.decisionBasis?.method) {
    states.method = receipt.decisionBasis.method;
  }
  if (receipt.confidence) {
    states.confidence = receipt.confidence;
  }
  return states;
}
