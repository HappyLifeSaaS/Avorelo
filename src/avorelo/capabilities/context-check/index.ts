// Avorelo Agent Context Check — capability entry point.
// Orchestrates scan → classify → render. Read-only, local-only, no content upload.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanSources } from "./scanner.ts";
import { classify } from "./classifier.ts";
import { renderHuman } from "./renderers/human.ts";
import { renderJson } from "./renderers/json.ts";
import { renderReceiptLines } from "./renderers/receipt.ts";
import { buildContextCheckReceipt } from "./receipt.ts";
import { contextCheckToEvidence } from "./evidence.ts";
import type {
  ContextCheckInput,
  ContextCheckResult,
  CheckStatus,
  RiskLevel,
  ContextFinding,
} from "./types.ts";
import type { EvidenceArtifact } from "../../shared/schemas/index.ts";

export type { ContextCheckInput, ContextCheckResult } from "./types.ts";
export { contextCheckToEvidence } from "./evidence.ts";
export { buildContextCheckReceipt } from "./receipt.ts";
export type { ContextCheckReceipt } from "./receipt.ts";

export function runContextCheck(input: ContextCheckInput): ContextCheckResult {
  const { sources, scanDurationMs } = scanSources(input.repoRoot);
  const findings = classify(sources, input.repoRoot, input.workContract);
  const status = deriveStatus(findings, input.strict ?? false);
  const riskLevel = deriveRiskLevel(findings);
  const recommendedActions = deriveActions(findings, status);
  const receiptLines = renderReceiptLines({
    schemaVersion: "agent-context-check.v1",
    status,
    riskLevel,
    sourcesChecked: sources.length,
    sources,
    findings,
    summary: buildSummary(status, sources.length, findings.length),
    recommendedActions,
    evidence: {
      scanDurationMs,
      totalContextSizeBytes: sources.reduce((s, src) => s + src.sizeBytes, 0),
      totalEstimatedTokens: sources.reduce((s, src) => s + src.estimatedTokens, 0),
      agentFamiliesDetected: [...new Set(sources.map(s => s.agentFamily))],
      workContractProvided: !!input.workContract,
    },
    receiptLines: [],
    generatedAt: new Date().toISOString(),
    repoRoot: input.repoRoot,
    mode: input.mode,
    strict: input.strict ?? false,
  });

  return {
    schemaVersion: "agent-context-check.v1",
    status,
    riskLevel,
    sourcesChecked: sources.length,
    sources,
    findings,
    summary: buildSummary(status, sources.length, findings.length),
    recommendedActions,
    evidence: {
      scanDurationMs,
      totalContextSizeBytes: sources.reduce((s, src) => s + src.sizeBytes, 0),
      totalEstimatedTokens: sources.reduce((s, src) => s + src.estimatedTokens, 0),
      agentFamiliesDetected: [...new Set(sources.map(s => s.agentFamily))],
      workContractProvided: !!input.workContract,
    },
    receiptLines,
    generatedAt: new Date().toISOString(),
    repoRoot: input.repoRoot,
    mode: input.mode,
    strict: input.strict ?? false,
  };
}

export { renderHuman } from "./renderers/human.ts";
export { renderJson } from "./renderers/json.ts";
export { renderReceiptLines } from "./renderers/receipt.ts";

export function persistContextCheckResult(dir: string, result: ContextCheckResult): { resultPath: string; receiptPath: string | null } {
  const ccDir = join(dir, ".avorelo", "context-check");
  mkdirSync(ccDir, { recursive: true });

  const safeResult = {
    schemaVersion: result.schemaVersion,
    status: result.status,
    riskLevel: result.riskLevel,
    sourcesChecked: result.sourcesChecked,
    findingCodes: result.findings.map(f => f.code),
    findingCount: result.findings.length,
    agentFamiliesDetected: result.evidence.agentFamiliesDetected,
    scanDurationMs: result.evidence.scanDurationMs,
    workContractProvided: result.evidence.workContractProvided,
    generatedAt: result.generatedAt,
    mode: result.mode,
    strict: result.strict,
  };
  const resultPath = join(ccDir, "latest.json");
  writeFileSync(resultPath, JSON.stringify(safeResult, null, 2));

  let receiptPath: string | null = null;
  try {
    const receiptId = `ccrcpt_${Date.now()}`;
    const built = buildContextCheckReceipt({ receiptId, result });
    receiptPath = join(ccDir, `${receiptId}.json`);
    writeFileSync(receiptPath, JSON.stringify(built.receipt, null, 2));
  } catch { receiptPath = null; }

  return { resultPath, receiptPath };
}

export function toEvidenceArtifacts(result: ContextCheckResult): EvidenceArtifact[] {
  return contextCheckToEvidence(result);
}

function deriveStatus(findings: ContextFinding[], strict: boolean): CheckStatus {
  if (findings.length === 0) return "pass";
  const hasAttention = findings.some(f => f.severity === "needs_attention");
  const hasWarning = findings.some(f => f.severity === "warning");
  if (hasAttention) return "needs_attention";
  if (hasWarning) return strict ? "needs_attention" : "warning";
  return "info";
}

function deriveRiskLevel(findings: ContextFinding[]): RiskLevel {
  if (findings.length === 0) return "none";
  const hasAttention = findings.some(f => f.severity === "needs_attention");
  const hasHighConfWarning = findings.some(f => f.severity === "warning" && f.confidence === "high");
  if (hasAttention) return "high";
  if (hasHighConfWarning) return "medium";
  if (findings.some(f => f.severity === "warning")) return "low";
  return "none";
}

function deriveActions(findings: ContextFinding[], status: CheckStatus): string[] {
  if (status === "pass") return [];
  const actions: string[] = [];
  const codes = new Set(findings.map(f => f.code));

  if (codes.has("BROKEN_CONTEXT_REFERENCE")) actions.push("Fix or remove broken file references in instruction files.");
  if (codes.has("OVERSIZED_AGENT_CONTEXT")) actions.push("Review large instruction files for stale or unnecessary content.");
  if (codes.has("STALE_TEMP_INSTRUCTION")) actions.push("Review temporary instructions that may no longer be needed.");
  if (codes.has("BROAD_INSTRUCTION_SCOPE")) actions.push("Review broad-scope rules against the current task scope.");

  if (actions.length === 0 && findings.length > 0) {
    actions.push("Review findings before starting autonomous work, or continue if intentional.");
  }
  return actions;
}

function buildSummary(status: CheckStatus, sourceCount: number, findingCount: number): string {
  if (status === "pass") return `Checked ${sourceCount} instruction source(s). No issues found.`;
  return `Checked ${sourceCount} instruction source(s). ${findingCount} finding(s) detected.`;
}
