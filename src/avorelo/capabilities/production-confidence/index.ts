// Avorelo Production-Confidence capability (Slice 4). Turns a real LOCAL workflow into reviewable,
// evidence-backed proof and PREVENTS fake completion. It ASSEMBLES evidence (source-of-truth read-back +
// environment integrity) and CALLS the Kernel — it owns NO decision: the stop-continue gate decides READY,
// kernel/receipts writes the receipt, kernel/evidence grades. Deterministic, local-only, no network.

import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gradeAll } from "../../kernel/evidence/index.ts";
import { decide } from "../../kernel/stop-continue-gate/index.ts";
import { StateLedger } from "../../kernel/state-ledger/index.ts";
import { writeReceipt, persistReceipt } from "../../kernel/receipts/index.ts";
import { detectSecretClasses } from "../../shared/redaction/index.ts";
import type { EvidenceArtifact, GradedEvidence, Receipt, WorkContract, DecisionBasis } from "../../shared/schemas/index.ts";

// --- Source-of-truth read-back (the strongest evidence: read ACTUAL persisted state, not a UI signal) ---

export type ReadbackCheck =
  | { kind: "file_equals"; path: string; expected: string; artifactId?: string }
  | { kind: "file_contains"; path: string; expected: string; artifactId?: string }
  | { kind: "file_absent"; path: string; artifactId?: string };

export type ReadbackResult = { artifact: EvidenceArtifact | null; passed: boolean; reasonCode: string; check: ReadbackCheck };

/**
 * Perform ONE source-of-truth read-back against the real filesystem. A match yields a
 * `source_of_truth_readback` artifact (OUTCOME). A mismatch/missing yields NO artifact (the fake is caught).
 * Never reads secret-bearing content into the artifact — only a boolean match + a ref (no raw content).
 */
export function readBack(dir: string, check: ReadbackCheck): ReadbackResult {
  const id = check.artifactId ?? `sot_${check.kind}`;
  const resolve = (p: string) => (p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : `${dir}/${p}`);
  try {
    if (check.kind === "file_absent") {
      const passed = !existsSync(resolve(check.path));
      return { artifact: passed ? { artifactId: id, kind: "source_of_truth_readback", ref: `sot:absent:${check.path}` } : null, passed, reasonCode: passed ? "READBACK_ABSENT_OK" : "READBACK_UNEXPECTEDLY_PRESENT", check };
    }
    const p = resolve(check.path);
    if (!existsSync(p)) return { artifact: null, passed: false, reasonCode: "READBACK_FILE_MISSING", check };
    const actual = readFileSync(p, "utf8");
    const passed = check.kind === "file_equals" ? actual.trim() === check.expected.trim() : actual.includes(check.expected);
    // ref carries NO raw content — just the path + match kind (content is never persisted).
    return { artifact: passed ? { artifactId: id, kind: "source_of_truth_readback", ref: `sot:${check.kind}:${check.path}` } : null, passed, reasonCode: passed ? "READBACK_MATCH" : "READBACK_MISMATCH", check };
  } catch (e) {
    return { artifact: null, passed: false, reasonCode: `READBACK_ERROR:${(e as Error).message.slice(0, 40)}`, check };
  }
}

// --- Environment integrity (a contaminated environment can fake success) ---

export type EnvironmentSignals = { worktreeDirty?: boolean; staleProcess?: boolean };
export type EnvironmentIntegrity = { compromised: boolean; reasonCodes: string[] };

/** Is the git worktree dirty? Real signal via `git status --porcelain`. Returns false if not a git repo. */
export function worktreeDirty(dir: string): boolean {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().length > 0;
  } catch {
    return false; // not a git repo / git unavailable -> cannot prove dirty; treat as not-a-signal (do not block)
  }
}

/**
 * Combine environment signals. `signals` may be injected (deterministic tests); otherwise the real worktree
 * is probed. Stale-process detection is a later slice (MINE_LATER); accepted as an injected signal here.
 */
