import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAndPersistContextEfficiencyBrief } from "../capabilities/context-efficiency/index.ts";
import { buildAndPersistModelRoutingInputProfile } from "../capabilities/model-routing-input/index.ts";
import { buildAndPersistWorkflowRadarAssessment } from "../capabilities/workflow-radar/index.ts";
import {
  buildAndPersistSessionContinuityHandoff,
  buildSessionContinuityHandoff,
  loadLatestSessionContinuityHandoff,
} from "../capabilities/session-continuity/index.ts";
import { buildProofReport, writeProofReport } from "../capabilities/proof-report/index.ts";
import { persistReceipt } from "../kernel/receipts/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-session-continuity-dogfood-"));
}

function runGit(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function seedRepo(dir: string, dependency = false): void {
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy"), { recursive: true });
  mkdirSync(join(dir, "docs", "release"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, ".avorelo", "runtime"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "README.md"), "# Sandbox\n");
  writeFileSync(join(dir, "src", "feature.ts"), "export const feature = true;\n");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = true;\n");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "settings.html"), "<html></html>\n");
  writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = true;\n");
  writeFileSync(join(dir, "docs", "release", "runbook.md"), "release\n");
  writeFileSync(join(dir, "tests", "session-continuity.test.ts"), "test\n");
  writeFileSync(join(dir, "tests", "session-continuity-cli.test.ts"), "test\n");
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "dogfood@example.com"]);
  runGit(dir, ["config", "user.name", "Dogfood"]);
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
  }
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

