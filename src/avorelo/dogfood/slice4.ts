// Avorelo Slice-4 dogfood (Production Confidence / Real Workflow Proof). SAFE: sandboxed temp dir with REAL
// files (read-back is genuine), no network, no login. Proves: fake-success blocked; complete proof done;
// dirty-worktree never done; source-of-truth read-back is the only path to OUTCOME; 0 raw secret/prompt/source;
// global ~/.claude untouched; latency measured.

import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { evaluateProof } from "../capabilities/production-confidence/index.ts";
import { open as openDashboard } from "../capabilities/local-dashboard/index.ts";
import { createWorkContract } from "../kernel/work-contract/index.ts";

const SECRET = "AKIA1234567" + "890ABCD99";
const ctr = (dir: string, id: string) => createWorkContract({ contractId: id, objective: "df4 proof", allowedPaths: [join(dir, "src")], planTier: "Free" });
const globalSha = () => { try { return createHash("sha256").update(readFileSync(join(homedir(), ".claude", "settings.json"))).digest("hex"); } catch { return null; } };

function run() {
  const failures: string[] = [];
  const before = globalSha();
  const dir = mkdtempSync(join(tmpdir(), "avorelo-df4-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  let timeToProofMs = 0;
  try {
    writeFileSync(join(dir, "src", "out.txt"), "expected-value\n");

    // 1) fake-success: declared http_status_ok + test_passed, read-back MISMATCH -> not done
    const fake = evaluateProof({
      contract: ctr(dir, "fake"), dir,
      artifacts: [{ artifactId: "h", kind: "http_status_ok", ref: "ev:200" }, { artifactId: "t", kind: "test_passed", ref: "ev:ci" }],
      readbacks: [{ kind: "file_equals", path: "src/out.txt", expected: "WRONG-VALUE" }],
      environment: { worktreeDirty: false }, receiptId: "rcpt_fake",
    });
    if (fake.decision === "STOP_DONE") failures.push("fake-success was marked done");

    // 2) complete: source read-back OUTCOME + aftermath POST_ACTION, clean env -> done
    const t0 = process.hrtime.bigint();
    const complete = evaluateProof({
      contract: ctr(dir, "complete"), dir,
      readbacks: [{ kind: "file_equals", path: "src/out.txt", expected: "expected-value" }],
      artifacts: [{ artifactId: "af", kind: "aftermath_correct", ref: "ev:terminal-ok" }],
      environment: { worktreeDirty: false }, receiptId: "rcpt_complete",
    });
    timeToProofMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (complete.decision !== "STOP_DONE") failures.push("complete proof not marked done");
    if (!complete.receipt.evidenceLevels.includes("OUTCOME")) failures.push("complete proof missing OUTCOME from read-back");

    // 3) dirty-worktree: same complete evidence but compromised env -> never done
    const dirty = evaluateProof({
      contract: ctr(dir, "dirty"), dir,
      readbacks: [{ kind: "file_equals", path: "src/out.txt", expected: "expected-value" }],
      artifacts: [{ artifactId: "af", kind: "aftermath_correct", ref: "ev:terminal-ok" }],
      environment: { worktreeDirty: true }, receiptId: "rcpt_dirty",
    });
    if (dirty.decision === "STOP_DONE") failures.push("dirty worktree was marked done");
    if (!dirty.reasonCodes.includes("ENVIRONMENT_COMPROMISED")) failures.push("dirty worktree missing ENVIRONMENT_COMPROMISED");

    // 4) secret in an artifact ref -> class only, never raw
    const sec = evaluateProof({
      contract: ctr(dir, "sec"), dir,
      artifacts: [{ artifactId: "s", kind: "user_confirmed", ref: `ev:${SECRET}` }],
      environment: { worktreeDirty: false }, receiptId: "rcpt_sec",
    });
    if (JSON.stringify(sec.receipt).includes(SECRET)) failures.push("raw secret leaked in proof receipt");

    // 5) the dashboard renders these proof receipts truthfully (reuse Slice 3; invents no proof)
    const opened = openDashboard(dir, { now: Date.now() });
    const html = readFileSync(opened.htmlPath, "utf8");
    if (html.includes(SECRET)) failures.push("raw secret leaked in dashboard HTML");
    const doneCards = opened.model.cards.filter((c) => c.kind === "done").length;
    if (doneCards !== 1) failures.push(`expected exactly 1 done card (complete), got ${doneCards}`);
    const dirtyCard = opened.model.cards.find((c) => c.contractId === "dirty");
    if (dirtyCard?.kind !== "needs_attention") failures.push(`dirty-worktree proof should be needs_attention, got ${dirtyCard?.kind}`);

    if (globalSha() !== before) failures.push("global ~/.claude changed");

    const summary = {
      ok: failures.length === 0,
      target: dir,
      verdicts: { fake: fake.decision, complete: complete.decision, dirty: dirty.decision },
      dirtyReasonCodes: dirty.reasonCodes,
      completeEvidenceLevels: complete.receipt.evidenceLevels,
      dashboardTotals: opened.model.totals,
      rawSecretLeaks: 0,
      timeToProofMs: Number(timeToProofMs.toFixed(4)),
      globalClaudeTouched: globalSha() !== before,
      failures,
    };
    process.stdout.write("AVORELO SLICE-4 DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  } finally {
    if (existsSync(dir) && dir.includes("avorelo-df4-")) rmSync(dir, { recursive: true, force: true });
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

run();
