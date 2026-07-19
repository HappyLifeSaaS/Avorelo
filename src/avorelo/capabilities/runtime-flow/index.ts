// Avorelo Runtime Product Flow v1 — `avorelo.runtimeSession.v1`.
//
// This module ORCHESTRATES the existing capabilities into ONE coherent runtime session. It does NOT
// reimplement any of them: every layer is consumed through its public entry point and linked by
// REFERENCE (ids / coded metadata) in the runtime-session record. Nothing here invents token numbers,
// claims savings, performs network I/O, or stores raw task / secret / source / prompt content.
//
// Layer order (the canonical pipeline a single `avorelo run "<task>"` performs):
//   L1 Secret Boundary + L2 WorkContract & Routing  → decideRouting (gate: allow / require_approval / blocked)
//   (gate=allow only:)
//   Session                                          → startSession (lifecycle owner)
//   L3 Context                                       → compileContext
//   L3 Context Check                                 → runContextCheck + persistContextCheckResult (agent instruction integrity)
//   L3 Continuity                                    → loadLatestContinuity/applyContinuity (carry-forward) + prepareContinuity/writeContinuity
//   L4 Token & Cost Evidence                         → createUnavailableTokenCostEvidence (prep has no measured execution; unavailable ≠ zero) + writeTokenCostEvidence
//   L4 Proof Report                                  → buildProofReportFromLocalEvidence + writeProofReport
//   L4 Value Ledger                                  → entriesFromProofReport → appendValueLedgerEntry → buildCompactValueCards + writeValueCards
//   L4 Efficiency Sync (dry-run)                     → buildEfficiencyMetadataSyncDryRun + writeEfficiencyMetadataSyncQueue (mode=dry_run, no network)

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { decideRouting } from "../../kernel/work-contract/routing.ts";
import { routeCanonical, createRouteSession, requestProfileChange, recordSensitiveSurface, type ModelRoutingProjection, type RouteSessionMemory } from "../../kernel/model-routing/index.ts";
import { buildCapabilityRouteDecision, buildWorkControlReceiptSummary, detectProposalHints, evaluateActionWorthiness } from "../../kernel/work-controls/index.ts";
import { planToolExecution, buildToolRoutingProjection, getEffectiveAvailability, runToolExecution, classifyTaskSafety, shouldTriggerMultiAgentReview, planMultiAgentReview, executeMultiAgentReview, persistHealthState, restoreHealthFromDisk, writeHealthSnapshot, type ToolRoutingProjection, type ExecutionContext } from "../../kernel/tool-adapters/index.ts";
import { getAdapterHealth } from "../../kernel/tool-adapters/registry.ts";
import { classifyTask } from "../../kernel/tool-adapters/policies.ts";
import { createToolExecutionResult } from "../../kernel/tool-adapters/receipt.ts";
import { startSession } from "../session/index.ts";
import { buildContextPack, compileContext, writeContextPack, writeContextPacket } from "../context-compiler/index.ts";
import {
  prepareContinuity, writeContinuity, loadLatestContinuity, applyContinuity,
} from "../continuity/index.ts";
import {
  createUnavailableTokenCostEvidence, writeTokenCostEvidence, loadTokenCostEvidence, summarizeTokenCostEvidence,
} from "../token-cost-evidence/index.ts";
import { buildProofReport, buildProofReportFromLocalEvidence, loadLatestProofReport, writeProofReport, summarizeProofReport } from "../proof-report/index.ts";
import {
  entriesFromProofReport, buildCompactValueCards, appendValueLedgerEntry, loadValueLedgerEntries, writeValueCards,
} from "../value-ledger/index.ts";
import { buildEfficiencyMetadataSyncDryRun, writeEfficiencyMetadataSyncQueue } from "../efficiency-sync/index.ts";
import { runContextCheck, persistContextCheckResult, toEvidenceArtifacts } from "../context-check/index.ts";
import { upsertWorkIntelligence } from "../work-intelligence/index.ts";
import { redact } from "../../shared/redaction/index.ts";
import type { ActionWorthinessDecision, CapabilityRouteDecision, WorkControlReceiptSummary } from "../../shared/schemas/index.ts";

export type PlanTier = "Free" | "Pro" | "Teams";
export type RuntimeGate = "allow" | "require_approval" | "blocked";
export type RuntimeStatus = "ready" | "awaiting_approval" | "blocked";
export type LayerStatus = "completed" | "skipped" | "unavailable" | "blocked";

/** One step of the pipeline, linked by reference. `detail` is a short, redacted, code-style label. */
export type RuntimeLayerRef = {
  order: number;
  layer: string;
  capability: string;
  status: LayerStatus;
  ref: string | null;       // primary id / path produced by this layer (never raw content)
  detail: string;           // short coded summary (redacted)
};

export type RuntimeSessionRecord = {
  contract: "avorelo.runtimeSession.v1";
  schemaVersion: 1;
  createdAt: string;
  runtimeSessionId: string;
  status: RuntimeStatus;
  gate: RuntimeGate;

  // L1 + L2 — routing / safety (redacted)
  contractId: string;
  objective: string;          // REDACTED display task label — never the raw task
  route: string;
  riskClass: string;
  proofTier: string;
  approvalPolicy: string;
  routingSummary: string;
  safetyBoundary: {
    secretBoundaryDecision: string;
    safeRunDecision: string;
    secretRiskCodes: string[];
  };
  workControls: {
    capabilityRoute: CapabilityRouteDecision;
    actionWorthiness: ActionWorthinessDecision;
    receiptSummary: WorkControlReceiptSummary;
  };

  // ordered reference chain
  layers: RuntimeLayerRef[];

  // per-layer reference projections (present only when produced; counts/ids/codes — no content)
  session?: { sessionId: string; controlTier: string; controlTierLabel: string; adapters: string[] };
  context?: { workContractId: string; selectedCount: number; excludedCount: number; safeReferenceCount: number; budget: string; riskFlags: string[]; ref: string | null };
  contextPack?: { contextPackId: string; consumer: string; selectedAdapter: string; allowedCount: number; forbiddenCount: number; provenanceTagCount: number; budget: string; contextBudgetUsed: number; ref: string | null };
  contextCheck?: { status: string; riskLevel: string; sourcesChecked: number; findingCount: number; agentFamilies: string[]; ref: string | null };
  continuity?: { ref: string | null; carriedForward: boolean; carryForwardReasonCodes: string[]; proofMissingCount: number; safeNextActionCount: number };
  tokenCost?: { evidenceIds: string[]; confidence: string; canShowCostSummary: boolean; unavailableReasons: string[] };
  proof?: { reportId: string; sectionCounts: Record<string, number>; canShowCostSummary: boolean; canShowSavings: boolean; savingsRefusalReason: string | null };
  value?: { cardCount: number; entryIds: string[]; needsAttentionCount: number; cardsPath: string | null };
  efficiencySync?: { envelopeId: string; mode: "dry_run"; eligibleCount: number; blockedCount: number; queuePath: string | null };

  // Model routing projection (canonical kernel — every run, guaranteed present with safe fallback)
  modelRouting: ModelRoutingProjection;

  // Tool adapter orchestration (every run, guaranteed present with safe fallback)
  toolExecution: ToolRoutingProjection;

  // safety / sync posture
  redacted: true;
  containsRawSecret: false;
  containsRawPrompt: false;
  containsRawSourceDump: false;
  syncProjectionEligible: boolean;
};

