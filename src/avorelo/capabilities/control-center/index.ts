// Avorelo Local Control Center v1 — `avorelo.controlCenter.v1`.
//
// A MINIMAL, LOCAL-FIRST, READ-ONLY operator surface. It owns NO truth: it only READS the artifacts the
// runtime flow and capabilities already wrote under `<dir>/.avorelo/` and projects them into one coherent
// read-model. No network, no server, no login, no cloud, no mutation. Deterministic given (dir, now).
//
// It composes existing loaders — it never recomputes or re-derives capability truth beyond calling their
// public read functions:
//   runtime-flow   → loadLatestRuntimeSession
//   token-cost     → loadTokenCostEvidence + summarizeTokenCostEvidence
//   proof-report   → buildProofReportFromLocalEvidence + summarizeProofReport
//   value-ledger   → loadValueLedgerEntries + buildCompactValueCards
//   continuity     → loadLatestContinuity
//   local-dashboard→ buildLocalDashboard (receipts projection)

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../../shared/redaction/index.ts";
import { loadLatestRuntimeSession } from "../runtime-flow/index.ts";
import { loadTokenCostEvidence, summarizeTokenCostEvidence } from "../token-cost-evidence/index.ts";
import { buildProofReportFromLocalEvidence, loadLatestProofReport, summarizeProofReport } from "../proof-report/index.ts";
import { loadValueLedgerEntries, buildCompactValueCards } from "../value-ledger/index.ts";
import { loadLatestContinuity } from "../continuity/index.ts";
import { buildLocalDashboard } from "../local-dashboard/index.ts";
import { buildHealthSummary } from "../../kernel/tool-adapters/health-persistence.ts";
import { getAdapterDescriptors } from "../../kernel/tool-adapters/registry.ts";
import { buildWorkIntelligence, loadLatestWorkIntelligence } from "../work-intelligence/index.ts";
import { readBrowserQaLatest } from "../browser-visual-qa/index.ts";

export type SectionStatus = "available" | "unavailable";

