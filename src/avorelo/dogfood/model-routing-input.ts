import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAndPersistContextEfficiencyBrief } from "../capabilities/context-efficiency/index.ts";
import {
  buildAndPersistModelRoutingInputProfile,
  buildModelRoutingInputPathCheck,
  loadLatestModelRoutingInputProfile,
} from "../capabilities/model-routing-input/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-model-routing-input-dogfood-"));
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "model-routing-input"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "tests", "model-routing-input.test.ts"), "test file");
  writeFileSync(join(dir, "tests", "model-routing-input-cli.test.ts"), "cli test file");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "model-routing-input", "index.ts"), "export const ok = true;\n");
}

function run() {
  const gates: Array<{ gate: string; pass: boolean }> = [];
  const scenarios: Array<{ scenario: string; pass: boolean }> = [];
  const gate = (name: string, pass: boolean) => gates.push({ gate: name, pass });
  const scenario = (name: string, pass: boolean) => scenarios.push({ scenario: name, pass });

  const dir = sandbox();
  try {
    seedRepo(dir);
    buildAndPersistContextEfficiencyBrief({ dir, task: "add metadata-only model routing input profile support" });
    const built = buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    const latest = loadLatestModelRoutingInputProfile(dir)!;
    const sourceCheck = buildModelRoutingInputPathCheck(dir, "src/avorelo/capabilities/model-routing-input/index.ts");
    const generatedCheck = buildModelRoutingInputPathCheck(dir, "dist/site/index.html");
    const billingProfile = buildAndPersistModelRoutingInputProfile({ dir, task: "update billing webhook routing policy" }).profile;

    gate("profile_contract_written", built.profile.contract === "avorelo.modelRoutingInputProfile.v1");
    gate("profile_persisted_to_model_routing_dir", existsSync(built.path));
    gate("safe_flags_present", latest.containsRawPrompt === false && latest.containsRawSource === false && latest.containsProviderPayload === false);
    gate("context_efficiency_consumed_when_available", latest.contextEfficiency.source === "latest_brief");
    gate("source_path_routes_to_reasoning_mode", sourceCheck.recommendedMode === "standard_reasoning");
    gate("generated_output_is_blocked", generatedCheck.recommendedMode === "blocked_needs_decision");
    gate("sensitive_task_requires_human_review", billingProfile.recommendedMode === "human_review_required");
    gate("safe_metadata_only_storage", latest.contentStorageClass === "safe_metadata_only");
    gate("recommended_validation_present", latest.recommendedValidation.commands.length > 0);
    gate("workspace_map_availability_reported", latest.workspaceMap.available === false);

    scenario("latest_profile_reads_back", latest.contract === "avorelo.modelRoutingInputProfile.v1");
    scenario("context_brief_flow_supported", latest.taskSource === "context_efficiency_latest");
    scenario("source_path_check_is_actionable", sourceCheck.safeNextAction.length > 0);
    scenario("generated_path_check_redirects_to_source", generatedCheck.summary.toLowerCase().includes("source-of-truth"));
    scenario("billing_task_is_review_heavy", billingProfile.safeNextAction.toLowerCase().includes("approval"));
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  const failedGates = gates.filter((item) => !item.pass);
  const failedScenarios = scenarios.filter((item) => !item.pass);
  const ok = failedGates.length === 0 && failedScenarios.length === 0;
  process.stdout.write("AVORELO MODEL-ROUTING-INPUT DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - failedGates.length, failed: failedGates.map((item) => item.gate) },
    scenarios: { total: scenarios.length, passed: scenarios.length - failedScenarios.length, failed: failedScenarios.map((item) => item.scenario) },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
