import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAndPersistContextEfficiencyBrief } from "../src/avorelo/capabilities/context-efficiency/index.ts";
import {
  buildAndPersistModelRoutingInputProfile,
  buildModelRoutingInputPathCheck,
  buildModelRoutingInputProfile,
  loadLatestModelRoutingInputProfile,
} from "../src/avorelo/capabilities/model-routing-input/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-model-routing-input-"));
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "model-routing-input"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "tests", "model-routing-input.test.ts"), "test file");
  writeFileSync(join(dir, "tests", "model-routing-input-cli.test.ts"), "cli test file");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "model-routing-input", "index.ts"), "export const ok = true;\n");
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

test("model routing input profile stays metadata-only for a normal task", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const profile = buildModelRoutingInputProfile({ dir, task: "add metadata-only routing profile tests" });
    assert.equal(profile.contract, "avorelo.modelRoutingInputProfile.v1");
    assert.equal(profile.containsRawPrompt, false);
    assert.equal(profile.containsRawSource, false);
    assert.equal(profile.containsProviderPayload, false);
    assert.equal(profile.contentStorageClass, "safe_metadata_only");
    assert.ok(["standard_reasoning", "deep_reasoning", "guarded_high_risk"].includes(profile.recommendedMode));
  } finally {
    cleanup(dir);
  }
});

test("model routing input can consume the latest context-efficiency brief", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "add metadata-only routing profile support" });
    const { path } = buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    const latest = loadLatestModelRoutingInputProfile(dir);
    assert.ok(existsSync(path));
    assert.ok(latest);
    assert.equal(latest?.taskSource, "context_efficiency_latest");
    assert.equal(latest?.contextEfficiency.source, "latest_brief");
  } finally {
    cleanup(dir);
  }
});

test("sensitive billing tasks require human review mode", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const profile = buildModelRoutingInputProfile({ dir, task: "update billing webhook and payment entitlement handling" });
    assert.equal(profile.recommendedMode, "human_review_required");
    assert.equal(profile.sensitivities.billingOrEntitlement, true);
  } finally {
    cleanup(dir);
  }
});

test("release-oriented tasks are blocked needs decision", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const profile = buildModelRoutingInputProfile({ dir, task: "prepare production deploy and release notes" });
    assert.equal(profile.recommendedMode, "blocked_needs_decision");
    assert.equal(profile.sensitivities.productionOrRelease, true);
  } finally {
    cleanup(dir);
  }
});

test("path check redirects generated output away from AI work", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const check = buildModelRoutingInputPathCheck(dir, "dist/site/index.html");
    assert.equal(check.contract, "avorelo.modelRoutingInputPathCheck.v1");
    assert.equal(check.recommendedMode, "blocked_needs_decision");
    assert.equal(check.containsRawSource, false);
    assert.equal(check.containsProviderPayload, false);
  } finally {
    cleanup(dir);
  }
});
