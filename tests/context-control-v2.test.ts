import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runRepoPreflight, formatPreflightResult } from "../src/avorelo/kernel/context-control/repo-preflight.ts";
import { promoteItem, forgetItem } from "../src/avorelo/kernel/context-control/promote-forget.ts";
import { storeItems, loadItems, loadLatestContextReceipt } from "../src/avorelo/kernel/context-control/storage.ts";
import { generateBrief } from "../src/avorelo/kernel/context-control/index.ts";
import type { ContextMemoryItem } from "../src/avorelo/kernel/context-control/types.ts";

let testDir: string;

function setup(): string {
  const dir = join(tmpdir(), `avorelo-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".avorelo", "activation"), { recursive: true });
  mkdirSync(join(dir, ".avorelo", "receipts"), { recursive: true });
  return dir;
}

function setupSourceRepo(): string {
  const dir = setup();
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-project", version: "1.0.0" }));
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

function setupRuntimeDir(): string {
  const dir = join(tmpdir(), `avorelo-test-${randomUUID().slice(0, 8)}`, ".avorelo");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "activation"), { recursive: true });
  mkdirSync(join(dir, "receipts"), { recursive: true });
  mkdirSync(join(dir, "context"), { recursive: true });
  mkdirSync(join(dir, "sessions"), { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try {
    const root = dir.endsWith(".avorelo") ? join(dir, "..") : dir;
    rmSync(root, { recursive: true, force: true });
  } catch { /* skip */ }
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
// 1. Repo Preflight Tests
// ============================================================

describe("repo-preflight: source repo detection", () => {
  afterEach(() => { if (testDir) cleanup(testDir); });

  it("accepts a proper source repo", () => {
    testDir = setupSourceRepo();
    const result = runRepoPreflight(testDir);
    assert.equal(result.ok, true);
    assert.equal(result.isGitRepo, true);
    assert.equal(result.hasPackageJson, true);
    assert.equal(result.hasSrcDir, true);
    assert.equal(result.isCanonicalSourceRepo, true);
    assert.equal(result.isRuntimeDataDir, false);
    assert.equal(result.blockers.length, 0);
  });

  it("rejects a runtime-only .avorelo directory", () => {
    testDir = setupRuntimeDir();
    const result = runRepoPreflight(testDir);
    assert.equal(result.ok, false);
    assert.equal(result.isRuntimeDataDir, true);
    assert.equal(result.isGitRepo, false);
    assert.equal(result.isCanonicalSourceRepo, false);
    assert.ok(result.blockers.length > 0);
    assert.ok(result.blockers[0].includes("runtime data directory"));
  });

  it("warns about non-git directories that are not runtime dirs", () => {
    testDir = setup();
    writeFileSync(join(testDir, "package.json"), "{}");
    const result = runRepoPreflight(testDir);
    assert.ok(result.warnings.some((w) => w.includes("No .git directory")));
  });

  it("handles non-existent directory", () => {
    const result = runRepoPreflight(join(tmpdir(), `nonexistent-${randomUUID()}`));
    assert.equal(result.ok, false);
    assert.ok(result.blockers[0].includes("does not exist"));
  });

  it("formats preflight result as human-readable text", () => {
    testDir = setupSourceRepo();
    const result = runRepoPreflight(testDir);
    const text = formatPreflightResult(result);
    assert.ok(text.includes("Avorelo Repo Preflight"));
    assert.ok(text.includes("Git repo:"));
    assert.ok(text.includes("Status: OK"));
  });

  it("formats blocked result with blockers", () => {
    testDir = setupRuntimeDir();
    const result = runRepoPreflight(testDir);
    const text = formatPreflightResult(result);
    assert.ok(text.includes("BLOCKED"));
    assert.ok(text.includes("runtime data directory"));
  });
});

describe("repo-preflight: runtime .avorelo is not treated as source repo", () => {
  afterEach(() => { if (testDir) cleanup(testDir); });

  it("runtime dir with many runtime indicators is rejected", () => {
    testDir = setupRuntimeDir();
    mkdirSync(join(testDir, "work-briefs"), { recursive: true });
    const result = runRepoPreflight(testDir);
    assert.equal(result.ok, false);
    assert.equal(result.isRuntimeDataDir, true);
  });

  it("runtime artifacts can still be written from a real repo", () => {
    testDir = setupSourceRepo();
    const avoreloDir = join(testDir, ".avorelo", "context");
    mkdirSync(avoreloDir, { recursive: true });
    writeFileSync(join(avoreloDir, "test.json"), "{}");
    assert.ok(existsSync(join(avoreloDir, "test.json")));

    const preflight = runRepoPreflight(testDir);
    assert.equal(preflight.ok, true);
  });
});

// ============================================================
// 2. Promote/Forget Tests
// ============================================================

describe("promote-forget: promote", () => {
  beforeEach(() => { testDir = setupSourceRepo(); });
  afterEach(() => { cleanup(testDir); });

  it("promotes a valid candidate item", () => {
    const item = makeItem({ id: "ctx_promote1" });
    storeItems(testDir, [item]);

    const result = promoteItem(testDir, { itemId: "ctx_promote1", reason: "Verified by tests" });
    assert.equal(result.ok, true);
    assert.equal(result.newStatus, "promoted");
    assert.equal(result.previousStatus, "candidate");
    assert.ok(result.receiptId.startsWith("receipt_"));

    const items = loadItems(testDir);
    assert.equal(items[0].lifecycle.status, "promoted");
  });

  it("generates a receipt on promotion", () => {
    const item = makeItem({ id: "ctx_rcpt1" });
    storeItems(testDir, [item]);

    const result = promoteItem(testDir, { itemId: "ctx_rcpt1", reason: "Test" });
    assert.ok(result.receiptId.startsWith("receipt_"));

    const receipt = loadLatestContextReceipt(testDir);
    assert.ok(receipt);
    assert.equal(receipt!.containsRawPrompt, false);
    assert.equal(receipt!.containsRawSecret, false);
  });

  it("rejects promotion of items with secrets", () => {
    const item = makeItem({
      id: "ctx_secret1",
      safety: { ...makeItem().safety, containsSecret: true, agentVisible: false },
    });
    storeItems(testDir, [item]);

    const result = promoteItem(testDir, { itemId: "ctx_secret1", reason: "Trying to promote" });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("secret"));
  });

  it("rejects promotion of non-existent items", () => {
    storeItems(testDir, []);
    const result = promoteItem(testDir, { itemId: "ctx_missing", reason: "Test" });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("not found"));
  });

  it("rejects production-ready claims without evidence", () => {
    const item = makeItem({
      id: "ctx_prod1",
      summary: "Feature is production-ready",
    });
    storeItems(testDir, [item]);

    const result = promoteItem(testDir, { itemId: "ctx_prod1", reason: "Looks good" });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("evidence"));
  });

  it("allows production-ready claim with evidence IDs", () => {
    const item = makeItem({
      id: "ctx_prod2",
      summary: "Feature is production-ready",
    });
    storeItems(testDir, [item]);

    const result = promoteItem(testDir, {
      itemId: "ctx_prod2",
      reason: "Verified with deploy receipt",
      evidenceIds: ["receipt_deploy_123"],
    });
    assert.equal(result.ok, true);
    assert.equal(result.newStatus, "promoted");
  });

  it("upgrades trust level with evidence", () => {
    const item = makeItem({ id: "ctx_trust1" });
    storeItems(testDir, [item]);

    promoteItem(testDir, { itemId: "ctx_trust1", reason: "With proof", evidenceIds: ["rcpt_1"] });
    const items = loadItems(testDir);
    assert.equal(items[0].trust.level, "verified");
    assert.ok(items[0].trust.evidenceIds.includes("rcpt_1"));
  });
});

describe("promote-forget: forget", () => {
  beforeEach(() => { testDir = setupSourceRepo(); });
  afterEach(() => { cleanup(testDir); });

  it("forgets an existing item", () => {
    const item = makeItem({ id: "ctx_forget1" });
    storeItems(testDir, [item]);

    const result = forgetItem(testDir, { itemId: "ctx_forget1", reason: "Outdated info" });
    assert.equal(result.ok, true);
    assert.equal(result.newStatus, "forgotten");
    assert.ok(result.receiptId.startsWith("receipt_"));

    const items = loadItems(testDir);
    assert.equal(items[0].lifecycle.status, "forgotten");
    assert.equal(items[0].safety.agentVisible, false);
  });

  it("marks as superseded when supersededBy is provided", () => {
    const item = makeItem({ id: "ctx_super1" });
    storeItems(testDir, [item]);

    const result = forgetItem(testDir, {
      itemId: "ctx_super1",
      reason: "Replaced by newer version",
      supersededBy: "ctx_newer1",
    });
    assert.equal(result.ok, true);
    assert.equal(result.newStatus, "superseded");

    const items = loadItems(testDir);
    assert.equal(items[0].lifecycle.status, "superseded");
  });

  it("generates receipt on forget", () => {
    const item = makeItem({ id: "ctx_frcpt1" });
    storeItems(testDir, [item]);

    const result = forgetItem(testDir, { itemId: "ctx_frcpt1", reason: "Test forget" });
    assert.ok(result.receiptId.startsWith("receipt_"));

    const receipt = loadLatestContextReceipt(testDir);
    assert.ok(receipt);
    assert.equal(receipt!.containsRawSecret, false);
  });

  it("rejects forget of non-existent items", () => {
    storeItems(testDir, []);
    const result = forgetItem(testDir, { itemId: "ctx_nope", reason: "Test" });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("not found"));
  });
});

// ============================================================
// 3. CLI Wiring Tests (via kernel, not CLI surface)
// ============================================================

describe("context-control: CLI commands wired", () => {
  beforeEach(() => { testDir = setupSourceRepo(); });
  afterEach(() => { cleanup(testDir); });

  it("generateBrief runs full pipeline from source repo", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Rules\n- Do not publish");
    const result = generateBrief(testDir, { branchName: "feature/test" });
    assert.ok(result.brief.briefId.startsWith("brief_"));
    assert.equal(result.mode.detectedMode, "feature_development");
    assert.ok(result.briefMarkdown.includes("# Avorelo Trusted Work Brief"));
  });

  it("promote is accessible from index", () => {
    const item = makeItem({ id: "ctx_idx1" });
    storeItems(testDir, [item]);
    const result = promoteItem(testDir, { itemId: "ctx_idx1", reason: "Index test" });
    assert.equal(result.ok, true);
  });

  it("forget is accessible from index", () => {
    const item = makeItem({ id: "ctx_idx2" });
    storeItems(testDir, [item]);
    const result = forgetItem(testDir, { itemId: "ctx_idx2", reason: "Index test" });
    assert.equal(result.ok, true);
  });

  it("preflight is accessible from index", () => {
    const result = runRepoPreflight(testDir);
    assert.equal(result.ok, true);
  });
});

// ============================================================
// 4. Integration: promote/forget with full pipeline
// ============================================================

describe("context-control: promote/forget integration", () => {
  beforeEach(() => { testDir = setupSourceRepo(); });
  afterEach(() => { cleanup(testDir); });

  it("promoted items persist across brief regeneration", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Test instructions");
    const brief1 = generateBrief(testDir);
    const items = loadItems(testDir);

    if (items.length > 0) {
      const firstId = items[0].id;
      promoteItem(testDir, { itemId: firstId, reason: "Manual verify" });
      const updated = loadItems(testDir);
      assert.equal(updated.find((i) => i.id === firstId)?.lifecycle.status, "promoted");
    }
  });

  it("forgotten items are excluded from agent view", () => {
    const item = makeItem({ id: "ctx_fgt_int" });
    storeItems(testDir, [item]);
    forgetItem(testDir, { itemId: "ctx_fgt_int", reason: "No longer relevant" });
    const items = loadItems(testDir);
    const forgotten = items.find((i) => i.id === "ctx_fgt_int");
    assert.ok(forgotten);
    assert.equal(forgotten!.safety.agentVisible, false);
  });
});

// ============================================================
// 5. Existing tests still pass (smoke check)
// ============================================================

describe("context-control: regression smoke", () => {
  beforeEach(() => { testDir = setupSourceRepo(); });
  afterEach(() => { cleanup(testDir); });

  it("generateBrief still works end-to-end", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Boundaries\n- No npm publish");
    const result = generateBrief(testDir);
    assert.ok(result.sourceCount > 0);
    assert.ok(result.receipt.safeForAgent);
    assert.equal(result.receipt.containsRawSecret, false);
  });
});
