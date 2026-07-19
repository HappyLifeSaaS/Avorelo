#!/usr/bin/env node
// Avorelo CLI. Surface = render + run only; owns no policy/evidence/receipt.
// Full Activation V2: detect â†’ repair â†’ run-entry â†’ verify â†’ first-value.
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../../shared/redaction/index.ts";
import { runSlice1 } from "../../kernel/run.ts";
import { createWorkContract } from "../../kernel/work-contract/index.ts";
import { writeReceipt } from "../../kernel/receipts/index.ts";
import { StateLedger } from "../../kernel/state-ledger/index.ts";
import { activate, doctor } from "../../capabilities/activation/index.ts";
import { runPreflight, formatPreflightReport } from "../../capabilities/activation/activation-preflight.ts";
import { runFullDetection } from "../../capabilities/activation/activation-detector.ts";
import { readActivationState, writeActivationState, verifyActivationState, repairActivationState, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE } from "../../capabilities/activation/activation-state.ts";
import { runFullActivation, persistActivationV2, type ActivationStateV2 } from "../../capabilities/activation/activation-runner.ts";
import { validateInstall, handleLifecycleHook, uninstall } from "../../adapters/claude-code/index.ts";
import { persistReceipt } from "../../kernel/receipts/index.ts";
import { open as openDashboard, renderText } from "../../capabilities/local-dashboard/index.ts";
import { openControlCenter, buildControlCenter, renderText as renderControlCenterText } from "../../capabilities/control-center/index.ts";
import {
  buildWorkIntelligence,
  loadLatestWorkIntelligence,
  loadLatestWorkResumePacket,
  renderShareSafeSummary,
  renderWorkIntelligenceText,
  renderWorkResumePacket,
  upsertWorkIntelligence,
} from "../../capabilities/work-intelligence/index.ts";
import { initWorkspace, buildActivationContract, loadWorkspace } from "../../capabilities/activation/init.ts";
import { buildDogfoodCheck, renderDogfoodCheck, buildDogfoodSummary, renderDogfoodSummary } from "../../capabilities/activation/dogfood-check.ts";
import { buildCoreReadiness, renderCoreReadiness } from "../../capabilities/core-readiness/index.ts";
import { evaluateProof, loadProofInput } from "../../capabilities/production-confidence/index.ts";
import { buildSite } from "../../surfaces/public-web/index.ts";
import { serve } from "../../surfaces/preview-server/index.ts";
import { startSession, getSessionStatus, resumeSession, processHookEvent } from "../../capabilities/session/index.ts";
import { loadLatestResumePacket } from "../../capabilities/session/resume-packet.ts";
import { detectAllAdapters, uninstallAll } from "../../adapters/registry.ts";
import { checkUpdateExplicit, renderFreshnessResult } from "../../capabilities/registry-freshness/index.ts";
import { watchOnce, watchWithFixture } from "../../capabilities/session/watcher.ts";
import { detectMonorepo } from "../../capabilities/workspace/monorepo.ts";
import { hasManagedBlock } from "../../capabilities/instruction-management/managed-blocks.ts";
import { getFeedbackConfig, optIn, optOut, prepareFeedbackBundle, prepareSupportBundle, SUPPORT_ISSUES_URL, SUPPORT_SECURITY_URL, SUPPORT_EMAIL } from "../../capabilities/feedback/index.ts";
import { classifyLoopReadiness } from "../../capabilities/loop-control/readiness.ts";
import { buildLoopPolicy } from "../../capabilities/loop-control/policy-builder.ts";
import { runLoop } from "../../capabilities/loop-control/orchestrator.ts";
import { readLoopMetadata, readActiveLoop, readLatestLoopMetadata } from "../../capabilities/loop-control/loop-metadata.ts";
import { claudeCodeLoopAdapter } from "../../adapters/claude-code/loop-adapter.ts";
import { detectCheckCommands } from "../../capabilities/loop-control/check-detection.ts";
import type { EvidenceArtifact } from "../../shared/schemas/index.ts";
import type { ToolRequest } from "../../kernel/pretooluse-gate/index.ts";
import { loadSettings, ensureSettings, resetSettings, renderSettings, writeSettings, ALPHA_NOTICE } from "../../capabilities/settings/index.ts";
import { sanitizeReceipt, type LocalReceipt } from "../../kernel/receipts/sanitize.ts";
import { listReceipts } from "../../kernel/receipts/index.ts";
import { buildEfficiencyMetadataSyncDryRun, writeEfficiencyMetadataSyncQueue } from "../../capabilities/efficiency-sync/index.ts";
import { buildCanonicalReadinessReport, summarizeCanonicalReadiness } from "../../capabilities/canonical-readiness/index.ts";
import { scanContent, evaluateSafeRun } from "../../capabilities/secret-boundary/index.ts";
import { decideRouting } from "../../kernel/work-contract/routing.ts";
import { compileContext } from "../../capabilities/context-compiler/index.ts";
import { prepareContinuity, applyContinuity, writeContinuity, loadLatestContinuity, expireContinuity } from "../../capabilities/continuity/index.ts";
import { createUnavailableTokenCostEvidence, importTokenCostEvidence, summarizeTokenCostEvidence, validateTokenCostEvidence, writeTokenCostEvidence, loadTokenCostEvidence } from "../../capabilities/token-cost-evidence/index.ts";
import { buildProofReportFromLocalEvidence, writeProofReport, summarizeProofReport } from "../../capabilities/proof-report/index.ts";
import { entriesFromProofReport, appendValueLedgerEntry, loadValueLedgerEntries, buildCompactValueCards, writeValueCards } from "../../capabilities/value-ledger/index.ts";
import { runRuntimeSession, loadLatestRuntimeSession } from "../../capabilities/runtime-flow/index.ts";
import { runContextCheck, renderHuman as renderContextCheckHuman, renderJson as renderContextCheckJson } from "../../capabilities/context-check/index.ts";
import {
  buildAndPersistContextEfficiencyBrief,
  buildContextEfficiencyPathCheck,
  loadLatestContextEfficiencyBrief,
  renderContextEfficiencyBrief,
  renderContextEfficiencyPathCheck,
} from "../../capabilities/context-efficiency/index.ts";
import {
  buildAndPersistModelRoutingInputProfile,
  buildModelRoutingInputPathCheck,
  loadLatestModelRoutingInputProfile,
  modelRoutingInputModeIsReady,
  renderModelRoutingInputPathCheck,
  renderModelRoutingInputProfile,
} from "../../capabilities/model-routing-input/index.ts";
import {
  buildAndPersistWorkflowRadarAssessment,
  buildWorkflowRadarPathCheck,
  loadLatestWorkflowRadarAssessment,
  renderWorkflowRadarAssessment,
  renderWorkflowRadarPathCheck,
  workflowRadarDecisionStateIsReady,
} from "../../capabilities/workflow-radar/index.ts";
import {
  buildAndPersistSessionContinuityHandoff,
  buildSessionContinuityPathCheck,
  loadLatestSessionContinuityHandoff,
  renderSessionContinuityHandoff,
  renderSessionContinuityPathCheck,
  sessionContinuityDecisionStateIsReady,
} from "../../capabilities/session-continuity/index.ts";
import {
  generateBrief as generateTrustBrief,
  loadItems as loadContextItems,
  loadConflicts as loadContextConflicts,
  loadMode as loadContextMode,
  loadLatestBrief as loadLatestTrustBrief,
  loadLatestContextReceipt,
  evaluateAgentAction,
  evaluateCompletionClaim,
  promoteItem,
  forgetItem,
  runRepoPreflight,
  formatPreflightResult,
} from "../../kernel/context-control/index.ts";
import {
  runBrowserVisualQa,
  readBrowserQaLatest,
  renderBrowserQaSummary,
  renderBrowserQaExplain,
  normalizeScreenshotPolicy,
  parseBooleanFlag,
} from "../../capabilities/browser-visual-qa/index.ts";
import type { BrowserQaRouteInput, BrowserQaScreenshotPolicy } from "../../capabilities/browser-visual-qa/index.ts";
import { discoverCapabilities, renderCapabilities, capabilitiesToJson } from "../../capabilities/capability-discovery/index.ts";
import { generateProofContract, renderProofContract } from "../../kernel/proof-contract/index.ts";
import { runAllProof, renderProofRun } from "../../kernel/proof-adapters/index.ts";
import { evaluateEvidence, renderGateResult, gateResultToJson } from "../../kernel/evidence-gate/index.ts";
import { createVerificationReceipt, storeVerificationReceipt, renderVerificationReceipt, loadLatestVerificationReceipt } from "../../kernel/verification-receipt/index.ts";

function arg(args: string[], name: string, dflt?: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}

function multiArg(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) values.push(args[i + 1]);
  }
  return values;
}

type Fixture = "fake-ready" | "complete-ready" | "insufficient" | "secret";
function buildFixture(name: Fixture): { artifacts: EvidenceArtifact[]; content?: unknown } {
  switch (name) {
    case "fake-ready": return { artifacts: [{ artifactId: "a1", kind: "http_status_ok", ref: "ev:200" }, { artifactId: "a2", kind: "ui_action_accepted", ref: "ev:submit" }] };
    case "complete-ready": return { artifacts: [{ artifactId: "a1", kind: "persisted_state_change", ref: "ev:row" }, { artifactId: "a2", kind: "aftermath_correct", ref: "ev:confirm" }] };
    case "insufficient": return { artifacts: [{ artifactId: "a1", kind: "persisted_state_change", ref: "ev:row" }] };
    case "secret": return { artifacts: [{ artifactId: "a1", kind: "http_status_ok", ref: "ev:200" }], content: { note: "deploy key AKIA1234567" + "890ABCD99", prompt: "raw prompt" } };
  }
}

function help(): number {
  process.stdout.write([
    "avorelo â€” AI Work Control",
    "",
    "  init [--target <dir>] [--json] [--reset]                          Initialize a local workspace (first run; no signup)",
    "  dogfood-check [--target <dir>] [--json]                           Read-only local readiness check (for dogfood testers)",
    "  dogfood-summary [--target <dir>] [--json]                         Safe pre-send summary to review before giving feedback",
    "  core-readiness [--json]                                           Product-core readiness verdict",
    "  start [--target <dir>] [--objective \"<text>\"]                     Start Avorelo (one command)",
    "  run \"<task>\" [--target <dir>]                                     Start a focused work session",
    "  resume [--target <dir>]                                           Resume an interrupted session",
    "  watch [--target <dir>] [--fixture <name>]                         Check for file changes (Tier B)",
    "  explain [--target <dir>]                                          Show what Avorelo changed",
    "  prompt [--target <dir>]                                           Copy-ready prompt for any AI tool",
    "",
    "  activate [--target <dir>]                                         Full activation: detect, repair, run-entry",
    "  activate --install-hooks --approve [--target <dir>]               Activate + install Claude Code hooks",
    "  status [--target <dir>]                                           Show activation and session status",
    "  open [--target <dir>] [--format html|json|text]                   Local receipts dashboard",
    "  control-center [--target <dir>] [--format html|json|text]         Local Control Center (read-only, all local state)",
    "  browser qa <run|latest|explain> [--target <dir>] [--json]         Local-first Browser QA surface",
    "  visual qa <run|latest|explain> [--target <dir>] [--json]          Alias for browser qa",
    "  work <latest|memory|resume-packet|relevance|context-waste|hygiene|receipt-hygiene|artifact-hygiene|capability-hygiene|export> [--target <dir>] [--json]",
    "  doctor [--target <dir>]                                           Health check (adapters, hooks, session)",
    "  verify [--target <dir>]                                           Validate activation state invariants",
    "  uninstall [--target <dir>]                                        Remove all Avorelo-managed content",
    "",
    "",
    "  loop check \"<task>\" [--target <dir>] [--json]                     Check loop readiness for a task",
    "  loop start \"<task>\" [--target <dir>] [--max <n>] [--json]         Start a bounded AI loop",
    "  loop status [--target <dir>] [--json]                             Show active/last loop status",
    "  loop stop [--target <dir>]                                        Signal active loop to stop",
    "  loop receipt <loopId> [--target <dir>] [--json]                   Show loop metadata + receipt",
    "",
    "  run --fixture <fake-ready|complete-ready|insufficient|secret>     Synthetic kernel proof",
    "  site [--target <dir>] [--out <dir>]                               Generate public web HTML",
    "  serve [--target <dir>] [--port <n>]                               Serve public web locally",
    "  lifecycle-hook <Event> [--payload <json>]                          Hook entrypoint",
    "",
    "",
    "  settings show [--target <dir>] [--json]                            Show current settings",
    "  settings reset [--target <dir>]                                   Reset settings to defaults",
    "",
    "  update-check [--target <dir>] [--json]                            Check for available updates",
    "",
    "  readiness [--target <dir>] [--json]                               Canonical readiness gate for this workspace",
    "",
    "",
    "  brief [--target <dir>] [--branch <name>] [--task \"<text>\"] [--json] Generate Trusted Work Brief",
    "  context check [--target <dir>] [--json] [--strict] [--ci]         Agent context integrity check",
    "  context brief [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--json]  Compact pre-work brief",
    "  context trust-brief [--target <dir>] [--branch <name>] [--task \"<text>\"] [--json]  Trusted context work brief",
    "  context status [--target <dir>] [--json]                          Context trust/freshness summary",
    "  context explain [--target <dir>] [--json]                         Why items were included/excluded",
    "  context conflicts [--target <dir>] [--json]                       List conflicts with resolutions",
    "  context verify [--target <dir>] [--json]                          Re-check working truth",
    "  context promote <item_id> --reason \"<reason>\" [--evidence <id>]   Promote a context item",
    "  context forget <item_id> --reason \"<reason>\"                      Forget/supersede a context item",
    "  context preflight [--target <dir>] [--json]                       Repo location safety check",
    "  doctor context [--target <dir>] [--json]                          Context health diagnostics",
    "  model route [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-context-brief] [--json]",
    "  workflow radar [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-context-brief] [--from-model-route] [--json]",
    "  session handoff [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-workflow-radar] [--include-continuation-prompt] [--json]",
    "",
    "  feedback prepare [--target <dir>]                                 Create sanitized feedback bundle",
    "  feedback status [--target <dir>]                                  Show feedback sharing status",
    "  feedback opt-in [--target <dir>]                                  Enable feedback sharing",
    "  feedback opt-out [--target <dir>]                                 Disable feedback sharing",
    "  support bundle [--target <dir>]                                   Create support/debug bundle",
    "",
  ].join("\n"));
  return 0;
}

function cmdRun(args: string[]): number {
  const name = (arg(args, "--fixture", "complete-ready") as Fixture);
  if (!["fake-ready", "complete-ready", "insufficient", "secret"].includes(name)) { process.stderr.write(`unknown fixture: ${name}\n`); return 2; }
  const contract = createWorkContract({ contractId: `cli_${name}`, objective: `synthetic ${name}`, allowedPaths: ["src/**"], planTier: "Free" });
  const fx = buildFixture(name);
  const { gate, receipt } = runSlice1({ contract, artifacts: fx.artifacts, content: fx.content, receiptId: `rcpt_cli_${name}` });
  process.stdout.write(JSON.stringify({ fixture: name, decision: gate.decision, confidence: gate.confidence, reasonCodes: gate.reasonCodes, receipt }, null, 2) + "\n");
  return gate.decision === "STOP_DONE" ? 0 : 1;
}