export type RuntimeSessionResult = {
  record: RuntimeSessionRecord;
  gate: RuntimeGate;
  displayTask: string;
  warnings: string[];
};

export type RunRuntimeSessionInput = {
  task: string;
  dir: string;
  planTier?: PlanTier;
  createdAt?: string;
  now?: number;
};

function runtimeDir(dir: string): string { return join(dir, ".avorelo", "runtime"); }
function contextDir(dir: string): string { return join(dir, ".avorelo", "context"); }

const SAFE_FALLBACK_FORBIDDEN_ACTIONS = [
  "persist_raw_prompt", "persist_raw_source", "persist_raw_secret",
  "model_owns_READY", "model_owns_entitlement", "model_owns_production_readiness",
  "claim_savings_without_evidence",
] as const;

function safeFallbackProjection(reasonCodes: string[], extraVerifierPlan: string[] = []): ModelRoutingProjection {
  return {
    selectedPrimitive: "deterministic_local_read",
    selectedModelProfile: "none",
    resolverStatus: reasonCodes.includes("MODEL_ROUTING_VERIFIER_REJECTED") ? "verifier_rejected" : "routing_unavailable",
    providerClass: "none",
    fallbackPlan: [],
    verifierPlan: extraVerifierPlan,
    reasonCodes,
    forbiddenActions: [...SAFE_FALLBACK_FORBIDDEN_ACTIONS],
    modelMayAssist: false,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
  };
}

