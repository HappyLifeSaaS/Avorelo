// Avorelo SafeReference Foundation (Phase 1). A reference to sensitive content that can NEVER carry the
// raw value. This is the foundation the Deterministic Secret Boundary (Phase 2) builds on — not the
// detector itself. Invariants enforced structurally + at construction:
//   - no rawValue field ever exists on a SafeReference.
//   - valueExposedToModel is always false.
//   - rawValuePersisted is always false.

import type {
  SafeReference,
  SafeReferenceSourceKind,
  SafeReferenceRiskClass,
} from "../schemas/index.ts";

export type MakeSafeReferenceInput = {
  id: string;
  sourceKind: SafeReferenceSourceKind;
  label: string;
  riskClass: SafeReferenceRiskClass;
  safeReasonCodes?: string[];
  // NOTE: callers may accidentally pass a raw value under various keys. We NEVER read them — and if any
  // value-bearing key is present we record that it was stripped, so the leak attempt is observable.
  [extra: string]: unknown;
};

// Keys that would carry a raw value — these are explicitly stripped and never copied onto the reference.
const VALUE_BEARING_KEYS = ["rawvalue", "raw_value", "value", "secret", "token", "credential", "plaintext"];

/**
 * Construct a SafeReference. Only the allowlisted fields are copied; any value-bearing field on the input
 * is dropped (never read into the result) and recorded via a "raw_value_stripped" reason code. The
 * false-flags are hard-coded, so a SafeReference cannot be constructed in an unsafe state.
 */
export function makeSafeReference(input: MakeSafeReferenceInput): SafeReference {
  const reasonCodes = [...(input.safeReasonCodes ?? [])];
  const attemptedRawValue = Object.keys(input).some((k) =>
    VALUE_BEARING_KEYS.includes(k.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  if (attemptedRawValue && !reasonCodes.includes("raw_value_stripped")) {
    reasonCodes.push("raw_value_stripped");
  }
  return {
    kind: "safe_reference",
    id: input.id,
    sourceKind: input.sourceKind,
    label: input.label,
    riskClass: input.riskClass,
    valueExposedToModel: false,
    rawValuePersisted: false,
    safeReasonCodes: reasonCodes,
  };
}

/** Type guard: is this value a well-formed SafeReference with its safety flags intact? */
export function isSafeReference(v: unknown): v is SafeReference {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "safe_reference" &&
    typeof r.id === "string" &&
    typeof r.label === "string" &&
    r.valueExposedToModel === false &&
    r.rawValuePersisted === false
  );
}

/**
 * Verify a SafeReference's serialized form contains no value-bearing/secret-like field. Returns true when
 * the reference is clean. Used by tests and by the redaction policy.
 */
export function safeReferenceHasNoRawValue(ref: SafeReference): boolean {
  const json = JSON.stringify(ref);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  for (const k of Object.keys(parsed)) {
    if (VALUE_BEARING_KEYS.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ""))) return false;
  }
  return ref.valueExposedToModel === false && ref.rawValuePersisted === false;
}
