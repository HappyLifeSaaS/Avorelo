// Avorelo Agent Context Check — JSON renderer. Machine-readable output for CI/future surfaces.

import type { ContextCheckResult } from "../types.ts";

export function renderJson(result: ContextCheckResult): string {
  const output = {
    schemaVersion: result.schemaVersion,
    status: result.status,
    riskLevel: result.riskLevel,
    sourcesChecked: result.sourcesChecked,
    findings: result.findings.map(f => ({
      code: f.code,
      severity: f.severity,
      confidence: f.confidence,
      path: f.path,
      message: f.message,
      suggestedAction: f.suggestedAction,
    })),
    recommendedActions: result.recommendedActions,
    evidence: {
      scanDurationMs: result.evidence.scanDurationMs,
      totalContextSizeBytes: result.evidence.totalContextSizeBytes,
      totalEstimatedTokens: result.evidence.totalEstimatedTokens,
      agentFamiliesDetected: result.evidence.agentFamiliesDetected,
      workContractProvided: result.evidence.workContractProvided,
    },
    generatedAt: result.generatedAt,
    mode: result.mode,
    strict: result.strict,
  };
  return JSON.stringify(output, null, 2);
}
