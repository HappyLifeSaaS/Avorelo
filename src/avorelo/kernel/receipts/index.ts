// Avorelo Receipt Writer (Slice 1, hardened). The ONLY durable-receipt writer.
// Allowlist-only persistence: NO arbitrary candidate content/prompt/source is ever stored — only derived,
// safe fields. Candidate content is scanned upstream (policy) and only derived CLASSES are recorded (S2).

import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../../shared/redaction/index.ts";
import { stableStringify } from "../state-ledger/index.ts";
import type { StateLedger } from "../state-ledger/index.ts";
import type { GradedEvidence, GateDecision, Receipt, DecisionBasis } from "../../shared/schemas/index.ts";
import { levelsPresent } from "../evidence/index.ts";

export type WriteReceiptInput = {
  contractId: string;
  decision: GateDecision;
  graded: GradedEvidence[];
  safeNextActions: string[];
  decisionBasis: DecisionBasis;
  sampleSize: number;
  redactionClasses?: string[]; // DERIVED classes only (from upstream scan); never raw content
  receiptId?: string; // injectable for deterministic tests
  writtenAt?: number; // injectable epoch ms for deterministic tests; defaults to Date.now()
};

/** Stable digest of a receipt's load-bearing fields — integrity visibility without leaking content. */
export function receiptDigest(parts: {
  contractId: string;
  decision: GateDecision;
  evidenceLevels: string[];
  evidenceRefs: string[];
}): string {
  return createHash("sha256").update(stableStringify(parts)).digest("hex").slice(0, 16);
}

export function writeReceipt(ledger: StateLedger, input: WriteReceiptInput): Receipt {
  const evidenceLevels = levelsPresent(input.graded);
  const evidenceRefs = input.graded.filter((g) => g.level !== null).map((g) => g.ref);

  const digest = receiptDigest({ contractId: input.contractId, decision: input.decision, evidenceLevels, evidenceRefs });

  // Build ONLY allowlisted, derived fields. No `context`, no candidate content, no prompt/source ever.
  const receipt: Receipt = {
    receiptId: input.receiptId ?? `rcpt_${randomUUID()}`,
    contractId: input.contractId,
    decision: input.decision,
    evidenceLevels,
    evidenceRefs,
    safeNextActions: input.safeNextActions,
    decisionBasis: input.decisionBasis,
    redactionClasses: Array.from(new Set(input.redactionClasses ?? [])),
    receiptDigest: digest,
    sampleSize: input.sampleSize,
    writtenAt: input.writtenAt ?? Date.now(),
    redaction: "applied",
  };

  // Defense-in-depth: redact the allowlisted receipt itself (catches any accidental secret in a ref/reason).
  const safe = redact(receipt).value;

  // Persist ONLY the receipt (allowlisted). The ledger payload is the receipt — nothing else.
  ledger.append({
    type: "receipt.written",
    contractId: input.contractId,
    payload: safe as unknown as Record<string, unknown>,
    reasonCodes: input.decisionBasis.reasonCodes,
  });

  return safe;
}

// --- Durable local receipt store (Slice 3). The receipts module is the SOLE owner of receipt file IO.
// Surfaces (CLI, dashboard) READ via listReceipts/readReceipt; they never write receipt files themselves.

/** Canonical repo-local receipt directory: <dir>/.avorelo/receipts (never any legacy vendor path). */
export function localReceiptDir(dir: string): string {
  return join(dir, ".avorelo", "receipts");
}

/** Persist a receipt to the local store (redacted defense-in-depth). Returns the file path. */
export function persistReceipt(dir: string, receipt: Receipt): string {
  const rcptDir = localReceiptDir(dir);
  mkdirSync(rcptDir, { recursive: true });
  const safe = redact(receipt).value;
  const path = join(rcptDir, `${safe.receiptId}.json`);
  writeFileSync(path, JSON.stringify(safe, null, 2));
  return path;
}

/** Read all receipts from the local store. Skips unparseable/foreign files (fail-open on a single bad file). */
export function listReceipts(dir: string): Receipt[] {
  const rcptDir = localReceiptDir(dir);
  if (!existsSync(rcptDir)) return [];
  const out: Receipt[] = [];
  for (const f of readdirSync(rcptDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(join(rcptDir, f), "utf8")) as Receipt;
      // Minimal shape guard: must look like a receipt (has receiptId + decision + redaction applied).
      if (r && typeof r.receiptId === "string" && typeof r.decision === "string" && r.redaction === "applied") out.push(r);
    } catch { /* skip a corrupt/foreign file rather than fail the whole view */ }
  }
  return out;
}

export function readReceipt(dir: string, receiptId: string): Receipt | null {
  const path = join(localReceiptDir(dir), `${receiptId}.json`);
  if (!existsSync(path)) return null;
  try {
    const r = JSON.parse(readFileSync(path, "utf8")) as Receipt;
    return r && typeof r.receiptId === "string" ? r : null;
  } catch { return null; }
}