export type ControlCenterModel = {
  contract: "avorelo.controlCenter.v1";
  schemaVersion: 1;
  generatedAt: number;
  workspace: string;
  sections: {
    runtimeSession: {
      status: SectionStatus;
      runtimeSessionId?: string;
      sessionStatus?: string;
      gate?: string;
      route?: string;
      riskClass?: string;
      proofTier?: string;
      layers?: { layer: string; status: string }[];
    };
    contextPack: {
      status: SectionStatus;
      contextPackId?: string;
      consumer?: string;
      selectedAdapter?: string;
      allowedCount?: number;
      forbiddenCount?: number;
      provenanceTagCount?: number;
      budget?: string;
      contextBudgetUsed?: number;
    };
    proof: {
      status: SectionStatus;
      reportId?: string;
      canShowSavings: boolean;        // v1: always false
      savingsRefusalReason?: string | null;
      sectionCounts?: Record<string, number>;
      canShowCostSummary?: boolean;
    };
    value: {
      status: SectionStatus;
      cardCount?: number;
      needsAttentionCount?: number;
      cards?: { title: string; status: string; confidence: string; valueLabel: string }[];
    };
    // NOTE: keyed `costEvidence` (not `tokenCost`): the shared redaction policy treats any key containing
    // "token" as a credential and would redact this whole benign section. The human label stays "Token/cost".
    costEvidence: {
      status: SectionStatus;
      confidence?: string;
      canShowCostSummary?: boolean;
      unavailableReasons?: string[];
      evidenceCount?: number;
    };
    continuity: {
      status: SectionStatus;
      packetStatus?: string;
      proofMissingCount?: number;
      safeNextActionCount?: number;
    };
    efficiencySync: {
      status: SectionStatus;
      mode?: string;                  // always "dry_run" when present
      eligibleCount?: number;
      blockedCount?: number;
    };
    contextCheck: {
      status: SectionStatus;
      checkStatus?: string;
      riskLevel?: string;
      inputsChecked?: number;
      findingCount?: number;
      policyPresent?: boolean;
    };
    receipts: {
      total: number;
      done: number;
      inProgress: number;
      blocked: number;
      needsAttention: number;
      stale: number;
    };
    modelRouting: {
      status: SectionStatus;
      selectedPrimitive?: string;
      selectedModelProfile?: string;
      resolverStatus?: string;
      providerClass?: string;
      modelMayDecide?: false;
      scannerMayDecide?: false;
      finalDecisionOwner?: string;
      reasonCodes?: string[];
    };
    toolExecution: {
      status: SectionStatus;
      selectedAdapter?: string;
      executionMode?: string;
      fallbackAdapters?: string[];
      approvalRequired?: boolean;
      proofRequired?: boolean;
      toolMayExecute?: boolean;
      modelMayDecide?: false;
      scannerMayDecide?: false;
      finalDecisionOwner?: string;
      reasonCodes?: string[];
      executionStatus?: string;
      executionReceiptId?: string;
      executionDurationMs?: number;
      executionProofCollected?: boolean;
      containsRawOutput?: false;
      containsRawModelOutput?: false;
      containsRawTerminalOutput?: false;
      containsRawGitDiff?: false;
      proofMetadata?: {
        adapterClass: string;
        summary: string;
        findingCount: number;
        artifactCount: number;
        fake: boolean;
        localOnly: boolean;
        sanitized: true;
      } | null;
      delegatedExecution?: {
        attempted: boolean;
        toolVersion: string | null;
        authRequired: boolean;
        patchSummary: string | null;
        filesChangedCount: number;
        taskSafetyClass: string;
        failureReason: string | null;
        containsRawModelOutput: false;
      } | null;
    };
    adapterHealth: {
      status: SectionStatus;
      totalAdapters?: number;
      healthyCount?: number;
      unhealthyCount?: number;
      cooldownCount?: number;
      unhealthyAdapters?: { adapterId: string; consecutiveFailures: number; cooldownUntil: number }[];
    };
    workIntelligence: {
      status: SectionStatus;
      outcomeStatus?: string;
      proofStatus?: string;
      resumeReadiness?: string;
      contextWasteLevel?: string;
      hygieneWarningCount?: number;
      nextActionCount?: number;
      nextActionPreview?: string;
      exportMode?: string;
    };
    browserVisualQa: {
      status: SectionStatus;
      generatedAt?: string;
      decision?: string;
      routesChecked?: number;
      failedRoutes?: number;
      warningCount?: number;
      screenshotPolicy?: string;
      screenshotsPersisted?: number;
      unsafeCapturesBlocked?: number;
      topFindings?: { route: string; severity: string; reasonCode: string; safeSummary: string }[];
      nextSafeAction?: string;
    };
  };
  sources: string[];
  notes: string[];
  redaction: "applied";
};

export type BuildOpts = { now: number; staleWindowMs?: number };

function avoreloPath(dir: string, ...parts: string[]): string { return join(dir, ".avorelo", ...parts); }