function run() {
  const gates: Array<{ gate: string; pass: boolean }> = [];
  const gate = (name: string, pass: boolean) => gates.push({ gate: name, pass });

  const dir = sandbox();
  const dependencyDir = sandbox();
  try {
    seedRepo(dir);
    seedRepo(dependencyDir, true);

    writeFileSync(join(dir, "src", "feature.ts"), "export const feature = false;\n");
    const fallback = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    gate("session_handoff_runs_on_repo_root", fallback.repoRoot.replace(/\\/g, "/") === dir.replace(/\\/g, "/"));
    gate("no_artifact_fallback_is_conservative_and_actionable", fallback.workflowRadar.source === "generated_fallback" && fallback.safeNextAction.length > 0);

    buildAndPersistContextEfficiencyBrief({ dir, task: "add session continuity handoff support" });
    buildAndPersistModelRoutingInputProfile({ dir, fromContextBrief: true });
    buildAndPersistWorkflowRadarAssessment({ dir, fromContextBrief: true });
    const routed = buildSessionContinuityHandoff({ dir, fromWorkflowRadar: true });
    gate("latest_context_efficiency_brief_is_consumed_if_present", routed.contextBrief.source === "latest_brief");
    gate("latest_model_routing_profile_is_consumed_if_present", routed.modelRouting.source === "latest_profile");
    gate("latest_workflow_radar_assessment_is_consumed_if_present", routed.workflowRadar.source === "latest_assessment");
    gate("changed_path_names_are_summarized_without_raw_diffs", routed.changedPaths.relevantPaths.includes("src/feature.ts") && !JSON.stringify(routed).includes("export const feature = false"));

    mkdirSync(join(dir, "dist", "site"), { recursive: true });
    writeFileSync(join(dir, "dist", "site", "index.html"), "generated\n");
    const generated = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    gate("generated_output_path_is_flagged", generated.doNotTouch.includes("dist/site/index.html"));

    writeFileSync(join(dir, ".avorelo", "runtime", "session.latest.json"), JSON.stringify({ ok: true }));
    const runtime = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    gate("local_runtime_artifact_path_is_flagged_as_do_not_stage", runtime.doNotTouch.includes(".avorelo/runtime/session.latest.json"));

    writeFileSync(join(dir, "docs", "release", "runbook.md"), "changed\n");
    const release = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    gate("release_or_production_owned_path_is_blocked_or_needs_review", release.decisionState === "BLOCKED");

    writeFileSync(join(dir, "src", "avorelo", "adapters", "lemon-squeezy", "checkout-api.ts"), "export const checkout = false;\n");
    const billing = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    gate("billing_auth_secret_sensitive_path_requires_review", billing.doNotTouch.includes("src/avorelo/adapters/lemon-squeezy/checkout-api.ts"));

    writeFileSync(join(dir, ".env.local"), "API_TOKEN=abc123\n");
    const secret = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    gate("secret_sensitive_paths_are_blocked", secret.doNotTouch.includes(".env.local"));

    const cleanDir = sandbox();
    try {
      seedRepo(cleanDir);
      writeFileSync(join(cleanDir, "src", "feature.ts"), "export const feature = false;\n");
      buildAndPersistContextEfficiencyBrief({ dir: cleanDir, task: "add session continuity handoff support" });
      buildAndPersistModelRoutingInputProfile({ dir: cleanDir, fromContextBrief: true });
      const validationMissing = buildSessionContinuityHandoff({ dir: cleanDir, task: "add session continuity handoff support" });
      gate("missing_validation_recommends_run_validation", validationMissing.recommendedNextAction === "run_validation");
      writeProofFixture(cleanDir);
      const evidenceMissing = buildSessionContinuityHandoff({ dir: cleanDir, task: "add session continuity handoff support" });
      gate("missing_evidence_recommends_produce_receipt", evidenceMissing.recommendedNextAction === "produce_receipt");
      writeProofFixture(cleanDir);
      writeReceiptFixture(cleanDir);
      const ready = buildSessionContinuityHandoff({ dir: cleanDir, task: "add session continuity handoff support" });
      gate("clean_safe_scenario_recommends_continue_work", ready.recommendedNextAction === "continue_work");
    } finally {
      if (existsSync(cleanDir)) rmSync(cleanDir, { recursive: true, force: true });
    }

    const dependent = buildSessionContinuityHandoff({ dir: dependencyDir, task: "continue session continuity workstream" });
    gate("dependent_branch_scenario_recommends_wait_for_dependency_merge", dependent.continuationMode === "wait_for_dependency_merge");

    const prompt = buildSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    gate("continuation_prompt_is_generated_when_requested", prompt.continuationPrompt.includes("Workstream:"));
    gate("continuation_prompt_contains_safe_next_action", prompt.continuationPrompt.includes("Safe next action:"));
    gate("continuation_prompt_excludes_raw_source_diff_terminal_provider_content", !prompt.continuationPrompt.includes("export const feature = false") && !prompt.continuationPrompt.includes("provider_payload"));

    const built = buildAndPersistSessionContinuityHandoff({ dir, task: "add session continuity handoff support" });
    const latest = loadLatestSessionContinuityHandoff(dir)!;
    const stored = readFileSync(built.path, "utf8");
    gate("artifact_safety_flags_are_present", latest.containsRawPrompt === false && latest.containsRawDiff === false && latest.containsFullTranscript === false);
    gate("latest_artifact_is_safe_metadata_only", latest.contentStorageClass === "safe_metadata_only" && !stored.includes("export const feature = false"));
    gate("context_efficiency_relationship_is_documented", latest.reasonCodes.includes("SESSION_CONTINUITY_CONTEXT_BRIEF_USED") || latest.warnings.some((warning) => warning.includes("Context Efficiency")));
    gate("model_routing_input_relationship_is_documented", latest.reasonCodes.includes("SESSION_CONTINUITY_MODEL_ROUTING_USED") || latest.warnings.some((warning) => warning.includes("Model Routing Input")));
    gate("workflow_radar_relationship_is_documented", latest.reasonCodes.includes("SESSION_CONTINUITY_WORKFLOW_RADAR_USED"));
    gate("final_summary_is_actionable", latest.safeNextAction.length > 0);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    if (existsSync(dependencyDir)) rmSync(dependencyDir, { recursive: true, force: true });
  }

  const failed = gates.filter((item) => !item.pass);
  const ok = failed.length === 0;
  process.stdout.write("AVORELO SESSION-CONTINUITY DOGFOOD\n" + JSON.stringify({
    ok,
    gates: {
      total: gates.length,
      passed: gates.length - failed.length,
      failed: failed.map((item) => item.gate),
    },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
