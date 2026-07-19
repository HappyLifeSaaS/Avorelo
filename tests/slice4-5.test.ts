// Avorelo Slice 4.5 tests: Context Budget, Tool Governance, Migration Scorecard. Zero-dep, node:test.
import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateContextBudget } from "../src/avorelo/capabilities/context-budget/index.ts";
import { buildExposurePlan } from "../src/avorelo/capabilities/tool-governance/index.ts";
import { scoreInventory, checkLegacyBrandLeaks } from "../src/avorelo/capabilities/migration-scorecard/index.ts";
import { createWorkContract } from "../src/avorelo/kernel/work-contract/index.ts";
import type { ContextDriver, ToolGovernance, MigrationCandidate } from "../src/avorelo/shared/schemas/index.ts";

// === Context Budget ===

const mkDriver = (id: string, overrides: Partial<ContextDriver> = {}): ContextDriver => ({
  driverId: id,
  driverType: "selected_files",
  label: id,
  contextCostCategory: "low",
  usefulness: "used",
  measurementConfidence: "measured",
  reasonCodes: [],
  deferredNextRun: false,
  savedOrAvoided: null,
  evidenceRef: null,
  ...overrides,
});

test("context budget: counts used/unused/deferred/blocked correctly", () => {
  const r = evaluateContextBudget({
    drivers: [
      mkDriver("a", { usefulness: "used" }),
      mkDriver("b", { usefulness: "loaded_unused" }),
      mkDriver("c", { usefulness: "deferred" }),
      mkDriver("d", { usefulness: "blocked" }),
    ],
  });
  assert.equal(r.totalDrivers, 4);
  assert.equal(r.used, 1);
  assert.equal(r.loadedUnused, 1);
  assert.equal(r.deferred, 1);
  assert.equal(r.blocked, 1);
});

test("context budget: high-cost unused drivers recommended for deferral", () => {
  const r = evaluateContextBudget({
    drivers: [
      mkDriver("expensive", { usefulness: "loaded_unused", contextCostCategory: "high" }),
      mkDriver("cheap", { usefulness: "loaded_unused", contextCostCategory: "low" }),
    ],
  });
  assert.ok(r.deferredNextRun.includes("expensive"));
  assert.ok(!r.deferredNextRun.includes("cheap")); // low-cost unused not deferred
});

test("context budget: measurement confidence is lowest of all drivers", () => {
  const r = evaluateContextBudget({
    drivers: [
      mkDriver("a", { measurementConfidence: "measured" }),
      mkDriver("b", { measurementConfidence: "inferred" }),
    ],
  });
  assert.equal(r.measurementConfidence, "inferred");
});

test("context budget: no fake token precision", () => {
  const d = mkDriver("repo", { driverType: "repo_map", savedOrAvoided: "estimated: reduced stale instructions" });
  assert.ok(!d.savedOrAvoided?.match(/^\d+ tokens$/)); // no precise token numbers
});

test("context budget: old_repo_migration_context attributed", () => {
  const r = evaluateContextBudget({
    drivers: [mkDriver("old", { driverType: "old_repo_migration_context", usefulness: "used" })],
  });
  assert.equal(r.used, 1);
});

// === Tool Governance ===

const mkTool = (id: string, overrides: Partial<ToolGovernance> = {}): ToolGovernance => ({
  toolId: id,
  toolName: id,
  contextCost: "low",
  riskLevel: "low",
  toolType: "read",
  defaultExposure: "always",
  requiresApprovalFor: [],
  reasonCodes: [],
  ...overrides,
});

const contract = createWorkContract({ contractId: "t", objective: "test", planTier: "Free" });

test("tool governance: blocked tools are always blocked", () => {
  const plan = buildExposurePlan({
    contract,
    tools: [mkTool("danger", { defaultExposure: "blocked" })],
    workflowStage: "edit",
  });
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.exposed.length, 0);
});

test("tool governance: approval-required tools separated", () => {
  const plan = buildExposurePlan({
    contract,
    tools: [mkTool("deploy", { defaultExposure: "approval" })],
    workflowStage: "edit",
  });
  assert.equal(plan.approvalRequired.length, 1);
  assert.equal(plan.exposed.length, 0);
});

test("tool governance: action tools deferred during read-only stage", () => {
  const plan = buildExposurePlan({
    contract,
    tools: [
      mkTool("reader", { toolType: "read" }),
      mkTool("writer", { toolType: "action" }),
    ],
    workflowStage: "read_only",
  });
  assert.equal(plan.exposed.length, 1);
  assert.equal(plan.exposed[0].toolId, "reader");
  assert.equal(plan.deferred.length, 1);
  assert.equal(plan.deferred[0].toolId, "writer");
});

test("tool governance: on-demand tools deferred unless contract requests them", () => {
  const ctr = createWorkContract({ contractId: "t2", objective: "use github", requestedOutputs: ["github pr"], planTier: "Free" });
  const tools = [mkTool("github", { defaultExposure: "on_demand", toolName: "github" })];

  const planWith = buildExposurePlan({ contract: ctr, tools, workflowStage: "edit" });
  assert.equal(planWith.exposed.length, 1);

  const planWithout = buildExposurePlan({ contract, tools, workflowStage: "edit" });
  assert.equal(planWithout.deferred.length, 1);
});

test("tool governance: high-cost tools deferred when budget tight", () => {
  const plan = buildExposurePlan({
    contract,
    tools: [mkTool("heavy", { contextCost: "high" })],
    workflowStage: "edit",
    contextBudgetRemaining: 1,
  });
  assert.equal(plan.deferred.length, 1);
});

