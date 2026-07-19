import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAndPersistContextEfficiencyBrief } from "../src/avorelo/capabilities/context-efficiency/index.ts";
import { buildAndPersistModelRoutingInputProfile } from "../src/avorelo/capabilities/model-routing-input/index.ts";
import { buildAndPersistWorkflowRadarAssessment } from "../src/avorelo/capabilities/workflow-radar/index.ts";
import {
  buildAndPersistSessionContinuityHandoff,
  buildSessionContinuityHandoff,
  buildSessionContinuityPathCheck,
  loadLatestSessionContinuityHandoff,
} from "../src/avorelo/capabilities/session-continuity/index.ts";
import { buildProofReport, writeProofReport } from "../src/avorelo/capabilities/proof-report/index.ts";
import { persistReceipt } from "../src/avorelo/kernel/receipts/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-session-continuity-"));
}

function runGit(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function seedRepo(dir: string, options: { dependency?: boolean } = {}): void {
  const dependency = options.dependency ?? false;
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "session-continuity"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy"), { recursive: true });
  mkdirSync(join(dir, "docs", "release"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, ".avorelo", "runtime"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "README.md"), "# Sandbox\n");
  writeFileSync(join(dir, "src", "feature.ts"), "export const feature = true;\n");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = true;\n");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "session-continuity", "index.ts"), "export const sessionContinuity = true;\n");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "settings.html"), "<html></html>\n");
  writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = true;\n");
  writeFileSync(join(dir, "docs", "release", "runbook.md"), "release\n");
  writeFileSync(join(dir, "tests", "session-continuity.test.ts"), "test\n");
  writeFileSync(join(dir, "tests", "session-continuity-cli.test.ts"), "test\n");
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "tests@example.com"]);
  runGit(dir, ["config", "user.name", "Tests"]);
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-m", "initial"]);
  const planningBase = runGit(dir, ["rev-parse", "HEAD"]);

  writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
  runGit(dir, ["add", "src/avorelo/capabilities/workflow-radar/index.ts"]);
  runGit(dir, ["commit", "-m", "workflow base"]);
  const workflowBase = runGit(dir, ["rev-parse", "HEAD"]);

  runGit(dir, ["checkout", "-b", "feature/session-continuity-smart-handoff"]);
  runGit(dir, ["update-ref", "refs/remotes/origin/planning/architecture-approval-v1", planningBase]);
  if (dependency) {
    runGit(dir, ["update-ref", "refs/remotes/origin/feature/workflow-intelligence-radar", workflowBase]);
    runGit(dir, ["update-ref", "refs/remotes/origin/feature/model-routing-input-layer", planningBase]);
  }
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function writeProofFixture(dir: string): void {
  const report = buildProofReport({
    verified: [{ code: "VALIDATED", title: "Validated", summary: "Focused validation completed." }],
  });
  writeProofReport(dir, report);
}

function writeReceiptFixture(dir: string): void {
  persistReceipt(dir, {
    receiptId: "rcpt_session_continuity",
    contractId: "session-continuity",
    decision: "STOP_DONE",
    evidenceLevels: ["OUTCOME", "POST_ACTION"],
    evidenceRefs: ["ev:outcome", "ev:post_action"],
    safeNextActions: ["handoff"],
    decisionBasis: {
      method: "deterministic",
      confidence: "HIGH",
      evidenceRefs: ["ev:outcome", "ev:post_action"],
      reasonCodes: ["SESSION_CONTINUITY"],
      fallbackUsed: false,
    },
    redactionClasses: [],
    receiptDigest: "digest123",
    sampleSize: 1,
    writtenAt: Date.now(),
    redaction: "applied",
  });
}

test("creates a conservative safe-metadata handoff when prior artifacts are missing", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const handoff = buildSessionContinuityHandoff({ dir, task: "add metadata-only session handoff support" });
    assert.equal(handoff.contract, "avorelo.sessionContinuityHandoff.v1");
    assert.equal(handoff.workflowRadar.source, "generated_fallback");
    assert.equal(handoff.containsRawPrompt, false);
    assert.equal(handoff.containsFullTranscript, false);
    assert.notEqual(handoff.decisionState, "BLOCKED");
  } finally {
    cleanup(dir);
  }
});

test("consumes latest Context Efficiency, Model Routing Input, and Workflow Radar artifacts when available", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    buildAndPersistContextEfficiencyBrief({ dir, task: "add session continuity handoff support" });
    buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    buildAndPersistWorkflowRadarAssessment({ dir, fromContextBrief: true });
    const handoff = buildSessionContinuityHandoff({ dir, fromWorkflowRadar: true });
    assert.equal(handoff.contextBrief.source, "latest_brief");
    assert.equal(handoff.modelRouting.source, "latest_profile");
    assert.equal(handoff.workflowRadar.source, "latest_assessment");
    assert.ok(handoff.reasonCodes.includes("SESSION_CONTINUITY_CONTEXT_BRIEF_USED"));
    assert.ok(handoff.reasonCodes.includes("SESSION_CONTINUITY_MODEL_ROUTING_USED"));
    assert.ok(handoff.reasonCodes.includes("SESSION_CONTINUITY_WORKFLOW_RADAR_USED"));
  } finally {
    cleanup(dir);
  }
});

