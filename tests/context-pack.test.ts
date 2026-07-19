import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContextPack,
  buildContextPackSyncMetadata,
  compileContext,
  loadLatestContextPack,
} from "../src/avorelo/capabilities/context-compiler/index.ts";
import { runRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";
import { buildControlCenter } from "../src/avorelo/capabilities/control-center/index.ts";

const DIR = process.cwd();
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";

test("1. executor context pack is bounded and redacted", () => {
  const packet = compileContext({ task: `update .env and src/auth/login.ts with ${TOK}`, dir: DIR, createdAt: "2026-06-17T00:00:00.000Z" });
  const pack = buildContextPack({ packet, selectedAdapter: "claude-code", consumer: "executor" });
  assert.equal(pack.contract, "avorelo.contextPack.v1");
  assert.equal(pack.selectedAdapter, "claude-code");
  assert.equal(pack.consumer, "executor");
  assert.equal(pack.redacted, true);
  assert.equal(JSON.stringify(pack).includes(TOK), false);
  assert.ok(pack.forbiddenContext.some((item) => item.reasonCode === "secret_file_excluded"));
});

test("2. reviewer context pack downgrades excerpts to summaries", () => {
  const packet = compileContext({ task: "fix src/util/format.ts and update README", dir: DIR, createdAt: "2026-06-17T00:00:00.000Z" });
  const pack = buildContextPack({
    packet,
    selectedAdapter: "codex",
    consumer: "reviewer",
    reviewerOfAdapter: "claude-code",
    relevantReceipts: ["tpr_test123"],
    sanitizedDiffSummary: "modified 2 files",
  });
  assert.equal(pack.consumer, "reviewer");
  assert.equal(pack.reviewerOfAdapter, "claude-code");
  assert.equal(pack.sanitizedDiffSummary, "modified 2 files");
  assert.ok(pack.toolInstructions.some((line) => /proof and patch summaries only/i.test(line)));
  assert.ok(pack.allowedContext.every((ref) => ref.includeMode !== "excerpt"));
});

test("3. context pack provenance and budget diagnostics exist", () => {
  const packet = compileContext({ task: "run tests in src/auth/login.ts", dir: DIR, createdAt: "2026-06-17T00:00:00.000Z" });
  const pack = buildContextPack({ packet, selectedAdapter: "deterministic-local" });
  assert.ok(pack.provenanceTags.includes("adapter:deterministic-local"));
  assert.ok(pack.provenanceTags.includes("consumer:executor"));
  assert.ok(pack.contextBudgetUsed >= pack.allowedContext.length);
  assert.ok(pack.contextReasonCodes.some((code) => code.startsWith("BUDGET:")));
});

test("4. context pack sync metadata is counts only", () => {
  const packet = compileContext({ task: "update the README", dir: DIR, createdAt: "2026-06-17T00:00:00.000Z" });
  const pack = buildContextPack({ packet, selectedAdapter: "deterministic-local" });
  const sync = buildContextPackSyncMetadata(pack);
  const raw = JSON.stringify(sync);
  assert.equal(sync.contract, "avorelo.contextPack.sync.v1");
  assert.equal((sync as Record<string, unknown>).allowedContext, undefined);
  assert.equal((sync as Record<string, unknown>).toolInstructions, undefined);
  assert.equal(raw.includes("README"), false);
});

test("5. runtime session persists context pack and control-center surfaces it", () => {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-context-pack-"));
  try {
    runRuntimeSession({ task: "update the README wording", dir, createdAt: "2026-06-17T00:00:00.000Z", now: 1760611200000 });
    const pack = loadLatestContextPack(dir);
    assert.ok(pack, "context pack persisted");
    assert.equal(pack?.contract, "avorelo.contextPack.v1");
    const cc = buildControlCenter(dir, { now: 1760611200000 });
    assert.equal(cc.sections.contextPack.status, "available");
    assert.ok((cc.sections.contextPack.allowedCount ?? 0) >= 1);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
