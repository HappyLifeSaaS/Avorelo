import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { prepareContinuity, writeContinuity } from "../capabilities/continuity/index.ts";
import { buildWorkIntelligence, loadLatestWorkIntelligence } from "../capabilities/work-intelligence/index.ts";
import { createWorkContract } from "../kernel/work-contract/index.ts";
import { runSlice1 } from "../kernel/run.ts";
import { persistReceipt } from "../kernel/receipts/index.ts";
import { buildControlCenter } from "../capabilities/control-center/index.ts";

const AT = "2026-06-20T00:00:00.000Z";
const NOW = Date.parse(AT);

function sandbox(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function run() {
  const gates: Array<{ gate: string; pass: boolean }> = [];
  const scenarios: Array<{ scenario: string; pass: boolean }> = [];
  const gate = (name: string, pass: boolean) => gates.push({ gate: name, pass });
  const scenario = (name: string, pass: boolean) => scenarios.push({ scenario: name, pass });

  const successDir = sandbox("avorelo-work-intel-success-");
  const openDir = sandbox("avorelo-work-intel-open-");
  const blockedDir = sandbox("avorelo-work-intel-blocked-");
  const repeatDir = sandbox("avorelo-work-intel-repeat-");
  const fallbackDir = sandbox("avorelo-work-intel-fallback-");
  const staleDir = sandbox("avorelo-work-intel-stale-");
  const broadDir = sandbox("avorelo-work-intel-broad-");
  const proDir = sandbox("avorelo-work-intel-pro-");
  try {
    runRuntimeSession({ task: "document the CLI install step", dir: successDir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "change billing webhook handler", dir: openDir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "cat ~/.ssh/id_rsa", dir: blockedDir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "change billing webhook handler", dir: repeatDir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "change billing webhook handler", dir: repeatDir, createdAt: "2026-06-20T01:00:00.000Z", now: NOW + 3_600_000 });
    writeContinuity(fallbackDir, prepareContinuity({ task: "update the README", dir: fallbackDir, now: NOW }));
    runRuntimeSession({ task: "refactor everything", dir: broadDir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "change billing webhook handler", dir: proDir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "change billing webhook handler", dir: proDir, createdAt: "2026-06-20T01:00:00.000Z", now: NOW + 3_600_000 });

    const receiptContract = createWorkContract({ contractId: "dogfood-stale-receipt", objective: "receipt hygiene", planTier: "Free" });
    const forced = {
      ...runSlice1({
        contract: receiptContract,
        artifacts: [{ artifactId: "only-nav", kind: "http_status_ok", ref: "nav" }],
        receiptId: "rcpt_dogfood_bad_done",
      }).receipt,
      decision: "STOP_DONE" as const,
    };
    persistReceipt(staleDir, forced);

    const success = loadLatestWorkIntelligence(successDir)!;
    const open = loadLatestWorkIntelligence(openDir)!;
    const blocked = loadLatestWorkIntelligence(blockedDir)!;
    const repeated = loadLatestWorkIntelligence(repeatDir)!;
    const fallback = buildWorkIntelligence(fallbackDir, { now: NOW }).model;
    const stale = buildWorkIntelligence(staleDir, { now: NOW }).model;
    const broad = loadLatestWorkIntelligence(broadDir)!;
    const pro = buildWorkIntelligence(proDir, {
      now: NOW + 7_200_000,
    }).model;
    const successPacket = buildWorkIntelligence(successDir, { now: NOW }).resumePacket;
    const beforeControlCenter = readdirSync(join(successDir, ".avorelo")).sort();
    buildControlCenter(successDir, { now: NOW });
    const afterControlCenter = readdirSync(join(successDir, ".avorelo")).sort();
    const allowedTelemetryEvents = new Set([
      "work_intelligence_generated",
      "resume_packet_generated",
      "context_waste_detected",
      "hygiene_warning_detected",
    ]);
    const serializedArtifacts = [
      JSON.stringify(success),
      JSON.stringify(successPacket),
    ];

    gate("summary_persisted_for_runtime_runs", !!success && !!open && !!blocked);
    gate("blocked_session_explained_without_execution_claim", blocked.outcomeReceipt360.outcomeStatus === "blocked");
    gate("repeat_detection_measured", repeated.workMemory.repeatedSetupCount >= 1);
    gate("fallback_works_without_runtime", fallback.runtimeSessionId === null);
    gate("claims_not_allowed_always_present", success.outcomeReceipt360.claimsNotAllowed.length > 0 && open.outcomeReceipt360.claimsNotAllowed.length > 0);
    gate("stale_or_unsafe_receipt_detected", stale.hygiene.receipt.warnings.some((warning) => warning.code === "UNSUPPORTED_DONE_CLAIM"));
    gate("broad_scope_detected", broad.contextWaste.warnings.some((warning) => warning.code === "BROAD_TASK_NEEDS_SCOPE"));
    gate("full_history_for_everyone", pro.workMemory.historyDepthAvailable >= 1);
    gate("fake_savings_never_claimed", success.outcomeReceipt360.claimsNotAllowed.some((claim) => claim.includes("savings")) && success.outcomeReceipt360.valueSignal.confidence !== "measured");
    gate("raw_sensitive_fields_never_persisted", serializedArtifacts.every((artifact) => !artifact.includes("AKIA") && !artifact.includes("id_rsa")));
    gate("control_center_remains_read_only", JSON.stringify(afterControlCenter) === JSON.stringify(beforeControlCenter));
    gate("telemetry_events_only_emit_for_real_behaviors", success.telemetry.recordedEvents.every((eventName) => allowedTelemetryEvents.has(eventName)));

    scenario("successful_local_summary", success.resume.readiness === "ready" && success.contextWaste.level === "low");
    scenario("failed_or_open_session_refuses_done", open.outcomeReceipt360.outcomeStatus === "open" && open.contextWaste.warnings.some((warning) => warning.code === "MISSING_PROOF_COMMAND"));
    scenario("blocked_risky_session_explained", blocked.outcomeReceipt360.outcomeStatus === "blocked" && blocked.outcomeReceipt360.claimsNotAllowed.some((claim) => claim.includes("blocked task")));
    scenario("repeated_setup_detected", repeated.contextWaste.warnings.some((warning) => warning.code === "REPEATED_SETUP_CONTEXT_RECREATION"));
    scenario("deterministic_no_agent_fallback", fallback.outcomeReceipt360.objectiveSummary.length > 0 && fallback.resume.providerNeutral === true);
    scenario("stale_artifact_or_receipt_hygiene_detected", stale.hygiene.receipt.status === "critical");
    scenario("broad_task_needs_scope", broad.workspaceMap.broadScopeDetected === true && broad.contextWaste.level === "high");
    scenario("full_history_available", pro.workMemory.historyDepthAvailable >= 1);
    scenario("resume_packet_stays_metadata_only", successPacket.containsRawPrompt === false && successPacket.containsRawSource === false && successPacket.containsRawDiff === false && successPacket.containsRawTerminalOutput === false);
  } finally {
    for (const dir of [successDir, openDir, blockedDir, repeatDir, fallbackDir, staleDir, broadDir, proDir]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }

  const failedGates = gates.filter((item) => !item.pass);
  const failedScenarios = scenarios.filter((item) => !item.pass);
  const ok = failedGates.length === 0 && failedScenarios.length === 0;
  process.stdout.write("AVORELO WORK-INTELLIGENCE DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - failedGates.length, failed: failedGates.map((item) => item.gate) },
    scenarios: { total: scenarios.length, passed: scenarios.length - failedScenarios.length, failed: failedScenarios.map((item) => item.scenario) },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
