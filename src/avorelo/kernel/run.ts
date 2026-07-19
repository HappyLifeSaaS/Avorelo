// Avorelo Slice-1 pipeline (Tier-D only; no LLM). Wires the Kernel singletons for synthetic evidence:
// Work Contract -> Policy -> Evidence Router -> Stop/Continue Gate -> Receipt (redacted) -> Ledger event.

import { StateLedger } from "./state-ledger/index.ts";
import { evaluatePolicy } from "./policy/index.ts";
import { gradeAll } from "./evidence/index.ts";
import { decide } from "./stop-continue-gate/index.ts";
import { writeReceipt } from "./receipts/index.ts";
import type { GateResult } from "./stop-continue-gate/index.ts";
import type { EvidenceArtifact, Receipt, WorkContract, ReviewerVerdict, DecisionBasis } from "../shared/schemas/index.ts";

export type RunInput = {
  contract: WorkContract;
  artifacts: EvidenceArtifact[];
  content?: unknown; // candidate content scanned by policy (synthetic; may contain a secret in tests)
  touchedPaths?: string[];
  reviewerVerdicts?: ReviewerVerdict[];
  stopConditionMet?: boolean;
  sampleSize?: number;
  ledger?: StateLedger;
  receiptId?: string;
};

export type RunResult = { gate: GateResult; receipt: Receipt; ledger: StateLedger };

export function runSlice1(input: RunInput): RunResult {
  const ledger = input.ledger ?? new StateLedger();

  const policy = evaluatePolicy({
    contract: input.contract,
    content: input.content,
    touchedPaths: input.touchedPaths,
  });

  const graded = gradeAll(input.artifacts);

  const gate = decide({
    contract: input.contract,
    graded,
    policyVerdict: policy.verdict,
    policyReasonCodes: policy.reasonCodes,
    reviewerVerdicts: input.reviewerVerdicts,
    stopConditionMet: input.stopConditionMet,
    sampleSize: input.sampleSize,
  });

  // Slice 1 is entirely deterministic — decisionBasis records method=deterministic (no model assist, per 129 §9).
  const decisionBasis: DecisionBasis = {
    method: "deterministic",
    confidence: gate.confidence,
    evidenceRefs: graded.filter((g) => g.level !== null).map((g) => g.ref),
    reasonCodes: gate.reasonCodes,
    fallbackUsed: false,
  };

  const receipt = writeReceipt(ledger, {
    contractId: input.contract.contractId,
    decision: gate.decision,
    graded,
    safeNextActions: gate.safeNextActions,
    decisionBasis,
    sampleSize: input.sampleSize ?? 1,
    // Persist ONLY derived secret/redaction CLASSES from the upstream policy scan — never the raw candidate content.
    redactionClasses: policy.secretClasses,
    receiptId: input.receiptId,
  });

  return { gate, receipt, ledger };
}