/** Build the read-only Control Center model from local artifacts. Read-only; owns no truth. */
export function buildControlCenter(dir: string, opts: BuildOpts): ControlCenterModel {
  const sources: string[] = [];
  const notes: string[] = [];

  // --- Runtime session (the coherent product-flow record) ---
  const runtime = loadLatestRuntimeSession(dir);
  const runtimeSection: ControlCenterModel["sections"]["runtimeSession"] = runtime
    ? {
        status: "available",
        runtimeSessionId: runtime.runtimeSessionId,
        sessionStatus: runtime.status,
        gate: runtime.gate,
        route: runtime.route,
        riskClass: runtime.riskClass,
        proofTier: runtime.proofTier,
        layers: runtime.layers.map((l) => ({ layer: l.layer, status: l.status })),
      }
    : { status: "unavailable" };
  if (runtime) sources.push(avoreloPath(dir, "runtime", "session.latest.json"));
  else notes.push("No runtime session yet — run `avorelo run \"<task>\"` to create one.");

  const contextPackSection: ControlCenterModel["sections"]["contextPack"] = runtime?.contextPack
    ? {
        status: "available",
        contextPackId: runtime.contextPack.contextPackId,
        consumer: runtime.contextPack.consumer,
        selectedAdapter: runtime.contextPack.selectedAdapter,
        allowedCount: runtime.contextPack.allowedCount,
        forbiddenCount: runtime.contextPack.forbiddenCount,
        provenanceTagCount: runtime.contextPack.provenanceTagCount,
        budget: runtime.contextPack.budget,
        contextBudgetUsed: runtime.contextPack.contextBudgetUsed,
      }
    : { status: "unavailable" };
  if (runtime?.contextPack?.ref) sources.push(runtime.contextPack.ref);

  const efficiencySection: ControlCenterModel["sections"]["efficiencySync"] = runtime?.efficiencySync
    ? { status: "available", mode: runtime.efficiencySync.mode, eligibleCount: runtime.efficiencySync.eligibleCount, blockedCount: runtime.efficiencySync.blockedCount }
    : { status: "unavailable" };

  // --- Proof report (rebuilt read-only from local evidence) ---
  let proofSection: ControlCenterModel["sections"]["proof"] = { status: "unavailable", canShowSavings: false };
  try {
    const report = loadLatestProofReport(dir) ?? buildProofReportFromLocalEvidence(dir);
    const sum = summarizeProofReport(report);
    proofSection = {
      status: "available",
      reportId: report.reportId,
      canShowSavings: sum.canShowSavings,
      savingsRefusalReason: sum.savingsRefusalReason,
      sectionCounts: sum.sections,
      canShowCostSummary: sum.canShowCostSummary,
    };
  } catch { /* no evidence yet */ }

  // --- Token & cost evidence ---
  const tcEvidence = loadTokenCostEvidence(dir);
  let costEvidenceSection: ControlCenterModel["sections"]["costEvidence"] = { status: "unavailable" };
  if (tcEvidence.length > 0) {
    const sum = summarizeTokenCostEvidence(tcEvidence);
    costEvidenceSection = {
      status: "available",
      confidence: sum.measuredCount > 0 ? "measured" : sum.importedCount > 0 ? "imported" : sum.estimatedCount > 0 ? "estimated" : sum.inferredCount > 0 ? "inferred" : "unavailable",
      canShowCostSummary: sum.canUseForCostSummary,
      unavailableReasons: sum.unavailableReasons,
      evidenceCount: tcEvidence.length,
    };
    sources.push(avoreloPath(dir, "evidence", "token-cost.jsonl"));
  }

  // --- Value ledger (compact cards) ---
  const entries = loadValueLedgerEntries(dir);
  let valueSection: ControlCenterModel["sections"]["value"] = { status: "unavailable" };
  if (entries.length > 0) {
    const cards = buildCompactValueCards(entries);
    valueSection = {
      status: "available",
      cardCount: cards.length,
      needsAttentionCount: cards.filter((c) => c.status === "needs_attention").length,
      cards: cards.map((c) => ({ title: c.title, status: c.status, confidence: c.confidence, valueLabel: c.valueLabel })),
    };
    sources.push(avoreloPath(dir, "value-ledger", "value-ledger.jsonl"));
  }

  // --- Continuity (next-run intent) ---
  const cont = loadLatestContinuity(dir);
  const continuitySection: ControlCenterModel["sections"]["continuity"] = cont
    ? { status: "available", packetStatus: cont.status, proofMissingCount: cont.proofMissing.length, safeNextActionCount: cont.safeNextActions.length }
    : { status: "unavailable" };
  if (cont) sources.push(avoreloPath(dir, "continuity", "latest.json"));

  // --- Context Check (agent instruction integrity) ---
  let contextCheckSection: ControlCenterModel["sections"]["contextCheck"] = { status: "unavailable" };
  try {
    const ccPath = avoreloPath(dir, "context-check", "latest.json");
    if (existsSync(ccPath)) {
      const raw = JSON.parse(readFileSync(ccPath, "utf8"));
      contextCheckSection = {
        status: "available",
        checkStatus: raw.status,
        riskLevel: raw.riskLevel,
        inputsChecked: raw.sourcesChecked,
        findingCount: raw.findingCount,
        policyPresent: raw.workContractProvided ?? false,
      };
      sources.push(ccPath);
    }
  } catch { /* no context-check data yet */ }

  // --- Receipts (reuse the local dashboard projection; read-only) ---
  const dash = buildLocalDashboard(dir, { now: opts.now, staleWindowMs: opts.staleWindowMs });
  const receiptsSection = {
    total: dash.totals.total,
    done: dash.totals.done,
    inProgress: dash.totals.inProgress,
    blocked: dash.totals.blocked,
    needsAttention: dash.totals.needsAttention,
    stale: dash.totals.stale,
  };
  if (dash.totals.total > 0) sources.push(avoreloPath(dir, "receipts"));

  // --- Model Routing (from latest runtime session projection) ---
  const modelRoutingSection: ControlCenterModel["sections"]["modelRouting"] = runtime?.modelRouting
    ? {
        status: "available",
        selectedPrimitive: runtime.modelRouting.selectedPrimitive,
        selectedModelProfile: runtime.modelRouting.selectedModelProfile,
        resolverStatus: runtime.modelRouting.resolverStatus,
        providerClass: runtime.modelRouting.providerClass,
        modelMayDecide: false,
        scannerMayDecide: false,
        finalDecisionOwner: runtime.modelRouting.finalDecisionOwner,
        reasonCodes: runtime.modelRouting.reasonCodes,
      }
    : { status: "unavailable" };

  // --- Tool Execution (from latest runtime session tool orchestration) ---
  const toolExecutionSection: ControlCenterModel["sections"]["toolExecution"] = runtime?.toolExecution
    ? {
        status: "available",
        selectedAdapter: runtime.toolExecution.selectedAdapter,
        executionMode: runtime.toolExecution.executionMode,
        fallbackAdapters: runtime.toolExecution.fallbackAdapters,
        approvalRequired: runtime.toolExecution.approvalRequired,
        proofRequired: runtime.toolExecution.proofRequired,
        toolMayExecute: runtime.toolExecution.toolMayExecute,
        modelMayDecide: false,
        scannerMayDecide: false,
        finalDecisionOwner: runtime.toolExecution.finalDecisionOwner,
        reasonCodes: runtime.toolExecution.reasonCodes,
        executionStatus: runtime.toolExecution.executionStatus,
        executionReceiptId: runtime.toolExecution.executionReceiptId,
        executionDurationMs: runtime.toolExecution.executionDurationMs,
        executionProofCollected: runtime.toolExecution.executionProofCollected,
        containsRawOutput: false,
        containsRawModelOutput: false,
        containsRawTerminalOutput: false,
        containsRawGitDiff: false,
        proofMetadata: runtime.toolExecution.proofMetadata ?? null,
        delegatedExecution: runtime.toolExecution.delegatedExecution ?? null,
        multiAgentReview: runtime.toolExecution.multiAgentReview ? {
          attempted: runtime.toolExecution.multiAgentReview.attempted,
          roundsCompleted: runtime.toolExecution.multiAgentReview.roundsCompleted,
          finalVerdict: runtime.toolExecution.multiAgentReview.finalVerdict,
          modelConsensusOnly: runtime.toolExecution.multiAgentReview.modelConsensusOnly,
          routedToManualGate: runtime.toolExecution.multiAgentReview.routedToManualGate,
          reasonCodes: runtime.toolExecution.multiAgentReview.reasonCodes,
          containsRawModelOutput: false,
        } : null,
      }
    : { status: "unavailable" };

  // --- Adapter Health (persistent health state from disk + in-memory) ---
  let adapterHealthSection: ControlCenterModel["sections"]["adapterHealth"] = { status: "unavailable" };
  try {
    const adapterIds = getAdapterDescriptors().map(d => d.id);
    const healthSummary = buildHealthSummary(dir, adapterIds, opts.now);
    const unhealthyAdapters = healthSummary.adapters
      .filter(a => !a.healthy || a.consecutiveFailures > 0)
      .map(a => ({ adapterId: a.adapterId, consecutiveFailures: a.consecutiveFailures, cooldownUntil: a.cooldownUntil }));
    adapterHealthSection = {
      status: "available",
      totalAdapters: healthSummary.totalAdapters,
      healthyCount: healthSummary.healthyCount,
      unhealthyCount: healthSummary.unhealthyCount,
      cooldownCount: healthSummary.cooldownCount,
      unhealthyAdapters: unhealthyAdapters.length > 0 ? unhealthyAdapters : undefined,
    };
  } catch { /* best-effort */ }

  let workIntelligenceSection: ControlCenterModel["sections"]["workIntelligence"] = { status: "unavailable" };
  try {
    const work = loadLatestWorkIntelligence(dir) ?? buildWorkIntelligence(dir, { now: opts.now }).model;
    workIntelligenceSection = {
      status: "available",
      outcomeStatus: work.outcomeReceipt360.outcomeStatus,
      proofStatus: work.outcomeReceipt360.proofStatus,
      resumeReadiness: work.resume.readiness,
      contextWasteLevel: work.contextWaste.level,
      hygieneWarningCount:
        work.hygiene.receipt.warnings.length +
        work.hygiene.artifact.warnings.length +
        work.hygiene.capability.warnings.length,
      nextActionCount: work.resume.safeNextActions.length,
      nextActionPreview: work.resume.safeNextActions[0],
      exportMode: "rich",
    };
  } catch { /* no work intelligence artifact yet */ }

  let browserVisualQaSection: ControlCenterModel["sections"]["browserVisualQa"] = { status: "unavailable" };
  try {
    const browserQa = readBrowserQaLatest(dir);
    if (browserQa) {
      browserVisualQaSection = {
        status: "available",
        generatedAt: browserQa.generatedAt,
        decision: browserQa.decision,
        routesChecked: browserQa.routesChecked,
        failedRoutes: browserQa.failedRoutes,
        warningCount: browserQa.warningCount,
        screenshotPolicy: browserQa.screenshotPolicy,
        screenshotsPersisted: browserQa.screenshotsPersisted,
        unsafeCapturesBlocked: browserQa.unsafeCapturesBlocked,
        topFindings: browserQa.topFindings.map((finding) => ({
          route: finding.route,
          severity: finding.severity,
          reasonCode: finding.reasonCode,
          safeSummary: finding.safeSummary,
        })),
        nextSafeAction: browserQa.nextSafeAction,
      };
      sources.push(avoreloPath(dir, "browser-qa", "latest.json"));
    }
  } catch { /* no browser qa artifact yet */ }

  if (sources.length === 0) notes.push("This workspace has no Avorelo activity yet.");

  const model: ControlCenterModel = {
    contract: "avorelo.controlCenter.v1",
    schemaVersion: 1,
    generatedAt: opts.now,
    workspace: dir,
    sections: {
      runtimeSession: runtimeSection,
      contextPack: contextPackSection,
      proof: proofSection,
      value: valueSection,
      costEvidence: costEvidenceSection,
      continuity: continuitySection,
      efficiencySync: efficiencySection,
      contextCheck: contextCheckSection,
      receipts: receiptsSection,
      modelRouting: modelRoutingSection,
      toolExecution: toolExecutionSection,
      adapterHealth: adapterHealthSection,
      workIntelligence: workIntelligenceSection,
      browserVisualQa: browserVisualQaSection,
    },
    sources,
    notes,
    redaction: "applied",
  };
  // Defense-in-depth: every source is already redacted, but redact again before the model leaves.
  return redact(model).value;
}

