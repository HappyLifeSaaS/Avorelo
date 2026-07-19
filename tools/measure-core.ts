#!/usr/bin/env node
// Avorelo core latency measurement. Runs each core operation N times, reports p50/max.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runSlice1 } from "../src/avorelo/kernel/run.ts";
import { createWorkContract } from "../src/avorelo/kernel/work-contract/index.ts";
import { writeReceipt, persistReceipt, listReceipts } from "../src/avorelo/kernel/receipts/index.ts";
import { StateLedger } from "../src/avorelo/kernel/state-ledger/index.ts";
import { buildLocalDashboard } from "../src/avorelo/capabilities/local-dashboard/index.ts";
import { evaluateProof } from "../src/avorelo/capabilities/production-confidence/index.ts";
import { evaluateContextBudget } from "../src/avorelo/capabilities/context-budget/index.ts";
import { buildExposurePlan } from "../src/avorelo/capabilities/tool-governance/index.ts";
import { scoreInventory } from "../src/avorelo/capabilities/migration-scorecard/index.ts";
import { buildSite } from "../src/avorelo/surfaces/public-web/index.ts";
import type { EvidenceArtifact } from "../src/avorelo/shared/schemas/index.ts";

const N = 10;

function bench(name: string, fn: () => void): { name: string; p50: number; max: number; samples: number } {
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return { name, p50: times[Math.floor(N / 2)], max: times[N - 1], samples: N };
}

const dir = mkdtempSync(join(tmpdir(), "avorelo-measure-"));
mkdirSync(join(dir, "src"), { recursive: true });
writeFileSync(join(dir, "src", "out.txt"), "expected\n");

const contract = createWorkContract({ contractId: "bench", objective: "benchmark", allowedPaths: [join(dir, "src")], planTier: "Free" });
const realArtifacts: EvidenceArtifact[] = [{ artifactId: "a", kind: "persisted_state_change", ref: "ev:r" }, { artifactId: "b", kind: "aftermath_correct", ref: "ev:ok" }];

const results = [
  bench("kernel_gate", () => runSlice1({ contract, artifacts: realArtifacts, receiptId: `rcpt_b_${Math.random()}` })),
  bench("receipt_write", () => {
    const r = runSlice1({ contract, artifacts: realArtifacts, receiptId: `rcpt_bw_${Math.random()}` });
    persistReceipt(dir, r.receipt);
  }),
  bench("receipt_read", () => listReceipts(dir)),
  bench("dashboard_build", () => buildLocalDashboard(dir, { now: Date.now() })),
  bench("proof_evaluation", () => evaluateProof({
    contract, dir, readbacks: [{ kind: "file_equals", path: "src/out.txt", expected: "expected" }],
    artifacts: [{ artifactId: "p", kind: "aftermath_correct", ref: "ev:ok" } as EvidenceArtifact],
    environment: { worktreeDirty: false }, persist: false,
  })),
  bench("context_budget", () => evaluateContextBudget({
    drivers: [
      { driverId: "f", driverType: "selected_files", label: "f", contextCostCategory: "low", usefulness: "used", measurementConfidence: "measured", reasonCodes: [], deferredNextRun: false, savedOrAvoided: null, evidenceRef: null },
    ],
  })),
  bench("tool_governance", () => buildExposurePlan({
    contract,
    tools: [{ toolId: "r", toolName: "R", contextCost: "low", riskLevel: "low", toolType: "read", defaultExposure: "always", requiresApprovalFor: [], reasonCodes: [] }],
    workflowStage: "edit",
  })),
  bench("migration_scorecard", () => scoreInventory({
    candidates: [{ candidateId: "x", capability: "x", oldPath: "x", description: "x", productValue: "user_value", architectureLayer: "capability", evidence: [], riskFlags: [], duplicationRisk: false, migrationMode: "REBUILD_NOW", canonicalOwner: "x", requiredProof: ["test"], slice: "1", userFacingImpact: "x" }],
  })),
  bench("site_build", () => buildSite(join(dir, "site_bench"))),
];

if (existsSync(dir) && dir.includes("avorelo-measure-")) rmSync(dir, { recursive: true, force: true });

process.stdout.write("AVORELO CORE LATENCY MEASUREMENT\n");
process.stdout.write("Environment: Node " + process.version + ", " + process.platform + "\n\n");
process.stdout.write("Operation               p50 (ms)   max (ms)   samples   confidence\n");
process.stdout.write("─".repeat(72) + "\n");
for (const r of results) {
  process.stdout.write(`${r.name.padEnd(24)} ${r.p50.toFixed(3).padStart(8)}   ${r.max.toFixed(3).padStart(8)}   ${String(r.samples).padStart(7)}   measured\n`);
}
process.stdout.write("\nAll measurements are real wall-clock times (measured, not estimated).\n");