async function cmdActivate(args: string[]): Promise<number> {
  const target = arg(args, "--target", process.cwd())!;
  const installHooksFlag = args.includes("--install-hooks");
  const approve = args.includes("--approve");
  const scope = arg(args, "--scope") ?? "project-wide";

  if (installHooksFlag) {
    if (!approve) {
      process.stderr.write("Hook installation requires explicit approval. Add --approve to confirm.\n");
      return 2;
    }
    try {
      const r = activate(target, { approve: true });
      persistReceipt(target, r.receipt);
      // Also run full V2 activation
      const state = runFullActivation(target);
      state.setupSteps.push({ id: "hooks_installed", label: "Claude Code hooks installed", status: r.ok ? "passed" : "blocked", evidencePath: join(target, ".claude", "settings.json") });
      if (r.ok) state.receipts.push({ id: r.receipt.receiptId, path: join(target, ".avorelo", "receipts", `${r.receipt.receiptId}.json`), type: "activation_with_hooks" });
      persistActivationV2(target, state);
      process.stdout.write(JSON.stringify({ ok: r.ok, mode: "activate-with-hooks", target, installed: r.validate.wellFormed, receipt: r.receipt.receiptId }, null, 2) + "\n");
      return r.ok ? 0 : 1;
    } catch (e) {
      process.stderr.write(`ACTIVATION_REFUSED: ${(e as Error).message}\n`);
      return 2;
    }
  }

  // Preflight: detect environment issues before attempting activation
  const preflight = runPreflight(target);
  if (!preflight.canStart) {
    process.stderr.write(formatPreflightReport(preflight));
    process.stderr.write(`\nActivation taxonomy: ${preflight.taxonomy}\n`);
    return 2;
  }
  if (!preflight.ok) {
    process.stderr.write(formatPreflightReport(preflight));
    process.stderr.write("Continuing with activation despite warnings...\n\n");
  }

  // Full V2 activation: detect â†’ repair â†’ run-entry â†’ verify â†’ first-value
  const state = runFullActivation(target);

  // Write activation receipt
  const contract = createWorkContract({ contractId: "canonical-activate", objective: "full local-first activation", allowedPaths: [join(target, ".avorelo")], planTier: "Free" });
  const ledger = new StateLedger();
  const receipt = writeReceipt(ledger, {
    contractId: contract.contractId,
    decision: "STOP_DONE",
    graded: [
      { artifactId: "g1", level: "OUTCOME", ref: "ev:activation-state-written" },
      { artifactId: "g2", level: "POST_ACTION", ref: "ev:activation-verified" },
    ],
    safeNextActions: ["run: avorelo status", "run: avorelo open"],
    decisionBasis: { method: "deterministic", confidence: "HIGH", evidenceRefs: ["ev:activation-state-written", "ev:activation-verified"], reasonCodes: ["FULL_ACTIVATION_V2"], fallbackUsed: false },
    sampleSize: 1,
    redactionClasses: [],
    receiptId: "rcpt_canonical_activation",
  });
  state.receipts.push({ id: receipt.receiptId, path: join(target, ".avorelo", "receipts", `${receipt.receiptId}.json`), type: "canonical_activation" });
  persistActivationV2(target, state);
  persistReceipt(target, receipt);

  // Detect coding agents, tools, and model context
  const detection = runFullDetection(target);

  // Print first-value summary
  const fv = state.firstValue;
  const lines = [
    "",
    "Avorelo activated.",
    "",
    `  Mode:       ${state.activationMode}`,
    `  Scope:      ${scope}`,
    `  Status:     ${state.activationStatus}`,
    `  State:      ${join(target, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE)}`,
  ];
  if (fv.found.length > 0) {
    lines.push("", "  Found:");
    for (const f of fv.found.slice(0, 8)) lines.push(`    ${f}`);
    if (fv.found.length > 8) lines.push(`    ... and ${fv.found.length - 8} more`);
  }
  if (detection.summary.toolsDetected.length > 0) {
    lines.push("", "  Coding tools detected:");
    for (const t of detection.summary.toolsDetected) lines.push(`    ${t}`);
  }
  if (fv.fixed.length > 0) {
    lines.push("", "  Fixed:");
    for (const f of fv.fixed) lines.push(`    ${f}`);
  }
  if (fv.needsAttention.length > 0) {
    lines.push("", "  Needs attention:");
    for (const n of fv.needsAttention) lines.push(`    ${n}`);
  }
  lines.push(
    "",
    `  Run entry:  ${state.runEntry.installed ? "installed" : "not installed"}`,
    `  Production: not ready`,
  );

  lines.push(
    "",
    `  Next: ${fv.nextAction}`,
    "",
  );
  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdPreflight(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const result = runPreflight(target);
  process.stdout.write(formatPreflightReport(result));
  process.stdout.write(`Taxonomy: ${result.taxonomy}\n`);
  return result.canStart ? 0 : 2;
}

function cmdDoctorContext(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  const preflight = runRepoPreflight(target);
  const items = loadContextItems(target);
  const conflicts = loadContextConflicts(target);
  const mode = loadContextMode(target);
  const latestBrief = loadLatestTrustBrief(target);
  const latestReceipt = loadLatestContextReceipt(target);

  const stale = items.filter((i) => i.freshness.status === "stale" || i.freshness.status === "expired");
  const unsafe = items.filter((i) => i.safety.containsSecret || !i.safety.agentVisible);
  const readyClaims = items.filter((i) => /\b(?:production[- ]?ready|deployed|shipped)\b/i.test(i.summary) && i.trust.level !== "verified");

  const checks = [
    { label: "Repo preflight", ok: preflight.ok, detail: preflight.ok ? "source repo detected" : preflight.blockers[0] ?? "failed" },
    { label: "Stale memory", ok: stale.length === 0, detail: stale.length === 0 ? "none" : `${stale.length} stale/expired item(s)` },
    { label: "Unsafe memory", ok: unsafe.length === 0, detail: unsafe.length === 0 ? "none" : `${unsafe.length} unsafe item(s)` },
    { label: "Context conflicts", ok: conflicts.length === 0, detail: conflicts.length === 0 ? "none" : `${conflicts.length} conflict(s)` },
    { label: "Unverified ready claims", ok: readyClaims.length === 0, detail: readyClaims.length === 0 ? "none" : `${readyClaims.length} unverified claim(s)` },
    { label: "Missing receipts", ok: latestReceipt !== null, detail: latestReceipt ? latestReceipt.receiptId : "no receipts found" },
    { label: "Brief available", ok: latestBrief !== null, detail: latestBrief ? "yes" : "not generated" },
  ];

  const allOk = checks.every((c) => c.ok);

  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: allOk, checks, mode: mode?.detectedMode ?? "unknown" }, null, 2) + "\n");
    return allOk ? 0 : 1;
  }

  const lines = ["", "avorelo doctor context", ""];
  for (const c of checks) {
    lines.push(`  ${c.ok ? "PASS" : "FAIL"} ${c.label}: ${c.detail}`);
  }
  lines.push("");
  lines.push(`  Mode: ${mode?.detectedMode ?? "unknown"}`);
  lines.push(`  Status: ${allOk ? "HEALTHY" : "NEEDS ATTENTION"}`);
  lines.push("");
  process.stdout.write(lines.join("\n"));
  return allOk ? 0 : 1;
}

async function cmdDoctor(args: string[]): Promise<number> {
  if (args[0] === "context") return cmdDoctorContext(args.slice(1));
  const target = arg(args, "--target", process.cwd())!;
  const r = doctor(target);
  const detected = detectAllAdapters(target);
  const sessionStatus = getSessionStatus(target);
  const tierMap: Record<string, string> = { "lifecycle-hooks": "A", "instruction-only": "C", "prompt-only": "D", "post-session-only": "D" };

  const lines = ["", "avorelo doctor", ""];
  lines.push("  Adapters:");
  for (const { adapter, detection } of detected) {
    const tier = tierMap[adapter.controlTier] ?? "D";
    const block = adapter.canBlockAction ? "can block" : "cannot block";
    const correct = adapter.canInjectCorrection ? "can correct" : "guidance only";
    lines.push(`    ${adapter.displayName}: Tier ${tier} (${block}, ${correct})`);
    for (const s of detection.signals) lines.push(`      ${s}`);
  }
  lines.push("");
  lines.push(`  Hooks: ${r.ok ? "healthy" : "issues found"} (latency: ${r.hookLatencyMs.toFixed(1)}ms)`);
  for (const c of r.checks) lines.push(`    ${c.ok ? "PASS" : "FAIL"} ${c.label}`);
  if (sessionStatus) {
    lines.push("");
    lines.push(`  Session: ${sessionStatus.status}`);
    lines.push(`    Tier: ${sessionStatus.controlTierLabel}`);
    lines.push(`    Drift: ${sessionStatus.driftSignals}`);
    lines.push(`    Corrections: ${sessionStatus.corrections}`);
    if (sessionStatus.activeSkills.length > 0) lines.push(`    Capabilities: ${sessionStatus.activeSkills.join(", ")}`);
  }
  // Watcher availability
  lines.push("");
  lines.push("  Watcher: available (Tier B near-live file observation)");
  lines.push("    Use: avorelo watch --target .");

  // Monorepo
  const mono = detectMonorepo(target);
  if (mono.isMonorepo) {
    lines.push("");
    lines.push(`  Monorepo: ${mono.strategy} (${mono.workspaces.length} workspaces)`);
    for (const ws of mono.workspaces.slice(0, 5)) {
      lines.push(`    ${ws.relativePath}${ws.hasAgentsMd ? " [AGENTS.md]" : ""}`);
    }
    if (mono.workspaces.length > 5) lines.push(`    ... and ${mono.workspaces.length - 5} more`);
  }

  // Context Check (lightweight inline)
  const ctxResult = runContextCheck({ repoRoot: target, mode: "generic", outputPreference: "human" });
  lines.push("");
  lines.push(`  Context Check: ${ctxResult.status} (${ctxResult.sourcesChecked} source(s), risk=${ctxResult.riskLevel})`);
  if (ctxResult.findings.length > 0) {
    for (const f of ctxResult.findings.slice(0, 3)) lines.push(`    ${f.severity}: ${f.message}`);
  }

  // Model routing health
  try {
    const { getModelRegistry, getLocalModels, getAllProviders, isProviderAvailable } = require("../../kernel/model-routing/index.ts");
    const models = getModelRegistry();
    const localModels = getLocalModels();
    const providers = getAllProviders();
    const healthyProviders = providers.filter((p: any) => isProviderAvailable(p.provider));
    lines.push("");
    lines.push(`  Model Routing: ${models.length} models registered (${localModels.length} local, ${models.length - localModels.length} cloud)`);
    lines.push(`    Providers: ${healthyProviders.length}/${providers.length} healthy (local-first, no credentials required)`);
    lines.push(`    Safety: modelMayDecide=false, scannerMayDecide=false, upgrade-only session memory`);
  } catch {
    lines.push("");
    lines.push("  Model Routing: unavailable");
  }

  // Feedback
  const fbConfig = getFeedbackConfig(target);
  lines.push("");
  lines.push(`  Feedback: ${fbConfig.enabled ? "enabled (opt-in)" : "disabled (default)"}`);
  lines.push(`  Support bundles: ${fbConfig.allowSupportBundles ? "available" : "disabled"}`);

  lines.push("");

  lines.push("");
  process.stdout.write(lines.join("\n"));
  return r.ok ? 0 : 1;
}

function cmdInit(args: string[]): number {
  // Local-first first-run entry. Initializes <target>/.avorelo/ and writes the avorelo.activation.v1
  // contract. No signup, no cloud credentials, no network beyond local git, no auth, no source dump.
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const reset = args.includes("--reset");

  const result = initWorkspace(target, { reset });
  if (!result.ok) {
    const msg = { ok: false, reason: result.reason, target };
    if (asJson) { process.stdout.write(JSON.stringify(msg, null, 2) + "\n"); return 1; }
    process.stderr.write([
      "",
      `Could not initialize Avorelo here: ${result.reason}.`,
      result.reason === "target_does_not_exist" ? "  The --target path does not exist." :
      result.reason === "target_not_a_directory" ? "  The --target path is not a directory." :
      result.reason?.includes("writable") ? "  The target (or its .avorelo directory) is not writable." :
      "  Check the --target path and permissions.",
      "",
    ].join("\n"));
    return 1;
  }

  // Ensure settings exist and show alpha notice on first init.
  const settings = ensureSettings(target, { workspaceId: result.contract!.workspaceId });
  if (result.created && !settings.alphaParticipation.noticeShownAt) {
    settings.alphaParticipation.noticeShownAt = new Date().toISOString();
    try { writeSettings(target, settings); } catch {}
  }

  if (asJson) { process.stdout.write(JSON.stringify(result.contract, null, 2) + "\n"); return 0; }
  const c = result.contract!;

  if (result.created) {
    process.stdout.write("\n" + ALPHA_NOTICE + "\n");
  }

  process.stdout.write([
    "",
    result.created ? "Avorelo initialized locally." : "Avorelo workspace refreshed (already initialized).",
    `  Workspace:  local (${c.workspaceId})`,
    `  Target:     ${c.target}`,
    `  Detected:   ${[c.gitDetected ? "git" : "no-git", c.packageDetected ? `package (${c.packageManager ?? "npm"})` : "no-package"].join(", ")}`,
    `  Updates:    explicit only — run \`avorelo update check\``,
    "",
    "  Next:",
    "    1. avorelo status --target .",
    "    2. avorelo run \"run tests\" --target .",
    "    3. avorelo control-center --target .",
    "",
  ].join("\n"));
  return 0;
}

function cmdDogfoodCheck(args: string[]): number {
  // Read-only readiness summary for an external dogfood tester. Collects nothing, uploads nothing, no network.
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const result = buildDogfoodCheck(target, { now: Date.now() });
  if (asJson) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); return 0; }
  process.stdout.write(renderDogfoodCheck(result));
  return 0;
}

function cmdDogfoodSummary(args: string[]): number {
  // Safe, read-only pre-send summary a tester reviews before giving feedback. Collects/uploads nothing.
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const result = buildDogfoodSummary(target, { now: Date.now() });
  if (asJson) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); return 0; }
  process.stdout.write(renderDogfoodSummary(result));
  return 0;
}

function cmdCoreReadiness(args: string[]): number {
  // Capstone PRODUCT-CORE verdict (private-alpha readiness). Read-only; assesses the Avorelo build.
  const asJson = args.includes("--json");
  const report = buildCoreReadiness({ now: Date.now() });
  if (asJson) { process.stdout.write(JSON.stringify(report, null, 2) + "\n"); return 0; }
  process.stdout.write(renderCoreReadiness(report));
  return report.result === "CORE_NOT_READY" ? 1 : 0;
}