// --- Rendering (local only; no remote assets; all dynamic strings escaped) ---

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function renderText(m: ControlCenterModel): string {
  const s = m.sections;
  const lines: string[] = [
    "Avorelo — Local Control Center (read-only)",
    `  workspace: ${m.workspace}`,
  ];
  if (s.runtimeSession.status === "available") {
    lines.push(`  Runtime:   ${s.runtimeSession.sessionStatus} · gate=${s.runtimeSession.gate} route=${s.runtimeSession.route} risk=${s.runtimeSession.riskClass} proof=${s.runtimeSession.proofTier}`);
    if (s.runtimeSession.layers?.length) lines.push(`    layers:  ${s.runtimeSession.layers.map((l) => `${l.layer}=${l.status}`).join(" ")}`);
  } else {
    lines.push("  Runtime:   none yet");
  }
  lines.push(`  Ctx pack:  ${s.contextPack.status === "available" ? `${s.contextPack.contextPackId} · consumer=${s.contextPack.consumer} adapter=${s.contextPack.selectedAdapter} · refs=${s.contextPack.allowedCount}/${s.contextPack.forbiddenCount} blocked · budget=${s.contextPack.budget} used=${s.contextPack.contextBudgetUsed} · tags=${s.contextPack.provenanceTagCount}` : "none"}`);
  lines.push(`  Proof:     ${s.proof.status === "available" ? `${s.proof.reportId} · savings ${s.proof.canShowSavings ? "shown" : `not claimed (${s.proof.savingsRefusalReason ?? "no_comparative_evidence"})`}` : "none"}`);
  lines.push(`  Token/cost:${s.costEvidence.status === "available" ? ` ${s.costEvidence.confidence} · costSummary=${s.costEvidence.canShowCostSummary} · ${s.costEvidence.evidenceCount} item(s)` : " none"}`);
  if (s.value.status === "available") {
    lines.push(`  Value:     ${s.value.cardCount} card(s)${s.value.needsAttentionCount ? ` · ${s.value.needsAttentionCount} need attention` : ""}`);
    for (const c of s.value.cards ?? []) lines.push(`    - ${c.title}: ${c.valueLabel} [${c.confidence}]`);
  } else {
    lines.push("  Value:     none");
  }
  lines.push(`  Continuity:${s.continuity.status === "available" ? ` ${s.continuity.packetStatus} · ${s.continuity.safeNextActionCount} next action(s) · ${s.continuity.proofMissingCount} proof gap(s)` : " none"}`);
  lines.push(`  Sync:      ${s.efficiencySync.status === "available" ? `${s.efficiencySync.mode} · ${s.efficiencySync.eligibleCount} eligible / ${s.efficiencySync.blockedCount} blocked` : "none"}`);
  lines.push(`  Context:   ${s.contextCheck.status === "available" ? `${s.contextCheck.checkStatus} · risk=${s.contextCheck.riskLevel} · ${s.contextCheck.inputsChecked} source(s) · ${s.contextCheck.findingCount} finding(s) · policy=${s.contextCheck.policyPresent}` : "none"}`);
  lines.push(`  Receipts:  ${s.receipts.total} · done ${s.receipts.done} · blocked ${s.receipts.blocked} · needs-attention ${s.receipts.needsAttention} · stale ${s.receipts.stale}`);
  if (s.modelRouting.status === "available") {
    lines.push(`  Routing:   primitive=${s.modelRouting.selectedPrimitive} profile=${s.modelRouting.selectedModelProfile} resolver=${s.modelRouting.resolverStatus} provider=${s.modelRouting.providerClass}`);
    lines.push(`    safety:  modelMayDecide=false scannerMayDecide=false owner=${s.modelRouting.finalDecisionOwner}`);
  } else {
    lines.push("  Routing:   none yet");
  }
  if (s.toolExecution.status === "available") {
    lines.push(`  Executor:  adapter=${s.toolExecution.selectedAdapter} mode=${s.toolExecution.executionMode} fallback=[${(s.toolExecution.fallbackAdapters ?? []).join(",")}]`);
    lines.push(`    gates:   approval=${s.toolExecution.approvalRequired} proof=${s.toolExecution.proofRequired} toolMayExecute=${s.toolExecution.toolMayExecute}`);
    if (s.toolExecution.executionStatus) {
      lines.push(`    exec:    status=${s.toolExecution.executionStatus} receipt=${s.toolExecution.executionReceiptId ?? "none"} duration=${s.toolExecution.executionDurationMs ?? 0}ms proof=${s.toolExecution.executionProofCollected ?? false}`);
    }
    if (s.toolExecution.proofMetadata) {
      const pm = s.toolExecution.proofMetadata;
      lines.push(`    proof:   class=${pm.adapterClass} findings=${pm.findingCount} artifacts=${pm.artifactCount} fake=${pm.fake} summary=${pm.summary}`);
    }
    if (s.toolExecution.delegatedExecution?.attempted) {
      const de = s.toolExecution.delegatedExecution;
      lines.push(`    delegated: version=${de.toolVersion ?? "n/a"} auth=${de.authRequired} safety=${de.taskSafetyClass} files=${de.filesChangedCount} patch=${de.patchSummary ?? "none"}`);
    }
  } else {
    lines.push("  Executor:  none yet");
  }
  lines.push(`  Work intel:${s.workIntelligence.status === "available" ? ` outcome=${s.workIntelligence.outcomeStatus} | proof=${s.workIntelligence.proofStatus} | resume=${s.workIntelligence.resumeReadiness} | waste=${s.workIntelligence.contextWasteLevel} | hygiene=${s.workIntelligence.hygieneWarningCount} | next=${s.workIntelligence.nextActionCount}${s.workIntelligence.nextActionPreview ? ` (${s.workIntelligence.nextActionPreview})` : ""}` : " none"}`);
  lines.push(`  Browser QA:${s.browserVisualQa.status === "available" ? ` ${s.browserVisualQa.decision} | routes=${s.browserVisualQa.routesChecked} | failed=${s.browserVisualQa.failedRoutes} | warnings=${s.browserVisualQa.warningCount} | screenshots=${s.browserVisualQa.screenshotPolicy}/${s.browserVisualQa.screenshotsPersisted}` : " none"}`);
  for (const n of m.notes) lines.push(`  note: ${n}`);
  lines.push("  (local-first · read-only · no network · no login)");
  return lines.join("\n") + "\n";
}

