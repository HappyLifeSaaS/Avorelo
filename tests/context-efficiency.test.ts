import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildAndPersistContextEfficiencyBrief,
  buildContextEfficiencyBrief,
  buildContextEfficiencyPathCheck,
  loadLatestContextEfficiencyBrief,
} from "../src/avorelo/capabilities/context-efficiency/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-context-efficiency-"));
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "context-efficiency"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "docs", "release"), { recursive: true });
  mkdirSync(join(dir, ".avorelo", "runtime"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "README.md"), "# Sandbox\n");
  writeFileSync(join(dir, "tests", "context-efficiency.test.ts"), "test file");
  writeFileSync(join(dir, "tests", "context-efficiency-cli.test.ts"), "cli test file");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "pricing.html"), "<html></html>");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "dashboard.html"), "<html></html>");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "context-efficiency", "index.ts"), "export const ok = true;\n");
  writeFileSync(join(dir, "src", "private-source.ts"), "const topSecret = 'raw source should not be copied';\n");
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

test("creates a work brief from a task description and infers feature development", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const brief = buildContextEfficiencyBrief({ dir, task: "build support for context efficiency work brief" });
    assert.equal(brief.contract, "avorelo.contextEfficiencyBrief.v1");
    assert.equal(brief.workType, "feature_development");
    assert.ok(brief.sourceOfTruthPaths.length > 0);
    assert.equal(brief.containsRawPrompt, false);
  } finally {
    cleanup(dir);
  }
});

test("infers bug fix and dashboard UX work types", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const bugFix = buildContextEfficiencyBrief({ dir, task: "fix regression in src/util/formatter.ts" });
    const dashboardUx = buildContextEfficiencyBrief({ dir, task: "update dashboard settings layout and UX copy" });
    assert.equal(bugFix.workType, "bug_fix");
    assert.equal(dashboardUx.workType, "dashboard_ux");
    assert.equal(dashboardUx.decisionState, "NEEDS_REVIEW");
  } finally {
    cleanup(dir);
  }
});

test("generated output and runtime artifacts are excluded from context/editing", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const generated = buildContextEfficiencyPathCheck(dir, "dist/site/index.html");
    const runtime = buildContextEfficiencyPathCheck(dir, ".avorelo/runtime/session.latest.json");
    assert.equal(generated.recommendation, "exclude");
    assert.equal(runtime.recommendation, "exclude");
    assert.ok(generated.summary.toLowerCase().includes("generated output"));
    assert.ok(runtime.summary.toLowerCase().includes("runtime artifacts"));
  } finally {
    cleanup(dir);
  }
});

test("release-owned and billing-sensitive paths are blocked or reviewed", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const releasePath = buildContextEfficiencyPathCheck(dir, "docs/release/runbook.md");
    const billingPath = buildContextEfficiencyPathCheck(dir, "src/avorelo/adapters/lemon-squeezy/checkout-api.ts");
    assert.equal(releasePath.decisionState, "BLOCKED");
    assert.equal(billingPath.decisionState, "NEEDS_REVIEW");
    assert.equal(billingPath.recommendation, "requires_user_confirmation");
  } finally {
    cleanup(dir);
  }
});

test("public site work recommends public-web validation commands", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const brief = buildContextEfficiencyBrief({ dir, task: "update public web pricing page copy" });
    const commands = brief.validation.commands.map((item) => item.command);
    assert.equal(brief.workType, "public_site");
    assert.ok(commands.includes("npm run build:site"));
    assert.ok(commands.includes("npm run site:check"));
  } finally {
    cleanup(dir);
  }
});

test("capability source paths recommend targeted CLI and capability tests", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const check = buildContextEfficiencyPathCheck(dir, "src/avorelo/capabilities/context-efficiency/index.ts");
    const commands = check.validation.commands.map((item) => item.command);
    assert.ok(commands.includes("node --test tests/context-efficiency.test.ts"));
    assert.ok(commands.includes("node --test tests/context-efficiency-cli.test.ts"));
  } finally {
    cleanup(dir);
  }
});

test("context budget defers lower-priority context and keeps safety flags false", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const brief = buildContextEfficiencyBrief({
      dir,
      task: "inspect README.md docs/guide.md tests/context-efficiency.test.ts src/avorelo/capabilities/context-efficiency/index.ts src/avorelo/surfaces/public-web/static/pricing.html src/avorelo/kernel/work-controls/index.ts",
    });
    assert.ok(brief.contextPlan.deferUntilNeeded.length >= 1);
    assert.equal(brief.containsRawSource, false);
    assert.equal(brief.containsRawEnvValue, false);
    assert.equal(brief.containsRawCustomerData, false);
    assert.equal(brief.contentStorageClass, "safe_metadata_only");
  } finally {
    cleanup(dir);
  }
});

test("persists latest brief safely without raw source contents", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const { path } = buildAndPersistContextEfficiencyBrief({
      dir,
      task: "review src/private-source.ts for alice@example.com using https://example.com with API_TOKEN=abc123 from C:\\Users\\alice\\secret.txt",
    });
    const stored = readFileSync(path, "utf8");
    assert.ok(!stored.includes("const topSecret"));
    assert.ok(!stored.includes("alice@example.com"));
    assert.ok(!stored.includes("https://example.com"));
    assert.ok(!stored.includes("API_TOKEN=abc123"));
    const latest = loadLatestContextEfficiencyBrief(dir)!;
    assert.equal(latest.containsRawPrompt, false);
    assert.equal(latest.containsRawDiff, false);
    assert.equal(latest.containsRawScreenshot, false);
  } finally {
    cleanup(dir);
  }
});

test("work-controls integration adds context-efficiency capability evidence without a second router", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const brief = buildContextEfficiencyBrief({ dir, task: "update public web pricing page copy" });
    assert.ok(brief.workControls.selectedCapabilities.includes("context-efficiency"));
    assert.ok(brief.workControls.expectedEvidence.includes("context_efficiency_brief"));
    assert.ok(!brief.workControls.selectedCapabilities.includes("control-center"));
  } finally {
    cleanup(dir);
  }
});

test("workspace map compatibility stays a fallback seam and dashboard path overlap is review-only", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const brief = buildContextEfficiencyBrief({ dir, task: "update dashboard settings layout" });
    const dashboard = buildContextEfficiencyPathCheck(dir, "src/avorelo/surfaces/public-web/static/dashboard.html");
    assert.equal(brief.workspaceMapCompatibility.workspaceMapAvailable, false);
    assert.ok(brief.workspaceMapCompatibility.notes.some((note) => note.includes("No standalone Workspace Map")));
    assert.equal(dashboard.decisionState, "NEEDS_REVIEW");
    assert.ok(dashboard.summary.toLowerCase().includes("separate ux lane"));
  } finally {
    cleanup(dir);
  }
});