function cmdStatus(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  // Local first-run view: if a workspace exists (or none of the heavier activation state does), report the
  // lightweight activation.v1 status and guide the next command. This is the path a new user follows.
  const workspace = loadWorkspace(target);
  const raw = readActivationState(target);
  if (asJson) {
    const contract = buildActivationContract(target);
    const latest = loadLatestRuntimeSession(target);
    process.stdout.write(JSON.stringify({
      activation: contract,
      runtimeSession: latest ? { runtimeSessionId: latest.runtimeSessionId, status: latest.status, gate: latest.gate } : null,
      hooksActivation: raw ? (raw as any).activationStatus ?? null : null,
    }, null, 2) + "\n");
    return 0;
  }
  if (workspace && !raw) {
    const contract = buildActivationContract(target);
    const latest = loadLatestRuntimeSession(target);
    process.stdout.write([
      "avorelo status",
      `  target:       ${target}`,
      `  initialized:  yes (${contract.workspaceId})`,
      `  detected:     ${[contract.gitDetected ? "git" : "no-git", contract.packageDetected ? "package" : "no-package"].join(", ")}`,
      `  workspace:    local-only Â· cloud not claimed`,
      `  last run:     ${latest ? `${latest.status} (${latest.runtimeSessionId})` : "none yet"}`,
      `  routing:      seamless model routing active (local-first, no credentials required)`,
      `  control ctr:  available â€” avorelo control-center --target .`,
      `  next:         ${contract.firstRunRecommended.command} â€” ${contract.firstRunRecommended.reason}`,
      "",
    ].join("\n"));
    return 0;
  }
  const v = validateInstall(target);

  if (!raw) {
    process.stdout.write([
      "avorelo status",
      `  target:       ${target}`,
      "  initialized:  no",
      "  workspace:    local-only Â· cloud not claimed",
      "  next:         avorelo init --target . â€” initialize the local workspace (no signup, no cloud)",
      "  (optional)    avorelo activate --target . â€” install AI-tool hooks for live session control",
      "",
    ].join("\n"));
    return 0;
  }

  // Handle both V1 and V2 state
  const state = raw as any;
  const isV2 = state.contract === "avorelo.activationState.v2";
  const lines = [
    "avorelo status",
    `  target:       ${target}`,
    `  activation:   ${state.activationStatus}`,
    `  mode:         ${state.activationMode}`,
    `  contract:     ${state.contract}`,
    `  state:        ${join(target, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE)}`,
    `  hooks:        ${v.installed ? (v.wellFormed ? "installed (6/6)" : `partial`) : "not installed"}`,
  ];
  if (isV2) {
    const env = state.environment || {};
    const tools = state.aiTools || {};
    const re = state.runEntry || {};
    lines.push(
      `  environment:  ${env.os || "?"} / Node ${env.nodeVersion || "?"} / ${env.packageManager || "?"} / ${env.framework || "none"}`,
      `  ai tools:     ${[tools.claudeCodeDetected && "Claude Code", tools.cursorDetected && "Cursor", tools.codexDetected && "Codex", tools.claudeMdDetected && "CLAUDE.md", tools.agentsMdDetected && "AGENTS.md"].filter(Boolean).join(", ") || "none detected"}`,
      `  run entry:    ${re.installed ? "installed" : "not installed"}`,
    );
  }
  lines.push(
    `  production:   ${state.productionReady ? "READY" : "NOT READY"}`,
    `  next:         ${state.firstValue?.nextAction || state.nextAction?.command || state.nextAction?.label || "run: npx avorelo activate"}`,
  );
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

function cmdOpen(args: string[]): number {
  // `avorelo open --control-center` renders the unified read-only Control Center; otherwise the receipts dashboard.
  if (args.includes("--control-center")) return cmdControlCenter(args);
  const target = arg(args, "--target", process.cwd())!;
  const format = arg(args, "--format", "html")!;
  const now = Date.now();
  if (format === "json") { const { model } = openDashboard(target, { now }); process.stdout.write(JSON.stringify(model, null, 2) + "\n"); return 0; }
  if (format === "text") { const { model } = openDashboard(target, { now }); process.stdout.write(renderText(model)); return 0; }
  const { htmlPath, model } = openDashboard(target, { now });
  process.stdout.write(JSON.stringify({ ok: true, htmlPath, totals: model.totals }, null, 2) + "\n");
  process.stdout.write("Tip: for the full local operator view (runtime, proof, value, continuity), run: avorelo control-center --target .\n");
  return 0;
}

function cmdControlCenter(args: string[]): number {
  // Minimal, local-first, READ-ONLY operator surface over the local .avorelo/ artifacts. No network, no server.
  const target = arg(args, "--target", process.cwd())!;
  // Accept `--json` as an alias for `--format json` for consistency with init/status/dogfood-check.
  const format = args.includes("--json") ? "json" : arg(args, "--format", "html")!;
  const now = Date.now();
  if (format === "json") { process.stdout.write(JSON.stringify(buildControlCenter(target, { now }), null, 2) + "\n"); return 0; }
  if (format === "text") { process.stdout.write(renderControlCenterText(buildControlCenter(target, { now }))); return 0; }
  const { htmlPath, model } = openControlCenter(target, { now });
  process.stdout.write(JSON.stringify({ ok: true, htmlPath, runtime: model.sections.runtimeSession.status, sources: model.sources.length }, null, 2) + "\n");
  return 0;
}

function browserQaDefaultTarget(): string {
  return join(import.meta.dirname, "..", "public-web", "static");
}

function browserQaRoutesFromArgs(args: string[]): BrowserQaRouteInput[] | undefined {
  const singles = multiArg(args, "--route");
  const csv = (arg(args, "--routes") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const combined = [...singles, ...csv];
  if (combined.length === 0) return undefined;
  return combined.map((route) => ({ route }));
}

function browserQaExitCode(decision: string): number {
  return decision === "PASS" || decision === "PASS_WITH_WARNINGS" ? 0 : 1;
}

async function cmdBrowserQa(args: string[]): Promise<number> {
  const area = args[0];
  const sub = args[1];
  const rest = args.slice(2);
  if (area !== "qa") {
    process.stderr.write("Usage: avorelo browser qa <run|latest|explain> [--target <dir>] [--json]\n");
    return 2;
  }

  const targetDir = arg(rest, "--target", process.cwd())!;
  const asJson = rest.includes("--json");

  if (sub === "latest" || sub === "explain") {
    const artifact = readBrowserQaLatest(targetDir);
    if (!artifact) {
      process.stderr.write("No Browser QA artifact found. Run: avorelo browser qa run [--target <dir>]\n");
      return 1;
    }
    if (asJson) {
      process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
      return browserQaExitCode(artifact.decision);
    }
    process.stdout.write(sub === "latest" ? renderBrowserQaSummary(artifact) : renderBrowserQaExplain(artifact));
    return browserQaExitCode(artifact.decision);
  }

  if (sub !== "run") {
    process.stderr.write("Usage: avorelo browser qa <run|latest|explain> [--target <dir>] [--json]\n");
    return 2;
  }

  const requestedPolicy = arg(rest, "--screenshot-policy") as BrowserQaScreenshotPolicy | undefined;
  const screenshotPolicy = normalizeScreenshotPolicy(requestedPolicy, {
    safeCapture: rest.includes("--safe-capture"),
    metadataOnly: rest.includes("--metadata-only"),
    noScreenshots: rest.includes("--no-screenshots"),
  });
  const timeoutRaw = Number(arg(rest, "--timeout", "10000"));
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10000;
  const artifact = await runBrowserVisualQa({
    dir: targetDir,
    target: arg(rest, "--browser-target", browserQaDefaultTarget()) ?? browserQaDefaultTarget(),
    routes: browserQaRoutesFromArgs(rest),
    timeoutMs,
    screenshotPolicy,
    allowLocalhostOnly: parseBooleanFlag(arg(rest, "--allow-localhost-only"), true),
    staging: rest.includes("--staging"),
  });
  if (asJson) {
    process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
    return browserQaExitCode(artifact.decision);
  }
  process.stdout.write(renderBrowserQaSummary(artifact));
  return browserQaExitCode(artifact.decision);
}

function cmdVerify(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const stateVerify = verifyActivationState(target);
  if (!stateVerify.valid) {
    process.stdout.write(JSON.stringify({ scope: "activation-state", valid: false, checks: stateVerify.checks }, null, 2) + "\n");
    const repair = repairActivationState(target);
    process.stdout.write(`Repair: ${repair.message}\n`);
    return 1;
  }
  const input = loadProofInput(target);
  if (input) {
    const contract = createWorkContract({ contractId: "verify", objective: input.objective ?? "verify real-workflow proof", allowedPaths: [join(target, "src")], planTier: "Free" });
    const r = evaluateProof({ contract, artifacts: input.artifacts, readbacks: input.readbacks, dir: target, sampleSize: input.sampleSize, receiptId: "rcpt_verify" });
    process.stdout.write(JSON.stringify({ scope: "full", activationState: { valid: true }, proof: { decision: r.decision, confidence: r.confidence } }, null, 2) + "\n");
    return r.decision === "STOP_DONE" ? 0 : 1;
  }
  process.stdout.write(JSON.stringify({ scope: "activation-state", valid: true, checks: stateVerify.checks }, null, 2) + "\n");
  return 0;
}

function cmdSite(args: string[]): number {
  const outDir = arg(args, "--out", join(process.cwd(), ".avorelo", "site"))!;
  const r = buildSite(outDir);
  process.stdout.write(JSON.stringify({ ok: r.ok, outDir: r.outDir, indexPath: r.indexPath, pages: r.pages }, null, 2) + "\n");
  return r.ok ? 0 : 1;
}

function cmdServe(args: string[]): number {
  const outDir = arg(args, "--out", join(process.cwd(), ".avorelo", "site"))!;
  const port = Number(arg(args, "--port", "0"));
  buildSite(outDir);
  serve(outDir, { port: Number.isFinite(port) ? port : 0 })
    .then((h) => {
      process.stdout.write(["", "Avorelo preview is running.", "", "Open:",
        `  Landing:      ${h.url}`, `  Activate:     ${h.url}activate.html`,
        `  Capabilities: ${h.url}capabilities.html`, `  Local viewer: ${h.url}dashboard.html`,
        `  Pricing:      ${h.url}pricing.html`, `  Articles:     ${h.url}articles.html`,
        "", "Press Ctrl+C to stop.", ""].join("\n"));
      const stop = () => h.close().then(() => process.exit(0));
      process.on("SIGINT", stop); process.on("SIGTERM", stop);
    })
    .catch((e) => { process.stderr.write(`SERVE_FAILED: ${(e as Error).message}\n`); process.exit(1); });
  return 0;
}

function readStdinJson(): Record<string, unknown> {
  try { const raw = readFileSync(0, "utf8"); return raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { return {}; }
}

function mapClaudeCodeEvent(ev: Record<string, unknown>, cwd: string): ToolRequest {
  const toolName = String(ev.tool_name ?? "").toLowerCase();
  const ti = (ev.tool_input ?? {}) as Record<string, unknown>;
  const tool = toolName.includes("bash") ? "bash" : /write|edit/.test(toolName) ? "edit" : toolName.includes("webfetch") ? "web_fetch" : toolName || "unknown";
  const content = ti.command ?? ti.content ?? ti.new_string ?? (Object.keys(ti).length ? JSON.stringify(ti) : undefined);
  const writePath = typeof ti.file_path === "string" ? ti.file_path : undefined;
  return { tool, writePath, content, workingDir: cwd };
}

function cmdLifecycleHook(args: string[]): number {
  const payloadRaw = arg(args, "--payload");
  const ccEvent = payloadRaw ? (JSON.parse(payloadRaw) as Record<string, unknown>) : readStdinJson();
  const event = String(ccEvent.hook_event_name ?? args[0] ?? "PreToolUse");
  const cwd = String(ccEvent.cwd ?? process.cwd());

  // PostToolUse (Phase 2 Secret Boundary): redact tool output BEFORE it reaches model context, and write a
  // redacted secret-boundary receipt. Additive â€” PreToolUse behavior below is unchanged.
  if (event === "PostToolUse") {
    const toolOutput = ccEvent.tool_response ?? ccEvent.tool_output ?? (ccEvent as Record<string, unknown>).output ?? "";
    const sourceLabel = String(ccEvent.tool_name ?? "").toLowerCase().includes("mcp") ? "tool_output" : "tool_output";
    const r = scanContent({ content: toolOutput, sourceKind: sourceLabel as "tool_output" });
    try {
      const dir = join(cwd, ".avorelo", "secret-boundary"); mkdirSync(dir, { recursive: true });
      // The receipt is already coded/redacted; defense-in-depth redact again before writing.
      appendFileSync(join(dir, "receipts.jsonl"), JSON.stringify(redact(r.receipt).value) + "\n");
    } catch {}
    // Emit redacted output (updatedToolOutput / updatedMcpToolOutput) â€” adapter wires these where supported.
    process.stdout.write(JSON.stringify({
      event: "PostToolUse",
      decision: r.decision,
      findingCodes: r.findings.map(f => f.code),
      secretCount: r.findings.length,
      modelSawSecret: false,
      cloudEligible: r.cloudEligible,
      updatedToolOutput: r.redacted,
      updatedMcpToolOutput: r.redacted,
    }) + "\n");
    return 0;
  }

  const looksLikeToolRequest = payloadRaw && (ccEvent as any).tool !== undefined && (ccEvent as any).workingDir !== undefined;
  const req: ToolRequest = looksLikeToolRequest ? (ccEvent as unknown as ToolRequest) : mapClaudeCodeEvent(ccEvent, cwd);
  const contract = createWorkContract({ contractId: "hook", objective: "lifecycle hook", allowedPaths: [join(cwd, "src")], planTier: "Free" });
  const r = handleLifecycleHook(event, req, { contract });
  try {
    const dir = join(cwd, ".avorelo", "events"); mkdirSync(dir, { recursive: true });
    const entry = redact({ ts: Date.now(), event: r.event, tool: req.tool, verdict: r.verdict, reasonCodes: r.reasonCodes, redactionClasses: r.redactionClasses, latencyMs: r.latencyMs }).value;
    appendFileSync(join(dir, "hook-fires.jsonl"), JSON.stringify(entry) + "\n");
  } catch {}
  if (r.exitCode === 2) { process.stderr.write(`avorelo blocked ${r.event} (${req.tool}): ${r.reasonCodes.join(", ")}\n`); return 2; }
  process.stdout.write(JSON.stringify({ event: r.event, verdict: r.verdict, reasonCodes: r.reasonCodes, redactionClasses: r.redactionClasses, latencyMs: Number(r.latencyMs.toFixed(3)) }) + "\n");
  return 0;
}

// Legacy hosted commands (claim/sync/billing) are discontinued in Community Edition.
// This tombstone only informs a user who invokes the old command; it calls NO hosted code,
// makes NO network request, reads NO account state, and writes NO hosted state.
// Removed from help/discovery; scheduled for full removal with the hosted transport layer.
function cmdCloudDiscontinued(command: string): number {
  const messages: Record<string, string> = {
    claim: "Avorelo account linking has been discontinued. Community Edition operates locally.",
    sync: "Avorelo cloud sync has been discontinued. Receipts and state remain local.",
    billing: "Avorelo hosted billing has been discontinued. Community Edition has no plans or subscriptions.",
  };
  const msg = messages[command]
    ?? "Avorelo hosted services (account linking, cloud sync, billing) have been discontinued. Community Edition operates locally.";
  process.stdout.write(`\n${msg}\n\n`);
  return 0;
}

function cmdStart(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const objective = arg(args, "--objective");

  // Community Edition: no automatic update notice or registry check. Use `avorelo update check`.

  const result = startSession(target, { objective: objective ?? undefined });

  if (!result.ok) {
    process.stderr.write("Avorelo could not start.\n");
    return 1;
  }

  const lines = ["", result.message, ""];
  if (args.includes("--verbose")) {
    lines.push(
      `  Session:    ${result.session.sessionId}`,
      `  Tier:       ${result.controlTierLabel} (${result.controlTier})`,
      `  Adapters:   ${result.adaptersInstalled.join(", ") || "none"}`,
    );
  }
  if (result.warnings.length > 0) {
    for (const w of result.warnings) lines.push(`  Note: ${w}`);
  }
  lines.push("", "  Keep using your AI coding tool. Avorelo will save proof locally.", "");
  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdRunTask(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  if (args.includes("--fixture")) return cmdRun(args);

  const task = args.find(a => !a.startsWith("--") && a !== target);
  if (!task) {
    process.stderr.write("Usage: avorelo run \"<task>\" [--target <dir>]\n");
    return 2;
  }

  // Runtime Product Flow v1: one coherent session that wires Secret Boundary + Routing â†’ Session â†’
  // Context â†’ Continuity â†’ Token/Cost Evidence â†’ Proof â†’ Value Ledger â†’ Efficiency Sync (dry-run).
  // The orchestrator consumes each capability; it never reimplements one, never invents numbers, never
  // claims savings, and performs no network I/O. The raw `task` is only used in-memory for routing /
  // secret detection â€” only the REDACTED displayTask is printed, persisted, or passed downstream.
  const { record, gate, displayTask } = runRuntimeSession({ task, dir: target });
  const c = record;
  const contractLine = `  Contract:   ${record.routingSummary}`;

  if (gate === "blocked") {
    process.stderr.write([
      "",
      `Blocked: ${record.route === "blocked" ? "secret-exfiltration / unsafe task" : "policy"} â€” route=${record.route}.`,
      contractLine,
      `  Safety:     boundary=${c.safetyBoundary.secretBoundaryDecision} safeRun=${c.safetyBoundary.safeRunDecision} risk=${c.safetyBoundary.secretRiskCodes.join(",") || "none"}`,
      "  Use a SafeReference (avorelo secret-boundary scan); never print raw secrets.",
      "",
    ].join("\n"));
    return 1;
  }

  if (gate === "require_approval") {
    process.stdout.write([
      "",
      `Requires approval before this task can run.`,
      contractLine,
      `  Why:        approvalPolicy=${record.approvalPolicy}; proof required=${record.proofTier}`,
      "  Re-run with explicit approval once you have confirmed scope.",
      "",
    ].filter(Boolean).join("\n"));
    return 0;
  }

  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(record, null, 2) + "\n");
    return 0;
  }

  // Coherent, honest, layer-by-layer summary. Every line is a reference to a local artifact.
  const lines = ["", `Session ready for: ${displayTask}`, "", contractLine, ""];
  lines.push("  Runtime flow (all local, redacted, no network):");
  for (const l of record.layers) {
    const mark = l.status === "completed" ? "+" : l.status === "blocked" ? "x" : "Â·";
    lines.push(`    ${mark} ${l.layer.padEnd(24)} ${l.detail}`);
  }
  if (record.proof) {
    lines.push("", `  Savings:    ${record.proof.canShowSavings ? "shown" : `not claimed (${record.proof.savingsRefusalReason ?? "no_comparative_evidence"})`}`);
  }
  if (args.includes("--verbose")) {
    lines.push(
      "",
      `  RuntimeSession: ${record.runtimeSessionId}`,
      `  Session:    ${record.session?.sessionId ?? "n/a"}`,
      `  Tier:       ${record.session?.controlTierLabel ?? "?"} (${record.session?.controlTier ?? "?"})`,
      `  Adapters:   ${record.session?.adapters.join(", ") || "none"}`,
      `  TokenCost:  ${record.tokenCost?.confidence ?? "n/a"} (costSummary=${record.tokenCost?.canShowCostSummary ?? false})`,
      `  Sync:       dry-run envelope ${record.efficiencySync?.envelopeId ?? "n/a"} (eligible=${record.efficiencySync?.eligibleCount ?? 0})`,
    );
    if (record.modelRouting) {
      const mr = record.modelRouting;
      lines.push(`  Routing:    primitive=${mr.selectedPrimitive} profile=${mr.selectedModelProfile}`);
      lines.push(`  Resolver:   ${mr.resolverStatus} provider=${mr.providerClass ?? "n/a"}`);
      lines.push(`  Safety:     modelMayDecide=${mr.modelMayDecide} scannerMayDecide=${mr.scannerMayDecide} owner=${mr.finalDecisionOwner}`);
      if (mr.reasonCodes?.length) lines.push(`  Reasons:    ${mr.reasonCodes.join(", ")}`);
    }
  }
  lines.push("", "  Keep using your AI coding tool. Avorelo will save proof locally.", "");
  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdReadiness(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const report = buildCanonicalReadinessReport(target);
  if (asJson) { process.stdout.write(JSON.stringify(report, null, 2) + "\n"); return 0; }
  const s = summarizeCanonicalReadiness(report);
  const lines = [
    "",
    `Avorelo Canonical Readiness (${report.contract})`,
    `  Result:     ${report.result.toUpperCase()}`,
    `  Phases:     ${s.phasesImplemented}/${s.phasesTotal} implemented`,
    `  Old-repo:   ${report.oldRepoCapabilityCoverage.filter((c) => c.canonicalEvidence.length > 0).length}/${report.oldRepoCapabilityCoverage.length} capabilities with canonical evidence`,
    `  Invariants: ${Object.values(report.invariants).filter(Boolean).length}/${Object.keys(report.invariants).length} holding`,
    `  Blockers:   ${report.blockers.length}${report.blockers.length ? " â€” " + report.blockers.join("; ") : ""}`,
    `  Limitations: ${report.limitations.length}`,
    ...report.limitations.map((l) => `    - ${l}`),
    "  Next track:",
    ...report.nextTrackRecommendations.map((r) => `    - ${r}`),
    "",
  ];
  process.stdout.write(lines.join("\n"));
  return report.result === "not_ready" ? 1 : 0;
}

function ensureWorkIntelligence(target: string) {
  return loadLatestWorkIntelligence(target) ?? upsertWorkIntelligence(target).model;
}

function cmdWork(args: string[]): number {
  const sub = args[0];
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  if (!sub) {
    process.stderr.write("Usage: avorelo work <latest|memory|resume-packet|relevance|context-waste|hygiene|receipt-hygiene|artifact-hygiene|capability-hygiene|export> [--target <dir>] [--json]\n");
    return 2;
  }

  const model = ensureWorkIntelligence(target);
  const packet = loadLatestWorkResumePacket(target) ?? upsertWorkIntelligence(target).resumePacket;

  if (sub === "latest") {
    if (asJson) {
      process.stdout.write(JSON.stringify(model.outcomeReceipt360, null, 2) + "\n");
      return 0;
    }
    process.stdout.write(renderWorkIntelligenceText(model));
    return model.outcomeReceipt360.outcomeStatus === "blocked" ? 1 : 0;
  }

  if (sub === "memory") {
    const payload = {
      historyDepthAvailable: model.workMemory.historyDepthAvailable,
      repeatedSetupCount: model.workMemory.repeatedSetupCount,
      crossSessionSignals: model.workMemory.crossSessionSignals,
      confidence: model.workMemory.confidence,
    };
    if (asJson) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return 0;
    }
    process.stdout.write([
      "",
      "Work memory",
      `  History:    ${payload.historyDepthAvailable} session(s) visible`,
      `  Repeats:    ${payload.repeatedSetupCount}`,
      `  Confidence: ${payload.confidence}`,
      ...payload.crossSessionSignals.map((signal) => `  Signal:     ${signal}`),
      "",
    ].join("\n"));
    return 0;
  }

  if (sub === "resume-packet") {
    const agent = (arg(args, "--agent", "generic") ?? "generic") as "claude_code" | "codex" | "cursor" | "generic";
    if (asJson) {
      process.stdout.write(JSON.stringify(packet, null, 2) + "\n");
      return packet.resumeReadiness === "blocked" ? 1 : 0;
    }
    process.stdout.write(renderWorkResumePacket(packet, agent) + "\n");
    return packet.resumeReadiness === "blocked" ? 1 : 0;
  }

  if (sub === "relevance") {
    const payload = model.workspaceMap;
    if (asJson) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return payload.missingObviousReferences.length > 0 ? 1 : 0;
    }
    const lines = [
      "",
      "Workspace relevance",
      ...payload.references.map((reference) => `  ${reference.label} (${reference.kind}) -> ${reference.relevance}/${reference.exists}`),
      ...payload.missingObviousReferences.map((item) => `  Missing:    ${item}`),
      ...payload.repeatedIrrelevantReferences.map((item) => `  Repeated:   ${item}`),
      "",
    ];
    process.stdout.write(lines.join("\n"));
    return payload.missingObviousReferences.length > 0 ? 1 : 0;
  }

  if (sub === "context-waste") {
    const payload = model.contextWaste;
    if (asJson) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return payload.warnings.length > 0 ? 1 : 0;
    }
    const lines = [
      "",
      `Context waste: ${payload.level}`,
      ...payload.warnings.map((warning) => `  ${warning.severity.toUpperCase()}: ${warning.summary}`),
      ...payload.topAdvice.map((advice) => `  Next:       ${advice}`),
      "",
    ];
    process.stdout.write(lines.join("\n"));
    return payload.warnings.length > 0 ? 1 : 0;
  }

  if (sub === "receipt-hygiene") {
    const payload = model.hygiene.receipt;
    if (asJson) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return payload.warnings.length > 0 ? 1 : 0;
    }
    process.stdout.write(["", `Receipt hygiene: ${payload.status}`, ...payload.warnings.map((warning) => `  ${warning.severity.toUpperCase()}: ${warning.summary}`), ""].join("\n"));
    return payload.warnings.length > 0 ? 1 : 0;
  }

  if (sub === "artifact-hygiene") {
    const payload = model.hygiene.artifact;
    if (asJson) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return payload.warnings.length > 0 ? 1 : 0;
    }
    process.stdout.write(["", `Artifact hygiene: ${payload.status}`, ...payload.warnings.map((warning) => `  ${warning.severity.toUpperCase()}: ${warning.summary}`), ""].join("\n"));
    return payload.warnings.length > 0 ? 1 : 0;
  }

  if (sub === "capability-hygiene") {
    const payload = model.hygiene.capability;
    if (asJson) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return payload.warnings.length > 0 ? 1 : 0;
    }
    process.stdout.write(["", `Capability hygiene: ${payload.status}`, ...payload.warnings.map((warning) => `  ${warning.severity.toUpperCase()}: ${warning.summary}`), ""].join("\n"));
    return payload.warnings.length > 0 ? 1 : 0;
  }

  if (sub === "hygiene") {
    const payload = model.hygiene;
    const warningCount = payload.receipt.warnings.length + payload.artifact.warnings.length + payload.capability.warnings.length;
    if (asJson) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return warningCount > 0 ? 1 : 0;
    }
    const lines = [
      "",
      `Hygiene: receipt=${payload.receipt.status} artifact=${payload.artifact.status} capability=${payload.capability.status}`,
      ...payload.receipt.warnings.map((warning) => `  RECEIPT ${warning.severity.toUpperCase()}: ${warning.summary}`),
      ...payload.artifact.warnings.map((warning) => `  ARTIFACT ${warning.severity.toUpperCase()}: ${warning.summary}`),
      ...payload.capability.warnings.map((warning) => `  CAPABILITY ${warning.severity.toUpperCase()}: ${warning.summary}`),
      "",
    ];
    process.stdout.write(lines.join("\n"));
    return warningCount > 0 ? 1 : 0;
  }

  if (sub === "export") {
    const agent = (arg(args, "--agent", "generic") ?? "generic") as "claude_code" | "codex" | "cursor" | "generic";
    if (asJson) {
      process.stdout.write(JSON.stringify({ model, resumePacket: packet }, null, 2) + "\n");
      return 0;
    }
    process.stdout.write(renderShareSafeSummary(model, packet, agent) + "\n");
    return 0;
  }

  process.stderr.write("Usage: avorelo work <latest|memory|resume-packet|relevance|context-waste|hygiene|receipt-hygiene|artifact-hygiene|capability-hygiene|export> [--target <dir>] [--json]\n");
  return 2;
}