export function renderHtml(m: ControlCenterModel): string {
  const s = m.sections;
  const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;
  const valueCards = (s.value.cards ?? []).map((c) => `<li><b>${esc(c.title)}</b>: ${esc(c.valueLabel)} <span class="conf">[${esc(c.confidence)}]</span></li>`).join("");
  const layers = (s.runtimeSession.layers ?? []).map((l) => `<span class="layer ${esc(l.status)}">${esc(l.layer)}</span>`).join(" ");
  const workIntelligenceRow = row("Work intel", s.workIntelligence.status === "available"
    ? `outcome=${esc(s.workIntelligence.outcomeStatus)} | proof=${esc(s.workIntelligence.proofStatus)} | resume=${esc(s.workIntelligence.resumeReadiness)} | waste=${esc(s.workIntelligence.contextWasteLevel)} | hygiene=${esc(s.workIntelligence.hygieneWarningCount)} | next=${esc(s.workIntelligence.nextActionCount)}${s.workIntelligence.nextActionPreview ? ` (${esc(s.workIntelligence.nextActionPreview)})` : ""}`
    : '<span class="muted">none</span>');
  const browserQaRow = row("Browser QA", s.browserVisualQa.status === "available"
    ? `decision=${esc(s.browserVisualQa.decision)} | routes=${esc(s.browserVisualQa.routesChecked)} | failed=${esc(s.browserVisualQa.failedRoutes)} | warnings=${esc(s.browserVisualQa.warningCount)} | screenshots=${esc(s.browserVisualQa.screenshotPolicy)}/${esc(s.browserVisualQa.screenshotsPersisted)}${s.browserVisualQa.nextSafeAction ? `<div class="muted">${esc(s.browserVisualQa.nextSafeAction)}</div>` : ""}`
    : '<span class="muted">none</span>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Avorelo — Local Control Center</title>
<style>
  body{font:14px/1.6 system-ui,sans-serif;margin:2rem;color:#111;background:#fafafa;max-width:900px}
  h1{font-size:1.25rem} table{border-collapse:collapse;width:100%;margin:.5rem 0 1rem}
  th{text-align:left;color:#555;padding:.35rem .6rem;width:130px;vertical-align:top;border-bottom:1px solid #eee}
  td{padding:.35rem .6rem;border-bottom:1px solid #eee}
  ul{margin:.2rem 0;padding-left:1.1rem} .conf{color:#777;font-size:.8rem}
  .layer{font-size:.72rem;padding:.1rem .35rem;border-radius:3px;background:#eef;border:1px solid #dde}
  .layer.unavailable,.layer.blocked{background:#fdecea;border-color:#f5c6bf} .layer.completed{background:#e9f7ee;border-color:#bfe6cb}
  .muted{color:#999} .note{color:#7d3c00;font-size:.85rem} footer{color:#999;font-size:.75rem;margin-top:1.5rem}
</style></head><body>
<h1>Avorelo — Local Control Center</h1>
<table>
${row("Runtime", s.runtimeSession.status === "available" ? `${esc(s.runtimeSession.sessionStatus)} · gate=${esc(s.runtimeSession.gate)} route=${esc(s.runtimeSession.route)} risk=${esc(s.runtimeSession.riskClass)} proof=${esc(s.runtimeSession.proofTier)}<div>${layers}</div>` : '<span class="muted">none yet</span>')}
${row("Ctx pack", s.contextPack.status === "available" ? `${esc(s.contextPack.contextPackId)} · consumer=${esc(s.contextPack.consumer)} adapter=${esc(s.contextPack.selectedAdapter)} · refs=${esc(s.contextPack.allowedCount)}/${esc(s.contextPack.forbiddenCount)} blocked · budget=${esc(s.contextPack.budget)} used=${esc(s.contextPack.contextBudgetUsed)} · tags=${esc(s.contextPack.provenanceTagCount)}` : '<span class="muted">none</span>')}
${row("Proof", s.proof.status === "available" ? `${esc(s.proof.reportId)} · savings ${s.proof.canShowSavings ? "shown" : `<b>not claimed</b> (${esc(s.proof.savingsRefusalReason ?? "no_comparative_evidence")})`}` : '<span class="muted">none</span>')}
${row("Token/cost", s.costEvidence.status === "available" ? `${esc(s.costEvidence.confidence)} · costSummary=${esc(s.costEvidence.canShowCostSummary)} · ${esc(s.costEvidence.evidenceCount)} item(s)` : '<span class="muted">none</span>')}
${row("Value", s.value.status === "available" ? `${esc(s.value.cardCount)} card(s)<ul>${valueCards}</ul>` : '<span class="muted">none</span>')}
${row("Continuity", s.continuity.status === "available" ? `${esc(s.continuity.packetStatus)} · ${esc(s.continuity.safeNextActionCount)} next action(s) · ${esc(s.continuity.proofMissingCount)} proof gap(s)` : '<span class="muted">none</span>')}
${row("Sync", s.efficiencySync.status === "available" ? `${esc(s.efficiencySync.mode)} · ${esc(s.efficiencySync.eligibleCount)} eligible / ${esc(s.efficiencySync.blockedCount)} blocked` : '<span class="muted">none</span>')}
${row("Context", s.contextCheck.status === "available" ? `${esc(s.contextCheck.checkStatus)} · risk=${esc(s.contextCheck.riskLevel)} · ${esc(s.contextCheck.inputsChecked)} source(s) · ${esc(s.contextCheck.findingCount)} finding(s) · policy=${esc(s.contextCheck.policyPresent)}` : '<span class="muted">none</span>')}
${row("Receipts", `${esc(s.receipts.total)} · done ${esc(s.receipts.done)} · blocked ${esc(s.receipts.blocked)} · needs-attention ${esc(s.receipts.needsAttention)} · stale ${esc(s.receipts.stale)}`)}
${workIntelligenceRow}
${browserQaRow}
</table>
${m.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}
<footer>Local-first · read-only · no login · no network · workspace ${esc(m.workspace)} · generated ${esc(new Date(m.generatedAt).toISOString())}. The control center reads local artifacts; it owns no policy/evidence/receipt truth.</footer>
</body></html>`;
}

export type OpenControlCenterResult = { ok: boolean; model: ControlCenterModel; htmlPath: string };

/** Render the control center to <dir>/.avorelo/control-center/index.html (local file; no server). */
export function openControlCenter(dir: string, opts: BuildOpts): OpenControlCenterResult {
  const model = buildControlCenter(dir, opts);
  const ccDir = join(dir, ".avorelo", "control-center");
  mkdirSync(ccDir, { recursive: true });
  const htmlPath = join(ccDir, "index.html");
  writeFileSync(htmlPath, renderHtml(model));
  return { ok: true, model, htmlPath };
}