export function checkEnvironmentIntegrity(dir: string, signals?: EnvironmentSignals): EnvironmentIntegrity {
  const reasonCodes: string[] = [];
  const dirty = signals?.worktreeDirty ?? worktreeDirty(dir);
  if (dirty) reasonCodes.push("WORKTREE_DIRTY");
  if (signals?.staleProcess) reasonCodes.push("STALE_PROCESS");
  return { compromised: reasonCodes.length > 0, reasonCodes };
}

// --- The real-workflow proof evaluator (assembles + calls the kernel; owns no decision) ---

export type EvaluateProofInput = {
  contract: WorkContract;
  artifacts?: EvidenceArtifact[]; // declared signals (http_status_ok/test_passed/screenshot/user_confirmed/...)
  readbacks?: ReadbackCheck[]; // source-of-truth read-backs performed against the real filesystem
  dir: string; // working dir for read-backs + worktree integrity
  environment?: EnvironmentSignals; // injected environment signals (else probed)
  sampleSize?: number;
  stopConditionMet?: boolean;
  receiptId?: string;
  ledger?: StateLedger;
  persist?: boolean; // write the proof receipt to <dir>/.avorelo/receipts (default true)
};

export type EvaluateProofResult = {
  decision: Receipt["decision"];
  confidence: string;
  reasonCodes: string[];
  graded: GradedEvidence[];
  environment: EnvironmentIntegrity;
  readbacks: ReadbackResult[];
  receipt: Receipt;
};

export function evaluateProof(input: EvaluateProofInput): EvaluateProofResult {
  const declared = input.artifacts ?? [];
  const readbacks = (input.readbacks ?? []).map((c) => readBack(input.dir, c));
  const readbackArtifacts = readbacks.map((r) => r.artifact).filter((a): a is EvidenceArtifact => a !== null);
  const allArtifacts = [...declared, ...readbackArtifacts];

  // Scan declared artifact refs for accidental secrets (classes only; never persisted raw).
  const secretClasses = detectSecretClasses(allArtifacts);

  const graded = gradeAll(allArtifacts);
  const env = checkEnvironmentIntegrity(input.dir, input.environment);

  const gate = decide({
    contract: input.contract,
    graded,
    policyVerdict: "allow", // policy block is a separate signal; Slice 4 proof assumes content already policy-clean
    sampleSize: input.sampleSize,
    stopConditionMet: input.stopConditionMet,
    environmentCompromised: env.compromised,
    environmentReasonCodes: env.reasonCodes,
  });

  const decisionBasis: DecisionBasis = {
    method: "deterministic",
    confidence: gate.confidence,
    evidenceRefs: graded.filter((g) => g.level !== null).map((g) => g.ref),
    reasonCodes: gate.reasonCodes,
    fallbackUsed: false,
  };

  const ledger = input.ledger ?? new StateLedger();
  const receipt = writeReceipt(ledger, {
    contractId: input.contract.contractId,
    decision: gate.decision,
    graded,
    safeNextActions: gate.safeNextActions,
    decisionBasis,
    sampleSize: input.sampleSize ?? 1,
    redactionClasses: secretClasses,
    receiptId: input.receiptId,
  });

  if (input.persist !== false) persistReceipt(input.dir, receipt);

  return { decision: receipt.decision, confidence: gate.confidence, reasonCodes: gate.reasonCodes, graded, environment: env, readbacks, receipt };
}

// --- proof-input.json loader for the CLI (declared artifacts + read-back checks; never carries raw content) ---

export type ProofInputFile = {
  objective?: string;
  artifacts?: EvidenceArtifact[];
  readbacks?: ReadbackCheck[];
  sampleSize?: number;
};

export function loadProofInput(dir: string): ProofInputFile | null {
  const p = `${dir}/.avorelo/proof-input.json`;
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as ProofInputFile; } catch { return null; }
}

/** True if the path looks like a recently-modified file (used by the CLI to hint freshness, not for grading). */
export function recentlyModified(path: string, withinMs: number, now: number): boolean {
  try { return now - statSync(path).mtimeMs <= withinMs; } catch { return false; }
}