function cmdValue(args: string[]): number {
  const sub = args[0];
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  // record: derive ledger entries from the latest local proof report and append them.
  if (sub === "record") {
    const report = buildProofReportFromLocalEvidence(target);
    const entries = entriesFromProofReport(report);
    for (const e of entries) { try { appendValueLedgerEntry(target, e); } catch {} }
    try { writeValueCards(target, loadValueLedgerEntries(target)); } catch {}
    if (asJson) { process.stdout.write(JSON.stringify({ recorded: entries.length }, null, 2) + "\n"); return 0; }
    process.stdout.write(`\nRecorded ${entries.length} value ledger entr(ies) from report ${report.reportId}.\n\n`);
    return 0;
  }

  if (sub === "ledger") {
    const entries = loadValueLedgerEntries(target);
    if (asJson) { process.stdout.write(JSON.stringify(entries, null, 2) + "\n"); return 0; }
    process.stdout.write(["", `Value ledger: ${entries.length} entr(ies)`, ...entries.map((e) => `  [${e.confidence}] ${e.category}: ${e.summary}`), ""].join("\n"));
    return 0;
  }

  if (sub === "cards" || sub === undefined) {
    const cards = buildCompactValueCards(loadValueLedgerEntries(target));
    if (asJson) { process.stdout.write(JSON.stringify(cards, null, 2) + "\n"); return 0; }
    process.stdout.write(["", "Avorelo Value Cards (compact, confidence-labelled)", "",
      ...cards.map((c) => `  ${c.title}: ${c.status} â€” ${c.valueLabel}`),
      "", "  (value aggregated from evidence; never invented â€” no ROI, no fake savings)", ""].join("\n"));
    return 0;
  }

  process.stderr.write("Usage: avorelo value <cards|ledger|record> [--target <dir>] [--json]\n");
  return 2;
}

