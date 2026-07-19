// Receipt safety gate (canonical receipt layer). Decides whether a receipt/artifact projection is safe
// to surface beyond raw local capture — i.e. it is explicitly allowlisted, redacted, and carries no raw
// prompt/transcript/source/secret/env value/terminal log/git diff/sensitive path and no unsafe reason code.
// This is a pure local decision: it makes safety STRICTER, never weaker, and performs no network access.
// (Relocated from capabilities/cloud-sync/eligibility.ts; behavior is identical.)

import {
  clearFlags,
  anyFlagSet,
  deriveFlags,
  hasUnsafeReasonCode,
} from "./validation.ts";
import type { ReceiptSafetyFlags } from "../../shared/schemas/index.ts";

export type EligibilityInput = {
  allowlisted: boolean; // the artifact kind is explicitly on the safe-projection allowlist
  redacted: boolean;
  flags?: ReceiptSafetyFlags; // declared safety flags; OR-ed with anything detected in `payload`
  reasonCodes?: string[];
  payload?: unknown; // optional — re-classified defensively if present
};

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[]; // codes explaining the verdict (empty when eligible)
};

/**
 * Decide whether a receipt projection is safe to surface. Eligible only when EVERY safety condition holds.
 * Any unsafe flag, missing redaction, missing allowlist, or unsafe reason code makes the payload ineligible.
 */
export function evaluateReceiptSafety(input: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];

  if (!input.allowlisted) reasons.push("not_allowlisted");
  if (!input.redacted) reasons.push("not_redacted");

  // Combine declared flags with flags detected in the actual payload (defense in depth).
  const flags = input.flags ? { ...input.flags } : clearFlags();
  if (input.payload !== undefined) {
    const derived = deriveFlags(input.payload);
    for (const k of Object.keys(flags) as (keyof ReceiptSafetyFlags)[]) {
      flags[k] = flags[k] || derived[k];
    }
  }
  if (anyFlagSet(flags)) {
    for (const [k, set] of Object.entries(flags)) if (set) reasons.push(`flag:${k}`);
  }

  if (hasUnsafeReasonCode(input.reasonCodes ?? [])) reasons.push("unsafe_reason_code");

  return { eligible: reasons.length === 0, reasons };
}
