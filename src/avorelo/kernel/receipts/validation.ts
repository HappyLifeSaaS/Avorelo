// Avorelo Receipt Validation Foundation (Phase 1). Additive helpers that NEW receipts can use to declare
// and validate their safety envelope. Does NOT migrate or revalidate existing legacy receipts — the
// existing `writeReceipt`/`persistReceipt` allowlist-only path is preserved unchanged.
//
// A receipt is cloud eligible ONLY if it is redacted, every "containsRaw*" flag is false, and all of its
// reason codes are on the sanctioned allowlist (the canonical SAFE_REASON_CODES set (kernel/receipts/sanitize)).

import { classifyPayload } from "../../shared/redaction/policy.ts";
import { SAFE_REASON_CODES } from "./sanitize.ts";
import type {
  ReceiptSafetyFlags,
  ValidatedReceiptMeta,
  EvidenceConfidence,
} from "../../shared/schemas/index.ts";

export const SYNC_POLICY_NAME = "allowlist-only-v1";

/** All-clear safety flags (the only state in which a payload can be cloud eligible). */
export function clearFlags(): ReceiptSafetyFlags {
  return {
    containsRawPrompt: false,
    containsRawTranscript: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsEnvValue: false,
    containsTerminalLog: false,
    containsGitDiff: false,
    containsSensitiveFilePath: false,
  };
}

/** Map a payload-classification violation code onto the matching safety flag. */
function applyViolation(flags: ReceiptSafetyFlags, code: string): void {
  if (code.startsWith("raw_secret")) flags.containsRawSecret = true;
  else if (code === "raw_prompt") flags.containsRawPrompt = true;
  else if (code === "raw_transcript") flags.containsRawTranscript = true;
  else if (code === "raw_source") flags.containsRawSource = true;
  else if (code === "env_value") flags.containsEnvValue = true;
  else if (code === "terminal_log") flags.containsTerminalLog = true;
  else if (code === "git_diff") flags.containsGitDiff = true;
  else if (code === "sensitive_file_path") flags.containsSensitiveFilePath = true;
}

/** Derive safety flags from an actual payload via the allowlist-first redaction policy. */
export function deriveFlags(payload: unknown): ReceiptSafetyFlags {
  const flags = clearFlags();
  for (const v of classifyPayload(payload).violations) applyViolation(flags, v);
  return flags;
}

export function anyFlagSet(flags: ReceiptSafetyFlags): boolean {
  return Object.values(flags).some(Boolean);
}

/** A reason code is safe only if it is on the sanctioned sync allowlist. */
export function hasUnsafeReasonCode(reasonCodes: string[]): boolean {
  return reasonCodes.some((c) => !SAFE_REASON_CODES.has(c));
}

export type ReceiptValidationInput = {
  schemaName: string;
  schemaVersion: string;
  createdAt?: number | null;
  redacted: boolean;
  flags?: ReceiptSafetyFlags; // explicit declaration; if omitted, derived from `payload`
  payload?: unknown; // optional — when present, flags are derived from it (defense in depth)
  reasonCodes?: string[];
  evidenceConfidence?: EvidenceConfidence;
};

export type ReceiptValidationResult = {
  meta: ValidatedReceiptMeta;
  cloudEligible: boolean;
  reasons: string[]; // why it is/ isn't eligible
};

/**
 * Validate a receipt's safety envelope and DERIVE its cloud eligibility. `cloudEligible` is never taken
 * on trust — it is computed from redaction + flags + reason codes here.
 */
export function validateReceiptSafety(input: ReceiptValidationInput): ReceiptValidationResult {
  const reasons: string[] = [];

  // Start from the declared flags, then OR-in anything detected in the actual payload.
  const flags = input.flags ? { ...input.flags } : clearFlags();
  if (input.payload !== undefined) {
    const derived = deriveFlags(input.payload);
    for (const k of Object.keys(flags) as (keyof ReceiptSafetyFlags)[]) {
      flags[k] = flags[k] || derived[k];
    }
  }

  const reasonCodes = input.reasonCodes ?? [];
  if (!input.redacted) reasons.push("not_redacted");
  if (anyFlagSet(flags)) {
    for (const [k, set] of Object.entries(flags)) if (set) reasons.push(`flag:${k}`);
  }
  if (hasUnsafeReasonCode(reasonCodes)) reasons.push("unsafe_reason_code");

  const cloudEligible = reasons.length === 0;

  const meta: ValidatedReceiptMeta = {
    schemaName: input.schemaName,
    schemaVersion: input.schemaVersion,
    createdAt: input.createdAt ?? null,
    redacted: input.redacted,
    flags,
    cloudEligible,
    syncPolicy: SYNC_POLICY_NAME,
    evidenceConfidence: input.evidenceConfidence ?? "unavailable",
  };

  return { meta, cloudEligible, reasons };
}