function cmdReport(args: string[]): number {
  const sub = (args[0] && !args[0].startsWith("--")) ? args[0] : undefined; // build|summarize|undefined
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  const report = buildProofReportFromLocalEvidence(target);
  if (sub === "build") { try { writeProofReport(target, report); } catch {} }

  if (sub === "summarize") {
    const s = summarizeProofReport(report);
    if (asJson) { process.stdout.write(JSON.stringify(s, null, 2) + "\n"); return 0; }
    process.stdout.write(`\nProof report ${s.reportId}: found=${s.sections.found} protected=${s.sections.protected} verified=${s.sections.verified} needsAttention=${s.sections.needsAttention} next=${s.sections.next}\n  Cost summary: ${s.canShowCostSummary ? "available" : "unavailable"} | Savings: ${s.canShowSavings ? "shown" : "unavailable (" + s.savingsRefusalReason + ")"}\n\n`);
    return 0;
  }

  if (asJson) { process.stdout.write(JSON.stringify(report, null, 2) + "\n"); return 0; }

  const sec = report.sections;
  const sv = sec.savedOrAvoided;
  const lines = [
    "", `Avorelo Proof Report (${report.contract})`, "",
    `  Found:          ${sec.found.length}${sec.found.length ? " â€” " + sec.found.map(i => i.code).join(", ") : ""}`,
    `  Protected:      ${sec.protected.length}${sec.protected.length ? " â€” " + sec.protected.map(i => i.code).join(", ") : ""}`,
    `  Fixed/Prepared: ${sec.fixedOrPrepared.length}`,
    `  Verified:       ${sec.verified.length}`,
    `  Needs attention: ${sec.needsAttention.length}${sec.needsAttention.length ? " â€” " + sec.needsAttention.map(i => i.summary).join("; ") : ""}`,
    `  Next:           ${sec.next.length}${sec.next.length ? " â€” " + sec.next.map(i => i.summary).join("; ") : ""}`,
    "",
    `  Token/cost evidence: ${report.evidenceSummary.tokenCostEvidenceCount} (measured=${report.evidenceSummary.measuredCount} imported=${report.evidenceSummary.importedCount} estimated=${report.evidenceSummary.estimatedCount} inferred=${report.evidenceSummary.inferredCount} unavailable=${report.evidenceSummary.unavailableCount})`,
    `  Cost evidence:  ${report.evidenceSummary.canShowCostSummary ? "available (" + (sv.costSummary?.confidence) + ")" : "unavailable"}`,
    `  Saved or avoided: ${sv.savingsClaimAllowed ? `${sv.savingsAmount} ${sv.savingsCurrency}` : "unavailable â€” " + sv.refusalReason}`,
    "  (savings require eligible comparative evidence; never invented)",
    "",
  ];
  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdTokenCost(args: string[]): number {
  const sub = args[0];
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  if (sub === "unavailable") {
    const reason = arg(args, "--reason", "no_token_usage_evidence")!;
    const e = createUnavailableTokenCostEvidence(reason, "manual_import");
    if (asJson) { process.stdout.write(JSON.stringify(e, null, 2) + "\n"); return 0; }
    process.stdout.write(["", "Token/Cost Evidence: UNAVAILABLE", `  Reason:     ${reason}`, "  Tokens:     null (unavailable is not zero)", "  Cost:       null", "  Savings:    not claimable (evidence only)", ""].join("\n"));
    return 0;
  }

  if (sub === "import" || sub === "validate") {
    const file = arg(args, "--file");
    if (!file || !existsSync(file)) { process.stderr.write("Usage: avorelo token-cost " + sub + " --file <path> [--json]\n"); return 2; }
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { process.stderr.write("Invalid JSON file.\n"); return 1; }
    const result = importTokenCostEvidence(parsed);
    if (!result.ok) {
      // Report rejected FIELD NAMES only â€” never raw values.
      const payload = { ok: false, rejectedFields: result.rejectedFields, reasons: result.reasons };
      if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return 1; }
      process.stdout.write(["", "Import REJECTED (raw values never shown).", result.rejectedFields.length ? `  Forbidden fields: ${result.rejectedFields.join(", ")}` : "", `  Reasons: ${result.reasons.join(", ")}`, ""].filter(Boolean).join("\n"));
      return 1;
    }
    if (sub === "validate") {
      const v = validateTokenCostEvidence(result.evidence);
      if (asJson) { process.stdout.write(JSON.stringify(v, null, 2) + "\n"); return v.valid ? 0 : 1; }
      process.stdout.write(`\nToken/Cost Evidence valid: ${v.valid}${v.valid ? "" : " â€” " + v.reasons.join(", ")}\n\n`);
      return v.valid ? 0 : 1;
    }
    try { writeTokenCostEvidence(target, result.evidence); } catch {}
    if (asJson) { process.stdout.write(JSON.stringify(result.evidence, null, 2) + "\n"); return 0; }
    process.stdout.write(["", "Token/Cost Evidence imported (sanitized).", `  Confidence: ${result.evidence.confidence}`, `  Tokens:     in=${result.evidence.tokens.inputTokens} out=${result.evidence.tokens.outputTokens} total=${result.evidence.tokens.totalTokens}`, `  Cost:       ${result.evidence.cost.amount ?? "null"} ${result.evidence.cost.currency ?? ""}`.trim(), "  Savings:    not claimable (evidence only)", ""].join("\n"));
    return 0;
  }

  if (sub === "summarize" || sub === undefined) {
    const items = loadTokenCostEvidence(target);
    const summary = summarizeTokenCostEvidence(items);
    if (asJson) { process.stdout.write(JSON.stringify(summary, null, 2) + "\n"); return 0; }
    process.stdout.write([
      "", "Token/Cost Evidence summary", `  Records:    ${items.length}`,
      `  Tokens:     in=${summary.totalInputTokens ?? "null"} out=${summary.totalOutputTokens ?? "null"} total=${summary.totalTokens ?? "null"}`,
      `  Cost:       ${summary.totalCost ?? "null"} ${summary.currency ?? ""}${summary.mixedCurrency ? " (mixed currency)" : ""}`.trim(),
      `  Confidence: measured=${summary.measuredCount} imported=${summary.importedCount} estimated=${summary.estimatedCount} inferred=${summary.inferredCount} unavailable=${summary.unavailableCount}`,
      "  Savings:    not claimable in Phase 6 (evidence only)",
      "",
    ].join("\n"));
    return 0;
  }

  process.stderr.write("Usage: avorelo token-cost <unavailable|import|validate|summarize> [--reason <r>] [--file <path>] [--target <dir>] [--json]\n");
  return 2;
}

function cmdContinuity(args: string[]): number {
  const sub = args[0];
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const now = Date.now();

  if (sub === "prepare") {
    const task = args.slice(1).find(a => !a.startsWith("--") && a !== target);
    if (!task) { process.stderr.write("Usage: avorelo continuity prepare \"<task>\" [--target <dir>] [--json]\n"); return 2; }
    const packet = prepareContinuity({ task, dir: target, now });
    try { writeContinuity(target, packet); } catch {}
    return printContinuity(packet, asJson);
  }

  if (sub === "show" || sub === undefined) {
    const loaded = loadLatestContinuity(target);
    if (!loaded) {
      if (asJson) { process.stdout.write(JSON.stringify({ status: "none", message: "no continuity packet" }) + "\n"); return 0; }
      process.stdout.write("\nNo continuity packet found. Run: avorelo continuity prepare \"<task>\"\n\n");
      return 0;
    }
    return printContinuity(expireContinuity(loaded, now), asJson);
  }

  if (sub === "apply") {
    const loaded = loadLatestContinuity(target);
    if (!loaded) { process.stderr.write("No continuity packet to apply. Run: avorelo continuity prepare \"<task>\"\n"); return 1; }
    const injection = applyContinuity(expireContinuity(loaded, now), now);
    if (asJson) { process.stdout.write(JSON.stringify(injection, null, 2) + "\n"); return 0; }
    if (!injection.injectable) {
      process.stdout.write(["", `Continuity NOT injectable: ${injection.reasons.join(", ")}`, "  (blocked/expired/approval-required packets are fail-closed)", ""].join("\n"));
      return 0;
    }
    const cf = injection.carryForward!;
    process.stdout.write(["", "Continuity applied (redacted carry-forward):", `  Objective:  ${cf.objectiveSummary}`, `  Context:    ${cf.contextSummary}`, `  Next:       ${cf.safeNextActions.join("; ")}`, cf.proofMissing.length ? `  Proof gaps: ${cf.proofMissing.join("; ")}` : "", ""].filter(Boolean).join("\n"));
    return 0;
  }

  process.stderr.write("Usage: avorelo continuity <prepare|show|apply> [--target <dir>] [--json]\n");
  return 2;
}

function printContinuity(packet: ReturnType<typeof prepareContinuity>, asJson: boolean): number {
  if (asJson) { process.stdout.write(JSON.stringify(packet, null, 2) + "\n"); return 0; }
  process.stdout.write([
    "",
    `Continuity packet (${packet.contract})`,
    `  Status:     ${packet.status}`,
    `  Objective:  ${packet.objectiveSummary}`,
    `  Routing:    risk=${packet.riskClass} route=${packet.route} proof=${packet.proofTier} approval=${packet.approvalPolicy}`,
    `  Context:    ${packet.contextSummary}`,
    packet.safeNextActions.length ? `  Next:       ${packet.safeNextActions.join("; ")}` : "",
    packet.proofMissing.length ? `  Proof gaps: ${packet.proofMissing.join("; ")}` : "",
    packet.openQuestions.length ? `  Decide:     ${packet.openQuestions.join("; ")}` : "",
    packet.riskFlags.length ? `  Risk flags: ${packet.riskFlags.join(", ")}` : "",
    `  Expires:    ${packet.expiresAt}`,
    "  (redacted carry-forward â€” no raw prompts/secrets/source/logs/diffs)",
    "",
  ].filter(Boolean).join("\n"));
  return 0;
}

function cmdContextCheck(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const strict = args.includes("--strict");
  const ci = args.includes("--ci");
  const wcPath = arg(args, "--work-contract");

  let workContract: import("../../capabilities/context-check/types.ts").WorkContractRef | undefined;
  if (wcPath && existsSync(wcPath)) {
    try { workContract = JSON.parse(readFileSync(wcPath, "utf8")); } catch {}
  }

  const result = runContextCheck({
    repoRoot: target,
    workContract,
    mode: ci ? "ci" : asJson ? "ci" : "generic",
    outputPreference: asJson || ci ? "json" : "human",
    strict,
  });

  if (asJson || ci) {
    process.stdout.write(renderContextCheckJson(result) + "\n");
  } else {
    process.stdout.write(renderContextCheckHuman(result));
  }

  if (ci) {
    const materialFinding = result.status === "needs_attention" || (strict && result.status === "warning");
    return materialFinding ? 1 : 0;
  }
  return strict && result.status === "needs_attention" ? 1 : 0;
}

function cmdContextBrief(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const sub = args[0];

  if (sub === "latest") {
    const brief = loadLatestContextEfficiencyBrief(target);
    if (!brief) {
      process.stderr.write("No context-efficiency brief has been generated yet.\n");
      return 1;
    }
    if (asJson) {
      process.stdout.write(JSON.stringify(brief, null, 2) + "\n");
      return brief.decisionState === "READY" || brief.decisionState === "READY_WITH_WARNINGS" ? 0 : 1;
    }
    process.stdout.write(renderContextEfficiencyBrief(brief));
    return brief.decisionState === "READY" || brief.decisionState === "READY_WITH_WARNINGS" ? 0 : 1;
  }

  if (sub === "check") {
    const path = arg(args, "--path");
    if (!path) {
      process.stderr.write("Usage: avorelo context brief check --path <path> [--target <dir>] [--json]\n");
      return 2;
    }
    const check = buildContextEfficiencyPathCheck(target, path);
    if (asJson) {
      process.stdout.write(JSON.stringify(check, null, 2) + "\n");
      return check.decisionState === "READY" || check.decisionState === "READY_WITH_WARNINGS" ? 0 : 1;
    }
    process.stdout.write(renderContextEfficiencyPathCheck(check));
    return check.decisionState === "READY" || check.decisionState === "READY_WITH_WARNINGS" ? 0 : 1;
  }

  const task = arg(args, "--task");
  const { brief } = buildAndPersistContextEfficiencyBrief({ dir: target, task });
  if (asJson) {
    process.stdout.write(JSON.stringify(brief, null, 2) + "\n");
    return brief.decisionState === "READY" || brief.decisionState === "READY_WITH_WARNINGS" ? 0 : 1;
  }
  process.stdout.write(renderContextEfficiencyBrief(brief));
  return brief.decisionState === "READY" || brief.decisionState === "READY_WITH_WARNINGS" ? 0 : 1;
}

function cmdContextTrustBrief(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const branchName = arg(args, "--branch");
  const taskText = arg(args, "--task");

  const preflight = runRepoPreflight(target);
  if (!preflight.ok) {
    process.stderr.write(formatPreflightResult(preflight));
    return 2;
  }

  const result = generateTrustBrief(target, { branchName, taskText });
  if (asJson) {
    process.stdout.write(JSON.stringify({
      mode: result.mode.detectedMode,
      confidence: result.mode.confidence,
      briefPath: result.briefPath,
      receiptPath: result.receiptPath,
      sourceCount: result.sourceCount,
      candidateCount: result.candidateCount,
      includedCount: result.brief.budget.includedItemIds.length,
      excludedCount: result.brief.budget.excludedItemIds.length,
      conflictCount: result.conflicts.length,
      redactionsApplied: result.redactionsApplied,
    }, null, 2) + "\n");
    return 0;
  }
  process.stdout.write([
    "",
    "Avorelo Trusted Work Brief generated",
    "",
    `  Mode:       ${result.mode.detectedMode}`,
    `  Confidence: ${Math.round(result.mode.confidence * 100)}%`,
    `  Brief:      ${result.briefPath}`,
    `  Receipt:    ${result.receiptPath}`,
    "",
    `  Sources:    ${result.sourceCount}`,
    `  Candidates: ${result.candidateCount}`,
    `  Included:   ${result.brief.budget.includedItemIds.length}`,
    `  Excluded:   ${result.brief.budget.excludedItemIds.length}`,
    `  Conflicts:  ${result.conflicts.length}`,
    `  Redactions: ${result.redactionsApplied}`,
    "",
    "  Safety: production actions blocked, npm publish blocked",
    "",
    result.brief.requiredProofBeforeCompletion.length > 0
      ? "  Required proof before completion:\n" + result.brief.requiredProofBeforeCompletion.map((p: string) => `    - ${p}`).join("\n")
      : "",
    "",
  ].filter(Boolean).join("\n"));
  return 0;
}

