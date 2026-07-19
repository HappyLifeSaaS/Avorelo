import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import { toCard, DEFAULT_STALE_WINDOW_MS } from "../local-dashboard/index.ts";
import { loadLatestRuntimeSession, type RuntimeSessionRecord } from "../runtime-flow/index.ts";
import { loadLatestContinuity, applyContinuity, type NextRunContinuityPacket } from "../continuity/index.ts";
import { loadLatestContextPacket, loadLatestContextPack } from "../context-compiler/index.ts";
import { buildProofReportFromLocalEvidence, loadLatestProofReport } from "../proof-report/index.ts";
import { buildCompactValueCards, loadValueLedgerEntries } from "../value-ledger/index.ts";
import { listReceipts } from "../../kernel/receipts/index.ts";
import { validateReceiptSafety } from "../../kernel/receipts/validation.ts";
import { unifiedRoute, type UnifiedTaskFrame } from "../../control-router/index.ts";
import { redact } from "../../shared/redaction/index.ts";
import type { ContextPack, ContextPacket, EvidenceConfidence, ProofReport, Receipt } from "../../shared/schemas/index.ts";

export type WorkIntelligenceConfidence = Exclude<EvidenceConfidence, "imported">;
export type WorkOutcomeStatus = "proved" | "open" | "blocked" | "awaiting_approval" | "unavailable";
export type WorkProofStatus = "proved" | "partial" | "blocked" | "unavailable";
export type WorkResumeReadiness = "ready" | "needs_attention" | "blocked" | "unavailable";
export type WorkHealthStatus = "healthy" | "warning" | "critical" | "unavailable";
export type WorkWasteLevel = "low" | "medium" | "high" | "unavailable";
export type WorkHistoryMode = "basic" | "rich";

export type WorkIntelligenceWarning = {
  code: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  confidence: WorkIntelligenceConfidence;
};

export type WorkReference = {
  label: string;
  kind: string;
  exists: "yes" | "no" | "unknown";
  relevance: "primary" | "supporting" | "missing" | "stale" | "sensitive";
  confidence: WorkIntelligenceConfidence;
  reasonCodes: string[];
};

export type WorkEfficiencyMetric = {
  code: string;
  label: string;
  value: number | null;
  unit: "count" | "rate" | "boolean" | "seconds" | "unknown";
  confidence: WorkIntelligenceConfidence;
  summary: string;
};

export type OutcomeReceipt360 = {
  objectiveSummary: string;
  outcomeStatus: WorkOutcomeStatus;
  gate: RuntimeSessionRecord["gate"] | "unavailable";
  route: string;
  proofStatus: WorkProofStatus;
  attemptedChangeSummary: string;
  evidenceSummary: {
    latestReceiptId: string | null;
    receiptCount: number;
    verifiedCount: number;
    needsAttentionCount: number;
  };
  failuresAndOpenState: string[];
  nextSessionNeeds: string[];
  valueSignal: {
    label: string;
    confidence: WorkIntelligenceConfidence;
  };
  claimsNotAllowed: string[];
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawEnvValue: false;
  containsRawSecret: false;
  containsRawDiff: false;
  containsRawTerminalOutput: false;
  contentStored: true;
  contentStorageClass: "safe_metadata_only";
};

export type WorkResumePacket = {
  contract: "avorelo.workResumePacket.v1";
  schemaVersion: 1;
  packetId: string;
  generatedAt: string;
  objectiveSummary: string;
  previousObjective: string;
  verifiedState: string[];
  failedChecks: string[];
  openRisks: string[];
  safeNextActions: string[];
  relevantReferences: Array<{ label: string; kind: string }>;
  scopeBoundaries: string[];
  decisionsMade: string[];
  capabilityRoutingSummary: string[];
  resumeReadiness: WorkResumeReadiness;
  supportedAgents: Array<"claude_code" | "codex" | "cursor" | "generic">;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawEnvValue: false;
  containsRawSecret: false;
  containsRawDiff: false;
  containsRawTerminalOutput: false;
  contentStored: true;
  contentStorageClass: "safe_metadata_only";
};

export type WorkIntelligenceModel = {
  contract: "avorelo.workIntelligence.v1";
  schemaVersion: 1;
  generatedAt: string;
  runtimeSessionId: string | null;
  outcomeReceipt360: OutcomeReceipt360;
  workMemory: {
    historyDepthAvailable: number;
    repeatedSetupCount: number;
    crossSessionSignals: string[];
    confidence: WorkIntelligenceConfidence;
  };
  resume: {
    packetId: string;
    readiness: WorkResumeReadiness;
    safeNextActions: string[];
    providerNeutral: true;
  };
  workspaceMap: {
    references: WorkReference[];
    irrelevantReferences: string[];
    missingObviousReferences: string[];
    repeatedIrrelevantReferences: string[];
    broadScopeDetected: boolean;
    sensitiveZones: string[];
  };
  contextWaste: {
    level: WorkWasteLevel;
    topAdvice: string[];
    warnings: WorkIntelligenceWarning[];
  };
  hygiene: {
    receipt: { status: WorkHealthStatus; warnings: WorkIntelligenceWarning[] };
    artifact: { status: WorkHealthStatus; warnings: WorkIntelligenceWarning[] };
    capability: { status: WorkHealthStatus; warnings: WorkIntelligenceWarning[] };
  };
  routing: {
    selectedCapabilities: string[];
    actionVerdict: string;
    modelProfile: string;
    primitive: string;
    adapter: string;
    skillReplay: {
      selectedCount: number;
      skippedCount: number;
      confidence: WorkIntelligenceConfidence;
    };
  };
  efficiency: {
    metrics: WorkEfficiencyMetric[];
  };
  telemetry: {
    previewOnly: boolean;
    recordedEvents: string[];
  };
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawEnvValue: false;
  containsRawSecret: false;
  containsRawDiff: false;
  containsRawTerminalOutput: false;
  contentStored: true;
  contentStorageClass: "safe_metadata_only";
};

type WorkIntelligenceHistoryEntry = {
  contract: "avorelo.workIntelligence.history.v1";
  generatedAt: string;
  objectiveSummary: string;
  runtimeSessionId: string | null;
  outcomeStatus: WorkOutcomeStatus;
  proofStatus: WorkProofStatus;
  repeatedSetupCount: number;
  relevantReferences: string[];
  irrelevantReferences: string[];
  missingObviousReferences: string[];
  safeNextActionCount: number;
};

export type BuildWorkIntelligenceOptions = {
  now?: number;
  runtimeRecord?: RuntimeSessionRecord | null;
  history?: WorkIntelligenceHistoryEntry[];
};

export type UpsertWorkIntelligenceResult = {
  model: WorkIntelligenceModel;
  resumePacket: WorkResumePacket;
  summaryPath: string;
  resumePacketPath: string;
};

