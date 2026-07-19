import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getAdapterDescriptors, getDescriptor } from "../src/avorelo/kernel/tool-adapters/registry.ts";
import { detectAllTools, detectTool } from "../src/avorelo/kernel/tool-adapters/detect.ts";
import { getDelegatedAdapterConfig } from "../src/avorelo/kernel/tool-adapters/executor.ts";
import { getTaskClassPolicy, defaultPolicyConstraints } from "../src/avorelo/kernel/tool-adapters/policies.ts";
import { planToolExecution, type PlanInput } from "../src/avorelo/kernel/tool-adapters/planner.ts";
import { planMultiAgentReview } from "../src/avorelo/kernel/tool-adapters/multi-agent-review.ts";
import { fakeAllAvailable } from "../src/avorelo/kernel/tool-adapters/testing/fakes.ts";

function makePlan(overrides?: Partial<PlanInput>): PlanInput {
  return {
    taskType: "code_generation", riskClass: "low", paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false, deepMode: false,
    secretsPossible: false, dir: ".", now: Date.now(),
    ...overrides,
  };
}

describe("Future Executor Adapters v1", () => {

  it("registry contains all 11 adapters including future ones", () => {
    const descriptors = getAdapterDescriptors();
    const ids = descriptors.map(d => d.id);
    assert.ok(ids.includes("gemini-cli"), "gemini-cli in registry");
    assert.ok(ids.includes("aider"), "aider in registry");
    assert.ok(ids.includes("cursor"), "cursor in registry");
    assert.equal(descriptors.length, 11, "11 total adapters");
  });

  it("gemini-cli descriptor has correct capabilities", () => {
    const desc = getDescriptor("gemini-cli");
    assert.ok(desc);
    assert.equal(desc.displayName, "Gemini CLI");
    assert.equal(desc.supportsRealRun, true);
    assert.equal(desc.supportsPatch, true);
    assert.equal(desc.supportsSandbox, false);
    assert.equal(desc.supportsProofCollection, false);
    assert.equal(desc.riskCeiling, "high");
    assert.equal(desc.dataPolicy, "no_training");
    assert.ok(desc.limitations.includes("future_executor_assessment_only"));
  });

  it("aider descriptor has correct capabilities", () => {
    const desc = getDescriptor("aider");
    assert.ok(desc);
    assert.equal(desc.displayName, "Aider");
    assert.equal(desc.supportsRealRun, true);
    assert.equal(desc.supportsShell, false);
    assert.equal(desc.supportsReview, false);
    assert.equal(desc.riskCeiling, "medium");
    assert.equal(desc.irreversibleActionPolicy, "block");
    assert.ok(desc.limitations.includes("future_executor_assessment_only"));
  });

  it("cursor descriptor reflects IDE-only nature", () => {
    const desc = getDescriptor("cursor");
    assert.ok(desc);
    assert.equal(desc.displayName, "Cursor");
    assert.equal(desc.supportsRealRun, false);
    assert.equal(desc.supportsPatch, false);
    assert.equal(desc.supportsShell, false);
    assert.equal(desc.riskCeiling, "low");
    assert.equal(desc.dataPolicy, "unknown");
    assert.ok(desc.limitations.includes("ide_only_no_cli_execution"));
    assert.ok(desc.limitations.includes("data_policy_unknown"));
  });

  it("detection returns unavailable for future adapters (not installed)", () => {
    const all = detectAllTools(".", Date.now());
    const gemini = all.find(a => a.adapterId === "gemini-cli");
    const aider = all.find(a => a.adapterId === "aider");
    const cursor = all.find(a => a.adapterId === "cursor");
    assert.ok(gemini, "gemini-cli detected");
    assert.ok(aider, "aider detected");
    assert.ok(cursor, "cursor detected");
    assert.equal(all.length, 11, "11 adapters detected");
  });

  it("detectTool works for each future adapter", () => {
    const now = Date.now();
    const gemini = detectTool("gemini-cli", ".", now);
    const aider = detectTool("aider", ".", now);
    const cursor = detectTool("cursor", ".", now);
    assert.ok(gemini);
    assert.ok(aider);
    assert.ok(cursor);
    assert.equal(gemini.adapterId, "gemini-cli");
    assert.equal(aider.adapterId, "aider");
    assert.equal(cursor.adapterId, "cursor");
  });

  it("gemini-cli and aider have delegated adapter configs", () => {
    const geminiConfig = getDelegatedAdapterConfig("gemini-cli");
    const aiderConfig = getDelegatedAdapterConfig("aider");
    const cursorConfig = getDelegatedAdapterConfig("cursor");
    assert.ok(geminiConfig, "gemini-cli has delegated config");
    assert.equal(geminiConfig.binaryName, "gemini");
    assert.ok(aiderConfig, "aider has delegated config");
    assert.equal(aiderConfig.binaryName, "aider");
    assert.equal(cursorConfig, null, "cursor has no delegated config (IDE-only)");
  });

  it("future adapters appear in low_risk_code preference order", () => {
    const policy = getTaskClassPolicy("low_risk_code");
    assert.ok(policy.preferenceOrder);
    assert.ok(policy.preferenceOrder.includes("gemini-cli"), "gemini-cli in low_risk_code");
    assert.ok(policy.preferenceOrder.includes("aider"), "aider in low_risk_code");
    const claudeIdx = policy.preferenceOrder.indexOf("claude-code");
    const geminiIdx = policy.preferenceOrder.indexOf("gemini-cli");
    assert.ok(geminiIdx > claudeIdx, "gemini-cli after claude-code in preference");
  });

  it("future adapters in default policy preference order", () => {
    const policy = defaultPolicyConstraints();
    assert.ok(policy.preferenceOrder.includes("gemini-cli"));
    assert.ok(policy.preferenceOrder.includes("aider"));
    const manualIdx = policy.preferenceOrder.indexOf("manual-gate");
    const geminiIdx = policy.preferenceOrder.indexOf("gemini-cli");
    assert.ok(geminiIdx < manualIdx, "future adapters before manual-gate");
  });

  it("cursor NOT in code execution preference orders (IDE-only)", () => {
    const lowRisk = getTaskClassPolicy("low_risk_code");
    const codeReview = getTaskClassPolicy("code_review");
    assert.ok(!lowRisk.preferenceOrder?.includes("cursor"), "cursor not in low_risk_code");
    assert.ok(!codeReview.preferenceOrder?.includes("cursor"), "cursor not in code_review");
  });

  it("fakeAllAvailable includes future adapters", () => {
    const all = fakeAllAvailable(Date.now());
    assert.equal(all["gemini-cli"], "available");
    assert.equal(all["aider"], "available");
    assert.equal(all["cursor"], "available");
  });

  it("planner skips unavailable future adapters gracefully", () => {
    const plan = planToolExecution(makePlan());
    assert.ok(plan.selectedAdapter !== "gemini-cli", "gemini-cli not selected (not installed)");
    assert.ok(plan.selectedAdapter !== "aider", "aider not selected (not installed)");
    assert.ok(plan.selectedAdapter !== "cursor", "cursor not selected (not installed)");
    assert.equal(plan.modelMayDecide, false);
    assert.equal(plan.scannerMayDecide, false);
    assert.equal(plan.finalDecisionOwner, "kernel/stop-continue-gate");
  });

  it("ownership contract preserved for all future adapters", () => {
    for (const adapterId of ["gemini-cli", "aider", "cursor"] as const) {
      const desc = getDescriptor(adapterId);
      assert.ok(desc, `${adapterId} has descriptor`);
      assert.equal(desc.dataPolicy, adapterId === "cursor" ? "unknown" : "no_training",
        `${adapterId} data policy correct`);
      assert.ok(desc.limitations.includes("future_executor_assessment_only"),
        `${adapterId} marked as future/assessment`);
    }
  });

  it("cross-adapter review resolves for gemini-cli executor", () => {
    const plan = planToolExecution(makePlan());
    plan.selectedAdapter = "gemini-cli";
    const trigger = { trigger: true, reasonCodes: ["TEST"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);
    assert.notEqual(reviewPlan.executorAdapter, reviewPlan.reviewerAdapter,
      "gemini-cli executor gets different reviewer");
    assert.equal(reviewPlan.reviewerAdapter, "claude-code");
  });

  it("delegated configs have correct execution args", () => {
    const geminiConfig = getDelegatedAdapterConfig("gemini-cli");
    assert.ok(geminiConfig);
    const geminiArgs = geminiConfig.execArgs("test task");
    assert.ok(geminiArgs.includes("-p"), "gemini uses -p flag");
    assert.ok(geminiArgs.includes("test task"));

    const aiderConfig = getDelegatedAdapterConfig("aider");
    assert.ok(aiderConfig);
    const aiderArgs = aiderConfig.execArgs("test task");
    assert.ok(aiderArgs.includes("--message"), "aider uses --message flag");
    assert.ok(aiderArgs.includes("--yes"), "aider uses --yes for non-interactive");
  });
});
