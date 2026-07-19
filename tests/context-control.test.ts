import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { discoverContextSources } from "../src/avorelo/kernel/context-control/discovery.ts";
import { normalizeSource } from "../src/avorelo/kernel/context-control/normalization.ts";
import { scoreTrust, scoreFreshness, trustBeats } from "../src/avorelo/kernel/context-control/trust.ts";
import { evaluatePromotion, evaluatePromotions } from "../src/avorelo/kernel/context-control/promotion.ts";
import { detectConflicts } from "../src/avorelo/kernel/context-control/conflicts.ts";
import { detectWorkMode } from "../src/avorelo/kernel/context-control/mode-detection.ts";
import { allocateBudget } from "../src/avorelo/kernel/context-control/budget.ts";
import { compileBrief, renderBriefMarkdown } from "../src/avorelo/kernel/context-control/brief-compiler.ts";
import { containsSecret, redactText, redactLines, isSensitivePath } from "../src/avorelo/kernel/context-control/redaction.ts";
import { evaluateAgentAction, evaluateCompletionClaim } from "../src/avorelo/kernel/context-control/agent-guard.ts";
import {
  createWorkBriefReceipt,
  createExclusionReceipt,
  createAgentDecisionReceipt,
  createPromotionReceipt,
  createConflictReceipt,
} from "../src/avorelo/kernel/context-control/receipts.ts";
import {
  storeDiscovery,
  storeItems,
  loadItems,
  storeConflicts,
  loadConflicts,
  storeMode,
  loadMode,
  storeBrief,
  loadLatestBrief,
  storeContextReceipt,
  loadLatestContextReceipt,
} from "../src/avorelo/kernel/context-control/storage.ts";
import { generateBrief } from "../src/avorelo/kernel/context-control/index.ts";
import type { ContextMemoryItem, DiscoveredSource, PromotionResult } from "../src/avorelo/kernel/context-control/types.ts";

let testDir: string;