const SUPPORTED_AGENTS: WorkResumePacket["supportedAgents"] = ["claude_code", "codex", "cursor", "generic"];

function workIntelligenceDir(dir: string): string {
  return join(dir, ".avorelo", "work-intelligence");
}

function latestSummaryPath(dir: string): string {
  return join(workIntelligenceDir(dir), "latest.json");
}

function latestResumePacketPath(dir: string): string {
  return join(workIntelligenceDir(dir), "resume.latest.json");
}

function historyPath(dir: string): string {
  return join(workIntelligenceDir(dir), "history.jsonl");
}

function resumeHistoryPath(dir: string): string {
  return join(workIntelligenceDir(dir), "resume.history.jsonl");
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function mapImportedConfidence(confidence: EvidenceConfidence | WorkIntelligenceConfidence): WorkIntelligenceConfidence {
  return confidence === "imported" ? "measured" : confidence;
}

function cleanLabel(dir: string, label: string): string {
  if (!label) return "unknown";
  if (!isAbsolute(label)) return label.replace(/\\/g, "/");
  const rel = relative(dir, label).replace(/\\/g, "/");
  if (!rel.startsWith("..")) return rel || ".";
  return "external-path";
}

function normalizedObjective(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sanitizeVisibleText(value: string): string {
  let sanitized = redact(value).value;
  sanitized = sanitized.replace(/\b[A-Z][A-Z0-9_]{2,}=\S+/g, "[REDACTED:env_value]");
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED:email]");
  sanitized = sanitized.replace(/\bhttps?:\/\/\S+/gi, "[REDACTED:remote_url]");
  sanitized = sanitized.replace(/\bgithub\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/gi, "[REDACTED:repo_ref]");
  sanitized = sanitized.replace(/(^|[\s"'(])(?:[A-Za-z]:\\Users\\[^\s"')]+|\/Users\/[^\s"')]+|\/home\/[^\s"')]+)/g, "$1[REDACTED:absolute_path]");
  return sanitized.replace(/\s+/g, " ").trim();
}

function sanitizeVisibleList(values: string[]): string[] {
  return unique(values.map((value) => sanitizeVisibleText(value)).filter(Boolean));
}

function containsUnsafeVisibleText(value: string): boolean {
  return (
    /\b[A-Z][A-Z0-9_]{2,}=\S+/.test(value) ||
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(value) ||
    /\bhttps?:\/\/\S+/i.test(value) ||
    /\bgithub\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/i.test(value) ||
    /(?:^|[\s"'(])(?:[A-Za-z]:\\Users\\[^\s"')]+|\/Users\/[^\s"')]+|\/home\/[^\s"')]+)/.test(value)
  );
}

function hasUnsafeVisibleStrings(values: string[]): boolean {
  return values.some((value) => containsUnsafeVisibleText(value));
}

function isGeneratedOutputLabel(label: string): boolean {
  return /(^|\/)(dist\/|\.avorelo\/)/.test(label) || /generated-pages\.ts$/i.test(label);
}

function isCanonicalPublicSourceLabel(label: string): boolean {
  return /src\/avorelo\/surfaces\/public-web\/static\//.test(label);
}

function severityStatus(warnings: WorkIntelligenceWarning[]): WorkHealthStatus {
  if (warnings.length === 0) return "healthy";
  if (warnings.some((warning) => warning.severity === "critical")) return "critical";
  return "warning";
}

function wasteStatus(warnings: WorkIntelligenceWarning[]): WorkWasteLevel {
  if (warnings.length === 0) return "low";
  if (warnings.some((warning) => warning.severity === "critical")) return "high";
  return warnings.length >= 3 ? "high" : "medium";
}

function loadHistory(dir: string): WorkIntelligenceHistoryEntry[] {
  const path = historyPath(dir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkIntelligenceHistoryEntry)
      .filter((entry) => entry.contract === "avorelo.workIntelligence.history.v1");
  } catch {
    return [];
  }
}

function referenceExists(dir: string, label: string): "yes" | "no" | "unknown" {
  if (!label || /[*()]/.test(label) || label === "external-path") return "unknown";
  if (label.includes("**")) return "unknown";
  const candidate = join(dir, label.replace(/\//g, "\\"));
  return existsSync(candidate) ? "yes" : "no";
}

function buildWorkspaceReferences(dir: string, contextPacket: ContextPacket | null, contextPack: ContextPack | null): WorkReference[] {
  if (!contextPacket && !contextPack) return [];

  const references: WorkReference[] = [];
  const seen = new Set<string>();
  const packetRefs = contextPacket?.selectedRefs ?? [];
  for (const ref of packetRefs) {
    const label = cleanLabel(dir, ref.label);
    if (seen.has(label)) continue;
    seen.add(label);
    const exists = referenceExists(dir, label);
    const relevance = exists === "no"
      ? "stale"
      : ref.safety === "sensitive"
      ? "sensitive"
      : ref.authority === "source_of_truth"
      ? "primary"
      : "supporting";
    references.push({
      label,
      kind: ref.kind,
      exists,
      relevance,
      confidence: exists === "no" ? "measured" : "inferred",
      reasonCodes: unique([
        `include_mode:${ref.includeMode}`,
        `authority:${ref.authority}`,
        `safety:${ref.safety}`,
        `freshness:${ref.freshness}`,
        ...(exists === "no" ? ["missing_local_reference"] : []),
      ]),
    });
  }

  for (const ref of contextPack?.allowedContext ?? []) {
    const label = cleanLabel(dir, ref.label);
    if (seen.has(label)) continue;
    seen.add(label);
    const exists = referenceExists(dir, label);
    references.push({
      label,
      kind: ref.kind,
      exists,
      relevance: exists === "no" ? "stale" : ref.safety === "sensitive" ? "sensitive" : "supporting",
      confidence: exists === "no" ? "measured" : "estimated",
      reasonCodes: unique([
        `include_mode:${ref.includeMode}`,
        `authority:${ref.authority}`,
        `safety:${ref.safety}`,
      ]),
    });
  }

  return references;
}

function buildMissingObviousReferences(runtime: RuntimeSessionRecord | null, contextPacket: ContextPacket | null, references: WorkReference[]): string[] {
  const labels = references.map((reference) => reference.label.toLowerCase());
  const missing: string[] = [];
  if (!runtime && !contextPacket) return missing;

  const proofTier = runtime?.proofTier ?? contextPacket?.proofTier ?? "none";
  const objective = (runtime?.objective ?? contextPacket?.objective ?? "").toLowerCase();
  const needsTestRef = proofTier === "tests" || proofTier === "browser" || proofTier === "production";
  const hasTestRef = labels.some((label) => /test|spec|playwright|vitest|jest|cypress/.test(label));
  if (needsTestRef && !hasTestRef) missing.push("proof tier expects an explicit test or browser reference");

  const hasDocsRef = labels.some((label) => /readme|docs/.test(label));
  if (/readme|docs|article|copy|marketing/.test(objective) && !hasDocsRef) missing.push("docs work should carry a docs or README reference");

  const hasSensitiveTruthRef = labels.some((label) => /auth|billing|payment|session|webhook/.test(label));
  if (/auth|billing|payment|session|webhook/.test(objective) && !hasSensitiveTruthRef) {
    missing.push("sensitive work should carry a source-of-truth auth or billing reference");
  }

  return unique(missing);
}

function buildIrrelevantReferences(runtime: RuntimeSessionRecord | null, references: WorkReference[]): string[] {
  const objective = (runtime?.objective ?? "").toLowerCase();
  const irrelevant: string[] = [];
  for (const reference of references) {
    const label = reference.label.toLowerCase();
    if (/readme|docs|article|marketing/.test(objective) && /test|spec|playwright|cypress/.test(label)) irrelevant.push(reference.label);
    if (/test|spec|verify|proof/.test(objective) && /article|pricing|landing|contact/.test(label)) irrelevant.push(reference.label);
  }
  return unique(irrelevant);
}

function replaySkillRouting(runtime: RuntimeSessionRecord | null, contextPacket: ContextPacket | null, contextPack: ContextPack | null): {
  selectedCount: number;
  skippedCount: number;
  confidence: WorkIntelligenceConfidence;
} {
  if (!runtime) return { selectedCount: 0, skippedCount: 0, confidence: "unavailable" };

  const selectedLabels = (contextPack?.allowedContext ?? contextPacket?.selectedRefs ?? [])
    .map((item) => cleanLabel(".", item.label))
    .filter((label) => label !== "unknown" && !label.includes("**"))
    .slice(0, 8);

  const frame: UnifiedTaskFrame = {
    taskType: runtime.route === "deterministic_only" ? "docs" : runtime.route === "blocked" ? "deploy" : "implementation",
    riskClass: (runtime.riskClass === "critical" ? "high" : runtime.riskClass) as "low" | "medium" | "high",
    touchedLayers: selectedLabels,
    browserAvailable: false,
    externalToolsAllowed: false,
    scannerAvailable: true,
    mcpTouched: false,
    paymentTouched: /billing|payment|invoice|subscription|webhook/i.test(runtime.objective),
    authTouched: /auth|login|session|credential/i.test(runtime.objective),
    cloudTouched: false,
    dashboardTouched: false,
    publicCopyTouched: /article|copy|pricing|landing|public/i.test(runtime.objective),
    proofRequired: runtime.proofTier !== "none" && runtime.proofTier !== "local",
    deterministicEvidenceAvailable: runtime.route === "deterministic_only",
    dataSensitivity: runtime.safetyBoundary.secretRiskCodes.length > 0 ? "high" : "low",
    externalWriteRequested: false,
    secretsPossible: runtime.safetyBoundary.secretRiskCodes.length > 0,
    productionImpactPossible: runtime.route === "blocked" || /deploy|production/i.test(runtime.objective),
    deepMode: runtime.route === "deep_reasoning_required",
    changedFiles: selectedLabels,
    userIntent: runtime.objective,
    localOnly: true,
    userPlan: "",
    founderCockpitTouched: false,
    aiTeamTouched: false,
    feedbackLoopTouched: false,
    oldRepoReferenceUsed: false,
    installedTools: [],
    contextBudgetRemaining: 100,
    tokenBudgetRemaining: 100000,
  };

  try {
    const route = unifiedRoute(frame);
    return {
      selectedCount: route.skillRouteSelected,
      skippedCount: route.skillRouteSkipped,
      confidence: "estimated",
    };
  } catch {
    return { selectedCount: 0, skippedCount: 0, confidence: "unavailable" };
  }
}

function buildReceiptWarnings(now: number, receipts: Receipt[], runtime: RuntimeSessionRecord | null): WorkIntelligenceWarning[] {
  const warnings: WorkIntelligenceWarning[] = [];
  for (const receipt of receipts) {
    const safety = validateReceiptSafety({
      schemaName: "avorelo.receipt.local",
      schemaVersion: "1",
      createdAt: receipt.writtenAt ?? null,
      redacted: receipt.redaction === "applied",
      payload: receipt,
      reasonCodes: receipt.decisionBasis.reasonCodes,
      evidenceConfidence: "measured",
    });
    if (!safety.cloudEligible) {
      warnings.push({
        code: "RECEIPT_UNSAFE_FIELDS",
        severity: "critical",
        summary: `Receipt ${receipt.receiptId} failed safety validation`,
        confidence: "measured",
      });
    }

    const card = toCard(receipt, { now, staleWindowMs: DEFAULT_STALE_WINDOW_MS });
    if (card.stale) {
      warnings.push({
        code: "RECEIPT_STALE",
        severity: "warning",
        summary: `Receipt ${receipt.receiptId} is stale`,
        confidence: "measured",
      });
    }
    if (receipt.decision === "STOP_DONE" && !card.ready) {
      warnings.push({
        code: "UNSUPPORTED_DONE_CLAIM",
        severity: "critical",
        summary: `Receipt ${receipt.receiptId} declares done without OUTCOME and POST_ACTION proof`,
        confidence: "measured",
      });
    }
  }

  if ((runtime?.proof?.reportId ?? null) === null) {
    warnings.push({
      code: "RECEIPT_PROOF_MISSING",
      severity: "warning",
      summary: "No proof report is linked to the latest runtime session",
      confidence: "measured",
    });
  }

  return uniqueByCode(warnings);
}

function buildArtifactWarnings(runtime: RuntimeSessionRecord | null, continuity: NextRunContinuityPacket | null, contextPacket: ContextPacket | null, references: WorkReference[]): WorkIntelligenceWarning[] {
  const warnings: WorkIntelligenceWarning[] = [];
  if (runtime && !contextPacket) {
    warnings.push({
      code: "CONTEXT_PACKET_MISSING",
      severity: "warning",
      summary: "Runtime session exists without a persisted context packet",
      confidence: "measured",
    });
  }
  if (continuity?.status === "expired") {
    warnings.push({
      code: "CONTINUITY_EXPIRED",
      severity: "warning",
      summary: "Latest continuity packet is expired and should not be reused",
      confidence: "measured",
    });
  }
  if (references.some((reference) => reference.exists === "no")) {
    warnings.push({
      code: "STALE_REFERENCES_DETECTED",
      severity: "warning",
      summary: "At least one persisted workspace reference no longer resolves locally",
      confidence: "measured",
    });
  }
  const generatedRefs = references.filter((reference) => isGeneratedOutputLabel(reference.label));
  if (generatedRefs.length > 0) {
    warnings.push({
      code: "GENERATED_OUTPUT_EDITED_AS_SOURCE",
      severity: "warning",
      summary: `Generated or derived output was referenced as source (${generatedRefs.slice(0, 2).map((reference) => reference.label).join(", ")})`,
      confidence: "measured",
    });
  }
  const touchesPublicCopy = /article|copy|pricing|landing|public|website|homepage/.test(runtime?.objective ?? "");
  const hasCanonicalPublicSource = references.some((reference) => isCanonicalPublicSourceLabel(reference.label));
  if (touchesPublicCopy && generatedRefs.length > 0 && !hasCanonicalPublicSource) {
    warnings.push({
      code: "PUBLIC_WEB_SOURCE_OF_TRUTH_MISSING",
      severity: "warning",
      summary: "Public-web work referenced generated output without a canonical static source reference",
      confidence: "measured",
    });
  }
  return uniqueByCode(warnings);
}

function evidenceCoverage(runtime: RuntimeSessionRecord | null): Set<string> {
  const available = new Set<string>();
  if (!runtime) return available;
  available.add("kernel_receipt_ref");
  if (runtime.context) available.add("context_budget_summary");
  if (runtime.proof) available.add("proof_report");
  if (runtime.toolExecution?.executionReceiptId) available.add("tool_execution_receipt");
  if (runtime.modelRouting) available.add("model_routing_projection");
  if (runtime.contextPack) available.add("context_pack");
  return available;
}

function buildCapabilityWarnings(runtime: RuntimeSessionRecord | null, skillReplay: { selectedCount: number; skippedCount: number; confidence: WorkIntelligenceConfidence }): WorkIntelligenceWarning[] {
  if (!runtime) return [];
  const warnings: WorkIntelligenceWarning[] = [];
  const selected = runtime.workControls.capabilityRoute.selectedCapabilities;
  const coverage = evidenceCoverage(runtime);
  const duplicates = selected.filter((value, index) => selected.indexOf(value) !== index);
  if (duplicates.length > 0) {
    warnings.push({
      code: "DUPLICATE_CAPABILITY_ROUTE",
      severity: "critical",
      summary: `Duplicate capability routing detected: ${unique(duplicates).join(", ")}`,
      confidence: "measured",
    });
  }
  if ((runtime.riskClass === "low" || runtime.route === "deterministic_only") && selected.length >= 5) {
    warnings.push({
      code: "OVER_SKILLED_LOW_RISK_TASK",
      severity: "warning",
      summary: `Low-risk work activated ${selected.length} capabilities`,
      confidence: "measured",
    });
  }
  const missingEvidence = runtime.workControls.receiptSummary.expectedEvidence.filter((expected) => !coverage.has(expected));
  if (missingEvidence.length > 0) {
    warnings.push({
      code: "CAPABILITY_SELECTED_WITHOUT_EVIDENCE",
      severity: "warning",
      summary: `Expected evidence missing for ${missingEvidence.length} capability signal(s)`,
      confidence: "measured",
    });
  }
  if (skillReplay.skippedCount > 0) {
    warnings.push({
      code: "SKILL_RECOMMENDED_BUT_NOT_APPLICABLE",
      severity: "info",
      summary: `${skillReplay.skippedCount} replayed skill route(s) were suppressed by current controls`,
      confidence: skillReplay.confidence,
    });
  }
  return uniqueByCode(warnings);
}

function buildWasteWarnings(
  runtime: RuntimeSessionRecord | null,
  continuity: NextRunContinuityPacket | null,
  references: WorkReference[],
  missingObviousReferences: string[],
  irrelevantReferences: string[],
  history: WorkIntelligenceHistoryEntry[],
  proofVerifiedCount: number,
): { warnings: WorkIntelligenceWarning[]; repeatedSetupCount: number } {
  const warnings: WorkIntelligenceWarning[] = [];
  const objective = normalizedObjective(runtime?.objective ?? continuity?.objectiveSummary ?? "");
  const matchingHistory = history.filter((entry) => normalizedObjective(entry.objectiveSummary) === objective);
  const incompleteHistory = matchingHistory.filter((entry) => entry.outcomeStatus !== "proved");
  const repeatedSetupCount = incompleteHistory.length;

  if (repeatedSetupCount > 0) {
    warnings.push({
      code: "REPEATED_SETUP_CONTEXT_RECREATION",
      severity: repeatedSetupCount >= 2 ? "critical" : "warning",
      summary: `This objective has been re-entered ${repeatedSetupCount + 1} times without a proved close`,
      confidence: "measured",
    });
  }
  if ((runtime?.route ?? continuity?.route) === "needs_decision") {
    warnings.push({
      code: "BROAD_TASK_NEEDS_SCOPE",
      severity: "warning",
      summary: "The task is broad or ambiguous and still needs a narrower decision",
      confidence: "measured",
    });
  }
  if (irrelevantReferences.length > 0) {
    warnings.push({
      code: "IRRELEVANT_REFERENCES_INCLUDED",
      severity: "warning",
      summary: `${irrelevantReferences.length} persisted references look off-scope for the current task`,
      confidence: "estimated",
    });
  }
  if (references.some((reference) => reference.exists === "no")) {
    warnings.push({
      code: "STALE_CONTEXT_REFERENCES",
      severity: "warning",
      summary: "Persisted context references include missing local paths",
      confidence: "measured",
    });
  }
  if (missingObviousReferences.length > 0) {
    warnings.push({
      code: "MISSING_OBVIOUS_REFERENCES",
      severity: "warning",
      summary: `${missingObviousReferences.length} obvious reference gaps were detected`,
      confidence: "estimated",
    });
  }
  if ((runtime?.proofTier === "tests" || runtime?.proofTier === "browser" || runtime?.proofTier === "production") && proofVerifiedCount === 0) {
    warnings.push({
      code: "MISSING_PROOF_COMMAND",
      severity: "critical",
      summary: "The session required proof beyond local routing but captured no verified proof items",
      confidence: "measured",
    });
  }
  if (matchingHistory.length > 0) {
    const previous = matchingHistory[matchingHistory.length - 1];
    if (previous.outcomeStatus !== "proved" && previous.proofStatus !== "proved" && proofVerifiedCount === 0) {
      warnings.push({
        code: "REPEATED_FAILED_CHECKS_WITHOUT_NEW_EVIDENCE",
        severity: "warning",
        summary: "This task pattern is repeating without new verified proof",
        confidence: "measured",
      });
    }
  }
  if (runtime?.route === "deterministic_only" && runtime.modelRouting.selectedModelProfile !== "none") {
    warnings.push({
      code: "UNNECESSARY_MODEL_ESCALATION",
      severity: "info",
      summary: "Deterministic work still escalated to a model profile",
      confidence: "estimated",
    });
  }
  return { warnings: uniqueByCode(warnings), repeatedSetupCount };
}

function uniqueByCode(warnings: WorkIntelligenceWarning[]): WorkIntelligenceWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEfficiencyMetrics(
  runtime: RuntimeSessionRecord | null,
  repeatedSetupCount: number,
  irrelevantReferences: string[],
  wasteWarnings: WorkIntelligenceWarning[],
  receiptWarnings: WorkIntelligenceWarning[],
  resumeReadiness: WorkResumeReadiness,
): WorkEfficiencyMetric[] {
  const metrics: WorkEfficiencyMetric[] = [
    {
      code: "repeated_setup_sessions",
      label: "Repeated setup sessions",
      value: repeatedSetupCount,
      unit: "count",
      confidence: "measured",
      summary: repeatedSetupCount === 0 ? "No repeated setup was detected in local history" : `${repeatedSetupCount} prior incomplete run(s) matched this objective`,
    },
    {
      code: "irrelevant_reference_count",
      label: "Irrelevant references",
      value: irrelevantReferences.length,
      unit: "count",
      confidence: irrelevantReferences.length > 0 ? "estimated" : "estimated",
      summary: irrelevantReferences.length === 0 ? "No obviously irrelevant references were persisted" : `${irrelevantReferences.length} persisted reference(s) look off-scope`,
    },
    {
      code: "missing_proof_command_count",
      label: "Missing proof command signals",
      value: wasteWarnings.filter((warning) => warning.code === "MISSING_PROOF_COMMAND").length,
      unit: "count",
      confidence: "measured",
      summary: wasteWarnings.some((warning) => warning.code === "MISSING_PROOF_COMMAND")
        ? "Proof was required but no verified proof item was captured"
        : "Proof coverage was not missing for the current session",
    },
    {
      code: "broad_task_rate",
      label: "Broad task rate",
      value: runtime?.route === "needs_decision" ? 1 : 0,
      unit: "boolean",
      confidence: "measured",
      summary: runtime?.route === "needs_decision" ? "The current task still needs a narrower scope" : "The current task remained bounded",
    },
    {
      code: "unsupported_done_claim_count",
      label: "Unsupported done claims",
      value: receiptWarnings.filter((warning) => warning.code === "UNSUPPORTED_DONE_CLAIM").length,
      unit: "count",
      confidence: "measured",
      summary: receiptWarnings.some((warning) => warning.code === "UNSUPPORTED_DONE_CLAIM")
        ? "A receipt claimed done without full proof"
        : "No unsupported done claim was detected",
    },
    {
      code: "resume_readiness",
      label: "Resume readiness",
      value: resumeReadiness === "ready" ? 1 : resumeReadiness === "needs_attention" ? 0 : null,
      unit: "boolean",
      confidence: "measured",
      summary: resumeReadiness === "ready"
        ? "The next session can resume from a trusted packet"
        : resumeReadiness === "needs_attention"
        ? "A resume packet exists but still carries proof gaps or scope questions"
        : "Resume readiness is unavailable or blocked",
    },
  ];
  return metrics;
}

function buildClaimsNotAllowed(runtime: RuntimeSessionRecord | null, receiptWarnings: WorkIntelligenceWarning[], proofStatus: WorkProofStatus): string[] {
  const claims = [
    "Do not claim raw prompt, source, diff, terminal output, env values, or secrets were stored.",
  ];
  if (!runtime?.proof?.canShowSavings) claims.push("Do not claim savings, ROI, or cost reduction without measured comparative evidence.");
  if (proofStatus !== "proved") claims.push("Do not claim the work is done or fully proved.");
  if (receiptWarnings.some((warning) => warning.code === "UNSUPPORTED_DONE_CLAIM")) {
    claims.push("Do not claim receipt-backed completion until OUTCOME and POST_ACTION proof are present.");
  }
  if (runtime?.gate === "blocked") claims.push("Do not claim the blocked task executed.");
  return unique(claims);
}

function buildOutcomeStatus(runtime: RuntimeSessionRecord | null, proofStatus: WorkProofStatus): WorkOutcomeStatus {
  if (!runtime) return "unavailable";
  if (runtime.gate === "blocked") return "blocked";
  if (runtime.gate === "require_approval") return "open";
  if (proofStatus === "proved") return "proved";
  return "open";
}

function buildProofStatus(runtime: RuntimeSessionRecord | null, verifiedCount: number, needsAttentionCount: number, foundCount: number): WorkProofStatus {
  if (runtime?.gate === "blocked") return "blocked";
  if (verifiedCount > 0 && needsAttentionCount === 0) return "proved";
  if (verifiedCount > 0 || foundCount > 0 || needsAttentionCount > 0) return "partial";
  return "unavailable";
}

function buildAttemptedChangeSummary(runtime: RuntimeSessionRecord | null): string {
  if (!runtime) return "No runtime session was found. This summary reflects deterministic local artifacts only.";
  const delegated = runtime.toolExecution.delegatedExecution;
  if (delegated?.attempted && delegated.filesChangedCount > 0) {
    return `${delegated.filesChangedCount} file(s) changed through ${runtime.toolExecution.selectedAdapter}.`;
  }
  if (runtime.toolExecution.executionStatus === "executed") {
    return `${runtime.toolExecution.selectedAdapter} executed and captured local evidence.`;
  }
  if (runtime.gate === "blocked") return "The task was blocked before execution.";
  if (runtime.gate === "require_approval") return "The task was prepared but stopped before execution because approval is still required.";
  return `The session prepared ${runtime.layers.length} local work layer(s), but no verified file-change count was captured.`;
}

function buildResumePacket(
  model: WorkIntelligenceModel,
  continuity: NextRunContinuityPacket | null,
  references: WorkReference[],
  runtime: RuntimeSessionRecord | null,
  proofReport: ProofReport,
): WorkResumePacket {
  const verifiedState = sanitizeVisibleList([
    ...proofReport.sections.verified.slice(0, 4).map((item) => item.summary),
    ...(model.outcomeReceipt360.proofStatus === "proved" ? ["Latest session holds verified proof coverage for the recorded scope."] : []),
  ]);
  const failedChecks = sanitizeVisibleList([
    ...proofReport.sections.needsAttention.slice(0, 6).map((item) => item.summary),
    ...continuity?.proofMissing.slice(0, 6) ?? [],
  ]);
  const openRisks = sanitizeVisibleList(unique([
    ...(runtime?.safetyBoundary.secretRiskCodes ?? []),
    ...(continuity?.riskFlags ?? []),
    ...model.hygiene.receipt.warnings.map((warning) => warning.summary),
    ...model.hygiene.capability.warnings.map((warning) => warning.summary),
  ])).slice(0, 8);
  const scopeBoundaries = sanitizeVisibleList(unique([
    `Route: ${model.outcomeReceipt360.route}`,
    `Gate: ${model.outcomeReceipt360.gate}`,
    `Proof tier: ${runtime?.proofTier ?? continuity?.proofTier ?? "unavailable"}`,
    `Approval policy: ${runtime?.approvalPolicy ?? continuity?.approvalPolicy ?? "unavailable"}`,
    ...(continuity?.avoidRepeating ?? []),
  ])).slice(0, 8);
  const capabilityRoutingSummary = unique([
    ...model.routing.selectedCapabilities.map((capability) => `capability:${capability}`),
    `action_verdict:${model.routing.actionVerdict}`,
    `model_profile:${model.routing.modelProfile}`,
    `adapter:${model.routing.adapter}`,
  ]);

  const packet: WorkResumePacket = {
    contract: "avorelo.workResumePacket.v1",
    schemaVersion: 1,
    packetId: "wrp_" + createHash("sha256").update(`${model.runtimeSessionId ?? "none"}:${model.generatedAt}`).digest("hex").slice(0, 12),
    generatedAt: model.generatedAt,
    objectiveSummary: model.outcomeReceipt360.objectiveSummary,
    previousObjective: model.outcomeReceipt360.objectiveSummary,
    verifiedState: unique(verifiedState).slice(0, 6),
    failedChecks: unique(failedChecks).slice(0, 8),
    openRisks,
    safeNextActions: sanitizeVisibleList(model.resume.safeNextActions).slice(0, 8),
    relevantReferences: references.slice(0, 8).map((reference) => ({ label: reference.label, kind: reference.kind })),
    scopeBoundaries,
    decisionsMade: sanitizeVisibleList(continuity?.decisionsMade.slice(0, 8) ?? []),
    capabilityRoutingSummary,
    resumeReadiness: model.resume.readiness,
    supportedAgents: SUPPORTED_AGENTS,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawEnvValue: false,
    containsRawSecret: false,
    containsRawDiff: false,
    containsRawTerminalOutput: false,
    contentStored: true,
    contentStorageClass: "safe_metadata_only",
  };

  return packet;
}

export function buildWorkIntelligence(dir: string, options: BuildWorkIntelligenceOptions = {}): {
  model: WorkIntelligenceModel;
  resumePacket: WorkResumePacket;
} {
  const now = options.now ?? Date.now();
  const generatedAt = new Date(now).toISOString();
  const runtime = options.runtimeRecord ?? loadLatestRuntimeSession(dir);
  const continuity = loadLatestContinuity(dir);
  const contextPacket = loadLatestContextPacket(dir);
  const contextPack = loadLatestContextPack(dir);
  const proofReport = loadLatestProofReport(dir) ?? buildProofReportFromLocalEvidence(dir, generatedAt);
  const receipts = listReceipts(dir);
  const valueCards = buildCompactValueCards(loadValueLedgerEntries(dir));
  const history = options.history ?? loadHistory(dir);

  const references = buildWorkspaceReferences(dir, contextPacket, contextPack);
  const missingObviousReferences = buildMissingObviousReferences(runtime, contextPacket, references);
  const irrelevantReferences = buildIrrelevantReferences(runtime, references);
  const skillReplay = replaySkillRouting(runtime, contextPacket, contextPack);
  const receiptWarnings = buildReceiptWarnings(now, receipts, runtime);
  const artifactWarnings = buildArtifactWarnings(runtime, continuity, contextPacket, references);
  const capabilityWarnings = buildCapabilityWarnings(runtime, skillReplay);
  const wasteResult = buildWasteWarnings(
    runtime,
    continuity,
    references,
    missingObviousReferences,
    irrelevantReferences,
    history,
    proofReport.sections.verified.length,
  );
  const proofStatus = buildProofStatus(runtime, proofReport.sections.verified.length, proofReport.sections.needsAttention.length, proofReport.sections.found.length);
  const outcomeStatus = buildOutcomeStatus(runtime, proofStatus);
  const continuityGate = continuity ? applyContinuity(continuity, now) : { injectable: false, reasons: ["no_packet"] };
  const resumeReadiness: WorkResumeReadiness = continuityGate.injectable
    ? "ready"
    : outcomeStatus === "blocked"
    ? "blocked"
    : continuity
    ? "needs_attention"
    : "unavailable";
  const nextActions = sanitizeVisibleList(
    continuity?.safeNextActions?.length
      ? continuity.safeNextActions
      : proofReport.sections.next.map((item) => item.summary).filter(Boolean),
  );
  const claimsNotAllowed = buildClaimsNotAllowed(runtime, receiptWarnings, proofStatus);
  const topValueCard = valueCards.find((card) => card.status !== "unavailable") ?? valueCards[0];
  const repeatedIrrelevantReferences = unique(history.flatMap((entry) => entry.irrelevantReferences)).filter((label) => irrelevantReferences.includes(label));
  const sensitiveZones = unique([
    ...references.filter((reference) => reference.relevance === "sensitive").map((reference) => reference.label),
    ...(runtime?.safetyBoundary.secretRiskCodes ?? []),
  ]).slice(0, 8);

  const model: WorkIntelligenceModel = {
    contract: "avorelo.workIntelligence.v1",
    schemaVersion: 1,
    generatedAt,
    runtimeSessionId: runtime?.runtimeSessionId ?? null,
    outcomeReceipt360: {
      objectiveSummary: sanitizeVisibleText(runtime?.objective ?? continuity?.objectiveSummary ?? "No recorded objective"),
      outcomeStatus,
      gate: runtime?.gate ?? "unavailable",
      route: runtime?.route ?? continuity?.route ?? "unavailable",
      proofStatus,
      attemptedChangeSummary: buildAttemptedChangeSummary(runtime),
      evidenceSummary: {
        latestReceiptId: receipts.length > 0 ? receipts[receipts.length - 1]!.receiptId : null,
        receiptCount: receipts.length,
        verifiedCount: proofReport.sections.verified.length,
        needsAttentionCount: proofReport.sections.needsAttention.length,
      },
      failuresAndOpenState: sanitizeVisibleList(unique([
        ...proofReport.sections.needsAttention.map((item) => item.summary),
        ...(continuity?.openQuestions ?? []),
      ])).slice(0, 8),
      nextSessionNeeds: sanitizeVisibleList(unique(nextActions)).slice(0, 8),
      valueSignal: {
        label: topValueCard?.valueLabel ?? "unavailable",
        confidence: topValueCard ? mapImportedConfidence(topValueCard.confidence) : "unavailable",
      },
      claimsNotAllowed,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawEnvValue: false,
      containsRawSecret: false,
      containsRawDiff: false,
      containsRawTerminalOutput: false,
      contentStored: true,
      contentStorageClass: "safe_metadata_only",
    },
    workMemory: {
      historyDepthAvailable: history.length,
      repeatedSetupCount: wasteResult.repeatedSetupCount,
      crossSessionSignals: unique([
        ...(wasteResult.repeatedSetupCount > 0 ? [`Repeated setup detected ${wasteResult.repeatedSetupCount} time(s)`] : []),
        ...(repeatedIrrelevantReferences.length > 0 ? [`Repeated irrelevant refs: ${repeatedIrrelevantReferences.join(", ")}`] : []),
      ]).map((signal) => sanitizeVisibleText(signal)),
      confidence: history.length > 0 ? "measured" : "unavailable",
    },
    resume: {
      packetId: "",
      readiness: resumeReadiness,
      safeNextActions: sanitizeVisibleList(unique(nextActions)).slice(0, 8),
      providerNeutral: true,
    },
    workspaceMap: {
      references: references.slice(0, 12),
      irrelevantReferences,
      missingObviousReferences,
      repeatedIrrelevantReferences,
      broadScopeDetected: (runtime?.route ?? continuity?.route) === "needs_decision",
      sensitiveZones,
    },
    contextWaste: {
      level: wasteStatus(wasteResult.warnings),
      topAdvice: unique([
        ...(wasteResult.warnings.some((warning) => warning.code === "BROAD_TASK_NEEDS_SCOPE") ? ["Narrow the scope before starting another run."] : []),
        ...(wasteResult.warnings.some((warning) => warning.code === "MISSING_PROOF_COMMAND") ? ["Add an explicit proof command or check before declaring progress."] : []),
        ...(irrelevantReferences.length > 0 ? ["Drop obviously off-scope references from the next context packet."] : []),
        ...(references.some((reference) => reference.exists === "no") ? ["Refresh or remove missing references before the next run."] : []),
      ]).map((advice) => sanitizeVisibleText(advice)).slice(0, 4),
      warnings: wasteResult.warnings,
    },
    hygiene: {
      receipt: { status: severityStatus(receiptWarnings), warnings: receiptWarnings },
      artifact: { status: severityStatus(artifactWarnings), warnings: artifactWarnings },
      capability: { status: severityStatus(capabilityWarnings), warnings: capabilityWarnings },
    },
    routing: {
      selectedCapabilities: runtime?.workControls.capabilityRoute.selectedCapabilities ?? [],
      actionVerdict: runtime?.workControls.actionWorthiness.verdict ?? "unavailable",
      modelProfile: runtime?.modelRouting.selectedModelProfile ?? "none",
      primitive: runtime?.modelRouting.selectedPrimitive ?? "none",
      adapter: runtime?.toolExecution.selectedAdapter ?? "none",
      skillReplay,
    },
    efficiency: {
      metrics: buildEfficiencyMetrics(runtime, wasteResult.repeatedSetupCount, irrelevantReferences, wasteResult.warnings, receiptWarnings, resumeReadiness),
    },
    telemetry: {
      previewOnly: true,
      recordedEvents: [],
    },
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawEnvValue: false,
    containsRawSecret: false,
    containsRawDiff: false,
    containsRawTerminalOutput: false,
    contentStored: true,
    contentStorageClass: "safe_metadata_only",
  };

  const partialResume = buildResumePacket(model, continuity, references, runtime, proofReport);
  model.resume.packetId = partialResume.packetId;

  return { model, resumePacket: partialResume };
}

function buildHistoryEntry(model: WorkIntelligenceModel): WorkIntelligenceHistoryEntry {
  return {
    contract: "avorelo.workIntelligence.history.v1",
    generatedAt: model.generatedAt,
    objectiveSummary: model.outcomeReceipt360.objectiveSummary,
    runtimeSessionId: model.runtimeSessionId,
    outcomeStatus: model.outcomeReceipt360.outcomeStatus,
    proofStatus: model.outcomeReceipt360.proofStatus,
    repeatedSetupCount: model.workMemory.repeatedSetupCount,
    relevantReferences: model.workspaceMap.references.map((reference) => reference.label),
    irrelevantReferences: model.workspaceMap.irrelevantReferences,
    missingObviousReferences: model.workspaceMap.missingObviousReferences,
    safeNextActionCount: model.resume.safeNextActions.length,
  };
}


export function validateWorkIntelligence(model: WorkIntelligenceModel): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (model.contract !== "avorelo.workIntelligence.v1") reasons.push("wrong_contract");
  if (model.containsRawPrompt !== false) reasons.push("contains_raw_prompt");
  if (model.containsRawSource !== false) reasons.push("contains_raw_source");
  if (model.containsRawEnvValue !== false) reasons.push("contains_raw_env_value");
  if (model.containsRawSecret !== false) reasons.push("contains_raw_secret");
  if (model.containsRawDiff !== false) reasons.push("contains_raw_diff");
  if (model.containsRawTerminalOutput !== false) reasons.push("contains_raw_terminal_output");
  if (model.outcomeReceipt360.containsRawPrompt !== false) reasons.push("outcome_receipt_raw_prompt");
  if (model.outcomeReceipt360.containsRawSource !== false) reasons.push("outcome_receipt_raw_source");
  if (model.outcomeReceipt360.containsRawEnvValue !== false) reasons.push("outcome_receipt_raw_env_value");
  if (model.outcomeReceipt360.containsRawSecret !== false) reasons.push("outcome_receipt_raw_secret");
  if (model.outcomeReceipt360.containsRawDiff !== false) reasons.push("outcome_receipt_raw_diff");
  if (model.outcomeReceipt360.containsRawTerminalOutput !== false) reasons.push("outcome_receipt_raw_terminal_output");
  if (containsUnsafeVisibleText(model.outcomeReceipt360.objectiveSummary)) reasons.push("objective_summary_contains_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(model.outcomeReceipt360.failuresAndOpenState)) reasons.push("failures_and_open_state_contains_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(model.outcomeReceipt360.nextSessionNeeds)) reasons.push("next_session_needs_contains_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(model.resume.safeNextActions)) reasons.push("resume_safe_next_actions_contain_unsafe_visible_text");
  if (model.outcomeReceipt360.valueSignal.confidence === "unavailable" && model.outcomeReceipt360.valueSignal.label !== "unavailable" && !/not claimed|unavailable/i.test(model.outcomeReceipt360.valueSignal.label)) {
    reasons.push("value_signal_unavailable_mislabeled");
  }
  if (model.outcomeReceipt360.claimsNotAllowed.length === 0) reasons.push("claims_not_allowed_missing");
  return { valid: reasons.length === 0, reasons };
}

export function validateWorkResumePacket(packet: WorkResumePacket): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (packet.contract !== "avorelo.workResumePacket.v1") reasons.push("wrong_contract");
  if (packet.containsRawPrompt !== false) reasons.push("contains_raw_prompt");
  if (packet.containsRawSource !== false) reasons.push("contains_raw_source");
  if (packet.containsRawEnvValue !== false) reasons.push("contains_raw_env_value");
  if (packet.containsRawSecret !== false) reasons.push("contains_raw_secret");
  if (packet.containsRawDiff !== false) reasons.push("contains_raw_diff");
  if (packet.containsRawTerminalOutput !== false) reasons.push("contains_raw_terminal_output");
  if (containsUnsafeVisibleText(packet.objectiveSummary)) reasons.push("objective_summary_contains_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(packet.verifiedState)) reasons.push("verified_state_contains_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(packet.failedChecks)) reasons.push("failed_checks_contain_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(packet.openRisks)) reasons.push("open_risks_contain_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(packet.safeNextActions)) reasons.push("safe_next_actions_contain_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(packet.scopeBoundaries)) reasons.push("scope_boundaries_contain_unsafe_visible_text");
  if (hasUnsafeVisibleStrings(packet.decisionsMade)) reasons.push("decisions_made_contain_unsafe_visible_text");
  if (packet.supportedAgents.length !== 4) reasons.push("supported_agents_incomplete");
  return { valid: reasons.length === 0, reasons };
}

export function upsertWorkIntelligence(dir: string, options: BuildWorkIntelligenceOptions = {}): UpsertWorkIntelligenceResult {
  const history = options.history ?? loadHistory(dir);
  const { model, resumePacket } = buildWorkIntelligence(dir, { ...options, history });
  const modelValidation = validateWorkIntelligence(model);
  const packetValidation = validateWorkResumePacket(resumePacket);
  if (!modelValidation.valid) throw new Error(`work_intelligence_invalid:${modelValidation.reasons.join(",")}`);
  if (!packetValidation.valid) throw new Error(`work_resume_packet_invalid:${packetValidation.reasons.join(",")}`);

  const d = workIntelligenceDir(dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(latestSummaryPath(dir), JSON.stringify(model, null, 2));
  appendFileSync(historyPath(dir), JSON.stringify(buildHistoryEntry(model)) + "\n");
  writeFileSync(latestResumePacketPath(dir), JSON.stringify(resumePacket, null, 2));
  appendFileSync(resumeHistoryPath(dir), JSON.stringify(resumePacket) + "\n");

  return {
    model,
    resumePacket,
    summaryPath: latestSummaryPath(dir),
    resumePacketPath: latestResumePacketPath(dir),
  };
}

export function loadLatestWorkIntelligence(dir: string): WorkIntelligenceModel | null {
  const path = latestSummaryPath(dir);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as WorkIntelligenceModel; } catch { return null; }
}

export function loadLatestWorkResumePacket(dir: string): WorkResumePacket | null {
  const path = latestResumePacketPath(dir);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as WorkResumePacket; } catch { return null; }
}

export function renderWorkIntelligenceText(model: WorkIntelligenceModel): string {
  const lines = [
    "Avorelo work intelligence",
    `  Outcome:    ${model.outcomeReceipt360.outcomeStatus} · proof=${model.outcomeReceipt360.proofStatus} · gate=${model.outcomeReceipt360.gate}`,
    `  Work:       ${model.outcomeReceipt360.objectiveSummary}`,
    `  Attempt:    ${model.outcomeReceipt360.attemptedChangeSummary}`,
    `  Evidence:   receipts=${model.outcomeReceipt360.evidenceSummary.receiptCount} verified=${model.outcomeReceipt360.evidenceSummary.verifiedCount} open=${model.outcomeReceipt360.evidenceSummary.needsAttentionCount}`,
    `  Resume:     ${model.resume.readiness} · next=${model.resume.safeNextActions[0] ?? "none"}`,
    `  Context:    ${model.contextWaste.level} waste · refs=${model.workspaceMap.references.length} · missing=${model.workspaceMap.missingObviousReferences.length}`,
    `  Hygiene:    receipt=${model.hygiene.receipt.status} artifact=${model.hygiene.artifact.status} capability=${model.hygiene.capability.status}`,
    `  Routing:    ${model.routing.primitive} · ${model.routing.modelProfile} · ${model.routing.adapter}`,
    `  Claims:     ${model.outcomeReceipt360.claimsNotAllowed[0] ?? "none"}`,
  ];
  return lines.join("\n") + "\n";
}

export function renderWorkResumePacket(packet: WorkResumePacket, agent: WorkResumePacket["supportedAgents"][number] = "generic"): string {
  const title = agent === "claude_code"
    ? "Claude Code resume packet"
    : agent === "codex"
    ? "Codex resume packet"
    : agent === "cursor"
    ? "Cursor resume packet"
    : "Generic agent resume packet";
  const lines = [
    title,
    "",
    `Objective: ${packet.objectiveSummary}`,
    "",
    "Verified state:",
    ...packet.verifiedState.map((line) => `- ${line}`),
    "",
    "Failed checks or open gaps:",
    ...(packet.failedChecks.length > 0 ? packet.failedChecks.map((line) => `- ${line}`) : ["- none recorded"]),
    "",
    "Open risks:",
    ...(packet.openRisks.length > 0 ? packet.openRisks.map((line) => `- ${line}`) : ["- none recorded"]),
    "",
    "Safe next actions:",
    ...(packet.safeNextActions.length > 0 ? packet.safeNextActions.map((line) => `- ${line}`) : ["- continue from the current safe state"]),
    "",
    "Relevant references:",
    ...(packet.relevantReferences.length > 0 ? packet.relevantReferences.map((reference) => `- ${reference.label} (${reference.kind})`) : ["- none recorded"]),
    "",
    "Scope boundaries:",
    ...packet.scopeBoundaries.map((line) => `- ${line}`),
    "",
    "Capability and routing summary:",
    ...packet.capabilityRoutingSummary.map((line) => `- ${line}`),
    "",
  ];
  return lines.join("\n");
}

export function renderShareSafeSummary(model: WorkIntelligenceModel, packet: WorkResumePacket, agent: WorkResumePacket["supportedAgents"][number] = "generic"): string {
  const lines = [
    `Avorelo Work Intelligence`,
    "",
    `Work: ${model.outcomeReceipt360.objectiveSummary}`,
    `Outcome: ${model.outcomeReceipt360.outcomeStatus}`,
    `Proof: ${model.outcomeReceipt360.proofStatus}`,
    `Attempted: ${model.outcomeReceipt360.attemptedChangeSummary}`,
    "",
    "What remains open:",
    ...(model.outcomeReceipt360.failuresAndOpenState.length > 0
      ? model.outcomeReceipt360.failuresAndOpenState.map((line) => `- ${line}`)
      : ["- no open failure summary recorded"]),
    "",
    "Next safe actions:",
    ...(model.resume.safeNextActions.length > 0 ? model.resume.safeNextActions.map((line) => `- ${line}`) : ["- none recorded"]),
    "",
    "Relevant references:",
    ...(model.workspaceMap.references.slice(0, 6).map((reference) => `- ${reference.label} (${reference.kind})`) || ["- none recorded"]),
    "",
    "Claims not allowed:",
    ...model.outcomeReceipt360.claimsNotAllowed.map((line) => `- ${line}`),
    "",
    renderWorkResumePacket(packet, agent),
  ];
  return lines.join("\n");
}
