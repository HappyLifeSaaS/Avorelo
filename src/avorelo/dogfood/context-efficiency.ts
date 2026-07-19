import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildAndPersistContextEfficiencyBrief,
  buildContextEfficiencyPathCheck,
  loadLatestContextEfficiencyBrief,
} from "../capabilities/context-efficiency/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-context-efficiency-dogfood-"));
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "README.md"), "# Sandbox\n");
  writeFileSync(join(dir, "tests", "context-efficiency.test.ts"), "test file");
  writeFileSync(join(dir, "tests", "context-efficiency-cli.test.ts"), "cli test file");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "pricing.html"), "<html></html>");
}

function run() {
  const gates: Array<{ gate: string; pass: boolean }> = [];
  const scenarios: Array<{ scenario: string; pass: boolean }> = [];
  const gate = (name: string, pass: boolean) => gates.push({ gate: name, pass });
  const scenario = (name: string, pass: boolean) => scenarios.push({ scenario: name, pass });

  const dir = sandbox();
  try {
    seedRepo(dir);
    const built = buildAndPersistContextEfficiencyBrief({ dir, task: "update public web pricing page copy" });
    const latest = loadLatestContextEfficiencyBrief(dir)!;
    const publicCheck = buildContextEfficiencyPathCheck(dir, "src/avorelo/surfaces/public-web/static/pricing.html");
    const generatedCheck = buildContextEfficiencyPathCheck(dir, "dist/site/index.html");
    const runtimeCheck = buildContextEfficiencyPathCheck(dir, ".avorelo/runtime/session.latest.json");
    const releaseCheck = buildContextEfficiencyPathCheck(dir, "docs/release/runbook.md");
    const dashboardCheck = buildContextEfficiencyPathCheck(dir, "src/avorelo/surfaces/public-web/static/dashboard.html");
    const stored = readFileSync(built.path, "utf8");

    gate("context_brief_runs_on_repo_root", built.brief.contract === "avorelo.contextEfficiencyBrief.v1");
    gate("task_description_produces_compact_brief", built.brief.objectiveSummary.length > 0 && built.brief.safeNextAction.length > 0);
    gate("public_web_source_gets_validation", publicCheck.validation.commands.some((item) => item.command === "npm run site:check"));
    gate("generated_output_excluded", generatedCheck.recommendation === "exclude");
    gate("runtime_artifact_excluded", runtimeCheck.recommendation === "exclude");
    gate("release_scope_blocked_or_reviewed", releaseCheck.decisionState === "BLOCKED" || releaseCheck.decisionState === "NEEDS_REVIEW");
    gate("check_path_works_for_three_paths", publicCheck.safeNextAction.length > 0 && generatedCheck.safeNextAction.length > 0 && runtimeCheck.safeNextAction.length > 0);
    gate("artifact_safety_flags_present", latest.containsRawPrompt === false && latest.containsRawSource === false && latest.containsRawScreenshot === false);
    gate("recommended_tests_shown", built.brief.validation.commands.length >= 2);
    gate("workspace_map_compatibility_documented", latest.workspaceMapCompatibility.notes.length > 0);
    gate("dashboard_overlap_review_only", dashboardCheck.decisionState === "NEEDS_REVIEW");
    gate("no_raw_source_or_prompt_persisted", !stored.includes("raw source") && !stored.includes("SECRET_KEY"));

    scenario("compact_actionable_summary", built.brief.decisionState === "READY" || built.brief.decisionState === "READY_WITH_WARNINGS");
    scenario("latest_artifact_reads_back", latest.contract === "avorelo.contextEfficiencyBrief.v1");
    scenario("public_web_path_ready", publicCheck.decisionState === "READY");
    scenario("generated_path_blocked_from_context", generatedCheck.summary.toLowerCase().includes("generated output"));
    scenario("runtime_path_kept_local_only", runtimeCheck.summary.toLowerCase().includes("local runtime artifacts"));
    scenario("release_path_not_in_scope", releaseCheck.safeNextAction.toLowerCase().includes("stay out"));
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  const failedGates = gates.filter((item) => !item.pass);
  const failedScenarios = scenarios.filter((item) => !item.pass);
  const ok = failedGates.length === 0 && failedScenarios.length === 0;
  process.stdout.write("AVORELO CONTEXT-EFFICIENCY DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - failedGates.length, failed: failedGates.map((item) => item.gate) },
    scenarios: { total: scenarios.length, passed: scenarios.length - failedScenarios.length, failed: failedScenarios.map((item) => item.scenario) },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
