// Avorelo Phase 1 Foundation Dogfood. Deterministic, local, redacted. Proves the kernel evidence +
// redaction + receipt-validation + cloud-sync-eligibility + safe-reference foundation holds its invariants.
// Reality gates (each must pass): kernel_evidence_foundation_exists, receipt_validation_blocks_raw_prompt,
// receipt_validation_blocks_raw_secret, redaction_policy_precedes_cloud_sync, safe_reference_never_contains_raw_value,
// unavailable_evidence_does_not_create_savings_claim, cloud_sync_eligibility_is_allowlist_only,
// phase2_secret_boundary_can_depend_on_phase1_foundation.

import { makeEvidence, unavailableEvidence, canClaimSavings, asNumberOrNotAvailable } from "../kernel/evidence/foundation.ts";
import { validateReceiptSafety } from "../kernel/receipts/validation.ts";
import { classifyPayload } from "../shared/redaction/policy.ts";
import { makeSafeReference, safeReferenceHasNoRawValue, isSafeReference } from "../shared/safe-reference/index.ts";
import { evaluateReceiptSafety } from "../kernel/receipts/eligibility.ts";

type Gate = { gate: string; pass: boolean; detail: string };

function run() {
  const gates: Gate[] = [];
  const check = (gate: string, pass: boolean, detail: string) => gates.push({ gate, pass, detail });

  // 1. kernel_evidence_foundation_exists
  {
    const measured = makeEvidence({ evidenceId: "e1", source: "deterministic_check", kind: "token_cost", confidence: "measured", valueLabel: "1200 tokens avoided", evidenceRef: "ev:run1" });
    const na = asNumberOrNotAvailable(unavailableEvidence("token_cost", "no_measurement"), null);
    check("kernel_evidence_foundation_exists", measured.confidence === "measured" && na === "not_available", `measured ok; unavailable→${na}`);
  }

  // 2. receipt_validation_blocks_raw_prompt
  {
    const r = validateReceiptSafety({ schemaName: "test.receipt", schemaVersion: "1", redacted: true, payload: { prompt: "raw user prompt that must never persist" }, reasonCodes: ["STOP_DONE"] });
    check("receipt_validation_blocks_raw_prompt", r.cloudEligible === false && r.meta.flags.containsRawPrompt, `eligible=${r.cloudEligible} reasons=${r.reasons.join(",")}`);
  }

  // 3. receipt_validation_blocks_raw_secret
  {
    const r = validateReceiptSafety({ schemaName: "test.receipt", schemaVersion: "1", redacted: true, payload: { note: "leaked AKIA1234567" + "890ABCD99" }, reasonCodes: ["STOP_DONE"] });
    check("receipt_validation_blocks_raw_secret", r.cloudEligible === false && r.meta.flags.containsRawSecret, `eligible=${r.cloudEligible} reasons=${r.reasons.join(",")}`);
  }

  // 4. redaction_policy_precedes_cloud_sync — an unsafe payload is caught by the policy and is NOT eligible.
  {
    const unsafe = { gitDiff: "diff --git a/x b/x\n+++ b/x" };
    const classified = classifyPayload(unsafe);
    const elig = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: unsafe, reasonCodes: ["STOP_DONE"] });
    check("redaction_policy_precedes_cloud_sync", classified.safe === false && elig.eligible === false, `classified.safe=${classified.safe} eligible=${elig.eligible}`);
  }

  // 5. safe_reference_never_contains_raw_value — even if a rawValue is passed in, it is stripped.
  {
    const ref = makeSafeReference({ id: "sr1", sourceKind: "env", label: "DB password (env)", riskClass: "credential", rawValue: "hunter2" } as never);
    const clean = safeReferenceHasNoRawValue(ref) && ref.valueExposedToModel === false && ref.rawValuePersisted === false && JSON.stringify(ref).indexOf("hunter2") === -1;
    check("safe_reference_never_contains_raw_value", clean && isSafeReference(ref), `clean=${clean} reasons=${ref.safeReasonCodes.join(",")}`);
  }

  // 6. unavailable_evidence_does_not_create_savings_claim
  {
    const na = unavailableEvidence("token_cost", "no_token_meter");
    const decision = canClaimSavings(na);
    check("unavailable_evidence_does_not_create_savings_claim", decision.allowed === false, `allowed=${decision.allowed} reasons=${decision.reasonCodes.join(",")}`);
  }

  // 7. cloud_sync_eligibility_is_allowlist_only — same clean payload is ineligible when NOT allowlisted.
  {
    const clean = { receiptId: "rcpt_x", decision: "STOP_DONE", count: 3, status: "done", reasonCodes: ["STOP_DONE"] };
    const allowed = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: clean, reasonCodes: ["STOP_DONE"] });
    const denied = evaluateReceiptSafety({ allowlisted: false, redacted: true, payload: clean, reasonCodes: ["STOP_DONE"] });
    check("cloud_sync_eligibility_is_allowlist_only", allowed.eligible === true && denied.eligible === false, `allowlisted→${allowed.eligible} not-allowlisted→${denied.eligible}`);
  }

  // 8. phase2_secret_boundary_can_depend_on_phase1_foundation — a SafeReference flows through the policy as SAFE,
  //    proving the boundary can represent a detected secret as a reference without tripping the policy.
  {
    const ref = makeSafeReference({ id: "sr2", sourceKind: "tool_output", label: "API key in tool output", riskClass: "credential" });
    const payload = { receiptId: "rcpt_y", decision: "STOP_BLOCKED", reasonCodes: ["SECRET_DETECTED"], safeRef: ref };
    const classified = classifyPayload(payload);
    const elig = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload, reasonCodes: ["SECRET_DETECTED"] });
    check("phase2_secret_boundary_can_depend_on_phase1_foundation", classified.safe === true && elig.eligible === true, `classified.safe=${classified.safe} eligible=${elig.eligible}`);
  }

  const failures = gates.filter((g) => !g.pass);
  const summary = { ok: failures.length === 0, total: gates.length, passed: gates.length - failures.length, gates, failures: failures.map((f) => f.gate) };
  process.stdout.write("AVORELO PHASE-1 FOUNDATION DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  process.exit(failures.length === 0 ? 0 : 1);
}

run();