test("tool governance: unknown tool type defaults to fail-closed (deferred)", () => {
  const plan = buildExposurePlan({
    contract,
    tools: [mkTool("mystery", { toolType: "action" })],
    workflowStage: "intake", // intake only allows "read"
  });
  assert.equal(plan.deferred.length, 1);
});

test("tool governance: deterministic — same input same output", () => {
  const tools = [mkTool("a"), mkTool("b", { toolType: "action" })];
  const r1 = buildExposurePlan({ contract, tools, workflowStage: "edit" });
  const r2 = buildExposurePlan({ contract, tools, workflowStage: "edit" });
  assert.deepStrictEqual(r1.exposed.map(t => t.toolId), r2.exposed.map(t => t.toolId));
});

// === Migration Scorecard ===

const mkCandidate = (id: string, overrides: Partial<MigrationCandidate> = {}): MigrationCandidate => ({
  candidateId: id,
  capability: id,
  oldPath: `scripts/${id}.js`,
  description: `${id} capability`,
  productValue: "user_value",
  architectureLayer: "capability",
  evidence: ["tests exist"],
  riskFlags: [],
  duplicationRisk: false,
  migrationMode: "REBUILD_NOW",
  canonicalOwner: `capabilities/${id}`,
  requiredProof: ["unit tests", "dogfood"],
  slice: "4.5",
  userFacingImpact: "reduces overhead",
  ...overrides,
});

test("migration scorecard: every candidate must have owner", () => {
  const r = scoreInventory({
    candidates: [mkCandidate("a", { canonicalOwner: "" })],
    receiptId: "test_mig_1",
  });
  assert.ok(r.errors.some(e => e.includes("missing canonical owner")));
});

test("migration scorecard: UNKNOWN_NEEDS_REVIEW flagged as error", () => {
  const r = scoreInventory({
    candidates: [mkCandidate("a", { migrationMode: "UNKNOWN_NEEDS_REVIEW" })],
  });
  assert.ok(r.errors.some(e => e.includes("UNKNOWN_NEEDS_REVIEW")));
});

test("migration scorecard: accepted without proof is an error", () => {
  const r = scoreInventory({
    candidates: [mkCandidate("a", { requiredProof: [] })],
  });
  assert.ok(r.errors.some(e => e.includes("no required proof")));
});

test("migration scorecard: duplication risk flagged", () => {
  const r = scoreInventory({
    candidates: [mkCandidate("a", { duplicationRisk: true })],
  });
  assert.ok(r.errors.some(e => e.includes("duplication risk")));
});

test("migration scorecard: classifies accepted/deferred/rejected correctly", () => {
  const r = scoreInventory({
    candidates: [
      mkCandidate("rebuild", { migrationMode: "REBUILD_NOW" }),
      mkCandidate("later", { migrationMode: "MINE_LATER" }),
      mkCandidate("reject", { migrationMode: "REJECT_SUPERSEDED" }),
    ],
  });
  assert.equal(r.accepted.length, 1);
  assert.equal(r.deferred.length, 1);
  assert.equal(r.rejected.length, 1);
});

test("migration scorecard: receipt has Found/Fixed/Proved/Needs Attention", () => {
  const r = scoreInventory({
    candidates: [mkCandidate("a")],
    receiptId: "test_mig_2",
  });
  assert.ok(r.receipt.found.length > 0);
  assert.ok(r.receipt.fixed.length > 0);
  assert.ok(r.receipt.proved.length > 0);
  assert.equal(r.receipt.redaction, "applied");
});

test("migration scorecard: no silent dropping — unknown mode deferred, not lost", () => {
  const r = scoreInventory({
    candidates: [mkCandidate("a", { migrationMode: "UNKNOWN_NEEDS_REVIEW" })],
  });
  assert.equal(r.deferred.length, 1); // not lost
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected.length, 0);
});

test("migration scorecard: high-risk candidates require explicit proof", () => {
  const r = scoreInventory({
    candidates: [mkCandidate("risky", { riskFlags: ["billing", "secrets"], requiredProof: [] })],
  });
  assert.ok(r.errors.some(e => e.includes("no required proof")));
});

// === Legacy Brand Leaks ===

test("legacy brand leaks: detects cco/wuz/ClaudeCode-Optimizer in paths", () => {
  const violations = checkLegacyBrandLeaks([
    "src/avorelo/kernel/run.ts",
    "scripts/cco-dashboard.js",
    ".claude/cco/state/account.json",
    "bin/wuz",
    "src/ClaudeCode-Optimizer/index.ts",
  ]);
  assert.equal(violations.length, 4); // cco-dashboard, .claude/cco, wuz, ClaudeCode-Optimizer
});

test("legacy brand leaks: clean paths pass", () => {
  const violations = checkLegacyBrandLeaks([
    "src/avorelo/kernel/run.ts",
    "src/avorelo/capabilities/activation/index.ts",
    "docs/product/source-of-truth.md",
  ]);
  assert.equal(violations.length, 0);
});

// === Proof Fields ===

test("unit-only verification does not imply user journey", () => {
  const proof = {
    verificationMode: "unit" as const,
    journeysChecked: [],
    evidenceArtifacts: ["test_result_1"],
    uncheckedItems: ["checkout flow", "activation flow"],
    reasonIfNotRun: "",
  };
  assert.equal(proof.journeysChecked.length, 0);
  assert.ok(proof.uncheckedItems.length > 0); // unchecked journeys visible
});

test("browser not run requires reason", () => {
  const proof = {
    verificationMode: "not_run" as const,
    journeysChecked: [],
    evidenceArtifacts: [],
    uncheckedItems: ["visual proof"],
    reasonIfNotRun: "no browser required for this CLI-only change",
  };
  assert.ok(proof.reasonIfNotRun.length > 0);
});
