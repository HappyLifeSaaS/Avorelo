import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAndPersistContextEfficiencyBrief } from "../src/avorelo/capabilities/context-efficiency/index.ts";
import { buildAndPersistModelRoutingInputProfile } from "../src/avorelo/capabilities/model-routing-input/index.ts";
import {
  buildAndPersistWorkflowRadarAssessment,
  buildWorkflowRadarAssessment,
  buildWorkflowRadarPathCheck,
  loadLatestWorkflowRadarAssessment,
} from "../src/avorelo/capabilities/workflow-radar/index.ts";
import { buildProofReport, writeProofReport } from "../src/avorelo/capabilities/proof-report/index.ts";
import { persistReceipt } from "../src/avorelo/kernel/receipts/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-workflow-radar-"));
}

function runGit(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "docs", "release"), { recursive: true });
  mkdirSync(join(dir, ".avorelo", "runtime"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "README.md"), "# Sandbox\n");
  writeFileSync(join(dir, "src", "feature.ts"), "export const feature = true;\n");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = true;\n");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "dashboard.html"), "<html></html>\n");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "pricing.html"), "<html></html>\n");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "login.html"), "<html></html>\n");
  writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = true;\n");
  writeFileSync(join(dir, "docs", "release", "runbook.md"), "release\n");
  writeFileSync(join(dir, "tests", "workflow-radar.test.ts"), "test\n");
  writeFileSync(join(dir, "tests", "workflow-radar-cli.test.ts"), "test\n");
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "tests@example.com"]);
  runGit(dir, ["config", "user.name", "Tests"]);
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-m", "initial"]);
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
    receiptId: "rcpt_workflow_radar",
    contractId: "workflow-radar",
    decision: "STOP_DONE",
    evidenceLevels: ["OUTCOME", "POST_ACTION"],
    evidenceRefs: ["ev:outcome", "ev:post_action"],
    safeNextActions: ["handoff"],
    decisionBasis: {
      method: "deterministic",
      confidence: "HIGH",
      evidenceRefs: ["ev:outcome", "ev:post_action"],
      reasonCodes: ["WORKFLOW_RADAR"],
      fallbackUsed: false,
    },
    redactionClasses: [],
    receiptDigest: "abc123digest",
    sampleSize: 1,
    writtenAt: Date.now(),
    redaction: "applied",
  });
}

test("creates a conservative workflow assessment with no prior artifacts", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const assessment = buildWorkflowRadarAssessment({ dir });
    assert.equal(assessment.contract, "avorelo.workflowRadar.v1");
    assert.equal(assessment.contextBrief.available, false);
    assert.equal(assessment.modelRouting.available, false);
    assert.ok(assessment.warnings.some((warning) => warning.includes("Context Efficiency brief is missing")));
    assert.notEqual(assessment.decisionState, "BLOCKED");
  } finally {
    cleanup(dir);
  }
});

test("consumes Context Efficiency brief and Model Routing Input profile when available", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    buildAndPersistContextEfficiencyBrief({ dir, task: "update workflow radar capability" });
    buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    const assessment = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    assert.equal(assessment.contextBrief.source, "latest_brief");
    assert.equal(assessment.modelRouting.source, "latest_profile");
    assert.equal(assessment.expectedScope.available, true);
  } finally {
    cleanup(dir);
  }
});

test("missing Context Efficiency brief and model profile stay warnings, not fatal", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const assessment = buildWorkflowRadarAssessment({ dir });
    assert.ok(assessment.warnings.some((warning) => warning.includes("Context Efficiency brief is missing")));
    assert.ok(assessment.warnings.some((warning) => warning.includes("Model Routing Input profile is missing")));
    assert.notEqual(assessment.decisionState, "UNAVAILABLE");
  } finally {
    cleanup(dir);
  }
});