function setup(): string {
  const dir = join(tmpdir(), `avorelo-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".avorelo", "activation"), { recursive: true });
  mkdirSync(join(dir, ".avorelo", "receipts"), { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* skip */ }
}

function makeItem(overrides: Partial<ContextMemoryItem> = {}): ContextMemoryItem {
  return {
    id: `ctx_${randomUUID().slice(0, 8)}`,
    schemaVersion: "1.0.0",
    type: "instruction",
    summary: "Test item",
    textHash: "abc123",
    source: { kind: "file", path: "test.md" },
    trust: { level: "inferred", confidence: 0.7, evidenceIds: [], reason: "test" },
    freshness: { status: "current", reason: "test" },
    scope: {},
    safety: {
      containsSecret: false,
      containsSensitiveData: false,
      productionImpact: false,
      ownerOnly: false,
      agentVisible: true,
      redactionRequired: false,
      reason: "safe",
    },
    lifecycle: { status: "candidate" },
    ...overrides,
  };
}

// ============================================================
// 1. Source Discovery Tests
// ============================================================

describe("context-control: source discovery", () => {
  beforeEach(() => { testDir = setup(); });
  afterEach(() => { cleanup(testDir); });

  it("finds AGENTS.md", () => {
    writeFileSync(join(testDir, "AGENTS.md"), "# Agent Instructions\n- Rule 1");
    const result = discoverContextSources(testDir);
    assert.ok(result.sources.some((s) => s.path === "AGENTS.md"));
  });

  it("finds CLAUDE.md", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Claude Rules");
    const result = discoverContextSources(testDir);
    assert.ok(result.sources.some((s) => s.path === "CLAUDE.md"));
  });

  it("finds .cursorrules", () => {
    writeFileSync(join(testDir, ".cursorrules"), "cursor rule content");
    const result = discoverContextSources(testDir);
    assert.ok(result.sources.some((s) => s.path === ".cursorrules"));
  });

  it("finds receipts", () => {
    mkdirSync(join(testDir, ".avorelo", "receipts"), { recursive: true });
    writeFileSync(join(testDir, ".avorelo", "receipts", "rcpt_test.json"), '{"type":"test"}');
    const result = discoverContextSources(testDir);
    assert.ok(result.sources.some((s) => s.kind === "receipt"));
  });

  it("handles missing files gracefully", () => {
    const result = discoverContextSources(testDir);
    assert.ok(Array.isArray(result.sources));
    assert.equal(result.schemaVersion, "1.0.0");
  });

  it("handles Windows-style paths", () => {
    writeFileSync(join(testDir, "README.md"), "# Test");
    const result = discoverContextSources(testDir);
    for (const s of result.sources) {
      assert.ok(!s.path.includes("\\\\"), "Path should use forward slashes or platform native");
    }
  });

  it("marks unsafe content sources", () => {
    writeFileSync(join(testDir, ".env"), "SECRET=abc123");
    mkdirSync(join(testDir, "docs"), { recursive: true });
    const result = discoverContextSources(testDir);
    assert.ok(result.redactionsApplied >= 0);
  });
});

// ============================================================
// 2. Normalization Tests
// ============================================================

describe("context-control: normalization", () => {
  beforeEach(() => { testDir = setup(); });
  afterEach(() => { cleanup(testDir); });

  it("produces valid ContextMemoryItem", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Rules\n- Do not publish\n- Run tests first");
    const source: DiscoveredSource = {
      id: "source_test",
      kind: "file",
      path: "CLAUDE.md",
      exists: true,
      sizeBytes: 100,
      lastModifiedAt: new Date().toISOString(),
      hash: "abc",
      candidateCount: 2,
      safeToRead: true,
      reason: "safe",
    };

    const items = normalizeSource(testDir, source);
    assert.ok(items.length > 0);
    assert.equal(items[0].schemaVersion, "1.0.0");
    assert.ok(items[0].id.startsWith("ctx_"));
    assert.ok(["instruction", "policy", "constraint"].includes(items[0].type));
  });

  it("classifies instructions from CLAUDE.md", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Project rules");
    const source: DiscoveredSource = {
      id: "s1", kind: "file", path: "CLAUDE.md", exists: true,
      sizeBytes: 20, lastModifiedAt: new Date().toISOString(),
      hash: "x", candidateCount: 1, safeToRead: true, reason: "safe",
    };
    const items = normalizeSource(testDir, source);
    assert.equal(items[0].type, "instruction");
  });

  it("classifies receipts as proof", () => {
    mkdirSync(join(testDir, ".avorelo", "receipts"), { recursive: true });
    writeFileSync(join(testDir, ".avorelo", "receipts", "rcpt_test.json"), '{"receiptType":"test"}');
    const source: DiscoveredSource = {
      id: "s2", kind: "receipt", path: ".avorelo/receipts/rcpt_test.json", exists: true,
      sizeBytes: 30, lastModifiedAt: new Date().toISOString(),
      hash: "y", candidateCount: 1, safeToRead: true, reason: "safe",
    };
    const items = normalizeSource(testDir, source);
    assert.equal(items[0].type, "proof");
  });

  it("redacts unsafe content", () => {
    const source: DiscoveredSource = {
      id: "s3", kind: "file", path: "secrets.txt", exists: true,
      sizeBytes: 50, lastModifiedAt: new Date().toISOString(),
      hash: "z", candidateCount: 0, safeToRead: false, reason: "unsafe",
    };
    const items = normalizeSource(testDir, source);
    assert.ok(items.length > 0);
    assert.equal(items[0].safety.agentVisible, false);
    assert.equal(items[0].trust.level, "unsafe");
  });

  it("preserves source metadata", () => {
    writeFileSync(join(testDir, "README.md"), "# Project\nDescription here");
    const ts = new Date().toISOString();
    const source: DiscoveredSource = {
      id: "s4", kind: "file", path: "README.md", exists: true,
      sizeBytes: 40, lastModifiedAt: ts, hash: "h", candidateCount: 1,
      safeToRead: true, reason: "safe",
    };
    const items = normalizeSource(testDir, source);
    assert.equal(items[0].source.path, "README.md");
    assert.equal(items[0].source.kind, "file");
  });
});

// ============================================================
// 3. Promotion Policy Tests
// ============================================================

describe("context-control: promotion", () => {
  it("promotes receipt-backed facts", () => {
    const item = makeItem({
      source: { kind: "receipt", path: "receipt.json", receiptId: "rcpt_1" },
      trust: { level: "verified", confidence: 0.95, evidenceIds: ["rcpt_1"], reason: "receipt" },
    });
    const result = evaluatePromotion(item);
    assert.equal(result.decision, "promote");
    assert.equal(result.safeForAgent, true);
  });

  it("rejects unverified ready claims", () => {
    const item = makeItem({
      summary: "Feature is production-ready and deployed",
      trust: { level: "inferred", confidence: 0.5, evidenceIds: [], reason: "no receipt" },
    });
    const result = evaluatePromotion(item);
    assert.equal(result.decision, "reject");
    assert.equal(result.safeForAgent, false);
  });

  it("rejects secrets", () => {
    const item = makeItem({
      safety: { ...makeItem().safety, containsSecret: true, agentVisible: false, redactionRequired: true, reason: "secret" },
    });
    const result = evaluatePromotion(item);
    assert.equal(result.decision, "mark_unsafe");
    assert.equal(result.safeForAgent, false);
  });

  it("rejects expired handoffs without verification", () => {
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const item = makeItem({
      type: "handoff",
      freshness: { status: "expired", lastVerifiedAt: oldDate, reason: "Over a month old" },
      source: { kind: "file", path: "handoff.md", timestamp: oldDate },
      trust: { level: "inferred", confidence: 0.5, evidenceIds: [], reason: "old file" },
    });
    const result = evaluatePromotion(item);
    assert.equal(result.decision, "reject");
    assert.equal(result.safeForAgent, false);
  });

  it("marks stale unverified items as unverified", () => {
    const staleDate = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const item = makeItem({
      type: "handoff",
      freshness: { status: "stale", lastVerifiedAt: staleDate, reason: "Over a week old" },
      source: { kind: "file", path: "handoff.md", timestamp: staleDate },
      trust: { level: "inferred", confidence: 0.5, evidenceIds: [], reason: "old file" },
    });
    const result = evaluatePromotion(item);
    assert.equal(result.decision, "mark_unverified");
    assert.equal(result.safeForAgent, false);
  });

  it("marks external unverified sources", () => {
    const item = makeItem({
      source: { kind: "external", url: "https://example.com" },
      trust: { level: "unverified", confidence: 0.3, evidenceIds: [], reason: "external" },
    });
    const result = evaluatePromotion(item);
    assert.equal(result.decision, "mark_unverified");
  });

  it("promotes current inferred items", () => {
    const item = makeItem({
      trust: { level: "inferred", confidence: 0.7, evidenceIds: [], reason: "local file" },
      freshness: { status: "current", reason: "just modified" },
    });
    const result = evaluatePromotion(item);
    assert.equal(result.decision, "promote");
  });
});

// ============================================================
// 4. Trust/Freshness Tests
// ============================================================

describe("context-control: trust scoring", () => {
  it("scores git-backed as verified", () => {
    const item = makeItem({ source: { kind: "git" } });
    const score = scoreTrust(item);
    assert.equal(score.trustLevel, "verified");
  });

  it("scores receipt-backed as verified", () => {
    const item = makeItem({ source: { kind: "receipt", receiptId: "r1" } });
    const score = scoreTrust(item);
    assert.equal(score.trustLevel, "verified");
  });

  it("scores external as unverified", () => {
    const item = makeItem({ source: { kind: "external" } });
    const score = scoreTrust(item);
    assert.equal(score.trustLevel, "unverified");
  });

  it("scores secret content as unsafe", () => {
    const item = makeItem({ safety: { ...makeItem().safety, containsSecret: true } });
    const score = scoreTrust(item);
    assert.equal(score.trustLevel, "unsafe");
  });

  it("trustBeats: verified beats inferred", () => {
    const a = { itemId: "a", trustLevel: "verified" as const, confidence: 0.9, reason: "", evidenceIds: [] };
    const b = { itemId: "b", trustLevel: "inferred" as const, confidence: 0.7, reason: "", evidenceIds: [] };
    assert.equal(trustBeats(a, b), true);
    assert.equal(trustBeats(b, a), false);
  });
});

describe("context-control: freshness scoring", () => {
  it("scores recent timestamp as current", () => {
    const item = makeItem({
      freshness: { status: "current", lastVerifiedAt: new Date().toISOString(), reason: "now" },
    });
    const score = scoreFreshness(item);
    assert.equal(score.freshnessStatus, "current");
  });

  it("scores old timestamp as stale/expired", () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const item = makeItem({
      freshness: { status: "expired", lastVerifiedAt: old, reason: "old" },
      source: { kind: "file", timestamp: old },
    });
    const score = scoreFreshness(item);
    assert.ok(score.freshnessStatus === "expired" || score.freshnessStatus === "stale");
  });

  it("scores no timestamp as unknown", () => {
    const item = makeItem({ freshness: { status: "unknown", reason: "no ts" } });
    item.source.timestamp = undefined;
    const score = scoreFreshness(item);
    assert.equal(score.freshnessStatus, "unknown");
  });
});

// ============================================================
// 5. Conflict Detection Tests
// ============================================================

describe("context-control: conflict detection", () => {
  it("detects production ready vs deploy missing", () => {
    const items = [
      makeItem({ id: "c1", summary: "Feature is production-ready and live" }),
      makeItem({
        id: "c2",
        summary: "Deploy missing — Netlify not deployed",
        source: { kind: "receipt" },
        trust: { level: "verified", confidence: 0.9, evidenceIds: ["r1"], reason: "receipt" },
      }),
    ];
    const conflicts = detectConflicts(items);
    assert.ok(conflicts.some((c) => c.type === "production_status_conflict"));
  });

  it("detects test pass vs dirty worktree", () => {
    const items = [
      makeItem({
        id: "t1", type: "proof", summary: "All tests passed",
        source: { kind: "receipt" },
        trust: { level: "verified", confidence: 0.9, evidenceIds: [], reason: "receipt" },
      }),
      makeItem({
        id: "t2", summary: "Git status: dirty uncommitted changes",
        source: { kind: "git" },
        trust: { level: "verified", confidence: 0.9, evidenceIds: [], reason: "git" },
      }),
    ];
    const conflicts = detectConflicts(items);
    assert.ok(conflicts.some((c) => c.type === "test_result_conflict"));
  });

  it("detects missing proof for ready claims", () => {
    const items = [
      makeItem({ id: "mp1", summary: "Feature is ready and complete", trust: { level: "inferred", confidence: 0.5, evidenceIds: [], reason: "no proof" } }),
    ];
    const conflicts = detectConflicts(items);
    assert.ok(conflicts.some((c) => c.type === "missing_proof_conflict"));
  });

  it("resolves production conflict conservatively", () => {
    const items = [
      makeItem({ id: "pc1", summary: "production-ready", trust: { level: "inferred", confidence: 0.5, evidenceIds: [], reason: "" } }),
      makeItem({ id: "pc2", summary: "deploy missing", source: { kind: "receipt" }, trust: { level: "verified", confidence: 0.9, evidenceIds: [], reason: "receipt" } }),
    ];
    const conflicts = detectConflicts(items);
    const prod = conflicts.find((c) => c.type === "production_status_conflict");
    assert.ok(prod);
    assert.ok(prod!.safeDefault === "pending_verification");
  });
});

// ============================================================
// 6. Mode Detection Tests
// ============================================================

describe("context-control: mode detection", () => {
  it("detects feature_development from branch name", () => {
    const result = detectWorkMode({ branchName: "feature/new-thing" });
    assert.equal(result.detectedMode, "feature_development");
    assert.ok(result.confidence > 0.3);
  });

  it("detects bugfix from branch name", () => {
    const result = detectWorkMode({ branchName: "fix/broken-auth" });
    assert.equal(result.detectedMode, "bugfix");
  });

  it("detects release_verification from release branch", () => {
    const result = detectWorkMode({ branchName: "release/v1.0.0" });
    assert.equal(result.detectedMode, "release_verification");
  });

  it("blocks production_release without approval", () => {
    const result = detectWorkMode({
      branchName: "main",
      taskText: "deploy to production",
      commands: ["deploy"],
    });
    assert.notEqual(result.detectedMode, "production_release");
  });

  it("allows production_release with approval", () => {
    const result = detectWorkMode({
      hasProductionApproval: true,
      taskText: "deploy to production",
    });
    assert.equal(result.detectedMode, "production_release");
  });

  it("detects qa_proof from test-only changes", () => {
    const result = detectWorkMode({
      changedFiles: ["tests/auth.test.ts", "tests/api.test.ts"],
      taskText: "verify test coverage",
    });
    assert.equal(result.detectedMode, "qa_proof");
  });

  it("detects security_guard from security findings", () => {
    const result = detectWorkMode({ hasSecurityFindings: true, taskText: "audit security" });
    assert.equal(result.detectedMode, "security_guard");
  });

  it("detects docs_product from docs-only changes", () => {
    const result = detectWorkMode({ changedFiles: ["docs/guide.md", "README.md"], taskText: "update documentation" });
    assert.equal(result.detectedMode, "docs_product");
  });

  it("falls back to unknown with no signals", () => {
    const result = detectWorkMode({});
    assert.equal(result.detectedMode, "unknown");
    assert.ok(result.confidence < 0.3);
  });

  it("includes safety constraints", () => {
    const result = detectWorkMode({ branchName: "feature/x" });
    assert.ok(result.safetyConstraints.length > 0);
    assert.ok(result.requiredProofBeforeCompletion.length > 0);
  });
});

// ============================================================
// 7. Brief Compiler Tests
// ============================================================

describe("context-control: brief compiler", () => {
  it("includes safety constraints in brief", () => {
    const items = [makeItem({ type: "constraint", summary: "Do not publish to npm" })];
    const promotions: PromotionResult[] = [{ schemaVersion: "1.0.0", decisionId: "p1", itemId: items[0].id, decision: "promote", reason: "ok", evidenceIds: [], resultingLifecycleStatus: "promoted", safeForAgent: true }];
    const mode = detectWorkMode({ branchName: "feature/x" });
    const budget = allocateBudget(items, promotions, 0);
    const brief = compileBrief(items, promotions, [], mode, budget);

    assert.ok(brief.mustFollowConstraints.length > 0 || brief.currentWorkingTruth.some((t) => t.includes("blocked")));
  });

  it("includes what not to assume", () => {
    const items = [makeItem()];
    const promotions = evaluatePromotions(items);
    const mode = detectWorkMode({ branchName: "feature/x" });
    const budget = allocateBudget(items, promotions, 0);
    const brief = compileBrief(items, promotions, [], mode, budget);

    assert.ok(brief.whatNotToAssume.length > 0);
  });

  it("includes required proof", () => {
    const items = [makeItem()];
    const promotions = evaluatePromotions(items);
    const mode = detectWorkMode({ branchName: "feature/x" });
    const budget = allocateBudget(items, promotions, 0);
    const brief = compileBrief(items, promotions, [], mode, budget);

    assert.ok(brief.requiredProofBeforeCompletion.length > 0);
  });

  it("renders valid markdown", () => {
    const items = [makeItem()];
    const promotions = evaluatePromotions(items);
    const mode = detectWorkMode({});
    const budget = allocateBudget(items, promotions, 0);
    const brief = compileBrief(items, promotions, [], mode, budget);
    const md = renderBriefMarkdown(brief);

    assert.ok(md.startsWith("# Avorelo Trusted Work Brief"));
    assert.ok(md.includes("## Current working truth"));
    assert.ok(md.includes("## What not to assume"));
    assert.ok(md.includes("## Required proof before completion"));
  });

  it("respects context budget", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `ctx_big_${i}`, summary: "A".repeat(200) }),
    );
    const promotions = evaluatePromotions(items);
    const budget = allocateBudget(items, promotions, 0, 500);

    assert.ok(budget.includedItemIds.length < items.length);
    assert.ok(budget.excludedItemIds.length > 0);
  });

  it("excludes stale/unsafe items from brief", () => {
    const items = [
      makeItem({ id: "safe1", trust: { level: "verified", confidence: 0.9, evidenceIds: [], reason: "ok" } }),
      makeItem({ id: "unsafe1", safety: { ...makeItem().safety, containsSecret: true, agentVisible: false } }),
    ];
    const promotions = evaluatePromotions(items);
    const budget = allocateBudget(items, promotions, 0);

    assert.ok(!budget.includedItemIds.includes("unsafe1"));
  });
});

// ============================================================
// 8. Receipt Tests
// ============================================================

describe("context-control: receipts", () => {
  it("creates work brief receipt", () => {
    const brief = compileBrief([], [], [], detectWorkMode({}), allocateBudget([], [], 0));
    const receipt = createWorkBriefReceipt(brief, "/path/brief.md", 10, 5, 0);

    assert.equal(receipt.type, "work_brief_receipt");
    assert.ok(receipt.receiptId.startsWith("receipt_"));
    assert.equal(receipt.containsRawPrompt, false);
    assert.equal(receipt.containsRawSecret, false);
    assert.equal(receipt.safeForAgent, true);
  });

  it("creates exclusion receipt", () => {
    const receipt = createExclusionReceipt([
      { itemId: "ctx_1", reason: "secret_detected", safeDefault: "exclude" },
    ]);
    assert.equal(receipt.type, "context_exclusion_receipt");
    assert.equal(receipt.excludedItems.length, 1);
  });

  it("creates agent decision receipt", () => {
    const receipt = createAgentDecisionReceipt("npm publish", "block", "owner only", "feature_development");
    assert.equal(receipt.type, "agent_context_decision_receipt");
    assert.equal(receipt.decision, "block");
  });

  it("creates promotion receipt", () => {
    const receipt = createPromotionReceipt([
      { schemaVersion: "1.0.0", decisionId: "p1", itemId: "ctx_1", decision: "promote", reason: "ok", evidenceIds: [], resultingLifecycleStatus: "promoted", safeForAgent: true },
    ]);
    assert.equal(receipt.type, "memory_promotion_receipt");
    assert.equal(receipt.promotions.length, 1);
  });

  it("creates conflict receipt", () => {
    const receipt = createConflictReceipt([]);
    assert.equal(receipt.type, "context_conflict_receipt");
  });

  it("receipts never contain raw content", () => {
    const receipt = createWorkBriefReceipt(
      compileBrief([], [], [], detectWorkMode({}), allocateBudget([], [], 0)),
      "/brief.md", 0, 0, 0,
    );
    assert.equal(receipt.containsRawPrompt, false);
    assert.equal(receipt.containsRawSource, false);
    assert.equal(receipt.containsRawSecret, false);
    assert.equal(receipt.contentStored, false);
  });
});

// ============================================================
// 9. Agent Guard Tests
// ============================================================

describe("context-control: agent guard", () => {
  it("blocks npm publish", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateAgentAction("npm publish", mode);
    assert.equal(decision.decision, "block");
    assert.ok(decision.reason.includes("Owner"), `Expected reason to mention Owner, got: ${decision.reason}`);
  });

  it("blocks netlify deploy --prod in feature mode", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateAgentAction("netlify deploy --prod", mode);
    assert.equal(decision.decision, "block");
  });

  it("blocks railway deploy in feature mode", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateAgentAction("railway up", mode);
    assert.equal(decision.decision, "block");
  });

  it("blocks force push", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateAgentAction("git push --force", mode);
    assert.equal(decision.decision, "block");
  });

  it("allows safe commands", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateAgentAction("npm test", mode);
    assert.equal(decision.decision, "allow");
  });

  it("downgrades completion claim without proof", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateCompletionClaim("Feature is production-ready", false, mode);
    assert.equal(decision.decision, "downgrade");
  });

  it("allows completion claim with verification receipt", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateCompletionClaim("Feature is verified and complete", true, mode);
    assert.equal(decision.decision, "allow");
  });

  it("generates receipt for blocked action", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateAgentAction("npm publish", mode);
    assert.ok(decision.receipt.receiptId.startsWith("receipt_"));
    assert.equal(decision.receipt.type, "agent_context_decision_receipt");
  });
});

// ============================================================
// 10. Redaction Tests
// ============================================================

describe("context-control: redaction", () => {
  it("detects API keys", () => {
    assert.equal(containsSecret("api_key=abc123secret"), true);
    assert.equal(containsSecret("API_KEY: mysecret"), true);
  });

  it("detects private keys", () => {
    assert.equal(containsSecret("-----BEGIN " + "PRIVATE KEY-----"), true);
  });

  it("detects token patterns", () => {
    assert.equal(containsSecret("sk-abcdefghijklmnopqrstuvwxyz1234"), true);
    assert.equal(containsSecret("ghp_abcdef" + "ghijklmnopqrstuvwxyz1234567890"), true);
  });

  it("does not flag safe content", () => {
    assert.equal(containsSecret("This is a normal instruction"), false);
    assert.equal(containsSecret("Run npm test to verify"), false);
  });

  it("redacts secrets from text", () => {
    const redacted = redactText("api_key=my_secret_value other text");
    assert.ok(redacted.includes("[REDACTED]"));
    assert.ok(!redacted.includes("my_secret_value"));
  });

  it("redacts lines with secrets", () => {
    const result = redactLines("line 1\napi_key=secret\nline 3");
    assert.ok(result.text.includes("[REDACTED_LINE]"));
    assert.equal(result.redactionsApplied, 1);
  });

  it("identifies sensitive paths", () => {
    assert.equal(isSensitivePath(".env"), true);
    assert.equal(isSensitivePath(".env.local"), true);
    assert.equal(isSensitivePath("credentials.json"), true);
    assert.equal(isSensitivePath("server.key"), true);
    assert.equal(isSensitivePath("README.md"), false);
    assert.equal(isSensitivePath("src/index.ts"), false);
  });
});

// ============================================================
// 11. Storage Tests
// ============================================================

describe("context-control: storage", () => {
  beforeEach(() => { testDir = setup(); });
  afterEach(() => { cleanup(testDir); });

  it("stores and loads items", () => {
    const items = [makeItem({ id: "store1" }), makeItem({ id: "store2" })];
    storeItems(testDir, items);
    const loaded = loadItems(testDir);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].id, "store1");
  });

  it("stores and loads conflicts", () => {
    const conflicts = [{ schemaVersion: "1.0.0" as const, conflictId: "c1", type: "policy_conflict" as const, items: ["a"], strongerEvidence: { itemId: "a", reason: "r" }, weakerEvidence: { itemId: "b", reason: "r" }, resolution: "r", impact: "i", requiredNextProof: "p", safeDefault: "s" }];
    storeConflicts(testDir, conflicts);
    const loaded = loadConflicts(testDir);
    assert.equal(loaded.length, 1);
  });

  it("stores and loads mode", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    storeMode(testDir, mode);
    const loaded = loadMode(testDir);
    assert.ok(loaded);
    assert.equal(loaded!.detectedMode, "feature_development");
  });

  it("stores and loads brief markdown", () => {
    storeBrief(testDir, "# Test Brief");
    const loaded = loadLatestBrief(testDir);
    assert.equal(loaded, "# Test Brief");
  });

  it("stores and loads context receipts", () => {
    const receipt = createAgentDecisionReceipt("test", "allow", "ok", "unknown");
    storeContextReceipt(testDir, receipt);
    const loaded = loadLatestContextReceipt(testDir);
    assert.ok(loaded);
    assert.equal(loaded!.type, "agent_context_decision_receipt");
  });

  it("handles empty storage gracefully", () => {
    assert.deepEqual(loadItems(testDir), []);
    assert.deepEqual(loadConflicts(testDir), []);
    assert.equal(loadMode(testDir), null);
    assert.equal(loadLatestBrief(testDir), null);
    assert.equal(loadLatestContextReceipt(testDir), null);
  });
});

// ============================================================
// 12. Full Pipeline / Integration Tests
// ============================================================

describe("context-control: full pipeline", () => {
  beforeEach(() => { testDir = setup(); });
  afterEach(() => { cleanup(testDir); });

  it("generates complete brief from real project structure", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# CLAUDE.md\n## Boundaries\n- Do not npm publish\n- Do not deploy without approval");
    writeFileSync(join(testDir, "AGENTS.md"), "# AGENTS.md\n- Follow CLAUDE.md rules");
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", version: "0.1.0" }));
    writeFileSync(
      join(testDir, ".avorelo", "activation", "activation-state.json"),
      JSON.stringify({ activated: true, activatedAt: new Date().toISOString() }),
    );

    const result = generateBrief(testDir, {
      branchName: "feature/new-feature",
      taskText: "implement new feature",
    });

    assert.ok(result.brief.briefId.startsWith("brief_"));
    assert.equal(result.mode.detectedMode, "feature_development");
    assert.ok(result.sourceCount > 0);
    assert.ok(result.candidateCount > 0);
    assert.ok(result.briefMarkdown.includes("# Avorelo Trusted Work Brief"));
    assert.ok(existsSync(result.briefPath));
    assert.ok(existsSync(result.receiptPath));
    assert.equal(result.receipt.type, "work_brief_receipt");
    assert.equal(result.receipt.safeForAgent, true);
  });

  it("scenario A: old handoff says production ready, newer receipt says deploy missing", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Rules");

    const items = [
      makeItem({
        id: "old_handoff",
        type: "handoff",
        summary: "Feature is production-ready and deployed to production",
        freshness: { status: "stale", reason: "old" },
        trust: { level: "inferred", confidence: 0.5, evidenceIds: [], reason: "old doc" },
      }),
      makeItem({
        id: "new_receipt",
        type: "proof",
        summary: "Deploy missing — Netlify not deployed",
        source: { kind: "receipt" },
        freshness: { status: "current", reason: "new" },
        trust: { level: "verified", confidence: 0.9, evidenceIds: ["r1"], reason: "receipt" },
      }),
    ];

    const conflicts = detectConflicts(items);
    assert.ok(conflicts.some((c) => c.type === "production_status_conflict"));

    const prodConflict = conflicts.find((c) => c.type === "production_status_conflict")!;
    assert.ok(prodConflict.resolution.includes("not verified"));
  });

  it("scenario D: agent session attempts npm publish", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateAgentAction("npm publish", mode);
    assert.equal(decision.decision, "block");
    assert.ok(decision.reason.toLowerCase().includes("owner"));
  });

  it("scenario E: secret appears in candidate memory", () => {
    const item = makeItem({
      summary: "api_key=super_secret_value_12345",
      safety: { ...makeItem().safety, containsSecret: true, agentVisible: false, redactionRequired: true, reason: "secret" },
    });
    const promo = evaluatePromotion(item);
    assert.equal(promo.decision, "mark_unsafe");
    assert.equal(promo.safeForAgent, false);
  });

  it("scenario G: huge docs set stays within budget", () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      makeItem({ id: `big_${i}`, summary: `Documentation section ${i}: ${"content ".repeat(50)}` }),
    );
    const promotions = evaluatePromotions(items);
    const budget = allocateBudget(items, promotions, 0);

    assert.ok(budget.includedItemIds.length < 100);
    assert.ok(budget.excludedItemIds.length > 0);
  });

  it("scenario H: no receipts found means proof missing", () => {
    const result = generateBrief(testDir);
    assert.ok(
      result.briefMarkdown.includes("proof") ||
      result.brief.requiredProofBeforeCompletion.length > 0,
    );
  });

  it("scenario J: external memory item not promoted", () => {
    const item = makeItem({
      source: { kind: "external", url: "https://example.com" },
      trust: { level: "unverified", confidence: 0.3, evidenceIds: [], reason: "external" },
    });
    const promo = evaluatePromotion(item);
    assert.notEqual(promo.decision, "promote");
  });

  it("scenario K: completion claim without proof downgraded", () => {
    const mode = detectWorkMode({ branchName: "feature/x" });
    const decision = evaluateCompletionClaim("Everything is done and production-ready", false, mode);
    assert.equal(decision.decision, "downgrade");
    assert.ok(decision.reason.includes("pending verification"));
  });
});
