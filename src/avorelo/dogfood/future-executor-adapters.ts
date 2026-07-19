// Dogfood: future executor adapters — verifies Gemini CLI, Aider, Cursor are registered,
// detectable, assessed, and do not break existing adapter orchestration.

import { getAdapterDescriptors, getDescriptor } from "../kernel/tool-adapters/registry.ts";
import { detectAllTools, detectTool } from "../kernel/tool-adapters/detect.ts";
import { getDelegatedAdapterConfig } from "../kernel/tool-adapters/executor.ts";
import { getTaskClassPolicy, defaultPolicyConstraints } from "../kernel/tool-adapters/policies.ts";
import { planToolExecution, type PlanInput } from "../kernel/tool-adapters/planner.ts";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];

function check(gate: string, pass: boolean, detail = "") {
  gates.push({ gate, pass, detail });
  if (!pass) console.error(`FAIL: ${gate} — ${detail}`);
}

function makePlanInput(overrides?: Partial<PlanInput>): PlanInput {
  return {
    taskType: "code_generation", riskClass: "low", paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false, deepMode: false,
    secretsPossible: false, dir: ".", now: Date.now(),
    ...overrides,
  };
}

// S1: Registry contains all 11 adapters
const descriptors = getAdapterDescriptors();
check("registry_contains_11_adapters", descriptors.length === 11, `count=${descriptors.length}`);

// S2: Each future adapter has a descriptor
for (const id of ["gemini-cli", "aider", "cursor"] as const) {
  const desc = getDescriptor(id);
  check(`descriptor_exists_${id}`, desc !== undefined, `id=${id}`);
}

// S3: All future adapters marked as assessment-only
for (const id of ["gemini-cli", "aider", "cursor"] as const) {
  const desc = getDescriptor(id)!;
  check(`assessment_only_${id}`, desc.limitations.includes("future_executor_assessment_only"),
    `limitations=${desc.limitations.join(",")}`);
}

// S4: Detection returns results for all future adapters
const allDetected = detectAllTools(".", Date.now());
check("detection_includes_all", allDetected.length === 11, `detected=${allDetected.length}`);

for (const id of ["gemini-cli", "aider", "cursor"] as const) {
  const result = detectTool(id, ".", Date.now());
  check(`detection_works_${id}`, result !== undefined && result.adapterId === id, `adapterId=${result?.adapterId}`);
}

// S5: Delegated configs exist for CLI-capable adapters
check("gemini_cli_has_delegated_config", getDelegatedAdapterConfig("gemini-cli") !== null, "gemini-cli config");
check("aider_has_delegated_config", getDelegatedAdapterConfig("aider") !== null, "aider config");
check("cursor_no_delegated_config", getDelegatedAdapterConfig("cursor") === null, "cursor IDE-only");

// S6: Future adapters in preference orders
const lowRisk = getTaskClassPolicy("low_risk_code");
check("gemini_in_low_risk", lowRisk.preferenceOrder!.includes("gemini-cli"), "low_risk_code order");
check("aider_in_low_risk", lowRisk.preferenceOrder!.includes("aider"), "low_risk_code order");

// S7: Cursor NOT in code execution preference orders
check("cursor_not_in_low_risk", !lowRisk.preferenceOrder!.includes("cursor"), "IDE-only exclusion");

// S8: Planner still works with future adapters (doesn't crash, selects proven adapter)
const plan = planToolExecution(makePlanInput());
check("planner_works", plan.selectedAdapter !== undefined, `selected=${plan.selectedAdapter}`);
check("planner_skips_unavailable_future",
  !["gemini-cli", "aider", "cursor"].includes(plan.selectedAdapter),
  `selected=${plan.selectedAdapter}`);

// S9: Ownership contract preserved
check("model_may_not_decide", plan.modelMayDecide === false, "modelMayDecide must be false");
check("scanner_may_not_decide", plan.scannerMayDecide === false, "scannerMayDecide must be false");
check("kernel_owns_decision", plan.finalDecisionOwner === "kernel/stop-continue-gate",
  `owner=${plan.finalDecisionOwner}`);

// S10: Data policy correctness
const geminiDesc = getDescriptor("gemini-cli")!;
const aiderDesc = getDescriptor("aider")!;
const cursorDesc = getDescriptor("cursor")!;
check("gemini_no_training", geminiDesc.dataPolicy === "no_training", `policy=${geminiDesc.dataPolicy}`);
check("aider_no_training", aiderDesc.dataPolicy === "no_training", `policy=${aiderDesc.dataPolicy}`);
check("cursor_unknown_policy", cursorDesc.dataPolicy === "unknown", `policy=${cursorDesc.dataPolicy}`);

// Summary
const passed = gates.filter((g) => g.pass).length;
const failed = gates.filter((g) => !g.pass);

console.log("\n=== Future Executor Adapters Dogfood ===\n");
for (const g of gates) {
  console.log(`${g.pass ? "✓" : "✗"} ${g.gate}: ${g.detail}`);
}
console.log(`\n${passed} passed, ${failed.length} failed of ${gates.length} gates`);

if (failed.length > 0) process.exit(1);