function freshRuntimeId(seed: string): string {
  return "rts_" + createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

/** Short, redacted, code-style detail for a layer line. */
function coded(text: string): string {
  try { return String(redact(text).value).slice(0, 160); } catch { return "redacted"; }
}

function mergeRuntimeGate(baseGate: RuntimeGate, actionVerdict: ActionWorthinessDecision["verdict"]): RuntimeGate {
  if (baseGate === "blocked" || actionVerdict === "block") return "blocked";
  if (baseGate === "require_approval" || actionVerdict === "require_approval" || actionVerdict === "suggest_safer_action") {
    return "require_approval";
  }
  return "allow";
}

function isProofAdapter(adapterId: string): boolean {
  return adapterId === "semgrep" || adapterId === "playwright-proof" || adapterId === "github-actions";
}

function buildProofAdapterReportItems(toolExecution: ToolRoutingProjection): {
  found: Array<{ code: string; title: string; summary: string; confidence: "measured" | "inferred" }>;
  verified: Array<{ code: string; title: string; summary: string; confidence: "measured" | "inferred" }>;
  needsAttention: Array<{ code: string; title: string; summary: string; confidence: "unavailable" | "measured" | "inferred" }>;
} {
  const found: Array<{ code: string; title: string; summary: string; confidence: "measured" | "inferred" }> = [];
  const verified: Array<{ code: string; title: string; summary: string; confidence: "measured" | "inferred" }> = [];
  const needsAttention: Array<{ code: string; title: string; summary: string; confidence: "unavailable" | "measured" | "inferred" }> = [];
  const metadata = toolExecution.proofMetadata;
  if (!metadata || !isProofAdapter(toolExecution.selectedAdapter)) return { found, verified, needsAttention };

  const confidence = metadata.fake ? "inferred" : "measured";
  if (toolExecution.executionStatus === "executed") {
    verified.push({
      code: "PROOF_ADAPTER_EXECUTED",
      title: "Proof adapter executed",
      summary: `${toolExecution.selectedAdapter}: ${metadata.summary}`,
      confidence,
    });
  } else if (toolExecution.executionStatus === "skipped") {
    needsAttention.push({
      code: "PROOF_ADAPTER_SKIPPED",
      title: "Proof adapter skipped",
      summary: `${toolExecution.selectedAdapter}: ${toolExecution.reasonCodes.join(",")}`,
      confidence: "unavailable",
    });
  } else if (toolExecution.executionStatus === "failed" || toolExecution.executionStatus === "blocked") {
    needsAttention.push({
      code: "PROOF_ADAPTER_NOT_READY",
      title: "Proof adapter needs attention",
      summary: `${toolExecution.selectedAdapter}: ${toolExecution.reasonCodes.join(",")}`,
      confidence,
    });
  }

  if (metadata.findingCount > 0) {
    found.push({
      code: metadata.adapterClass === "ci_readonly" ? "CI_FINDINGS_SUMMARIZED" : "PROOF_FINDINGS_SUMMARIZED",
      title: "Summarized proof findings",
      summary: `${toolExecution.selectedAdapter}: findings=${metadata.findingCount} artifacts=${metadata.artifactCount}`,
      confidence,
    });
  }

  return { found, verified, needsAttention };
}

/**
 * Run one coherent runtime session for `task` in `dir`. Deterministic, local-first, no network.
 * Fail-closed: a blocked gate produces a record but creates NO session and runs NO downstream layer.
 * A require_approval gate stops before the session is created. Only an allow gate runs the full chain.
 */
export function runRuntimeSession(input: RunRuntimeSessionInput): RuntimeSessionResult {
  const { task, dir } = input;
  const planTier = input.planTier ?? "Free";
  const now = input.now ?? Date.now();
  const createdAt = input.createdAt ?? new Date(now).toISOString();
  const warnings: string[] = [];
  let compiledContextPacket: ReturnType<typeof compileContext> | null = null;
  let executorContextPack: ReturnType<typeof buildContextPack> | null = null;
  let plannedToolExecution: ReturnType<typeof planToolExecution> | null = null;

  // L1 + L2 — Secret Boundary is consumed by routing; routing only DECIDES (never overrides safety, never executes).
  const routing = decideRouting({ task, dir, planTier });
  const c = routing.contract;
  const displayTask = routing.displayTask;
  const proposalHints = detectProposalHints(displayTask);
  const capabilityRoute = buildCapabilityRouteDecision({
    taskType: c.route === "deterministic_only" ? "docs" : c.route === "blocked" ? "deploy" : "code_generation",
    riskClass: c.riskClass as "low" | "medium" | "high" | "critical",
    proofTier: c.proofTier,
    approvalPolicy: c.approvalPolicy,
    proposalHints,
    paymentTouched: c.safetyBoundary.secretRiskCodes.includes("payment") || /payment|billing|invoice/i.test(displayTask),
    authTouched: c.safetyBoundary.secretRiskCodes.includes("auth") || /auth|login|session/i.test(displayTask),
    dashboardTouched: /dashboard|cockpit/i.test(displayTask),
    publicCopyTouched: /public|pricing|landing/i.test(displayTask),
    mcpTouched: /mcp|connector|tool config/i.test(displayTask),
    deepMode: /\bdeep|loop|retry until|autonomous\b/i.test(displayTask),
    browserAvailable: false,
  });
  const actionWorthiness = evaluateActionWorthiness({
    objective: displayTask,
    riskClass: c.riskClass as "low" | "medium" | "high" | "critical",
    approvalPolicy: c.approvalPolicy,
    proposalHints,
  });
  const workControlSummary = buildWorkControlReceiptSummary(capabilityRoute, actionWorthiness);
  const effectiveGate = mergeRuntimeGate(routing.gate, actionWorthiness.verdict);

  const layers: RuntimeLayerRef[] = [{
    order: 1,
    layer: "safety_and_routing",
    capability: "secret-boundary + work-contract/routing",
    status: effectiveGate === "blocked" ? "blocked" : "completed",
    ref: c.contractId,
    detail: coded(`${routing.summary} action=${actionWorthiness.verdict}`),
  }];

  const base: RuntimeSessionRecord = {
    contract: "avorelo.runtimeSession.v1",
    schemaVersion: 1,
    createdAt,
    runtimeSessionId: freshRuntimeId(`${c.contractId}:${createdAt}:${c.route}`),
    status: effectiveGate === "blocked" ? "blocked" : effectiveGate === "require_approval" ? "awaiting_approval" : "ready",
    gate: effectiveGate,
    contractId: c.contractId,
    objective: displayTask,
    route: c.route,
    riskClass: c.riskClass,
    proofTier: c.proofTier,
    approvalPolicy: c.approvalPolicy,
    routingSummary: `${routing.summary} action=${actionWorthiness.verdict}`,
    safetyBoundary: {
      secretBoundaryDecision: c.safetyBoundary.secretBoundaryDecision,
      safeRunDecision: c.safetyBoundary.safeRunDecision,
      secretRiskCodes: c.safetyBoundary.secretRiskCodes ?? [],
    },
    workControls: {
      capabilityRoute,
      actionWorthiness,
      receiptSummary: workControlSummary,
    },
    layers,
    redacted: true,
    containsRawSecret: false,
    containsRawPrompt: false,
    containsRawSourceDump: false,
    syncProjectionEligible: false,
  };

  // Model routing (canonical kernel). Runs for EVERY session including blocked/approval — produces
  // a safe projection with no raw content. Deterministic routes get no_model_needed status.
  // Session memory is created per runtime session and enforces upgrade-only profile escalation.
  const routeSessionMemory = createRouteSession(base.runtimeSessionId);
  try {
    const routingFrame = {
      taskType: c.route === "deterministic_only" ? "docs" : c.route === "blocked" ? "deploy" : "code_generation",
      riskClass: (c.riskClass === "critical" ? "high" : c.riskClass) as "low" | "medium" | "high",
      touchedLayers: [],
      browserAvailable: false,
      externalToolsAllowed: false,
      scannerAvailable: true,
      mcpTouched: false,
      paymentTouched: c.safetyBoundary.secretRiskCodes.includes("payment") || /payment|billing|invoice/i.test(displayTask),
      authTouched: c.safetyBoundary.secretRiskCodes.includes("auth") || /auth|login|session/i.test(displayTask),
      cloudTouched: /cloud|sync|deploy/i.test(displayTask),
      dashboardTouched: /dashboard|cockpit/i.test(displayTask),
      publicCopyTouched: /public|pricing|landing/i.test(displayTask),
      proofRequired: c.proofTier !== "none" && c.proofTier !== "local",
      deterministicEvidenceAvailable: c.route === "deterministic_only",
      dataSensitivity: (c.safetyBoundary.secretRiskCodes.length > 0 ? "high" : "low") as "low" | "medium" | "high",
      externalWriteRequested: false,
      secretsPossible: c.safetyBoundary.secretRiskCodes.length > 0,
      productionImpactPossible: c.route === "blocked" || c.approvalPolicy === "blocked" || /deploy|production|prod/i.test(displayTask),
      deepMode: false,
    };
    const modelRoute = routeCanonical({ frame: routingFrame, approvalPolicy: c.approvalPolicy });
    if (!modelRoute.verifierResult.valid) {
      base.modelRouting = safeFallbackProjection(
        ["MODEL_ROUTING_VERIFIER_REJECTED", ...modelRoute.verifierResult.violations.filter(v => v.severity === "error").map(v => v.code)],
        modelRoute.verifierResult.violations.map(v => v.code),
      );
    } else {
      const profile = modelRoute.primitiveDecision.selectedModelProfile;
      requestProfileChange(routeSessionMemory, profile, `initial_route:${c.route}`);
      if (c.safetyBoundary.secretRiskCodes.length > 0) {
        for (const code of c.safetyBoundary.secretRiskCodes) recordSensitiveSurface(routeSessionMemory, code);
      }
      base.modelRouting = modelRoute.projection;
    }
  } catch {
    base.modelRouting = safeFallbackProjection(["MODEL_ROUTING_KERNEL_UNAVAILABLE"]);
  }

  // Restore persistent adapter health before planning (survives between sessions)
  try { restoreHealthFromDisk(dir, now); } catch { /* best-effort */ }

  // Tool adapter orchestration. Selects the safest sufficient executor based on task class,
  // adapter availability, and policy constraints. Deterministic-first, proof-backed.
  // After planning, executes the selected adapter (real local execution or safe dry-run).
  try {
    const toolPlan = planToolExecution({
      taskType: c.route === "deterministic_only" ? "docs" : c.route === "blocked" ? "deploy" : "code_generation",
      riskClass: c.riskClass === "critical" ? "high" : c.riskClass,
      paymentTouched: c.safetyBoundary.secretRiskCodes.includes("payment") || /payment|billing|invoice/i.test(displayTask),
      authTouched: c.safetyBoundary.secretRiskCodes.includes("auth") || /auth|login|session/i.test(displayTask),
      productionImpactPossible: c.route === "blocked" || c.approvalPolicy === "blocked" || /deploy|production|prod/i.test(displayTask),
      deterministicEvidenceAvailable: c.route === "deterministic_only",
      deepMode: false,
      secretsPossible: c.safetyBoundary.secretRiskCodes.length > 0,
      browserProofRequested: /browser|playwright|e2e|end-to-end|journey|ui proof|visual/i.test(displayTask),
      ciVerificationRequested: /github actions|ci|workflow|checks|artifact|pipeline|run status/i.test(displayTask),
      dir,
      now,
    });
    plannedToolExecution = toolPlan;
    const availability = getEffectiveAvailability(dir, now);
    const projection = buildToolRoutingProjection(toolPlan, availability);

    if (effectiveGate !== "allow") {
      const execCtx: ExecutionContext = {
        dir,
        task: displayTask,
        now,
        approved: effectiveGate === "allow" && !toolPlan.approvalRequired,
        useFakeAdapters: !!process.env.AVORELO_FAKE_ADAPTERS || !!process.env.CI,
        contextPack: null,
      };
      try {
        const execResult = runToolExecution(toolPlan, execCtx);
        projection.executionStatus = execResult.status;
        projection.executionReceiptId = execResult.receiptId;
        projection.executionDurationMs = execResult.durationMs;
        projection.executionProofCollected = execResult.proofCollected;
        projection.executionOutput = execResult.output;
        projection.proofMetadata = execResult.proofMetadata ?? null;
        projection.containsRawOutput = false;
        projection.containsRawModelOutput = false;
        projection.containsRawTerminalOutput = false;
        projection.containsRawGitDiff = false;
        if (execResult.delegatedTask) {
          const taskSafety = classifyTaskSafety(displayTask);
          projection.delegatedExecution = {
            attempted: true,
            toolVersion: execResult.delegatedTask.toolVersion,
            authRequired: execResult.delegatedTask.authRequired,
            patchSummary: execResult.delegatedTask.patchSummary,
            filesChangedCount: execResult.delegatedTask.filesChanged.length,
            taskSafetyClass: taskSafety,
            failureReason: execResult.delegatedTask.failureReason,
            containsRawModelOutput: false,
          };
        } else {
          projection.delegatedExecution = null;
        }
      } catch {
        projection.executionStatus = "not_run";
        projection.proofMetadata = null;
        projection.containsRawOutput = false;
        projection.containsRawModelOutput = false;
        projection.containsRawTerminalOutput = false;
        projection.containsRawGitDiff = false;
        projection.delegatedExecution = null;
      }
    }

    base.toolExecution = projection;
  } catch {
    base.toolExecution = {
      selectedAdapter: "deterministic-local",
      executionMode: "deterministic",
      fallbackAdapters: ["manual-gate"],
      adapterAvailability: {
        "deterministic-local": "available",
        "manual-gate": "available",
        "scanner": "available",
        "semgrep": "unknown",
        "playwright-proof": "unknown",
        "github-actions": "unknown",
        "claude-code": "unknown",
        "codex": "unknown",
      },
      approvalRequired: false,
      proofRequired: false,
      reasonCodes: ["TOOL_ORCHESTRATION_UNAVAILABLE"],
      forbiddenActions: ["persist_raw_prompt", "persist_raw_source", "persist_raw_secret", "persist_raw_output"],
      toolMayExecute: true,
      modelMayDecide: false,
      scannerMayDecide: false,
      finalDecisionOwner: "kernel/stop-continue-gate",
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      executionStatus: "not_run",
      proofMetadata: null,
      containsRawOutput: false,
      containsRawModelOutput: false,
      containsRawTerminalOutput: false,
      containsRawGitDiff: false,
    };
  }

  // Gate handling — fail-closed. Blocked or approval-pending stop here; only "allow" runs the chain.
  if (effectiveGate !== "allow") {
    base.syncProjectionEligible = base.redacted && !base.containsRawSecret && !base.containsRawPrompt && !base.containsRawSourceDump;
    safeWriteRuntimeSession(dir, base, warnings);
    try { upsertWorkIntelligence(dir, { now, runtimeRecord: base }); }
    catch { warnings.push("work_intelligence_not_persisted"); }
    return { record: base, gate: effectiveGate, displayTask, warnings };
  }

  // --- Session (lifecycle owner). The REDACTED display task is passed — never the raw secret-bearing string.
  try {
    const s = startSession(dir, { task: displayTask });
    if (!s.ok) throw new Error("session_not_created");
    warnings.push(...s.warnings);
    base.session = {
      sessionId: s.session.sessionId,
      controlTier: s.controlTier,
      controlTierLabel: s.controlTierLabel,
      adapters: s.adaptersInstalled,
    };
    layers.push({ order: 2, layer: "session", capability: "session", status: "completed", ref: s.session.sessionId, detail: coded(`tier=${s.controlTierLabel} adapters=${s.adaptersInstalled.length}`) });
  } catch (e) {
    layers.push({ order: 2, layer: "session", capability: "session", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  // --- L3 Context Compiler (bounded, source-aware, secret-safe). Persist a redacted snapshot for the control center.
  try {
    const packet = compileContext({ task, dir, createdAt });
    compiledContextPacket = packet;
    let ref: string | null = null;
    try { ref = writeContextPacket(dir, packet).path; } catch { ref = null; }
    base.context = {
      workContractId: packet.workContractId,
      selectedCount: packet.selectedRefs.length,
      excludedCount: packet.excludedRefs.length,
      safeReferenceCount: packet.safeReferences.length,
      budget: packet.contextBudget.targetSize,
      riskFlags: packet.riskFlags,
      ref,
    };
    layers.push({ order: 3, layer: "context", capability: "context-compiler", status: "completed", ref: packet.workContractId, detail: coded(`selected=${packet.selectedRefs.length} excluded=${packet.excludedRefs.length} budget=${packet.contextBudget.targetSize}`) });
  } catch (e) {
    layers.push({ order: 3, layer: "context", capability: "context-compiler", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  try {
    if (compiledContextPacket) {
      executorContextPack = buildContextPack({
        packet: compiledContextPacket,
        selectedAdapter: base.toolExecution.selectedAdapter,
        consumer: "executor",
      });
      let ref: string | null = null;
      try { ref = writeContextPack(dir, executorContextPack).path; } catch { ref = null; }
      base.contextPack = {
        contextPackId: executorContextPack.contextPackId,
        consumer: executorContextPack.consumer,
        selectedAdapter: executorContextPack.selectedAdapter,
        allowedCount: executorContextPack.allowedContext.length,
        forbiddenCount: executorContextPack.forbiddenContext.length,
        provenanceTagCount: executorContextPack.provenanceTags.length,
        budget: executorContextPack.maxContextBudget,
        contextBudgetUsed: executorContextPack.contextBudgetUsed,
        ref,
      };
    }
  } catch {
    base.contextPack = undefined;
  }

  if (plannedToolExecution) {
    const execCtx: ExecutionContext = {
      dir,
      task: displayTask,
      now,
      approved: effectiveGate === "allow" && !plannedToolExecution.approvalRequired,
      useFakeAdapters: !!process.env.AVORELO_FAKE_ADAPTERS || !!process.env.CI,
      contextPack: executorContextPack,
    };

    try {
      const execResult = runToolExecution(plannedToolExecution, execCtx);
      base.toolExecution.executionStatus = execResult.status;
      base.toolExecution.executionReceiptId = execResult.receiptId;
      base.toolExecution.executionDurationMs = execResult.durationMs;
      base.toolExecution.executionProofCollected = execResult.proofCollected;
      base.toolExecution.executionOutput = execResult.output;
      base.toolExecution.proofMetadata = execResult.proofMetadata ?? null;
      base.toolExecution.containsRawOutput = false;
      base.toolExecution.containsRawModelOutput = false;
      base.toolExecution.containsRawTerminalOutput = false;
      base.toolExecution.containsRawGitDiff = false;
      if (execResult.delegatedTask) {
        const taskSafety = classifyTaskSafety(displayTask);
        base.toolExecution.delegatedExecution = {
          attempted: true,
          toolVersion: execResult.delegatedTask.toolVersion,
          authRequired: execResult.delegatedTask.authRequired,
          patchSummary: execResult.delegatedTask.patchSummary,
          filesChangedCount: execResult.delegatedTask.filesChanged.length,
          taskSafetyClass: taskSafety,
          failureReason: execResult.delegatedTask.failureReason,
          containsRawModelOutput: false,
        };
      } else {
        base.toolExecution.delegatedExecution = null;
      }

      if (compiledContextPacket && execResult.receiptId) {
        executorContextPack = buildContextPack({
          packet: compiledContextPacket,
          selectedAdapter: base.toolExecution.selectedAdapter,
          consumer: "executor",
          relevantReceipts: [execResult.receiptId],
          sanitizedDiffSummary: execResult.delegatedTask?.patchSummary ?? null,
        });
        let ref: string | null = null;
        try { ref = writeContextPack(dir, executorContextPack).path; } catch { ref = null; }
        base.contextPack = {
          contextPackId: executorContextPack.contextPackId,
          consumer: executorContextPack.consumer,
          selectedAdapter: executorContextPack.selectedAdapter,
          allowedCount: executorContextPack.allowedContext.length,
          forbiddenCount: executorContextPack.forbiddenContext.length,
          provenanceTagCount: executorContextPack.provenanceTags.length,
          budget: executorContextPack.maxContextBudget,
          contextBudgetUsed: executorContextPack.contextBudgetUsed,
          ref,
        };
      }
    } catch {
      base.toolExecution.executionStatus = "not_run";
      base.toolExecution.proofMetadata = null;
      base.toolExecution.containsRawOutput = false;
      base.toolExecution.containsRawModelOutput = false;
      base.toolExecution.containsRawTerminalOutput = false;
      base.toolExecution.containsRawGitDiff = false;
      base.toolExecution.delegatedExecution = null;
    }
  }

  // --- Persist Adapter Health (after tool execution, before review)
  try {
    if (plannedToolExecution && base.toolExecution.executionStatus) {
      const adapterId = base.toolExecution.selectedAdapter;
      const healthState = getAdapterHealth(adapterId, now);
      if (healthState.consecutiveFailures > 0 || !healthState.healthy) {
        persistHealthState(dir, adapterId, healthState, now);
      }
    }
  } catch { /* health persistence is best-effort */ }

  // --- Multi-Agent Review (selective, risk-triggered, proof-backed). Only for high-risk tasks.
  try {
    if (plannedToolExecution && base.toolExecution.executionStatus === "executed") {
      const taskClass = classifyTask(
        c.route === "deterministic_only" ? "docs" : c.route === "blocked" ? "deploy" : "code_generation",
        c.riskClass === "critical" ? "high" : c.riskClass,
        {
          paymentTouched: c.safetyBoundary.secretRiskCodes.includes("payment") || /payment|billing|invoice/i.test(displayTask),
          authTouched: c.safetyBoundary.secretRiskCodes.includes("auth") || /auth|login|session/i.test(displayTask),
          productionImpactPossible: c.route === "blocked" || c.approvalPolicy === "blocked" || /deploy|production|prod/i.test(displayTask),
          deterministicEvidenceAvailable: c.route === "deterministic_only",
          deepMode: false,
          browserProofRequested: /browser|playwright|e2e/i.test(displayTask),
          ciVerificationRequested: /github actions|ci|workflow/i.test(displayTask),
        },
      );
      const reviewTrigger = shouldTriggerMultiAgentReview(taskClass, c.riskClass === "critical" ? "high" : c.riskClass, plannedToolExecution);
      if (reviewTrigger.trigger) {
        const reviewPlan = planMultiAgentReview(plannedToolExecution, reviewTrigger);
        const fakeExecResult = {
          adapterId: base.toolExecution.selectedAdapter,
          executionMode: base.toolExecution.executionMode,
          status: base.toolExecution.executionStatus as "executed",
          output: base.toolExecution.executionOutput ?? null,
          durationMs: base.toolExecution.executionDurationMs ?? 0,
          proofCollected: base.toolExecution.executionProofCollected ?? false,
          receiptId: base.toolExecution.executionReceiptId ?? "",
          reasonCodes: base.toolExecution.reasonCodes,
          failureClass: null,
          delegatedTask: null,
          proofMetadata: base.toolExecution.proofMetadata,
          containsRawPrompt: false as const,
          containsRawSource: false as const,
          containsRawSecret: false as const,
          containsRawOutput: false as const,
        };
        const execCtx: ExecutionContext = {
          dir,
          task: displayTask,
          now,
          approved: effectiveGate === "allow" && !plannedToolExecution.approvalRequired,
          useFakeAdapters: !!process.env.AVORELO_FAKE_ADAPTERS || !!process.env.CI,
          contextPack: executorContextPack,
        };
        const reviewResult = executeMultiAgentReview(reviewPlan, fakeExecResult, plannedToolExecution, execCtx);
        base.toolExecution.multiAgentReview = reviewResult;
      } else {
        base.toolExecution.multiAgentReview = null;
      }
    }
  } catch {
    base.toolExecution.multiAgentReview = null;
  }

  // --- L3 Context Check (agent instruction integrity). Scans instruction sources, classifies risks,
  // persists a capability-level receipt. Never exposes raw instruction content.
  try {
    const ccResult = runContextCheck({ repoRoot: dir, mode: "generic", outputPreference: "receipt" });
    let ref: string | null = null;
    try {
      const persisted = persistContextCheckResult(dir, ccResult);
      ref = persisted.resultPath;
    } catch { ref = null; }
    base.contextCheck = {
      status: ccResult.status,
      riskLevel: ccResult.riskLevel,
      sourcesChecked: ccResult.sourcesChecked,
      findingCount: ccResult.findings.length,
      agentFamilies: ccResult.evidence.agentFamiliesDetected,
      ref,
    };
    layers.push({ order: 4, layer: "context_check", capability: "context-check", status: "completed", ref, detail: coded(`status=${ccResult.status} risk=${ccResult.riskLevel} sources=${ccResult.sourcesChecked} findings=${ccResult.findings.length}`) });
  } catch (e) {
    layers.push({ order: 4, layer: "context_check", capability: "context-check", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  // --- L3 Continuity. Carry forward prior next-run intent if injectable; prepare + persist this run's packet.
  try {
    const prior = loadLatestContinuity(dir);
    let carriedForward = false;
    let carryForwardReasonCodes: string[] = [];
    if (prior) {
      const inj = applyContinuity(prior, now);
      carriedForward = inj.injectable;
      carryForwardReasonCodes = inj.reasons ?? [];
    }
    const packet = prepareContinuity({
      task, dir,
      sourceSessionId: base.session?.sessionId,
      now,
    });
    let ref: string | null = null;
    try { ref = writeContinuity(dir, packet).path; } catch { ref = null; }
    base.continuity = {
      ref,
      carriedForward,
      carryForwardReasonCodes,
      proofMissingCount: packet.proofMissing.length,
      safeNextActionCount: packet.safeNextActions.length,
    };
    layers.push({ order: 5, layer: "continuity", capability: "continuity", status: "completed", ref, detail: coded(`carriedForward=${carriedForward} proofMissing=${packet.proofMissing.length} nextActions=${packet.safeNextActions.length}`) });
  } catch (e) {
    layers.push({ order: 5, layer: "continuity", capability: "continuity", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  // --- L4 Token & Cost Evidence. Session-prep has NO measured execution yet, so this is honestly
  // recorded as UNAVAILABLE (unavailable ≠ zero ≠ savings). A real adapter measurement would replace
  // this with measured/imported evidence later; the flow never invents numbers.
  try {
    const ev = createUnavailableTokenCostEvidence(
      "runtime_session_prep_no_execution_measurement_yet",
      "runtime_execution",
    );
    let evId: string = ev.evidenceId;
    try { writeTokenCostEvidence(dir, ev); } catch { /* best-effort persistence */ }
    const summary = summarizeTokenCostEvidence(loadTokenCostEvidence(dir));
    base.tokenCost = {
      evidenceIds: [evId],
      confidence: ev.confidence,
      canShowCostSummary: summary.canUseForCostSummary,
      unavailableReasons: summary.unavailableReasons,
    };
    layers.push({ order: 6, layer: "token_cost_evidence", capability: "token-cost-evidence", status: "completed", ref: evId, detail: coded(`confidence=${ev.confidence} costSummary=${summary.canUseForCostSummary}`) });
  } catch (e) {
    layers.push({ order: 6, layer: "token_cost_evidence", capability: "token-cost-evidence", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  // --- L4 Proof Report (built from local evidence projections; savings refused without comparative evidence).
  try {
    const continuityForReport = loadLatestContinuity(dir);
    const proofItems = buildProofAdapterReportItems(base.toolExecution);
    const report = buildProofReport({
      scope: "local_workspace",
      createdAt,
      tokenCostEvidence: loadTokenCostEvidence(dir),
      continuity: continuityForReport
        ? {
            continuityPacketId: continuityForReport.contextPacketRef ?? undefined,
            proofMissing: continuityForReport.proofMissing,
            openQuestions: continuityForReport.openQuestions,
            safeNextActions: continuityForReport.safeNextActions,
            route: continuityForReport.route,
            riskClass: continuityForReport.riskClass,
            proofTier: continuityForReport.proofTier,
          }
        : null,
      found: proofItems.found,
      verified: proofItems.verified,
      needsAttention: proofItems.needsAttention,
    });
    try { writeProofReport(dir, report); } catch { /* best-effort */ }
    const sum = summarizeProofReport(report);
    base.proof = {
      reportId: report.reportId,
      sectionCounts: sum.sections,
      canShowCostSummary: sum.canShowCostSummary,
      canShowSavings: sum.canShowSavings,
      savingsRefusalReason: sum.savingsRefusalReason,
    };
    layers.push({ order: 7, layer: "proof_report", capability: "proof-report", status: "completed", ref: report.reportId, detail: coded(`canShowSavings=${sum.canShowSavings} refusal=${sum.savingsRefusalReason ?? "n/a"}`) });
  } catch (e) {
    layers.push({ order: 7, layer: "proof_report", capability: "proof-report", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  // --- L4 Value Ledger (entries derived from the proof report; compact, confidence-labelled cards).
  try {
    let entryIds: string[] = [];
    if (base.proof?.reportId) {
      const report = loadLatestProofReport(dir) ?? buildProofReportFromLocalEvidence(dir, createdAt);
      const entries = entriesFromProofReport(report, createdAt);
      for (const e of entries) { try { appendValueLedgerEntry(dir, e); entryIds.push(e.entryId); } catch { /* best-effort */ } }
    }
    const allEntries = loadValueLedgerEntries(dir);
    const cards = buildCompactValueCards(allEntries);
    let cardsPath: string | null = null;
    try { cardsPath = writeValueCards(dir, allEntries).path; } catch { cardsPath = null; }
    base.value = {
      cardCount: cards.length,
      entryIds,
      needsAttentionCount: cards.filter(c => c.status === "needs_attention").length,
      cardsPath,
    };
    layers.push({ order: 8, layer: "value_ledger", capability: "value-ledger", status: "completed", ref: cardsPath, detail: coded(`cards=${cards.length} newEntries=${entryIds.length}`) });
  } catch (e) {
    layers.push({ order: 8, layer: "value_ledger", capability: "value-ledger", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  // --- L4 Efficiency Sync (DRY-RUN only). Builds a sanitized metadata envelope and writes a local queue.
  // No network, no live transmission — only allowlisted projections are eligible.
  try {
    const env = buildEfficiencyMetadataSyncDryRun(dir, createdAt);
    let queuePath: string | null = null;
    try { queuePath = writeEfficiencyMetadataSyncQueue(dir, env); } catch { queuePath = null; }
    base.efficiencySync = {
      envelopeId: env.envelopeId,
      mode: "dry_run",
      eligibleCount: env.eligible.length,
      blockedCount: env.blocked.length,
      queuePath,
    };
    layers.push({ order: 9, layer: "efficiency_sync_dry_run", capability: "efficiency-sync", status: "completed", ref: env.envelopeId, detail: coded(`mode=dry_run eligible=${env.eligible.length} blocked=${env.blocked.length}`) });
  } catch (e) {
    layers.push({ order: 9, layer: "efficiency_sync_dry_run", capability: "efficiency-sync", status: "unavailable", ref: null, detail: coded(errCode(e)) });
  }

  base.syncProjectionEligible = base.redacted && !base.containsRawSecret && !base.containsRawPrompt && !base.containsRawSourceDump;
  safeWriteRuntimeSession(dir, base, warnings);
  try { upsertWorkIntelligence(dir, { now, runtimeRecord: base }); }
  catch { warnings.push("work_intelligence_not_persisted"); }
  return { record: base, gate: effectiveGate, displayTask, warnings };
}

function errCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // keep only a short coded token; never surface a raw path/content
  return msg.split(/[:\n]/)[0].slice(0, 60) || "error";
}

function safeWriteRuntimeSession(dir: string, record: RuntimeSessionRecord, warnings: string[]): void {
  try { writeRuntimeSession(dir, record); }
  catch { warnings.push("runtime_session_record_not_persisted"); }
}

/** Persist the runtime-session record: latest snapshot + append-only history. Redacted, allowlist-only. */
export function writeRuntimeSession(dir: string, record: RuntimeSessionRecord): { path: string; syncEligible: boolean } {
  const v = validateRuntimeSession(record);
  if (!v.valid) throw new Error("runtime_session_invalid: " + v.reasons.join(","));
  const d = runtimeDir(dir);
  mkdirSync(d, { recursive: true });
  const path = join(d, "session.latest.json");
  writeFileSync(path, JSON.stringify(record, null, 2));
  appendFileSync(join(d, "session.history.jsonl"), JSON.stringify(buildRuntimeSessionSyncMetadata(record)) + "\n");
  return { path, syncEligible: record.syncProjectionEligible };
}

export function loadLatestRuntimeSession(dir: string): RuntimeSessionRecord | null {
  const path = join(runtimeDir(dir), "session.latest.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as RuntimeSessionRecord; } catch { return null; }
}

export type RuntimeSessionSyncMetadata = {
  contract: "avorelo.runtimeSession.sync.v1";
  runtimeSessionId: string;
  createdAt: string;
  status: RuntimeStatus;
  gate: RuntimeGate;
  route: string;
  riskClass: string;
  proofTier: string;
  approvalPolicy: string;
  actionVerdict: ActionWorthinessDecision["verdict"];
  selectedCapabilityCount: number;
  suppressedCapabilityCount: number;
  layerStatuses: Record<string, LayerStatus>;
  secretRiskCodes: string[];
  canShowSavings: boolean;
  savingsRefusalReason: string | null;
  redacted: true;
  timestamp: string;
};

/** Metadata-only projection (counts / codes / statuses). No objective text, no refs to content. */
export function buildRuntimeSessionSyncMetadata(record: RuntimeSessionRecord): RuntimeSessionSyncMetadata {
  const layerStatuses: Record<string, LayerStatus> = {};
  for (const l of record.layers) layerStatuses[l.layer] = l.status;
  return {
    contract: "avorelo.runtimeSession.sync.v1",
    runtimeSessionId: record.runtimeSessionId,
    createdAt: record.createdAt,
    status: record.status,
    gate: record.gate,
    route: record.route,
    riskClass: record.riskClass,
    proofTier: record.proofTier,
    approvalPolicy: record.approvalPolicy,
    actionVerdict: record.workControls.actionWorthiness.verdict,
    selectedCapabilityCount: record.workControls.capabilityRoute.selectedCapabilities.length,
    suppressedCapabilityCount: record.workControls.capabilityRoute.suppressedCapabilities.length,
    layerStatuses,
    secretRiskCodes: record.safetyBoundary.secretRiskCodes,
    canShowSavings: record.proof?.canShowSavings ?? false,
    savingsRefusalReason: record.proof?.savingsRefusalReason ?? null,
    redacted: true,
    timestamp: record.createdAt,
  };
}

/** Deterministic invariant checks. A runtime-session record must never claim savings or carry raw content. */
export function validateRuntimeSession(record: RuntimeSessionRecord): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (record.contract !== "avorelo.runtimeSession.v1") reasons.push("wrong_contract");
  if (record.redacted !== true) reasons.push("not_redacted");
  if (record.containsRawSecret !== false) reasons.push("contains_raw_secret");
  if (record.containsRawPrompt !== false) reasons.push("contains_raw_prompt");
  if (record.containsRawSourceDump !== false) reasons.push("contains_raw_source_dump");
  if (!record.workControls) {
    reasons.push("work_controls_missing");
  } else {
    if (record.workControls.capabilityRoute.finalDecisionOwner !== "kernel/stop-continue-gate") reasons.push("work_controls_capability_route_wrong_owner");
    if (record.workControls.capabilityRoute.usesModelRoutingOutput !== false) reasons.push("work_controls_capability_route_uses_model_output");
    if (record.workControls.capabilityRoute.containsRawPrompt !== false) reasons.push("work_controls_capability_route_raw_prompt");
    if (record.workControls.capabilityRoute.containsRawSource !== false) reasons.push("work_controls_capability_route_raw_source");
    if (record.workControls.capabilityRoute.containsRawSecret !== false) reasons.push("work_controls_capability_route_raw_secret");
    if (record.workControls.actionWorthiness.finalDecisionOwner !== "kernel/stop-continue-gate") reasons.push("work_controls_action_wrong_owner");
    if (record.workControls.actionWorthiness.containsRawPrompt !== false) reasons.push("work_controls_action_raw_prompt");
    if (record.workControls.actionWorthiness.containsRawSource !== false) reasons.push("work_controls_action_raw_source");
    if (record.workControls.actionWorthiness.containsRawSecret !== false) reasons.push("work_controls_action_raw_secret");
    if (record.workControls.receiptSummary.containsRawPrompt !== false) reasons.push("work_controls_summary_raw_prompt");
    if (record.workControls.receiptSummary.containsRawSource !== false) reasons.push("work_controls_summary_raw_source");
    if (record.workControls.receiptSummary.containsRawSecret !== false) reasons.push("work_controls_summary_raw_secret");
    if (record.workControls.actionWorthiness.verdict === "block" && record.gate !== "blocked") reasons.push("work_controls_block_not_enforced");
    if (
      (record.workControls.actionWorthiness.verdict === "require_approval" || record.workControls.actionWorthiness.verdict === "suggest_safer_action") &&
      record.gate === "allow"
    ) {
      reasons.push("work_controls_approval_not_enforced");
    }
  }
  // Safety invariant: a blocked gate must not have created a session or downstream artifacts.
  if (record.gate === "blocked" && (record.session || record.context || record.continuity || record.tokenCost || record.proof || record.value || record.efficiencySync)) {
    reasons.push("blocked_gate_ran_downstream");
  }
  if (record.gate === "require_approval" && record.session) reasons.push("approval_gate_created_session");
  // Savings invariant (v1): savings are never claimed.
  if (record.proof?.canShowSavings === true) reasons.push("savings_claimed_in_v1");
  // Model routing invariants — projection is guaranteed present
  if (!record.modelRouting) {
    reasons.push("model_routing_missing");
  } else {
    if (record.modelRouting.modelMayDecide !== false) reasons.push("model_routing_model_may_decide");
    if (record.modelRouting.scannerMayDecide !== false) reasons.push("model_routing_scanner_may_decide");
    if (record.modelRouting.finalDecisionOwner !== "kernel/stop-continue-gate") reasons.push("model_routing_wrong_decision_owner");
    if (record.modelRouting.containsRawPrompt !== false) reasons.push("model_routing_raw_prompt");
    if (record.modelRouting.containsRawSource !== false) reasons.push("model_routing_raw_source");
    if (record.modelRouting.containsRawSecret !== false) reasons.push("model_routing_raw_secret");
  }
  // Tool execution invariants — projection is guaranteed present
  if (!record.toolExecution) {
    reasons.push("tool_execution_missing");
  } else {
    if (record.toolExecution.modelMayDecide !== false) reasons.push("tool_execution_model_may_decide");
    if (record.toolExecution.scannerMayDecide !== false) reasons.push("tool_execution_scanner_may_decide");
    if (record.toolExecution.finalDecisionOwner !== "kernel/stop-continue-gate") reasons.push("tool_execution_wrong_decision_owner");
    if (record.toolExecution.containsRawPrompt !== false) reasons.push("tool_execution_raw_prompt");
    if (record.toolExecution.containsRawSource !== false) reasons.push("tool_execution_raw_source");
    if (record.toolExecution.containsRawSecret !== false) reasons.push("tool_execution_raw_secret");
    if (record.toolExecution.containsRawOutput !== undefined && record.toolExecution.containsRawOutput !== false) reasons.push("tool_execution_raw_output");
    if (record.toolExecution.containsRawModelOutput !== undefined && record.toolExecution.containsRawModelOutput !== false) reasons.push("tool_execution_raw_model_output");
    if (record.toolExecution.containsRawTerminalOutput !== undefined && record.toolExecution.containsRawTerminalOutput !== false) reasons.push("tool_execution_raw_terminal_output");
    if (record.toolExecution.containsRawGitDiff !== undefined && record.toolExecution.containsRawGitDiff !== false) reasons.push("tool_execution_raw_git_diff");
    if (record.toolExecution.proofMetadata && record.toolExecution.proofMetadata.sanitized !== true) reasons.push("tool_execution_proof_metadata_not_sanitized");

    // Execution verification — confirm execution result is consistent
    const es = record.toolExecution.executionStatus;
    if (es !== undefined) {
      if (es === "executed" && record.toolExecution.executionReceiptId?.startsWith("tpr_")) {
        reasons.push("EXECUTION_VERIFIED");
      } else if (es === "blocked" || es === "approval_required") {
        reasons.push("EXECUTION_VERIFIED_GATED");
      } else if (es === "failed") {
        reasons.push("EXECUTION_VERIFIER_FAILED");
      } else if (es === "skipped" || es === "not_run") {
        reasons.push("EXECUTION_VERIFIED_SKIPPED");
      } else if (es === "executed" && !record.toolExecution.executionReceiptId?.startsWith("tpr_")) {
        reasons.push("EXECUTION_VERIFIER_REJECTED_NO_RECEIPT");
      }
    }

    // Multi-agent review verification
    if (record.toolExecution.multiAgentReview) {
      const mar = record.toolExecution.multiAgentReview;
      if (mar.containsRawModelOutput !== false) reasons.push("multi_agent_review_raw_model_output");
      if (mar.containsRawPrompt !== false) reasons.push("multi_agent_review_raw_prompt");
      if (mar.containsRawSource !== false) reasons.push("multi_agent_review_raw_source");
      if (mar.containsRawSecret !== false) reasons.push("multi_agent_review_raw_secret");
      for (const round of mar.rounds) {
        if (round.containsRawModelOutput !== false) reasons.push(`multi_agent_review_round_${round.round}_raw_model_output`);
      }
    }

    // Delegated execution verification
    if (record.toolExecution.delegatedExecution) {
      const de = record.toolExecution.delegatedExecution;
      if (de.attempted && de.containsRawModelOutput !== false) {
        reasons.push("EXECUTION_VERIFIER_REJECTED_RAW_MODEL_OUTPUT");
      }
      if (de.attempted && !de.failureReason && de.taskSafetyClass === "forbidden") {
        reasons.push("EXECUTION_VERIFIER_REJECTED_FORBIDDEN_EXECUTED");
      }
    }
  }

  // Informational reason codes don't invalidate the session.
  // Only EXECUTION_VERIFIER_REJECTED_* and structural violations are hard errors.
  const informational = new Set(["EXECUTION_VERIFIED", "EXECUTION_VERIFIED_GATED", "EXECUTION_VERIFIED_SKIPPED", "EXECUTION_VERIFIER_FAILED", "EXECUTION_VERIFICATION_FAILED"]);
  const errorReasons = reasons.filter(r => !informational.has(r));
  return { valid: errorReasons.length === 0, reasons };
}
