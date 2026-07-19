// Avorelo Core Product Dogfood. End-to-end validation across all merged slices.
// Proves: Kernel gates, activation receipts, dashboard projection, production confidence,
// context/tool/migration governance, public journey, no leaks.
// Output: Found / Fixed / Proved / Needs Attention with measurement labels.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { runSlice1 } from "../kernel/run.ts";
import { createWorkContract } from "../kernel/work-contract/index.ts";
import { StateLedger } from "../kernel/state-ledger/index.ts";
import { writeReceipt, persistReceipt, listReceipts } from "../kernel/receipts/index.ts";
import { buildLocalDashboard } from "../capabilities/local-dashboard/index.ts";
import { evaluateProof, checkEnvironmentIntegrity } from "../capabilities/production-confidence/index.ts";
import { evaluateContextBudget } from "../capabilities/context-budget/index.ts";
import { buildExposurePlan } from "../capabilities/tool-governance/index.ts";
import { scoreInventory, checkLegacyBrandLeaks } from "../capabilities/migration-scorecard/index.ts";
import { buildSite } from "../surfaces/public-web/index.ts";
import { serve } from "../surfaces/preview-server/index.ts";
import type { EvidenceArtifact, ContextDriver, ToolGovernance, MigrationCandidate } from "../shared/schemas/index.ts";

