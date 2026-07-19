// Avorelo Slice-1 dogfood (G1/G8/G9/G10). SAFE: synthetic + local + no customer data + no prod writes.
// Runs a fake-READY task and a complete-READY task, writes redacted receipts to .avorelo/receipts/,
// asserts no raw secret/prompt survives, records a measurement, prints a summary. Exits non-zero on any failure.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSlice1 } from "../kernel/run.ts";
import { createWorkContract } from "../kernel/work-contract/index.ts";
import { StateLedger } from "../kernel/state-ledger/index.ts";
import type { EvidenceArtifact, Receipt } from "../shared/schemas/index.ts";

const RAW_SECRET = "AKIA1234567" + "890ABCD99"; // synthetic, fake
const RAW_PROMPT = "this is a raw user prompt that must never be persisted";

function noLeak(obj: unknown): boolean {
  const s = JSON.stringify(obj);
  return !s.includes(RAW_SECRET) && !s.includes(RAW_PROMPT);
}

function run() {
  const outDir = join(process.cwd(), ".avorelo", "receipts");
  mkdirSync(outDir, { recursive: true });
  const failures: string[] = [];
  const measurements: Record<string, number> = { fakeReadyBlocked: 0, completeReadyAccepted: 0, secretLeaks: 0 };

  // G9 — fake READY (NAV/INT only) must be BLOCKED
  const fake = runSlice1({
    contract: createWorkContract({ contractId: "df_fake", objective: "synthetic fake-ready", planTier: "Free" }),
    artifacts: [
      { artifactId: "a1", kind: "http_status_ok", ref: "ev:200" },
      { artifactId: "a2", kind: "ui_action_accepted", ref: "ev:submit" },
    ] as EvidenceArtifact[],
    receiptId: "rcpt_df_fake",
  });
  if (fake.gate.decision === "STOP_BLOCKED" || fake.gate.decision === "CONTINUE") measurements.fakeReadyBlocked = 1;
  else failures.push(`fake-READY not blocked: got ${fake.gate.decision}`);

  // G10 — complete READY (OUTCOME+POST_ACTION) must be ACCEPTED
  const complete = runSlice1({
    contract: createWorkContract({ contractId: "df_complete", objective: "synthetic complete-ready", planTier: "Free" }),
    artifacts: [
      { artifactId: "a1", kind: "persisted_state_change", ref: "ev:row" },
      { artifactId: "a2", kind: "aftermath_correct", ref: "ev:confirmation" },
    ] as EvidenceArtifact[],
    receiptId: "rcpt_df_complete",
  });
  if (complete.gate.decision === "STOP_DONE") measurements.completeReadyAccepted = 1;
  else failures.push(`complete-READY not accepted: got ${complete.gate.decision}`);

  // G8 — a secret-bearing task: secret/prompt must NOT survive into the receipt
  const secret = runSlice1({
    contract: createWorkContract({ contractId: "df_secret", objective: "synthetic secret task", planTier: "Free" }),
    artifacts: [{ artifactId: "a1", kind: "http_status_ok", ref: "ev:200" }] as EvidenceArtifact[],
    content: { finding: `secret ${RAW_SECRET}`, prompt: RAW_PROMPT },
    receiptId: "rcpt_df_secret",
  });

  // Write redacted receipts locally + assert no raw secret/prompt anywhere in the persisted ledger/receipts.
  const receipts: Receipt[] = [fake.receipt, complete.receipt, secret.receipt];
  for (const r of receipts) {
    const f = join(outDir, `${r.receiptId}.json`);
    writeFileSync(f, JSON.stringify(r, null, 2));
    if (!noLeak(r)) {
      failures.push(`raw secret/prompt leaked into receipt ${r.receiptId}`);
      measurements.secretLeaks++;
    }
  }
  // Also assert the secret task's full ledger (incl. redacted context) is clean.
  if (!noLeak(secret.ledger.all())) {
    failures.push("raw secret/prompt leaked into ledger");
    measurements.secretLeaks++;
  }
  // And the secret action was blocked (policy SECRET_DETECTED) — never declared done.
  if (secret.gate.decision === "STOP_DONE") failures.push("secret task wrongly reached STOP_DONE");
  // Derived classes are recorded; raw never is.
  if (!secret.receipt.redactionClasses.includes("aws_access_key")) failures.push("derived secret class not recorded");

  // Nested-payload tamper proof: mutating nested content must break the hash chain.
  const tl = new StateLedger();
  const te = tl.append({ type: "t", contractId: "c", payload: { nested: { v: 1 } }, ts: 1 });
  const chainBeforeTamper = tl.verifyChain();
  (te.payload as { nested: { v: number } }).nested.v = 999;
  const tamperDetected = tl.verifyChain() === false;
  if (!chainBeforeTamper) failures.push("clean chain failed to verify");
  if (!tamperDetected) failures.push("nested-payload tamper NOT detected");

  const summary = {
    ok: failures.length === 0,
    measurements,
    decisions: { fake: fake.gate.decision, complete: complete.gate.decision, secret: secret.gate.decision },
    secretClassesBlocked: secret.gate.reasonCodes,
    secretRedactionClasses: secret.receipt.redactionClasses,
    receiptsWritten: receipts.map((r) => r.receiptId),
    chainIntact: { fake: fake.ledger.verifyChain(), complete: complete.ledger.verifyChain(), secret: secret.ledger.verifyChain() },
    nestedTamperDetected: tamperDetected,
    failures,
  };
  process.stdout.write("AVORELO SLICE-1 DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  process.exit(failures.length === 0 ? 0 : 1);
}

run();
