// Avorelo Loop Control V1 Dogfood. End-to-end validation of the loop control capability.
// Proves: readiness classification, policy building, drift detection, orchestration with
// mock adapter, metadata/receipt persistence, safety stops, and iteration drift.

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { classifyLoopReadiness } from "../capabilities/loop-control/readiness.ts";
import { buildLoopPolicy } from "../capabilities/loop-control/policy-builder.ts";
import { runLoop } from "../capabilities/loop-control/orchestrator.ts";
import { readLoopMetadata } from "../capabilities/loop-control/loop-metadata.ts";
import { detectScopeDrift, detectMethodDrift } from "../kernel/drift-guard/index.ts";
import { detectIterationDrift } from "../capabilities/loop-control/iteration-drift.ts";
import { listReceipts } from "../kernel/receipts/index.ts";
import type { LoopAdapter, IterationOutput } from "../adapters/loop-adapter.ts";

function time<T>(fn: () => T): { result: T; ms: number } {
  const t0 = process.hrtime.bigint();
  const result = fn();
  return { result, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

function makeMockAdapter(behavior: "success" | "error" | "stuck" | "drift-files"): LoopAdapter {
  let iteration = 0;
  return {
    id: `mock-${behavior}`,
    displayName: `Mock (${behavior})`,
    async executeIteration(input): Promise<IterationOutput> {
      iteration++;
      switch (behavior) {
        case "success":
          return { exitCode: 0, filesChanged: [`src/fix_${iteration}.ts`], commandsRun: ["npm test"], durationMs: 50, agentError: null, truncatedLog: null };
        case "error":
          return { exitCode: 1, filesChanged: [], commandsRun: [], durationMs: 10, agentError: "segfault", truncatedLog: null };
        case "stuck":
          return { exitCode: 0, filesChanged: [], commandsRun: [], durationMs: 10, agentError: null, truncatedLog: null };
        case "drift-files":
          return { exitCode: 0, filesChanged: ["secrets/key.pem"], commandsRun: [], durationMs: 10, agentError: null, truncatedLog: null };
      }
    },
    isAvailable() { return true; },
  };
}

async function run() {
  const found: string[] = [];
  const fixed: string[] = [];
  const proved: string[] = [];
  const needsAttention: string[] = [];
  const latency: Record<string, number> = {};
  let failures = 0;

  // --- Scenario 1: Readiness classification covers all risk tiers ---
  const { result: r1, ms: t1 } = time(() => {
    const safe = classifyLoopReadiness({ task: "Fix lint errors in src/utils" });
    const risky = classifyLoopReadiness({ task: "Update auth login flow" });
    const broad = classifyLoopReadiness({ task: "Refactor everything" });
    const destructive = classifyLoopReadiness({ task: "Deploy to production" });
    return { safe, risky, broad, destructive };
  });
  latency["readiness_classification"] = t1;
  if (r1.safe.classification === "safe_with_bounded_loop" && r1.risky.classification === "needs_human_gate" &&
      r1.broad.classification === "not_suitable" && r1.destructive.classification === "blocked") {
    proved.push("readiness: all 4 risk tiers classify correctly");
  } else { needsAttention.push("readiness: classification mismatch"); failures++; }

  // --- Scenario 2: Policy builder respects risk + caps ---
  const { result: r2, ms: t2 } = time(() => {
    const readiness = classifyLoopReadiness({ task: "Fix tests" });
    const p1 = buildLoopPolicy({ readiness });
    const p2 = buildLoopPolicy({ readiness, userMaxIterations: 100 });
    const riskyR = classifyLoopReadiness({ task: "Fix auth login" });
    const p3 = buildLoopPolicy({ readiness: riskyR });
    return { p1, p2, p3 };
  });
  latency["policy_builder"] = t2;
  if (r2.p1.mode === "bounded_loop" && r2.p2.maxIterations <= 10 && r2.p3.mode === "single_run" && r2.p3.maxIterations === 1) {
    proved.push("policy: bounded_loop/single_run modes, iteration cap at 10");
  } else { needsAttention.push("policy: unexpected mode or cap"); failures++; }

  // --- Scenario 3: Kernel drift guard detects scope + method drift ---
  const { result: r3, ms: t3 } = time(() => {
    const scope = detectScopeDrift({ changedFiles: ["secrets/key.pem"], allowedPaths: ["src/*"], disallowedPaths: ["secrets/*"] });
    const method = detectMethodDrift({ commandsRun: ["rm -rf /", "npm publish"], blockedCommands: ["npm publish"] });
    const clean = detectScopeDrift({ changedFiles: ["src/app.ts"], allowedPaths: ["src/*"], disallowedPaths: [] });
    return { scope, method, clean };
  });
  latency["drift_guard"] = t3;
  if (r3.scope.length > 0 && r3.scope[0].severity === "block" && r3.method.length === 2 && r3.clean.length === 0) {
    proved.push("drift-guard: scope block, method block (2 findings), clean pass");
  } else { needsAttention.push("drift-guard: unexpected findings"); failures++; }

  // --- Scenario 4: Iteration drift detects repeated failures ---
  const { result: r4, ms: t4 } = time(() => {
    const iter1 = { iteration: 1, startedAt: "", durationMs: 100, filesChanged: ["a.ts"], checksRun: ["c1"], checkResults: { c1: "failed" as const }, driftDetected: false, gateDecision: "CONTINUE" as const, reasonCodes: [] };
    const iter2 = { iteration: 2, startedAt: "", durationMs: 100, filesChanged: ["a.ts"], checksRun: ["c1"], checkResults: { c1: "failed" as const }, driftDetected: false, gateDecision: "CONTINUE" as const, reasonCodes: [] };
    return detectIterationDrift({ iterations: [iter1, iter2], currentFilesChanged: ["a.ts"], previousFilesChanged: ["a.ts"] });
  });
  latency["iteration_drift"] = t4;
  if (r4.length > 0 && r4.some(d => d.type === "proof_drift")) {
    proved.push("iteration-drift: proof drift detected on repeated failures");
  } else { needsAttention.push("iteration-drift: missing proof drift"); failures++; }

  // --- Scenario 5: Orchestrator runs single_run with mock adapter, produces receipt + metadata ---
  const dir5 = mkdtempSync(join(tmpdir(), "avorelo-dogfood-loop5-"));
  try {
    const readiness = classifyLoopReadiness({ task: "Fix lint" });
    const policy = buildLoopPolicy({ readiness, userMaxIterations: 1 });
    policy.mode = "single_run";
    policy.maxIterations = 1;
    policy.requiredChecks = [];

    const { result: r5, ms: t5 } = time(() => runLoop({
      task: "Fix lint",
      contractId: "wc_dogfood_5",
      policy,
      adapter: makeMockAdapter("success"),
      cwd: dir5,
      allowedPaths: [],
      disallowedPaths: [],
    }));
    latency["orchestrator_single_run"] = t5;
    const orch5 = await r5;
    const meta5 = readLoopMetadata(dir5, orch5.loopId);
    const receipts5 = listReceipts(dir5);
    if (meta5 && receipts5.length > 0 && meta5.safety.containsRawPrompt === false) {
      proved.push("orchestrator: single_run produces receipt + metadata with safety flags");
      found.push(`loop metadata at ${orch5.metadataPath}`);
    } else {
      needsAttention.push(`orchestrator: single_run missing receipt/metadata (meta=${!!meta5} receipts=${receipts5.length} stopReason=${orch5.stopReason} ref=${meta5?.kernelReceiptRef} safety=${JSON.stringify(meta5?.safety)})`);
      failures++;
    }
  } finally { rmSync(dir5, { recursive: true, force: true }); }

  // --- Scenario 6: Orchestrator stops on agent error ---
  const dir6 = mkdtempSync(join(tmpdir(), "avorelo-dogfood-loop6-"));
  try {
    const readiness = classifyLoopReadiness({ task: "Fix lint" });
    const policy = buildLoopPolicy({ readiness });
    policy.requiredChecks = policy.requiredChecks.filter(c => c.type === "scope_check");

    const r6 = await runLoop({
      task: "Fix lint",
      contractId: "wc_dogfood_6",
      policy,
      adapter: makeMockAdapter("error"),
      cwd: dir6,
      allowedPaths: [],
      disallowedPaths: [],
    });
    if (r6.stopReason === "failure_agent_error" && r6.iterationsRun === 1) {
      proved.push("orchestrator: stops on agent error after 1 iteration");
    } else { needsAttention.push("orchestrator: did not stop on agent error"); failures++; }
  } finally { rmSync(dir6, { recursive: true, force: true }); }

  // --- Scenario 7: Orchestrator handles abort signal (Ctrl+C) ---
  const dir7 = mkdtempSync(join(tmpdir(), "avorelo-dogfood-loop7-"));
  try {
    const ac = new AbortController();
    ac.abort();
    const readiness = classifyLoopReadiness({ task: "Fix lint" });
    const policy = buildLoopPolicy({ readiness });
    policy.requiredChecks = [];

    const r7 = await runLoop({
      task: "Fix lint",
      contractId: "wc_dogfood_7",
      policy,
      adapter: makeMockAdapter("success"),
      cwd: dir7,
      allowedPaths: [],
      disallowedPaths: [],
      abortSignal: ac.signal,
    });
    if (r7.stopReason === "user_stopped" && r7.iterationsRun === 0) {
      proved.push("orchestrator: abort signal stops loop before first iteration");
    } else { needsAttention.push("orchestrator: abort signal did not stop cleanly"); failures++; }
  } finally { rmSync(dir7, { recursive: true, force: true }); }

  // --- Summary ---
  const lines = [
    "",
    "Avorelo Loop Control V1 Dogfood",
    "",
    `  Found:            ${found.length}`,
    ...found.map(f => `    ${f}`),
    `  Fixed:            ${fixed.length}`,
    ...fixed.map(f => `    ${f}`),
    `  Proved:           ${proved.length}`,
    ...proved.map(p => `    ${p}`),
    `  Needs attention:  ${needsAttention.length}`,
    ...needsAttention.map(n => `    ${n}`),
    "",
    "  Latency:",
    ...Object.entries(latency).map(([k, v]) => `    ${k}: ${v.toFixed(1)}ms`),
    "",
    failures > 0 ? `  RESULT: ${failures} scenario(s) need attention.` : "  RESULT: All scenarios passed.",
    "",
  ];

  process.stdout.write(lines.join("\n"));
  return failures > 0 ? 1 : 0;
}

run().then((code) => process.exit(code), (e) => { process.stderr.write(`DOGFOOD_CRASH: ${(e as Error).message}\n`); process.exit(1); });