test("dependent branches wait for dependency merge without blocking handoff generation", () => {
  const dir = sandbox();
  try {
    seedRepo(dir, { dependency: true });
    const handoff = buildSessionContinuityHandoff({ dir, task: "continue session continuity workstream" });
    assert.equal(handoff.worktree.dependency.selectedBase, "origin/feature/workflow-intelligence-radar");
    assert.equal(handoff.continuationMode, "wait_for_dependency_merge");
    assert.equal(handoff.recommendedNextAction, "retarget_or_rebase_after_dependency_merge");
    assert.equal(handoff.worktree.dependency.dependentBranchDetected, true);
    assert.ok(handoff.dependencyNotes.some((note) => note.includes("workflow-intelligence-radar")));
  } finally {
    cleanup(dir);
  }
});

test("changed paths are summarized by path name only and exclude raw source or diffs from the prompt", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const handoff = buildSessionContinuityHandoff({ dir, task: "update session continuity capability" });
    const serialized = JSON.stringify(handoff);
    assert.ok(handoff.changedPaths.relevantPaths.includes("src/feature.ts"));
    assert.ok(handoff.continuationPrompt.includes("feature/session-continuity-smart-handoff"));
    assert.ok(handoff.continuationPrompt.includes("src/feature.ts"));
    assert.equal(serialized.includes("export const feature = false"), false);
    assert.equal(handoff.continuationPrompt.includes("export const feature = false"), false);
    assert.equal(handoff.continuationPrompt.includes("provider_payload"), false);
  } finally {
    cleanup(dir);
  }
});

test("generated, runtime, release, billing, auth, and secret-sensitive paths become do-not-touch boundaries", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    mkdirSync(join(dir, "dist", "site"), { recursive: true });
    writeFileSync(join(dir, "dist", "site", "index.html"), "generated\n");
    writeFileSync(join(dir, ".avorelo", "runtime", "session.latest.json"), JSON.stringify({ ok: true }));
    writeFileSync(join(dir, "docs", "release", "runbook.md"), "changed\n");
    writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = false;\n");
    writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "settings.html"), "<html>changed</html>\n");
    writeFileSync(join(dir, ".env.local"), "API_TOKEN=abc123\n");
    const handoff = buildSessionContinuityHandoff({ dir, task: "update session continuity capability" });
    assert.equal(handoff.safeToContinue, false);
    assert.equal(handoff.decisionState, "BLOCKED");
    assert.ok(handoff.doNotTouch.includes("dist/site/index.html"));
    assert.ok(handoff.doNotTouch.includes(".avorelo/runtime/session.latest.json"));
    assert.ok(handoff.doNotTouch.includes("docs/release/runbook.md"));
    assert.ok(handoff.doNotTouch.includes("src/avorelo/adapters/lemon-squeezy/checkout-api.ts"));
    assert.ok(handoff.doNotTouch.includes("src/avorelo/surfaces/public-web/static/settings.html"));
    assert.ok(handoff.doNotTouch.includes(".env.local"));
  } finally {
    cleanup(dir);
  }
});

test("validation and evidence gaps are surfaced before continue_work becomes safe", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "add session continuity handoff support" });
    buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");

    const validationMissing = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    assert.equal(validationMissing.decisionState, "NEEDS_VALIDATION");
    assert.equal(validationMissing.recommendedNextAction, "run_validation");

    writeProofFixture(dir);
    const evidenceMissing = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    assert.equal(evidenceMissing.decisionState, "NEEDS_EVIDENCE");
    assert.equal(evidenceMissing.recommendedNextAction, "produce_receipt");

    writeReceiptFixture(dir);
    const ready = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    assert.ok(["READY_TO_CONTINUE", "READY_WITH_WARNINGS"].includes(ready.decisionState));
    assert.equal(ready.recommendedNextAction, "continue_work");
  } finally {
    cleanup(dir);
  }
});

test("safe clean sessions can recommend summarize_for_next_session", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "review the current session continuity status" });
    buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    buildAndPersistWorkflowRadarAssessment({ dir, fromContextBrief: true });
    const handoff = buildSessionContinuityHandoff({ dir, fromWorkflowRadar: true });
    assert.equal(handoff.continuationMode, "summarize_and_handoff");
    assert.equal(handoff.recommendedNextAction, "summarize_for_next_session");
  } finally {
    cleanup(dir);
  }
});

test("path checks make generated output a do-not-touch handoff boundary", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const check = buildSessionContinuityPathCheck(dir, "dist/site/index.html");
    assert.equal(check.category, "generated_output");
    assert.equal(check.doNotTouch, true);
    assert.equal(check.recommendedNextAction, "summarize_for_next_session");
  } finally {
    cleanup(dir);
  }
});

test("persisted handoff artifacts stay safe metadata only and exclude raw source content", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const built = buildAndPersistSessionContinuityHandoff({ dir, task: "persist a session continuity handoff" });
    const latest = loadLatestSessionContinuityHandoff(dir)!;
    const stored = readFileSync(built.path, "utf8");
    assert.equal(latest.contentStorageClass, "safe_metadata_only");
    assert.equal(latest.containsRawDiff, false);
    assert.equal(latest.containsProviderPayload, false);
    assert.equal(stored.includes("export const feature = false"), false);
    assert.ok(existsSync(built.path));
  } finally {
    cleanup(dir);
  }
});
