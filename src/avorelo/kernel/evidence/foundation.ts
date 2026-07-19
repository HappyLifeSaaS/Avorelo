// Avorelo Evidence Foundation (Phase 1). Confidence-labelled evidence entries for the efficiency/value layer.
// THE ONE RULE still holds: this module GRADES/LABELS evidence; it never decides READY (that is the gate).
//
// Foundation rules (from the migration roadmap, Phase 1):
//   - "unavailable" is NOT zero and NOT a pass — it is the explicit absence of evidence.
//   - "estimated"/"inferred" are accepted but MUST stay labelled (never shown as hard numbers).
//   - token/cost savings REQUIRE evidence; they can never be claimed from "unavailable" evidence.
// This module owns no persistence and no decision — it produces normalized, safe evidence entries.

import type {
  EvidenceEntry,
  EvidenceConfidence,
  EvidenceSourceKind,
  EvidenceKind,
} from "../../shared/schemas/index.ts";

/** A confidence that represents the ABSENCE of evidence. Never coerced to 0 or to a pass. */
export const UNAVAILABLE: EvidenceConfidence = "unavailable";

/** Confidences that may back a hard (unlabelled) numeric claim. Estimated/inferred must stay labelled. */
const HARD_CONFIDENCE = new Set<EvidenceConfidence>(["measured", "imported"]);
/** Confidences that are accepted but must always be presented WITH their label. */
const SOFT_CONFIDENCE = new Set<EvidenceConfidence>(["estimated", "inferred"]);

export type MakeEvidenceInput = {
  evidenceId: string;
  source: EvidenceSourceKind;
  kind: EvidenceKind;
  confidence: EvidenceConfidence;
  valueLabel?: string | null;
  evidenceRef?: string | null;
  redactionState?: EvidenceEntry["redactionState"];
  persistLocally?: boolean;
  reasonCodes?: string[];
};

/**
 * Normalize an evidence entry. Enforces the foundation invariants deterministically:
 *  - "unavailable" entries carry NO ref and NO value label (absence stays absence).
 *  - deterministic checks default to redaction "not_required"; everything else defaults to "pending"
 *    (it must pass redaction before it can be persisted/synced).
 *  - sync eligibility is left "not_evaluated" here — the cloud-sync eligibility policy decides it.
 */
export function makeEvidence(input: MakeEvidenceInput): EvidenceEntry {
  const isUnavailable = input.confidence === UNAVAILABLE;
  const reasonCodes = [...(input.reasonCodes ?? [])];

  if (isUnavailable && (input.evidenceRef || input.valueLabel)) {
    // Defensive: an "unavailable" entry must not smuggle a value/ref. Drop them, record why.
    reasonCodes.push("unavailable_evidence_has_no_value");
  }

  const redactionState =
    input.redactionState ?? (input.source === "deterministic_check" ? "not_required" : "pending");

  return {
    evidenceId: input.evidenceId,
    source: input.source,
    kind: input.kind,
    confidence: input.confidence,
    redactionState,
    syncEligibility: "not_evaluated",
    persistLocally: input.persistLocally ?? !isUnavailable,
    valueLabel: isUnavailable ? null : input.valueLabel ?? null,
    evidenceRef: isUnavailable ? null : input.evidenceRef ?? null,
    reasonCodes,
  };
}

/** Construct an explicit "no evidence" entry. Absence is represented, never faked as 0/pass. */
export function unavailableEvidence(kind: EvidenceKind, reason: string): EvidenceEntry {
  return makeEvidence({
    evidenceId: `ev_unavailable_${kind}`,
    source: "unknown",
    kind,
    confidence: UNAVAILABLE,
    reasonCodes: [reason || "evidence_unavailable"],
  });
}

/** True when the entry actually carries evidence (i.e. confidence is not "unavailable"). */
export function isAvailable(e: EvidenceEntry): boolean {
  return e.confidence !== UNAVAILABLE;
}

/**
 * Render a numeric measurement safely. An "unavailable" evidence NEVER becomes 0 — it returns the
 * sentinel "not_available". Callers must not substitute 0 for absence.
 */
export function asNumberOrNotAvailable(e: EvidenceEntry, value: number | null): number | "not_available" {
  if (!isAvailable(e) || value === null) return "not_available";
  return value;
}

export type SavingsClaimDecision = {
  allowed: boolean; // may a savings figure be shown at all?
  mustLabel: boolean; // if allowed, must it be shown WITH its confidence label?
  confidence: EvidenceConfidence;
  reasonCodes: string[];
};

/**
 * Decide whether a token/cost (or time) savings claim may be made from an evidence entry.
 * Rules: savings require evidence — unavailable evidence can NEVER back a savings claim; a claim also
 * requires a safe evidence reference. measured/imported may be shown as a hard figure; estimated/inferred
 * are allowed only WITH their label.
 */
export function canClaimSavings(e: EvidenceEntry): SavingsClaimDecision {
  const reasonCodes: string[] = [];
  if (e.kind !== "token_cost" && e.kind !== "time") {
    reasonCodes.push("not_a_savings_kind");
    return { allowed: false, mustLabel: false, confidence: e.confidence, reasonCodes };
  }
  if (!isAvailable(e)) {
    reasonCodes.push("no_savings_from_unavailable_evidence");
    return { allowed: false, mustLabel: false, confidence: e.confidence, reasonCodes };
  }
  if (!e.evidenceRef) {
    reasonCodes.push("savings_requires_evidence_ref");
    return { allowed: false, mustLabel: false, confidence: e.confidence, reasonCodes };
  }
  if (HARD_CONFIDENCE.has(e.confidence)) {
    return { allowed: true, mustLabel: false, confidence: e.confidence, reasonCodes };
  }
  if (SOFT_CONFIDENCE.has(e.confidence)) {
    reasonCodes.push("savings_must_be_labelled");
    return { allowed: true, mustLabel: true, confidence: e.confidence, reasonCodes };
  }
  reasonCodes.push("unknown_confidence");
  return { allowed: false, mustLabel: false, confidence: e.confidence, reasonCodes };
}