test("generated output and runtime artifacts are flagged as drift or warning paths", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "update workflow radar capability" });
    mkdirSync(join(dir, "dist", "site"), { recursive: true });
    writeFileSync(join(dir, "dist", "site", "index.html"), "generated\n");
    writeFileSync(join(dir, ".avorelo", "runtime", "session.latest.json"), JSON.stringify({ ok: true }));
    const assessment = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    assert.ok(assessment.changedPaths.generatedOutputCount >= 1);
    assert.ok(assessment.changedPaths.runtimeArtifactCount >= 1);
    assert.ok(["DRIFT_DETECTED", "ON_TRACK_WITH_WARNINGS", "NEEDS_REVIEW"].includes(assessment.decisionState));
  } finally {
    cleanup(dir);
  }
});

test("release, billing, auth, and secret-sensitive paths require review or block", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "update workflow radar capability" });
    writeFileSync(join(dir, "docs", "release", "runbook.md"), "changed\n");
    writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = false;\n");
    writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "login.html"), "<html>changed</html>\n");
    writeFileSync(join(dir, ".env.local"), "API_TOKEN=abc123\n");
    const assessment = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    assert.ok(["BLOCKED", "NEEDS_REVIEW"].includes(assessment.decisionState));
    assert.equal(assessment.humanReviewRequired, true);
    assert.ok(assessment.reasonCodes.includes("WORKFLOW_RADAR_BILLING_SCOPE_REVIEW") || assessment.reasonCodes.includes("WORKFLOW_RADAR_SECRET_SCOPE_REVIEW"));
  } finally {
    cleanup(dir);
  }
});

test("missing validation becomes NEEDS_EVIDENCE and evidence gaps can recommend produce_receipt", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "update workflow radar capability" });
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    const validationMissing = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    assert.equal(validationMissing.decisionState, "NEEDS_EVIDENCE");
    assert.equal(validationMissing.recommendedNextAction, "run_validation");

    writeProofFixture(dir);
    const evidenceMissing = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    assert.equal(evidenceMissing.decisionState, "NEEDS_EVIDENCE");
    assert.equal(evidenceMissing.recommendedNextAction, "produce_receipt");
  } finally {
    cleanup(dir);
  }
});

test("work mode mismatch and risky drift are surfaced", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "update workflow radar capability" });
    buildAndPersistModelRoutingInputProfile({ dir, task: "update README documentation" });
    writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = false;\n");
    const assessment = buildWorkflowRadarAssessment({ dir });
    assert.equal(assessment.modelRouting.modeConsistent, false);
    assert.ok(assessment.signals.some((signal) => signal.type === "work_mode_mismatch"));
  } finally {
    cleanup(dir);
  }
});

test("clean low-risk on-track work recommends continue_work when validation and receipts exist", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "update workflow radar capability" });
    buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    writeProofFixture(dir);
    writeReceiptFixture(dir);
    const assessment = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    assert.ok(["ON_TRACK", "ON_TRACK_WITH_WARNINGS"].includes(assessment.decisionState));
    assert.equal(assessment.recommendedNextAction, "continue_work");
  } finally {
    cleanup(dir);
  }
});

test("path checks are actionable and persisted artifacts stay safe metadata only", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const built = buildAndPersistWorkflowRadarAssessment({
      dir,
      task: "review API_TOKEN=abc123 and https://example.com before updating workflow radar capability",
    });
    const latest = loadLatestWorkflowRadarAssessment(dir)!;
    const stored = readFileSync(built.path, "utf8");
    const check = buildWorkflowRadarPathCheck(dir, "docs/release/runbook.md");
    assert.equal(latest.containsRawPrompt, false);
    assert.equal(latest.containsProviderPayload, false);
    assert.equal(latest.contentStorageClass, "safe_metadata_only");
    assert.ok(!stored.includes("API_TOKEN=abc123"));
    assert.ok(!stored.includes("https://example.com"));
    assert.equal(check.contract, "avorelo.workflowRadarPathCheck.v1");
    assert.ok(check.safeNextAction.length > 0);
  } finally {
    cleanup(dir);
  }
});
