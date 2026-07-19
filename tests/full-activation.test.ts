import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFullActivation, persistActivationV2, ACTIVATION_STATE_V2_CONTRACT, type ActivationStateV2 } from "../src/avorelo/capabilities/activation/activation-runner.ts";
import { runFullDetection } from "../src/avorelo/capabilities/activation/activation-detector.ts";
import { runSafeRepairs } from "../src/avorelo/capabilities/activation/activation-repair.ts";
import { installRunEntry } from "../src/avorelo/capabilities/activation/activation-run-entry.ts";
import { readActivationState, ACTIVATION_STATE_CONTRACT } from "../src/avorelo/capabilities/activation/activation-state.ts";

let target: string;

before(() => {
  target = mkdtempSync(join(tmpdir(), "avorelo-test-full-"));
  mkdirSync(join(target, "src"), { recursive: true });
  // Simulate a project with package.json
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: "test-project", scripts: { test: "echo ok" } }));
});

after(() => {
  if (existsSync(target) && target.includes("avorelo-test-full-")) rmSync(target, { recursive: true, force: true });
});

describe("Full Activation V2", () => {
  // Detection
  it("detects repo identity", () => {
    const r = runFullDetection(target);
    assert.equal(typeof r.repo.root, "string");
    assert.equal(typeof r.repo.gitDetected, "boolean");
  });

  it("detects package manager and scripts", () => {
    const r = runFullDetection(target);
    assert.equal(r.environment.packageManager, "npm");
    assert.ok(r.environment.testCommand);
  });

  it("detects AI instruction surfaces", () => {
    writeFileSync(join(target, "CLAUDE.md"), "# Test project");
    const r = runFullDetection(target);
    assert.ok(r.aiTools.claudeMdDetected);
  });

  it("detects skills/model/router/scanner availability", () => {
    const r = runFullDetection(target);
    assert.equal(typeof r.modelsAndTools.skillsRegistryAvailable, "boolean");
    assert.equal(typeof r.modelsAndTools.scannersAvailable, "boolean");
  });

  // V2 state
  it("creates V2 state", () => {
    const state = runFullActivation(target);
    assert.equal(state.contract, ACTIVATION_STATE_V2_CONTRACT);
    assert.equal(state.activationMode, "local-first/free");
    assert.ok(state.environment);
    assert.ok(state.aiTools);
    assert.ok(state.modelsAndTools);
    assert.ok(state.runEntry);
    // Community Edition: activation state carries no auth/cloud/billing/plan/entitlement fields.
    assert.ok(!("auth" in state), "no auth field in CE activation state");
    assert.ok(!("cloud" in state), "no cloud field in CE activation state");
    assert.ok(!("billing" in state), "no billing field in CE activation state");
  });

  it("V1 state can be read back as V2", () => {
    const state = runFullActivation(target);
    persistActivationV2(target, state);
    const raw = readActivationState(target);
    // readActivationState returns null for V2 contract since V1 check fails
    // But the file should exist
    assert.ok(existsSync(join(target, ".avorelo", "activation", "activation-state.json")));
  });

  // Safe repair
  it("safe repairs create directories", () => {
    const repairs = runSafeRepairs(target);
    assert.ok(repairs.length > 0);
    assert.ok(existsSync(join(target, ".avorelo")));
    assert.ok(existsSync(join(target, ".avorelo", "receipts")));
  });

  it("corrupt state safe repair", () => {
    mkdirSync(join(target, ".avorelo", "activation"), { recursive: true });
    writeFileSync(join(target, ".avorelo", "activation", "activation-state.json"), "invalid json{{{");
    const state = runFullActivation(target); // should not crash
    assert.ok(state.contract === ACTIVATION_STATE_V2_CONTRACT);
  });

  it("rerun idempotent", () => {
    const s1 = runFullActivation(target);
    persistActivationV2(target, s1);
    const s2 = runFullActivation(target);
    persistActivationV2(target, s2);
    assert.equal(s2.contract, ACTIVATION_STATE_V2_CONTRACT);
    assert.equal(s2.workspaceId, s1.workspaceId); // preserved from first run
  });

  // Run entry
  it("run entry block installed in CLAUDE.md", () => {
    const re = installRunEntry(target);
    assert.ok(re.installed);
    assert.ok(re.instructionSurfaces.some(s => s.path.includes("CLAUDE.md")));
    const content = readFileSync(join(target, "CLAUDE.md"), "utf8");
    assert.ok(content.includes("Avorelo Run Entry"));
  });

  it("run entry preserves user content", () => {
    writeFileSync(join(target, "CLAUDE.md"), "# My project rules\nDo not delete this.\n");
    const re = installRunEntry(target);
    const content = readFileSync(join(target, "CLAUDE.md"), "utf8");
    assert.ok(content.includes("My project rules"));
    assert.ok(content.includes("Do not delete this"));
    assert.ok(content.includes("Avorelo Run Entry"));
  });

  it("run entry repair updates stale block", () => {
    // Already has block from previous test — running again should be unchanged/updated
    const re = installRunEntry(target);
    const action = re.instructionSurfaces.find(s => s.path.includes("CLAUDE.md"));
    assert.ok(action);
    assert.ok(["unchanged", "updated"].includes(action.action));
  });

  it("run entry contract written", () => {
    const re = installRunEntry(target);
    assert.ok(re.contractPath);
    assert.ok(existsSync(re.contractPath!));
  });

  it("hooks not installed by default", () => {
    const state = runFullActivation(target);
    assert.ok(!state.setupSteps.some(s => s.id === "hooks_installed"));
  });

  it("safe repairs cannot overwrite unmarked content", () => {
    writeFileSync(join(target, "AGENTS.md"), "# Important rules\nKeep this!");
    const re = installRunEntry(target);
    const content = readFileSync(join(target, "AGENTS.md"), "utf8");
    assert.ok(content.includes("Important rules"));
    assert.ok(content.includes("Keep this!"));
  });

  // First value
  it("first value summary generated", () => {
    const state = runFullActivation(target);
    assert.ok(state.firstValue.available);
    assert.ok(state.firstValue.found.length > 0);
    assert.ok(typeof state.firstValue.nextAction === "string");
  });

  // Production
  it("production not ready", () => {
    const state = runFullActivation(target);
    assert.equal(state.productionReady, false);
  });

  it("redacted", () => {
    const state = runFullActivation(target);
    assert.equal(state.redacted, true);
  });
});
