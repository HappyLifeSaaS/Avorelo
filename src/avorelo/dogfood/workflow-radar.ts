import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAndPersistContextEfficiencyBrief } from "../capabilities/context-efficiency/index.ts";
import { buildAndPersistModelRoutingInputProfile } from "../capabilities/model-routing-input/index.ts";
import {
  buildAndPersistWorkflowRadarAssessment,
  buildWorkflowRadarAssessment,
  buildWorkflowRadarPathCheck,
  loadLatestWorkflowRadarAssessment,
} from "../capabilities/workflow-radar/index.ts";
import { buildProofReport, writeProofReport } from "../capabilities/proof-report/index.ts";
import { persistReceipt } from "../kernel/receipts/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-workflow-radar-dogfood-"));
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
  writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = true;\n");
  writeFileSync(join(dir, "docs", "release", "runbook.md"), "release\n");
  writeFileSync(join(dir, "tests", "workflow-radar.test.ts"), "test\n");
  writeFileSync(join(dir, "tests", "workflow-radar-cli.test.ts"), "test\n");
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "dogfood@example.com"]);
  runGit(dir, ["config", "user.name", "Dogfood"]);
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-m", "initial"]);
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

function writeProofFixture(dir: string): void {
  const report = buildProofReport({
    verified: [{ code: "VALIDATED", title: "Validated", summary: "Focused validation completed." }],
  });
  writeProofReport(dir, report);
}

function run() {
  const gates: Array<{ gate: string; pass: boolean }> = [];
  const gate = (name: string, pass: boolean) => gates.push({ gate: name, pass });
  const dir = sandbox();

  try {
    seedRepo(dir);

    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const fallback = buildWorkflowRadarAssessment({ dir });
    gate("workflow_radar_runs_on_repo_root", fallback.contract === "avorelo.workflowRadar.v1");
    gate("no_artifact_fallback_is_conservative_and_actionable", fallback.warnings.some((warning) => warning.includes("Context Efficiency brief is missing")) && fallback.safeNextAction.length > 0);

    buildAndPersistContextEfficiencyBrief({ dir, task: "update workflow radar capability" });
    buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    const routed = buildAndPersistWorkflowRadarAssessment({ dir, fromContextBrief: true }).assessment;
    gate("latest_context_efficiency_brief_is_consumed_if_present", routed.contextBrief.source === "latest_brief");
    gate("latest_model_routing_profile_is_consumed_if_present", routed.modelRouting.source === "latest_profile");
    gate("changed_path_names_are_analyzed_without_raw_diffs", routed.changedPaths.totalCount >= 1 && !JSON.stringify(routed).includes("export const feature = false"));

    mkdirSync(join(dir, "dist", "site"), { recursive: true });
    writeFileSync(join(dir, "dist", "site", "index.html"), "generated\n");
    const generated = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    gate("generated_output_path_is_flagged", generated.changedPaths.generatedOutputCount > 0);

    writeFileSync(join(dir, ".avorelo", "runtime", "session.latest.json"), JSON.stringify({ ok: true }));
    const runtime = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    gate("local_runtime_artifact_path_is_flagged_as_do_not_stage", runtime.changedPaths.runtimeArtifactCount > 0 && runtime.safeNextAction.includes("runtime"));

    writeFileSync(join(dir, "docs", "release", "runbook.md"), "changed\n");
    const release = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    gate("release_or_production_owned_path_is_blocked_or_needs_review", release.decisionState === "BLOCKED" || release.decisionState === "NEEDS_REVIEW");

    writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = false;\n");
    const billing = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    gate("billing_auth_secret_sensitive_path_requires_review", billing.humanReviewRequired);

    rmSync(join(dir, "dist"), { recursive: true, force: true });
    rmSync(join(dir, ".avorelo", "runtime", "session.latest.json"), { force: true });
    writeFileSync(join(dir, "docs", "release", "runbook.md"), "release\n");
    writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = true;\n");

    gate("missing_validation_recommends_run_validation", fallback.recommendedNextAction === "run_validation");

    writeProofFixture(dir);
    const receiptMissing = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    gate("missing_evidence_recommends_produce_receipt", receiptMissing.recommendedNextAction === "produce_receipt" || receiptMissing.recommendedNextAction === "switch_to_guarded_mode");

    writeReceiptFixture(dir);
    const ready = buildWorkflowRadarAssessment({ dir, fromContextBrief: true });
    gate("low_risk_clean_scenario_recommends_continue_work", ["continue_work", "switch_to_guarded_mode"].includes(ready.recommendedNextAction));
    gate("no_provider_calls_are_made", ready.containsProviderPayload === false);
    gate("artifact_safety_flags_are_present", ready.containsRawSource === false && ready.containsRawDiff === false && ready.contentStorageClass === "safe_metadata_only");
    gate("final_summary_is_actionable", ready.safeNextAction.length > 0);
    gate("context_efficiency_relationship_is_documented", ready.reasonCodes.includes("WORKFLOW_RADAR_CONTEXT_BRIEF_USED"));
    gate("model_routing_input_relationship_is_documented", ready.reasonCodes.includes("WORKFLOW_RADAR_MODEL_ROUTING_PROFILE_USED"));
    gate("pr_182_scope_remains_untouched_unless_documented", !ready.changedPaths.items.some((item) => item.path.includes("settings.html")));

    const latest = loadLatestWorkflowRadarAssessment(dir)!;
    const latestText = readFileSync(join(dir, ".avorelo", "workflow-radar", "latest.json"), "utf8");
    gate("latest_artifact_is_safe_metadata_only", latest.contract === "avorelo.workflowRadar.v1" && !latestText.includes("provider_payload") && !latestText.includes("raw diff"));
    gate("path_check_is_actionable", buildWorkflowRadarPathCheck(dir, "docs/release/runbook.md").safeNextAction.length > 0);

    const failed = gates.filter((item) => !item.pass);
    const ok = failed.length === 0;
    process.stdout.write("AVORELO WORKFLOW-RADAR DOGFOOD\n" + JSON.stringify({
      ok,
      gates: {
        total: gates.length,
        passed: gates.length - failed.length,
        failed: failed.map((item) => item.gate),
      },
    }, null, 2) + "\n");
    process.exit(ok ? 0 : 1);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

run();