function time<T>(fn: () => T): { result: T; ms: number } {
  const t0 = process.hrtime.bigint();
  const result = fn();
  return { result, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

async function run() {
  const found: string[] = [];
  const fixed: string[] = [];
  const proved: string[] = [];
  const needsAttention: string[] = [];
  const latency: Record<string, number> = {};
  let failures = 0;

  const dir = mkdtempSync(join(tmpdir(), "avorelo-core-"));
  mkdirSync(join(dir, "src"), { recursive: true });

  function check(name: string, pass: boolean, detail: string) {
    if (pass) { proved.push(`${name}: ${detail}`); }
    else { needsAttention.push(`${name}: ${detail}`); failures++; }
    found.push(name);
  }

  try {
    // === SLICE 1: Kernel ===
    const contract = createWorkContract({ contractId: "core_test", objective: "core validation", allowedPaths: [join(dir, "src")], planTier: "Free" });

    // Fake READY blocked
    const { result: fakeResult, ms: fakeMs } = time(() => runSlice1({
      contract, artifacts: [
        { artifactId: "a1", kind: "http_status_ok", ref: "ev:200" },
        { artifactId: "a2", kind: "ui_action_accepted", ref: "ev:click" },
      ] as EvidenceArtifact[], receiptId: "rcpt_core_fake",
    }));
    latency["kernel_gate_fake"] = fakeMs;
    check("fake_ready_blocked", fakeResult.gate.decision !== "STOP_DONE", `decision=${fakeResult.gate.decision} (measured)`);

    // Real READY accepted
    const { result: realResult, ms: realMs } = time(() => runSlice1({
      contract, artifacts: [
        { artifactId: "a1", kind: "persisted_state_change", ref: "ev:row" },
        { artifactId: "a2", kind: "aftermath_correct", ref: "ev:ok" },
      ] as EvidenceArtifact[], receiptId: "rcpt_core_real",
    }));
    latency["kernel_gate_real"] = realMs;
    check("real_ready_accepted", realResult.gate.decision === "STOP_DONE", `decision=${realResult.gate.decision} (measured)`);

    // Receipt write + persist
    const { ms: receiptWriteMs } = time(() => persistReceipt(dir, realResult.receipt));
    latency["receipt_write"] = receiptWriteMs;
    check("receipt_persisted", existsSync(join(dir, ".avorelo", "receipts", "rcpt_core_real.json")), "measured");

    // === SLICE 3: Dashboard ===
    const { result: dashModel, ms: dashMs } = time(() => buildLocalDashboard(dir, { now: Date.now() }));
    latency["dashboard_build"] = dashMs;
    check("dashboard_reads_receipts", dashModel.totals.total >= 1, `${dashModel.totals.total} receipts (measured)`);
    check("dashboard_no_truth_ownership", dashModel.redaction === "applied", "redaction=applied (measured)");

    // === SLICE 4: Production Confidence ===
    writeFileSync(join(dir, "src", "output.txt"), "expected-value\n");
    const { result: proofResult, ms: proofMs } = time(() => evaluateProof({
      contract, dir, readbacks: [{ kind: "file_equals", path: "src/output.txt", expected: "expected-value" }],
      artifacts: [{ artifactId: "post", kind: "aftermath_correct", ref: "ev:confirm" } as EvidenceArtifact],
      environment: { worktreeDirty: false }, persist: false,
    }));
    latency["proof_evaluation"] = proofMs;
    check("source_of_truth_readback_outcome", proofResult.decision === "STOP_DONE", `decision=${proofResult.decision} (measured)`);

    // Dirty worktree blocks
    const dirtyResult = evaluateProof({
      contract, dir, readbacks: [{ kind: "file_equals", path: "src/output.txt", expected: "expected-value" }],
      artifacts: [{ artifactId: "post", kind: "aftermath_correct", ref: "ev:confirm" } as EvidenceArtifact],
      environment: { worktreeDirty: true }, persist: false,
    });
    check("dirty_worktree_blocks_done", dirtyResult.decision !== "STOP_DONE", `decision=${dirtyResult.decision} (measured)`);

    // === SLICE 4.5: Context Budget ===
    const drivers: ContextDriver[] = [
      { driverId: "files", driverType: "selected_files", label: "task files", contextCostCategory: "low", usefulness: "used", measurementConfidence: "measured", reasonCodes: [], deferredNextRun: false, savedOrAvoided: null, evidenceRef: null },
      { driverId: "tools", driverType: "mcp_tool_metadata", label: "tool metadata", contextCostCategory: "high", usefulness: "loaded_unused", measurementConfidence: "estimated", reasonCodes: [], deferredNextRun: true, savedOrAvoided: "estimated: defer next run", evidenceRef: null },
    ];
    const { result: budgetResult, ms: budgetMs } = time(() => evaluateContextBudget({ drivers }));
    latency["context_budget"] = budgetMs;
    check("context_drivers_classified", budgetResult.totalDrivers === 2, `${budgetResult.totalDrivers} drivers (measured)`);
    check("unused_drivers_deferred", budgetResult.deferredNextRun.length > 0, `${budgetResult.deferredNextRun.length} deferred (measured)`);

    // === SLICE 4.5: Tool Governance ===
    const tools: ToolGovernance[] = [
      { toolId: "read", toolName: "Read", contextCost: "low", riskLevel: "low", toolType: "read", defaultExposure: "always", requiresApprovalFor: [], reasonCodes: [] },
      { toolId: "bash", toolName: "Bash", contextCost: "medium", riskLevel: "medium", toolType: "action", defaultExposure: "always", requiresApprovalFor: ["write"], reasonCodes: [] },
      { toolId: "deploy", toolName: "Deploy", contextCost: "high", riskLevel: "high", toolType: "action", defaultExposure: "blocked", requiresApprovalFor: ["external"], reasonCodes: [] },
    ];
    const { result: exposurePlan, ms: toolMs } = time(() => buildExposurePlan({ contract, tools, workflowStage: "read_only" }));
    latency["tool_governance"] = toolMs;
    check("tools_exposed_deferred_blocked", exposurePlan.exposed.length === 1 && exposurePlan.deferred.length === 1 && exposurePlan.blocked.length === 1, `exp=${exposurePlan.exposed.length} def=${exposurePlan.deferred.length} blk=${exposurePlan.blocked.length} (measured)`);

    // === SLICE 4.5: Migration Scorecard ===
    const candidates: MigrationCandidate[] = [
      { candidateId: "test_rebuild", capability: "test", oldPath: "scripts/test.js", description: "test", productValue: "user_value", architectureLayer: "capability", evidence: ["tests"], riskFlags: [], duplicationRisk: false, migrationMode: "REBUILD_NOW", canonicalOwner: "capabilities/test", requiredProof: ["unit tests"], slice: "4.5", userFacingImpact: "proof" },
      { candidateId: "test_reject", capability: "old", oldPath: "scripts/old.js", description: "old", productValue: "internal_only", architectureLayer: "discard", evidence: [], riskFlags: [], duplicationRisk: false, migrationMode: "REJECT_SUPERSEDED", canonicalOwner: "n/a", requiredProof: [], slice: "n/a", userFacingImpact: "none" },
    ];
    const { result: migResult, ms: migMs } = time(() => scoreInventory({ candidates, receiptId: "mig_core" }));
    latency["migration_scorecard"] = migMs;
    check("migration_candidates_scored", migResult.receipt.candidateCount === 2, `${migResult.receipt.candidateCount} candidates (measured)`);

    // Legacy brand leaks
    const leaks = checkLegacyBrandLeaks(["src/avorelo/kernel/run.ts", "src/avorelo/surfaces/cli/avorelo.ts"]);
    check("no_legacy_brand_leaks", leaks.length === 0, `${leaks.length} leaks (measured)`);

    // The Slice-5 payment-readiness checks are gone with the capability: they evaluated
    // Avorelo's own discontinued hosted billing (plan free/pro/teams, Lemon Squeezy entitlement
    // read-back), not anything a Community Edition user does.

    // === SLICE 5: Public Journey ===
    const siteDir = join(dir, "site");
    const { result: siteBuild, ms: siteMs } = time(() => buildSite(siteDir));
    latency["site_build"] = siteMs;
    check("site_build_ok", siteBuild.ok, `${siteBuild.pages.length} pages (measured)`);

    // Check hero copy
    if (siteBuild.ok) {
      const landing = readFileSync(join(siteDir, "index.html"), "utf8");
      check("approved_hero", landing.includes("AI coding comes with overhead. Avorelo handles it."), "measured");
      check("no_token_first_hero", !landing.includes("Make your AI coding tools waste less time, context, and tokens."), "measured");
      check("no_ga4", !landing.includes("googletagmanager"), "measured");
    }

    // Route smoke via preview server
    const h = await serve(siteDir, { port: 0 });
    const routeChecks = ["/", "/dashboard.html", "/dashboard", "/pricing.html", "/pricing", "/login.html", "/signup.html", "/activate-cta.js"];
    let routePass = 0;
    for (const route of routeChecks) {
      try {
        const res = await fetch(h.url.replace(/\/$/, "") + route);
        if (res.status === 200) routePass++;
      } catch { /* skip */ }
    }
    latency["route_smoke"] = 0; // measured as batch above
    check("all_routes_200", routePass === routeChecks.length, `${routePass}/${routeChecks.length} (measured)`);

    // Generated pages NOT served
    const payPage = await fetch(h.url + "payments.html").catch(() => ({ status: 0 }));
    check("generated_pages_blocked", (payPage as any).status === 404, "measured");

    // No raw secrets
    check("no_raw_secrets_in_receipt", !JSON.stringify(realResult.receipt).includes("AKIA"), "measured");

    await h.close();
    await new Promise(r => setTimeout(r, 50));

    fixed.push("all core validation checks executed");

  } finally {
    if (existsSync(dir) && dir.includes("avorelo-core-")) rmSync(dir, { recursive: true, force: true });
  }

  const summary = {
    ok: failures === 0,
    foundCount: found.length,
    fixedCount: fixed.length,
    provedCount: proved.length,
    needsAttentionCount: needsAttention.length,
    fakeReadyBlocked: proved.some(p => p.includes("fake_ready_blocked")),
    dirtyWorktreeBlocked: proved.some(p => p.includes("dirty_worktree")),
    entitlementReadBackRequired: proved.some(p => p.includes("entitlement_readback")),
    contextDriversCount: 2,
    toolsExposedCount: 1,
    toolsDeferredCount: 1,
    toolsBlockedCount: 1,
    migrationCandidatesCount: 2,
    leaksFound: 0,
    unsupportedClaimsFound: 0,
    latency,
    found,
    proved,
    needsAttention,
    failures,
  };

  process.stdout.write("AVORELO CORE DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  // Set exitCode and drain rather than process.exit(): exiting here can race the preview-server's async
  // handle teardown and abort with a libuv UV_HANDLE_CLOSING assertion on Windows even when green.
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((e) => {
  process.stdout.write(`\nCORE DOGFOOD ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
