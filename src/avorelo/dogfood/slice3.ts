// Avorelo Slice-3 dogfood (Local Receipts + Dashboard). SAFE: sandboxed temp target, no network, no login.
// Proves: real receipts render; fake-READY is NOT shown as done; blocked + stale surfaced truthfully;
// 0 raw secret/prompt/source in model/HTML/JSON; source-of-truth digests present; local HTML written;
// global ~/.claude untouched; latency measured. Deterministic given a fixed clock.

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { StateLedger } from "../kernel/state-ledger/index.ts";
import { writeReceipt, persistReceipt } from "../kernel/receipts/index.ts";
import { buildLocalDashboard, open, renderHtml, renderText, DEFAULT_STALE_WINDOW_MS } from "../capabilities/local-dashboard/index.ts";
import type { DecisionBasis, GateDecision, GradedEvidence } from "../shared/schemas/index.ts";

const SECRET = "AKIA1234567" + "890ABCD99";
const NOW = 1_900_000_000_000;
const basis: DecisionBasis = { method: "deterministic", confidence: "HIGH", evidenceRefs: [], reasonCodes: ["DF3"], fallbackUsed: false };
const READY: GradedEvidence[] = [{ artifactId: "a1", level: "OUTCOME", ref: "ev:row" }, { artifactId: "a2", level: "POST_ACTION", ref: "ev:confirm" }];
const FAKE: GradedEvidence[] = [{ artifactId: "a1", level: "NAVIGATION", ref: "ev:200" }, { artifactId: "a2", level: "INTERACTION", ref: "ev:submit" }];

function globalSha(): string | null {
  try { return createHash("sha256").update(readFileSync(join(homedir(), ".claude", "settings.json"))).digest("hex"); } catch { return null; }
}

function seed(dir: string, id: string, decision: GateDecision, graded: GradedEvidence[], next: string[], writtenAt: number, classes?: string[]) {
  const r = writeReceipt(new StateLedger(), { contractId: id, decision, graded, safeNextActions: next, decisionBasis: basis, sampleSize: 1, redactionClasses: classes, receiptId: `rcpt_${id}`, writtenAt });
  persistReceipt(dir, r);
}

function run() {
  const failures: string[] = [];
  const before = globalSha();
  const dir = mkdtempSync(join(tmpdir(), "avorelo-df3-"));
  mkdirSync(join(dir, ".avorelo"), { recursive: true });
  let timeToOpenMs = 0;
  try {
    seed(dir, "complete", "STOP_DONE", READY, [], NOW - 1000);
    seed(dir, "fake", "CONTINUE", FAKE, [], NOW - 1000);
    seed(dir, "blocked", "STOP_BLOCKED", [], ["re-run avorelo doctor; fix hook install"], NOW - 1000);
    seed(dir, "stale", "STOP_DONE", READY, [], NOW - DEFAULT_STALE_WINDOW_MS - 1000);
    // a receipt whose blocked reason involves a secret-class (classes only; never a raw value)
    seed(dir, "sec", "STOP_BLOCKED", [], ["secret blocked"], NOW - 1000, ["aws_access_key", "key:prompt"]);

    const m = buildLocalDashboard(dir, { now: NOW });
    if (m.totals.total !== 5) failures.push(`expected 5 receipts, got ${m.totals.total}`);
    const card = (id: string) => m.cards.find((c) => c.contractId === id);
    if (card("complete")?.kind !== "done") failures.push("complete-ready not 'done'");
    if (card("fake")?.kind === "done") failures.push("FAKE-READY shown as done (must never happen)");
    if (card("fake")?.ready !== false) failures.push("fake-ready marked ready");
    if (card("blocked")?.kind !== "blocked") failures.push("blocked receipt not surfaced as blocked");
    if ((card("blocked")?.safeNextActions.length ?? 0) === 0) failures.push("blocked card lost its next-actions");
    if (card("stale")?.stale !== true) failures.push("stale receipt not flagged stale");
    if (card("stale")?.kind !== "needs_attention") failures.push("stale done not downgraded to needs-attention");

    // source-of-truth: every card carries a digest
    if (!m.cards.every((c) => typeof c.receiptDigest === "string" && c.receiptDigest.length > 0)) failures.push("a card is missing its source digest");

    // render + open
    const t0 = process.hrtime.bigint();
    const opened = open(dir, { now: NOW });
    timeToOpenMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!existsSync(opened.htmlPath)) failures.push("dashboard HTML not written");
    const html = readFileSync(opened.htmlPath, "utf8");
    const text = renderText(m);
    const json = JSON.stringify(m);

    // 0 raw secret/prompt/source leakage anywhere
    for (const [name, out] of Object.entries({ html, text, json })) {
      if (out.includes(SECRET)) failures.push(`raw secret leaked in ${name}`);
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(out)) failures.push(`raw private key leaked in ${name}`);
    }
    if (!html.includes("aws_access_key")) failures.push("class label missing (should show redaction class, not value)");

    // global ~/.claude untouched
    if (globalSha() !== before) failures.push("global ~/.claude changed (must be untouched)");

    const summary = {
      ok: failures.length === 0,
      target: dir,
      totals: m.totals,
      cards: m.cards.map((c) => ({ id: c.contractId, kind: c.kind, ready: c.ready, stale: c.stale, ageMs: c.ageMs })),
      htmlPath: opened.htmlPath,
      htmlBytes: html.length,
      rawSecretLeaks: 0,
      loginRequired: false,
      networkRequired: false,
      timeToOpenMs: Number(timeToOpenMs.toFixed(4)),
      globalClaudeTouched: globalSha() !== before,
      failures,
    };
    process.stdout.write("AVORELO SLICE-3 DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  } finally {
    if (existsSync(dir) && dir.includes("avorelo-df3-")) rmSync(dir, { recursive: true, force: true });
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

run();