function cmdContextTrustStatus(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  const mode = loadContextMode(target);
  const items = loadContextItems(target);
  const conflicts = loadContextConflicts(target);
  const latestBrief = loadLatestTrustBrief(target);
  const latestReceipt = loadLatestContextReceipt(target);

  const promoted = items.filter((i) => i.lifecycle.status === "promoted");
  const stale = items.filter((i) => i.freshness.status === "stale" || i.freshness.status === "expired");
  const unsafe = items.filter((i) => i.safety.containsSecret || !i.safety.agentVisible);

  if (asJson) {
    process.stdout.write(JSON.stringify({
      mode: mode?.detectedMode ?? "unknown",
      confidence: mode?.confidence ?? 0,
      totalItems: items.length,
      promoted: promoted.length,
      stale: stale.length,
      unsafe: unsafe.length,
      conflicts: conflicts.length,
      hasBrief: latestBrief !== null,
      hasReceipt: latestReceipt !== null,
    }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write([
    "",
    "Avorelo Context Trust Status",
    "",
    `  Mode:        ${mode?.detectedMode ?? "unknown"}`,
    `  Confidence:  ${mode ? Math.round(mode.confidence * 100) + "%" : "n/a"}`,
    `  Items:       ${items.length} total, ${promoted.length} promoted`,
    `  Stale:       ${stale.length}`,
    `  Unsafe:      ${unsafe.length}`,
    `  Conflicts:   ${conflicts.length}`,
    `  Brief:       ${latestBrief ? "available" : "not generated"}`,
    `  Receipt:     ${latestReceipt ? latestReceipt.receiptId : "none"}`,
    "",
  ].join("\n"));
  return 0;
}

function cmdContextTrustExplain(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  const items = loadContextItems(target);
  if (items.length === 0) {
    process.stderr.write("No context items found. Run 'avorelo brief' first.\n");
    return 1;
  }

  const included = items.filter((i) => i.lifecycle.status === "promoted" || i.safety.agentVisible);
  const excluded = items.filter((i) => !i.safety.agentVisible || i.lifecycle.status === "forgotten" || i.lifecycle.status === "superseded");

  if (asJson) {
    process.stdout.write(JSON.stringify({
      included: included.map((i) => ({ id: i.id, type: i.type, summary: i.summary.slice(0, 80), trust: i.trust.level, freshness: i.freshness.status })),
      excluded: excluded.map((i) => ({ id: i.id, type: i.type, summary: i.summary.slice(0, 80), reason: i.safety.reason })),
    }, null, 2) + "\n");
    return 0;
  }

  const lines = ["", "Avorelo Context Explain", ""];
  lines.push(`  Included (${included.length}):`);
  for (const i of included.slice(0, 20)) {
    lines.push(`    ${i.id} [${i.type}] trust=${i.trust.level} fresh=${i.freshness.status}`);
  }
  if (included.length > 20) lines.push(`    ... and ${included.length - 20} more`);

  lines.push("");
  lines.push(`  Excluded (${excluded.length}):`);
  for (const i of excluded.slice(0, 10)) {
    lines.push(`    ${i.id} [${i.type}] reason=${i.safety.reason}`);
  }
  if (excluded.length > 10) lines.push(`    ... and ${excluded.length - 10} more`);

  lines.push("");
  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdContextTrustConflicts(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  const conflicts = loadContextConflicts(target);
  if (asJson) {
    process.stdout.write(JSON.stringify({ conflicts }, null, 2) + "\n");
    return conflicts.length > 0 ? 1 : 0;
  }

  if (conflicts.length === 0) {
    process.stdout.write("\nNo context conflicts detected.\n\n");
    return 0;
  }

  const lines = ["", `Avorelo Context Conflicts (${conflicts.length})`, ""];
  for (const c of conflicts) {
    lines.push(`  ${c.type}`);
    lines.push(`    Items: ${c.items.join(", ")}`);
    lines.push(`    Resolution: ${c.resolution}`);
    lines.push(`    Safe default: ${c.safeDefault}`);
    lines.push(`    Required proof: ${c.requiredNextProof}`);
    lines.push("");
  }
  process.stdout.write(lines.join("\n"));
  return 1;
}

function cmdContextTrustVerify(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  const result = generateTrustBrief(target, {
    branchName: arg(args, "--branch"),
    taskText: arg(args, "--task"),
  });

  const stale = result.items.filter((i) => i.freshness.status === "stale" || i.freshness.status === "expired");
  const unsafe = result.items.filter((i) => i.safety.containsSecret);
  const unresolved = result.conflicts;

  if (asJson) {
    process.stdout.write(JSON.stringify({
      verified: stale.length === 0 && unsafe.length === 0 && unresolved.length === 0,
      staleCount: stale.length,
      unsafeCount: unsafe.length,
      conflictCount: unresolved.length,
      briefPath: result.briefPath,
      receiptPath: result.receiptPath,
    }, null, 2) + "\n");
    return (stale.length > 0 || unsafe.length > 0 || unresolved.length > 0) ? 1 : 0;
  }

  const lines = ["", "Avorelo Context Verify", ""];
  lines.push(`  Brief regenerated at: ${result.briefPath}`);
  lines.push(`  Stale items:          ${stale.length}`);
  lines.push(`  Unsafe items:         ${unsafe.length}`);
  lines.push(`  Unresolved conflicts: ${unresolved.length}`);
  if (stale.length === 0 && unsafe.length === 0 && unresolved.length === 0) {
    lines.push("");
    lines.push("  Status: VERIFIED");
  } else {
    lines.push("");
    lines.push("  Status: NEEDS ATTENTION");
  }
  lines.push("");
  process.stdout.write(lines.join("\n"));
  return (stale.length > 0 || unsafe.length > 0 || unresolved.length > 0) ? 1 : 0;
}

function cmdContextPromote(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const itemId = args.find((a) => a.startsWith("ctx_"));
  const reason = arg(args, "--reason") ?? "Manual promotion";
  const evidenceIds = multiArg(args, "--evidence");

  if (!itemId) {
    process.stderr.write("Usage: avorelo context promote <item_id> --reason \"<reason>\" [--evidence <receipt_id>] [--target <dir>] [--json]\n");
    return 2;
  }

  const preflight = runRepoPreflight(target);
  if (!preflight.ok) {
    process.stderr.write(formatPreflightResult(preflight));
    return 2;
  }

  const result = promoteItem(target, { itemId, reason, evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined });
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    process.stdout.write([
      "",
      `Promoted: ${result.itemId}`,
      `  Previous: ${result.previousStatus}`,
      `  New:      ${result.newStatus}`,
      `  Reason:   ${result.reason}`,
      `  Receipt:  ${result.receiptId}`,
      "",
    ].join("\n"));
  } else {
    process.stderr.write([
      "",
      `Cannot promote ${result.itemId}: ${result.reason}`,
      `  Receipt:  ${result.receiptId}`,
      "",
    ].join("\n"));
  }
  return result.ok ? 0 : 1;
}

function cmdContextForget(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const itemId = args.find((a) => a.startsWith("ctx_"));
  const reason = arg(args, "--reason") ?? "Manual forget";
  const supersededBy = arg(args, "--superseded-by");

  if (!itemId) {
    process.stderr.write("Usage: avorelo context forget <item_id> --reason \"<reason>\" [--superseded-by <item_id>] [--target <dir>] [--json]\n");
    return 2;
  }

  const preflight = runRepoPreflight(target);
  if (!preflight.ok) {
    process.stderr.write(formatPreflightResult(preflight));
    return 2;
  }

  const result = forgetItem(target, { itemId, reason, supersededBy });
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    process.stdout.write([
      "",
      `Forgotten: ${result.itemId}`,
      `  Previous: ${result.previousStatus}`,
      `  New:      ${result.newStatus}`,
      `  Reason:   ${result.reason}`,
      `  Receipt:  ${result.receiptId}`,
      "",
    ].join("\n"));
  } else {
    process.stderr.write([
      "",
      `Cannot forget ${result.itemId}: ${result.reason}`,
      `  Receipt:  ${result.receiptId}`,
      "",
    ].join("\n"));
  }
  return result.ok ? 0 : 1;
}

function cmdContext(args: string[]): number {
  const sub = args[0];
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  // first positional after the subcommand that isn't a flag or the --target value
  const task = args.slice(1).find(a => !a.startsWith("--") && a !== target);

  if (sub === "check") return cmdContextCheck(args.slice(1));
  if (sub === "brief") return cmdContextBrief(args.slice(1));
  if (sub === "trust-brief") return cmdContextTrustBrief(args.slice(1));
  if (sub === "status") return cmdContextTrustStatus(args.slice(1));
  if (sub === "explain") return cmdContextTrustExplain(args.slice(1));
  if (sub === "conflicts") return cmdContextTrustConflicts(args.slice(1));
  if (sub === "verify") return cmdContextTrustVerify(args.slice(1));
  if (sub === "promote") return cmdContextPromote(args.slice(1));
  if (sub === "forget") return cmdContextForget(args.slice(1));
  if (sub === "preflight") {
    const preflight = runRepoPreflight(target);
    if (asJson) {
      process.stdout.write(JSON.stringify(preflight, null, 2) + "\n");
      return preflight.ok ? 0 : 1;
    }
    process.stdout.write(formatPreflightResult(preflight));
    return preflight.ok ? 0 : 1;
  }

  if (sub !== "compile") {
    process.stderr.write("Usage: avorelo context <compile|check|brief|trust-brief|status|explain|conflicts|verify|promote|forget|preflight> [args]\n");
    return 2;
  }
  if (!task) {
    process.stderr.write("Usage: avorelo context compile \"<task>\" [--target <dir>] [--json]\n");
    return 2;
  }

  const packet = compileContext({ task, dir: target });
  // The packet is redacted (coded refs / safe references only). Safe to print.
  if (asJson) {
    process.stdout.write(JSON.stringify(packet, null, 2) + "\n");
    return 0;
  }
  process.stdout.write([
    "",
    `Context packet (${packet.contract})`,
    `  Objective:  ${packet.objective}`,
    `  Routing:    risk=${packet.riskClass} route=${packet.route} proof=${packet.proofTier} approval=${packet.approvalPolicy}`,
    `  Budget:     ${packet.contextBudget.targetSize} (cost=${packet.contextBudget.estimatedContextCost})`,
    `  Selected:   ${packet.selectedRefs.length} ref(s)${packet.selectedRefs.length ? " â€” " + packet.selectedRefs.map(r => `${r.label}[${r.includeMode}/${r.safety}]`).join(", ") : ""}`,
    `  Excluded:   ${packet.excludedRefs.length}${packet.excludedRefs.length ? " â€” " + packet.excludedRefs.map(r => r.label).join(", ") : ""}`,
    `  SafeRefs:   ${packet.safeReferences.length}`,
    packet.riskFlags.length ? `  Risk flags: ${packet.riskFlags.join(", ")}` : "",
    packet.proofNeeded.length ? `  Proof:      ${packet.proofNeeded.join("; ")}` : "",
    `  Cloud eligible: ${packet.cloudEligible}`,
    "  (bounded, source-aware, secret-safe â€” values are never included)",
    "",
  ].filter(Boolean).join("\n"));
  return 0;
}

function cmdModelRoute(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const useContextBrief = args.includes("--from-context-brief");
  const sub = args[0];

  if (useContextBrief && arg(args, "--task")) {
    process.stderr.write("Usage: avorelo model route [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-context-brief] [--json]\n");
    return 2;
  }

  if (sub === "latest") {
    const profile = loadLatestModelRoutingInputProfile(target);
    if (!profile) {
      process.stderr.write("No model-routing input profile has been generated yet.\n");
      return 1;
    }
    if (asJson) {
      process.stdout.write(JSON.stringify(profile, null, 2) + "\n");
      return modelRoutingInputModeIsReady(profile.recommendedMode) ? 0 : 1;
    }
    process.stdout.write(renderModelRoutingInputProfile(profile));
    return modelRoutingInputModeIsReady(profile.recommendedMode) ? 0 : 1;
  }

  if (sub === "check") {
    const path = arg(args, "--path");
    if (!path) {
      process.stderr.write("Usage: avorelo model route check --path <path> [--target <dir>] [--json]\n");
      return 2;
    }
    const check = buildModelRoutingInputPathCheck(target, path);
    if (asJson) {
      process.stdout.write(JSON.stringify(check, null, 2) + "\n");
      return modelRoutingInputModeIsReady(check.recommendedMode) ? 0 : 1;
    }
    process.stdout.write(renderModelRoutingInputPathCheck(check));
    return modelRoutingInputModeIsReady(check.recommendedMode) ? 0 : 1;
  }

  const task = arg(args, "--task");
  try {
    const { profile } = buildAndPersistModelRoutingInputProfile({
      dir: target,
      task,
      fromContextBrief: useContextBrief,
    });
    if (asJson) {
      process.stdout.write(JSON.stringify(profile, null, 2) + "\n");
      return modelRoutingInputModeIsReady(profile.recommendedMode) ? 0 : 1;
    }
    process.stdout.write(renderModelRoutingInputProfile(profile));
    return modelRoutingInputModeIsReady(profile.recommendedMode) ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

function cmdModel(args: string[]): number {
  const sub = args[0];
  if (sub === "route") return cmdModelRoute(args.slice(1));
  process.stderr.write("Usage: avorelo model route [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-context-brief] [--json]\n");
  return 2;
}

function cmdWorkflowRadar(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const useContextBrief = args.includes("--from-context-brief");
  const useModelRoute = args.includes("--from-model-route");
  const sub = args[0];

  if (useContextBrief && useModelRoute) {
    process.stderr.write("Usage: avorelo workflow radar [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-context-brief] [--from-model-route] [--json]\n");
    return 2;
  }
  if ((useContextBrief || useModelRoute) && arg(args, "--task")) {
    process.stderr.write("Usage: avorelo workflow radar [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-context-brief] [--from-model-route] [--json]\n");
    return 2;
  }

  if (sub === "latest") {
    const assessment = loadLatestWorkflowRadarAssessment(target);
    if (!assessment) {
      process.stderr.write("No workflow radar assessment has been generated yet.\n");
      return 1;
    }
    if (asJson) {
      process.stdout.write(JSON.stringify(assessment, null, 2) + "\n");
      return workflowRadarDecisionStateIsReady(assessment.decisionState) ? 0 : 1;
    }
    process.stdout.write(renderWorkflowRadarAssessment(assessment));
    return workflowRadarDecisionStateIsReady(assessment.decisionState) ? 0 : 1;
  }

  if (sub === "check") {
    const path = arg(args, "--path");
    if (!path) {
      process.stderr.write("Usage: avorelo workflow radar check --path <path> [--target <dir>] [--json]\n");
      return 2;
    }
    const check = buildWorkflowRadarPathCheck(target, path);
    if (asJson) {
      process.stdout.write(JSON.stringify(check, null, 2) + "\n");
      return workflowRadarDecisionStateIsReady(check.decisionState) ? 0 : 1;
    }
    process.stdout.write(renderWorkflowRadarPathCheck(check));
    return workflowRadarDecisionStateIsReady(check.decisionState) ? 0 : 1;
  }

  try {
    const task = arg(args, "--task");
    const { assessment } = buildAndPersistWorkflowRadarAssessment({
      dir: target,
      task,
      fromContextBrief: useContextBrief,
      fromModelRoute: useModelRoute,
    });
    if (asJson) {
      process.stdout.write(JSON.stringify(assessment, null, 2) + "\n");
      return workflowRadarDecisionStateIsReady(assessment.decisionState) ? 0 : 1;
    }
    process.stdout.write(renderWorkflowRadarAssessment(assessment));
    return workflowRadarDecisionStateIsReady(assessment.decisionState) ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

function cmdWorkflow(args: string[]): number {
  const sub = args[0];
  if (sub === "radar") return cmdWorkflowRadar(args.slice(1));
  process.stderr.write("Usage: avorelo workflow radar [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-context-brief] [--from-model-route] [--json]\n");
  return 2;
}

function cmdSessionHandoff(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const includeContinuationPrompt = args.includes("--include-continuation-prompt");
  const fromWorkflowRadar = args.includes("--from-workflow-radar");
  const sub = args[0];

  if (fromWorkflowRadar && arg(args, "--task")) {
    process.stderr.write("Usage: avorelo session handoff [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-workflow-radar] [--include-continuation-prompt] [--json]\n");
    return 2;
  }

  if (sub === "latest") {
    const handoff = loadLatestSessionContinuityHandoff(target);
    if (!handoff) {
      process.stderr.write("No session-continuity handoff has been generated yet.\n");
      return 1;
    }
    if (asJson) {
      process.stdout.write(JSON.stringify(handoff, null, 2) + "\n");
      return sessionContinuityDecisionStateIsReady(handoff.decisionState) ? 0 : 1;
    }
    process.stdout.write(renderSessionContinuityHandoff(handoff, { includeContinuationPrompt }));
    return sessionContinuityDecisionStateIsReady(handoff.decisionState) ? 0 : 1;
  }

  if (sub === "check") {
    const path = arg(args, "--path");
    if (!path) {
      process.stderr.write("Usage: avorelo session handoff check --path <path> [--target <dir>] [--json]\n");
      return 2;
    }
    const check = buildSessionContinuityPathCheck(target, path);
    if (asJson) {
      process.stdout.write(JSON.stringify(check, null, 2) + "\n");
      return sessionContinuityDecisionStateIsReady(check.decisionState) && !check.doNotTouch ? 0 : 1;
    }
    process.stdout.write(renderSessionContinuityPathCheck(check));
    return sessionContinuityDecisionStateIsReady(check.decisionState) && !check.doNotTouch ? 0 : 1;
  }

  try {
    const task = arg(args, "--task");
    const { handoff } = buildAndPersistSessionContinuityHandoff({
      dir: target,
      task,
      fromWorkflowRadar,
    });
    if (asJson) {
      process.stdout.write(JSON.stringify(handoff, null, 2) + "\n");
      return sessionContinuityDecisionStateIsReady(handoff.decisionState) ? 0 : 1;
    }
    process.stdout.write(renderSessionContinuityHandoff(handoff, { includeContinuationPrompt }));
    return sessionContinuityDecisionStateIsReady(handoff.decisionState) ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

function cmdSession(args: string[]): number {
  const sub = args[0];
  if (sub === "handoff") return cmdSessionHandoff(args.slice(1));
  process.stderr.write("Usage: avorelo session handoff [latest|check --path <path>] [--target <dir>] [--task \"<text>\"] [--from-workflow-radar] [--include-continuation-prompt] [--json]\n");
  return 2;
}

function cmdSecretBoundary(args: string[]): number {
  const sub = args[0];
  const asJson = args.includes("--json");
  // Local-first input: --content "<text>" or --file <path>. No network, no provider calls.
  let content: unknown = arg(args, "--content");
  const file = arg(args, "--file");
  if (file && existsSync(file)) content = readFileSync(file, "utf8");
  if (content === undefined) content = "";

  if (sub === "scan" || sub === undefined) {
    const r = scanContent({ content, sourceKind: file ? "file" : "tool_output" });
    if (asJson) {
      // The receipt + findings are already redacted (coded only). Safe to print.
      process.stdout.write(JSON.stringify({ decision: r.decision, findings: r.findings, cloudEligible: r.cloudEligible, syncPayload: r.syncPayload, safeReferences: r.safeReferences }, null, 2) + "\n");
    } else {
      process.stdout.write([
        "",
        `Secret Boundary scan: ${r.decision.toUpperCase()}`,
        `  Findings: ${r.findings.length}${r.findings.length ? " (" + r.findings.map(f => f.code).join(", ") + ")" : ""}`,
        `  Cloud eligible: ${r.cloudEligible}`,
        "  (values are never shown â€” coded findings + safe references only)",
        "",
      ].join("\n"));
    }
    return r.decision === "block" ? 1 : 0;
  }

  if (sub === "remediate") {
    const r = scanContent({ content, sourceKind: file ? "file" : "tool_output" });
    const plan = r.remediation;
    if (asJson) {
      process.stdout.write(JSON.stringify({ decision: r.decision, remediation: plan, findings: r.findings.map(f => f.code) }, null, 2) + "\n");
    } else if (!plan) {
      process.stdout.write("\nNo secrets found â€” no remediation needed.\n\n");
    } else {
      process.stdout.write(["", "Recommended remediation (no auto-rotation; manual steps only):", ...plan.steps.map((s, i) => `  ${i + 1}. ${s}`), ""].join("\n"));
    }
    return 0;
  }

  process.stderr.write("Usage: avorelo secret-boundary <scan|remediate> [--content \"<text>\"|--file <path>] [--json]\n");
  return 2;
}

function cmdResume(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;

  const packet = loadLatestResumePacket(target);
  if (!packet) {
    process.stdout.write("No resume packet found. Start a new session with `avorelo start`.\n");
    return 1;
  }

  const result = resumeSession(target);
  if (!result) {
    process.stderr.write("Could not resume session.\n");
    return 1;
  }

  const lines = [
    "",
    `Resumed: ${packet.objective}`,
    "",
    `  Previous session: ${packet.sessionId}`,
    `  New session:      ${result.session.sessionId}`,
    `  Evidence so far:  ${packet.evidenceProgress.join(", ") || "none"}`,
    `  Missing:          ${packet.evidenceMissing.join(", ") || "none"}`,
    "",
    `  Next: ${packet.safeNextActions[0] || "Continue from where you left off."}`,
    "",
  ];
  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdExplain(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const lines = ["", "Avorelo explain", ""];

  // What Avorelo changed
  const detected = detectAllAdapters(target);
  const changedFiles: string[] = [];
  for (const { adapter } of detected) {
    const surface = adapter.getInstructionSurface(target);
    if (surface && existsSync(surface)) changedFiles.push(surface);
  }
  if (changedFiles.length > 0) {
    lines.push("  Changed:");
    for (const f of changedFiles) lines.push(`    ${f.replace(target, ".")}`);
  } else {
    lines.push("  Changed: nothing");
  }

  // What Avorelo did NOT change
  lines.push("");
  lines.push("  Preserved: all user content outside Avorelo markers");

  // Hooks
  const hookValidation = validateInstall(target);
  lines.push("");
  lines.push(`  Hooks: ${hookValidation.installed ? "installed" : "not installed"}`);

  // Cloud
  lines.push("  Cloud: off (local-first)");

  // Receipts
  lines.push(`  Receipts: ${join(target, ".avorelo", "receipts")}`);

  // Session
  const sessionStatus = getSessionStatus(target);
  if (sessionStatus) {
    lines.push("");
    lines.push(`  Session: ${sessionStatus.status}`);
    lines.push(`    Objective: ${sessionStatus.objective}`);
    lines.push(`    Control: Tier ${sessionStatus.controlTierLabel}`);
    lines.push(`    Tool calls: ${sessionStatus.toolCalls}`);
    lines.push(`    Evidence: ${sessionStatus.evidenceCount}`);
    if (sessionStatus.driftSignals > 0) lines.push(`    Drift handled: ${sessionStatus.driftSignals}`);
    if (sessionStatus.corrections > 0) lines.push(`    Corrections: ${sessionStatus.corrections}`);
    if (sessionStatus.activeSkills.length > 0) lines.push(`    Active capabilities: ${sessionStatus.activeSkills.join(", ")}`);
  }


  // Feedback
  lines.push("");
  lines.push("  Feedback stays local unless you choose to share it.");

  // How to revert
  lines.push("");
  lines.push("  To revert: avorelo uninstall --target .");
  lines.push("");

  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdPrompt(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;

  const sessionStatus = getSessionStatus(target);
  const resumePacket = loadLatestResumePacket(target);

  const lines = [
    "# Avorelo â€” AI Work Control",
    "",
    "This project uses Avorelo for AI work control.",
    "",
    "## Rules",
    "- Check `npx avorelo status` before starting work.",
    "- Run existing tests before declaring work complete.",
    "- Do not claim production readiness without Avorelo receipts.",
    "- Do not modify auth, billing, or migration files without approval.",
    "- Stay within the declared task scope.",
  ];

  if (sessionStatus) {
    lines.push("", "## Current session", "");
    lines.push(`Objective: ${sessionStatus.objective}`);
    lines.push(`Status: ${sessionStatus.status}`);
    if (sessionStatus.driftSignals > 0) lines.push(`Drift signals: ${sessionStatus.driftSignals} â€” check avorelo explain`);
  }

  if (resumePacket) {
    lines.push("", "## Resume context", "");
    lines.push(resumePacket.summary);
    if (resumePacket.safeNextActions.length > 0) {
      lines.push("", "Next steps:");
      for (const a of resumePacket.safeNextActions) lines.push(`- ${a}`);
    }
  }

  lines.push("", "---", "Generated by Avorelo. Run `npx avorelo prompt` to refresh.", "");
  process.stdout.write(lines.join("\n"));
  return 0;
}

function cmdWatch(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const fixture = arg(args, "--fixture") as "scope-drift" | "sensitive" | "clean" | "loop" | undefined;

  if (fixture) {
    const result = watchWithFixture(target, fixture);
    process.stdout.write(`\n  ${result.message}\n\n`);
    return result.driftSignals.length > 0 ? 1 : 0;
  }

  const result = watchOnce(target);
  if (!result.ok) {
    process.stdout.write(`${result.message}\n`);
    return 1;
  }
  process.stdout.write(`\n  ${result.message}\n\n`);
  return result.driftSignals.length > 0 ? 1 : 0;
}


function cmdFeedback(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const sub = args[0];

  if (sub === "status") {
    const config = getFeedbackConfig(target);
    const lines = [
      "",
      "Avorelo feedback",
      "",
      `  Sharing: ${config.enabled ? "enabled" : "disabled (default)"}`,
      `  Support bundles: ${config.allowSupportBundles ? "available" : "disabled"}`,
      "",
      "  Everything stays local. Nothing is uploaded or sent automatically.",
      "  Share a bundle yourself via GitHub if you choose to.",
      "",
    ];
    if (config.optedInAt) lines.splice(-2, 0, `  Opted in: ${config.optedInAt}`);
    if (config.optedOutAt) lines.splice(-2, 0, `  Opted out: ${config.optedOutAt}`);
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  if (sub === "opt-in") {
    optIn(target);
    process.stdout.write("Feedback sharing enabled. Run `avorelo feedback prepare` to create a bundle.\n");
    return 0;
  }

  if (sub === "opt-out") {
    optOut(target);
    process.stdout.write("Feedback sharing disabled. All data stays local.\n");
    return 0;
  }

  if (sub === "prepare") {
    const { bundle, path } = prepareFeedbackBundle(target);
    const lines = [
      "",
      "Sanitized feedback bundle created.",
      "",
      `  Saved: ${path}`,
      "",
      "  Includes:",
      "    Avorelo version, platform, adapters, session summary,",
      "    proof status, drift categories, notice state.",
      "",
      "  Excludes:",
      "    secrets, env values, source code, private prompts,",
      "    API keys, tokens, credentials, full logs, file contents.",
      "",
      "  Inspect the file before sharing.",
      "  To delete: remove the file above.",
      "  No data was sent.",
      "",
    ];
    process.stdout.write(lines.join("\n"));
    return 0;
  }

  if (sub === "share") {
    const file = arg(args, "--file");
    if (!file || !existsSync(file)) {
      process.stderr.write("Usage: avorelo feedback share --file <bundle-path>\n");
      return 2;
    }
    process.stdout.write([
      "",
      "Avorelo never uploads or sends anything. Sharing is a manual step you take.",
      "",
      "  To share this bundle yourself:",
      `    1. Inspect: ${file}`,
      `    2. Open an issue and attach it: ${SUPPORT_ISSUES_URL}`,
      `    3. General support by email: ${SUPPORT_EMAIL}`,
      `    4. For a security report, use private reporting: ${SUPPORT_SECURITY_URL}`,
      "",
      "  Do not paste secrets, credentials, or private source into an issue.",
      "  No data was sent.",
      "",
    ].join("\n"));
    return 0;
  }

  // Default: show status
  return cmdFeedback(["status", ...args]);
}

function cmdSupport(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const sub = args[0];

  if (sub === "bundle") {
    const { path, markdownPath } = prepareSupportBundle(target);
    process.stdout.write([
      "",
      "Local support bundle created.",
      "",
      `  JSON:     ${path}`,
      `  Markdown: ${markdownPath}`,
      "",
      "  Sanitized and inspectable. Nothing was sent, uploaded, or attached.",
      "",
      "  If you choose to share it yourself:",
      `    Bugs & feedback:  ${SUPPORT_ISSUES_URL}`,
      `    General support:  ${SUPPORT_EMAIL}`,
      `    Security reports: ${SUPPORT_SECURITY_URL}`,
      "",
      "  These are references you visit yourself. Nothing is opened, emailed, or sent.",
      "",
    ].join("\n"));
    return 0;
  }

  process.stderr.write("Usage: avorelo support bundle [--target <dir>]\n");
  return 2;
}

function cmdLoop(args: string[]): number | Promise<number> {
  const sub = args[0];
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");

  if (sub === "check") {
    const task = args.slice(1).find(a => !a.startsWith("--") && a !== target);
    if (!task) { process.stderr.write("Usage: avorelo loop check \"<task>\" [--target <dir>] [--allow <path>] [--block <path>] [--check <cmd>] [--json]\n"); return 2; }
    const allowPaths = multiArg(args, "--allow");
    const blockPaths = multiArg(args, "--block");
    const userCheckCmds = multiArg(args, "--check");
    const userChecks = userCheckCmds.length > 0 ? userCheckCmds.map(cmd => ({ label: cmd, command: cmd })) : undefined;
    const readiness = classifyLoopReadiness({ task });
    const policy = buildLoopPolicy({ readiness, cwd: target, userChecks });
    const visibleChecks = policy.requiredChecks.filter(c => c.type !== "scope_check" && c.type !== "drift_check");
    if (asJson) { process.stdout.write(JSON.stringify({ readiness, policy, allowedPaths: allowPaths, blockedPaths: blockPaths }, null, 2) + "\n"); return 0; }
    process.stdout.write([
      "",
      `Loop readiness: ${readiness.classification}`,
      `  Risk tier:    ${readiness.riskTier}`,
      `  Mode:         ${policy.mode}`,
      `  Max iter:     ${policy.maxIterations}`,
      `  Max runtime:  ${policy.maxRuntimeMinutes}m`,
      `  Reason codes: ${readiness.reasonCodes.join(", ") || "none"}`,
      visibleChecks.length > 0 ? `  Checks:       ${visibleChecks.map(c => c.label).join(", ")}` : "",
      allowPaths.length > 0 ? `  Allowed:      ${allowPaths.join(", ")}` : "",
      blockPaths.length > 0 ? `  Blocked:      ${blockPaths.join(", ")}` : "",
      readiness.classification === "blocked" ? "  This task cannot be run as a loop." : "",
      readiness.classification === "needs_human_gate" ? "  This task will run as single_run (human gate required)." : "",
      "",
    ].filter(Boolean).join("\n"));
    return 0;
  }

  if (sub === "start") {
    const task = args.slice(1).find(a => !a.startsWith("--") && a !== target);
    if (!task) { process.stderr.write("Usage: avorelo loop start \"<task>\" [--target <dir>] [--max <n>] [--allow <path>] [--block <path>] [--check <cmd>] [--json]\n"); return 2; }
    const readiness = classifyLoopReadiness({ task });
    if (readiness.classification === "blocked") {
      process.stderr.write(`\nBlocked: ${readiness.reasonCodes.join(", ")}. This task cannot be looped.\n\n`);
      return 1;
    }
    const userMax = arg(args, "--max");
    const allowPaths = multiArg(args, "--allow");
    const blockPaths = multiArg(args, "--block");
    const userCheckCmds = multiArg(args, "--check");
    const userChecks = userCheckCmds.length > 0 ? userCheckCmds.map(cmd => ({ label: cmd, command: cmd })) : undefined;
    const policy = buildLoopPolicy({ readiness, userMaxIterations: userMax ? Number(userMax) : undefined, cwd: target, userChecks });

    if (!claudeCodeLoopAdapter.isAvailable()) {
      process.stderr.write("\nClaude Code CLI not found. Install it or ensure `claude` is on PATH.\n\n");
      return 1;
    }

    const ac = new AbortController();
    const sigHandler = () => { ac.abort(); };
    process.on("SIGINT", sigHandler);
    process.on("SIGTERM", sigHandler);

    const visibleChecks = policy.requiredChecks.filter(c => c.type !== "scope_check" && c.type !== "drift_check");
    process.stdout.write([
      "",
      `Starting loop: ${task}`,
      `  Mode:       ${policy.mode}`,
      `  Max iter:   ${policy.maxIterations}`,
      `  Risk tier:  ${readiness.riskTier}`,
      visibleChecks.length > 0 ? `  Checks:     ${visibleChecks.map(c => c.label).join(", ")}` : "",
      allowPaths.length > 0 ? `  Allowed:    ${allowPaths.join(", ")}` : "",
      blockPaths.length > 0 ? `  Blocked:    ${blockPaths.join(", ")}` : "",
      "",
    ].filter(Boolean).join("\n"));

    const contractId = `wc_loop_${Date.now().toString(36)}`;
    return runLoop({
      task,
      contractId,
      policy,
      adapter: claudeCodeLoopAdapter,
      cwd: target,
      allowedPaths: allowPaths,
      disallowedPaths: blockPaths,
      abortSignal: ac.signal,
      onIterationComplete(s) {
        process.stdout.write(`  [iter ${s.iteration}] gate=${s.gateDecision} files=${s.filesChanged.length} drift=${s.driftDetected} (${s.durationMs}ms)\n`);
      },
    }).then((result) => {
      process.removeListener("SIGINT", sigHandler);
      process.removeListener("SIGTERM", sigHandler);
      if (asJson) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); return result.stopCategory === "success" ? 0 : 1; }
      process.stdout.write([
        "",
        `Loop complete: ${result.stopReason}`,
        `  Iterations: ${result.iterationsRun}`,
        `  Receipt:    ${result.metadata.kernelReceiptRef}`,
        `  Metadata:   ${result.metadataPath}`,
        `  Proof:      ${result.metadata.proofState}`,
        "",
      ].join("\n"));
      return result.stopCategory === "success" ? 0 : 1;
    });
  }

  if (sub === "status") {
    const active = readActiveLoop(target);
    if (!active || !active.loopId) {
      if (asJson) { process.stdout.write(JSON.stringify({ status: "none" }) + "\n"); return 0; }
      process.stdout.write("\nNo active or recent loop found.\n\n");
      return 0;
    }
    const meta = readLoopMetadata(target, active.loopId);
    if (asJson) { process.stdout.write(JSON.stringify({ active, metadata: meta }, null, 2) + "\n"); return 0; }
    if (!meta) {
      process.stdout.write(`\nLoop ${active.loopId}: ${active.status} (no metadata yet)\n\n`);
      return 0;
    }
    process.stdout.write([
      "",
      `Loop: ${meta.loopId}`,
      `  Status:     ${active.status}`,
      `  Stop:       ${meta.stopReason}`,
      `  Iterations: ${meta.iterationsRun}/${meta.maxIterations}`,
      `  Proof:      ${meta.proofState}`,
      `  Drift:      ${meta.driftDetected ? "yes" : "no"}`,
      `  Files:      ${meta.filesChanged.length} (${meta.filesChangedInScope} in-scope)`,
      `  Receipt:    ${meta.kernelReceiptRef}`,
      "",
    ].join("\n"));
    return 0;
  }

  if (sub === "stop") {
    const active = readActiveLoop(target);
    if (!active || !active.loopId || active.status === "none") {
      process.stdout.write("\nNo active loop to stop.\n\n");
      return 0;
    }
    process.stdout.write("\nLoop stop signal sent (Ctrl+C). The active loop will stop after the current iteration.\n\n");
    return 0;
  }

  if (sub === "latest") {
    const meta = readLatestLoopMetadata(target);
    if (!meta) {
      if (asJson) { process.stdout.write(JSON.stringify({ latest: null }) + "\n"); return 0; }
      process.stdout.write("\nNo recent loop found.\n\n");
      return 0;
    }
    if (asJson) { process.stdout.write(JSON.stringify(meta, null, 2) + "\n"); return 0; }
    const checksSummary = meta.checksRun.length > 0
      ? `${meta.checksPassed} passed, ${meta.checksFailed} failed, ${meta.checksNotRun} not run`
      : "none";
    const driftLine = meta.driftDetected ? `${meta.driftSummary.length} finding(s)` : "none";
    const resumeHint = meta.safeNextActions.length > 0 ? meta.safeNextActions[0] : "none";
    process.stdout.write([
      "",
      `Latest loop: ${meta.loopId}`,
      `  Created:    ${meta.createdAt}`,
      `  Stop:       ${meta.stopReason} (${meta.stopCategory})`,
      `  Iterations: ${meta.iterationsRun}/${meta.maxIterations}`,
      `  Proof:      ${meta.proofState}`,
      `  Checks:     ${checksSummary}`,
      `  Drift:      ${driftLine}`,
      `  Files:      ${meta.filesChanged.length} changed (${meta.filesChangedInScope} in-scope)`,
      `  Receipt:    ${meta.kernelReceiptRef}`,
      `  Resume:     ${resumeHint}`,
      "",
    ].join("\n"));
    return 0;
  }
  if (sub === "receipt") {
    const loopId = args[1];
    if (!loopId || loopId.startsWith("--")) { process.stderr.write("Usage: avorelo loop receipt <loopId> [--target <dir>] [--json]\n"); return 2; }
    const meta = readLoopMetadata(target, loopId);
    if (!meta) { process.stderr.write(`\nNo loop metadata found for ${loopId}.\n\n`); return 1; }
    if (asJson) { process.stdout.write(JSON.stringify(meta, null, 2) + "\n"); return 0; }
    process.stdout.write([
      "",
      `Loop receipt: ${meta.loopId}`,
      `  Contract:   ${meta.contractId}`,
      `  Kernel ref: ${meta.kernelReceiptRef}`,
      `  Mode:       ${meta.mode}`,
      `  Iterations: ${meta.iterationsRun}/${meta.maxIterations}`,
      `  Runtime:    ${Math.round(meta.totalRuntimeMs / 1000)}s`,
      `  Stop:       ${meta.stopReason} (${meta.stopCategory})`,
      `  Proof:      ${meta.proofState}`,
      `  Files:      ${meta.filesChanged.length} changed (${meta.filesChangedInScope} in-scope, ${meta.filesChangedOutOfScope} out-of-scope)`,
      `  Checks:     ${meta.checksPassed} passed, ${meta.checksFailed} failed, ${meta.checksNotRun} not run`,
      `  Drift:      ${meta.driftDetected ? meta.driftSummary.length + " finding(s)" : "none"}`,
      `  Safety:     redacted=${meta.safety.redacted} rawPrompt=${meta.safety.containsRawPrompt} rawSecret=${meta.safety.containsRawSecret}`,
      "",
    ].join("\n"));
    return 0;
  }


  if (sub === "resume") {
    const resumeTarget = args[1];
    const meta = resumeTarget && !resumeTarget.startsWith("--")
      ? readLoopMetadata(target, resumeTarget.startsWith("loop_") ? resumeTarget : `loop_${resumeTarget}`)
      : readLatestLoopMetadata(target);
    if (!meta) {
      if (asJson) { process.stdout.write(JSON.stringify({ resume: null }) + "\n"); return 0; }
      process.stdout.write("\nNo loop found to resume.\n\n");
      return 0;
    }
    const plan: string[] = [];
    if (meta.openIssues.length > 0) plan.push(`Open issues: ${meta.openIssues.join("; ")}`);
    if (meta.safeNextActions.length > 0) plan.push(...meta.safeNextActions.map(a => `Next: ${a}`));
    if (meta.checksFailed > 0) plan.push(`Re-run ${meta.checksFailed} failed check(s)`);
    if (meta.driftDetected) plan.push(`Review ${meta.driftSummary.length} drift finding(s)`);
    if (plan.length === 0) plan.push("No continuation actions identified.");
    if (asJson) { process.stdout.write(JSON.stringify({ loopId: meta.loopId, plan }, null, 2) + "\n"); return 0; }
    process.stdout.write([
      "",
      `Resume plan for: ${meta.loopId}`,
      `  Last stop:  ${meta.stopReason} (${meta.stopCategory})`,
      `  Proof:      ${meta.proofState}`,
      `  Iterations: ${meta.iterationsRun}/${meta.maxIterations}`,
      "",
      "  Continuation plan:",
      ...plan.map(p => `    - ${p}`),
      "",
      "  (display only â€” does not execute)",
      "",
    ].join("\n"));
    return 0;
  }

  if (sub === "doctor") {
    const issues: string[] = [];
    const ok: string[] = [];

    if (existsSync(join(target, ".git"))) { ok.push("Git repository detected"); }
    else { issues.push("Not a git repository â€” loop needs git for drift detection"); }

    if (claudeCodeLoopAdapter.isAvailable()) { ok.push("Claude Code CLI available"); }
    else { issues.push("Claude Code CLI not found â€” install it or ensure `claude` is on PATH"); }

    const testDir = join(target, ".avorelo", "loops");
    try {
      mkdirSync(testDir, { recursive: true });
      const testFile = join(testDir, ".doctor_probe");
      writeFileSync(testFile, "probe");
      unlinkSync(testFile);
      ok.push("Storage writable (.avorelo/loops/)");
    } catch { issues.push("Cannot write to .avorelo/loops/ â€” check permissions"); }

    const detected = detectCheckCommands(target);
    if (detected.length > 0) { ok.push(`Auto-detected checks: ${detected.map(c => c.label).join(", ")}`); }
    else { ok.push("No auto-detected checks (use --check to add manually)"); }

    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split(".")[0], 10);
    if (major >= 24) { ok.push(`Node.js ${nodeVersion}`); }
    else { issues.push(`Node.js ${nodeVersion} â€” version 24+ recommended`); }

    if (asJson) { process.stdout.write(JSON.stringify({ ok, issues, ready: issues.length === 0 }, null, 2) + "\n"); return 0; }
    process.stdout.write([
      "",
      "Avorelo Loop Doctor",
      "",
      ...ok.map(o => `  âœ“ ${o}`),
      ...issues.map(i => `  âœ— ${i}`),
      "",
      issues.length === 0 ? "  Ready to loop." : `  ${issues.length} issue(s) found.`,
      "",
    ].join("\n"));
    return 0;
  }

  process.stderr.write("Usage: avorelo loop <check|start|status|stop|latest|receipt|resume|doctor> [args]\n");
  return 2;
}

function cmdUninstallAll(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const adapterResult = uninstallAll(target);
  const hookResult = uninstall(target);
  const removed = [...adapterResult.removed, ...(hookResult.restored ? [join(target, ".claude", "settings.json")] : [])];
  const preserved = adapterResult.preserved;
  const avoreloDir = join(target, ".avorelo");
  try {
    if (existsSync(avoreloDir)) {
      rmSync(avoreloDir, { recursive: true, force: true });
      removed.push(avoreloDir);
    }
  } catch {}
  process.stdout.write(JSON.stringify({ target, removed, preserved, hooksRestored: hookResult.restored }, null, 2) + "\n");
  return 0;
}

function cmdSettings(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const sub = args[0];

  if (sub === "set") {
    // Community Edition has no configurable settings: update checking is explicit-only
    // (no automatic-check preference), and there is no telemetry/learning to toggle.
    process.stderr.write("No configurable settings in Community Edition. Update checks are explicit: run `avorelo update check`.\n");
    return 1;
  }

  if (sub === "reset") {
    const ws = loadWorkspace(target);
    const s = resetSettings(target, { workspaceId: ws?.workspaceId });
    if (asJson) { process.stdout.write(JSON.stringify(s, null, 2) + "\n"); return 0; }
    process.stdout.write("Settings reset to defaults.\n");
    return 0;
  }

  // Default: show
  const s = loadSettings(target) ?? ensureSettings(target, { workspaceId: loadWorkspace(target)?.workspaceId });
  if (asJson) { process.stdout.write(JSON.stringify(s, null, 2) + "\n"); return 0; }
  process.stdout.write(renderSettings(s));
  return 0;
}

// Explicit update check: the ONLY network-capable update op. One bounded GET to the fixed npm URL.
async function cmdUpdateCheck(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const result = await checkUpdateExplicit();
  if (asJson) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); return result.source === "unavailable" ? 1 : 0; }
  process.stdout.write(renderFreshnessResult(result) + "\n");
  // fail-open: local Avorelo stays usable; an unusable registry response is reported honestly (exit 1),
  // never a silent "up to date".
  return result.source === "unavailable" ? 1 : 0;
}

// Network-free tombstone: Avorelo never self-updates. Prints manual commands; runs nothing.
function cmdUpdateApply(_args: string[]): number {
  process.stdout.write([
    "",
    "Avorelo does not self-update. Community Edition is installed via npm and updated manually.",
    "",
    "  One-off (always latest):   npx avorelo@latest <command>",
    "  If you installed globally:  npm install -g avorelo@latest",
    "",
    "  (Informational only — nothing was run, downloaded, or installed.)",
    "",
  ].join("\n"));
  return 0;
}

function cmdCapabilities(args: string[]): number {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const caps = discoverCapabilities(target);

  if (asJson) {
    process.stdout.write(JSON.stringify(capabilitiesToJson(caps), null, 2) + "\n");
    return 0;
  }

  process.stdout.write(renderCapabilities(caps) + "\n");
  return 0;
}

async function cmdProve(args: string[]): Promise<number> {
  const target = arg(args, "--target", process.cwd())!;
  const asJson = args.includes("--json");
  const changedFiles = multiArg(args, "--files");

  const caps = discoverCapabilities(target);
  const contract = generateProofContract(changedFiles, caps);
  const proofRun = await runAllProof(target, changedFiles);
  const gate = evaluateEvidence(contract, proofRun);
  const receipt = createVerificationReceipt(target, contract, proofRun, gate);
  const receiptPath = storeVerificationReceipt(receipt, target);

  if (asJson) {
    process.stdout.write(JSON.stringify({
      contract: { workType: contract.workType, requiredProof: contract.requiredProof.length },
      proofRun: { overallStatus: proofRun.overallStatus, totalDuration: proofRun.totalDuration },
      gate: gateResultToJson(gate),
      receipt: { id: receipt.id, safeToClose: receipt.safeToClose },
      receiptPath,
    }, null, 2) + "\n");
    return gate.safeToClose ? 0 : 1;
  }

  process.stdout.write([
    renderProofContract(contract),
    "",
    renderProofRun(proofRun),
    "",
    renderGateResult(gate),
    "",
    renderVerificationReceipt(receipt),
    `Receipt stored: ${receiptPath}`,
  ].join("\n") + "\n");

  return gate.safeToClose ? 0 : 1;
}

function avoreloVersion(): string {
  // Read AVORELO's own package version. Works both from source (src/avorelo/surfaces/cli) and from the
  // bundled dist (node_modules/avorelo/dist). Try the NEAREST package.json first and ONLY accept the one
  // named "avorelo" â€” when installed as a dependency, a deeper ancestor package.json belongs to the
  // CONSUMER project and must never be mistaken for ours (that returned the wrong --version before).
  for (const rel of ["../package.json", "../../package.json", "../../../package.json", "../../../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(import.meta.dirname, rel), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "avorelo" && pkg.version) return pkg.version;
    } catch { /* try next */ }
  }
  return "unknown";
}

function main(argv: string[]): number | Promise<number> {
  const args = argv.slice(2);
  const cmd = args[0];
  const rest = args.slice(1);
  if (cmd === "--version" || cmd === "-v" || cmd === "version") { process.stdout.write(`avorelo ${avoreloVersion()}\n`); return 0; }
  if (!cmd || args.includes("--help")) return help();
  switch (cmd) {
    case "start": return cmdStart(rest);
    case "run": return rest.includes("--fixture") ? cmdRun(rest) : cmdRunTask(rest);
    case "resume": return cmdResume(rest);
    case "watch": return cmdWatch(rest);
    case "explain": return cmdExplain(rest);
    case "prompt": return cmdPrompt(rest);
    case "settings": return cmdSettings(rest);
    case "update-check": return cmdUpdateCheck(rest);
    case "update-apply": return cmdUpdateApply(rest);
    case "feedback": return cmdFeedback(rest);
    case "support": return cmdSupport(rest);
    case "activate": return cmdActivate(rest);
    case "preflight": return cmdPreflight(rest);
    case "doctor": return cmdDoctor(rest);
    case "uninstall": return cmdUninstallAll(rest);
    case "init": return cmdInit(rest);
    case "dogfood-check": return cmdDogfoodCheck(rest);
    case "dogfood-summary": return cmdDogfoodSummary(rest);
    case "core-readiness": return cmdCoreReadiness(rest);
    case "status": return cmdStatus(rest);
    case "open": return cmdOpen(rest);
    case "control-center": return cmdControlCenter(rest);
    case "browser": return cmdBrowserQa(rest);
    case "visual": return cmdBrowserQa(rest);
    case "verify": return cmdVerify(rest);
    case "site": return cmdSite(rest);
    case "serve": return cmdServe(rest);
    case "claim":
    case "sync":
    case "billing":
      return cmdCloudDiscontinued(cmd);
    case "lifecycle-hook": return cmdLifecycleHook(rest);
    case "secret-boundary": return cmdSecretBoundary(rest);
    case "brief": return cmdContextTrustBrief(rest);
    case "context": return cmdContext(rest);
    case "model": return cmdModel(rest);
    case "workflow": return cmdWorkflow(rest);
    case "session": return cmdSession(rest);
    case "continuity": return cmdContinuity(rest);
    case "token-cost": return cmdTokenCost(rest);
    case "report": return cmdReport(rest);
    case "value": return cmdValue(rest);
    case "work": return cmdWork(rest);
    case "readiness": return cmdReadiness(rest);
    case "loop": return cmdLoop(rest);
    case "capabilities": return cmdCapabilities(rest);
    case "prove": return cmdProve(rest);
    default: return help();
  }
}

const result = main(process.argv);
const _cmd = process.argv[2];
const _restArgs = process.argv.slice(3);


async function finalize(exitCode: number): Promise<void> {
  process.exitCode = exitCode;
  // Community Edition: no remote telemetry, no learning uplink, no auto-emitted
  // events. Command finalization performs no outbound request.
  if (_cmd !== "serve") {
    setTimeout(() => process.exit(exitCode), 50).unref();
  }
}

if (typeof result === "number") { void finalize(result); }
else {
  result.then(
    (exitCode) => void finalize(exitCode),
    // Surface the failure instead of exiting 1 silently — a swallowed rejection previously
    // hid a real activate crash. Print the error, then fail.
    (e) => { process.stderr.write(`Avorelo command failed: ${e?.stack ?? e}\n`); process.exit(1); },
  );
}
