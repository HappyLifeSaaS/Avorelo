// Avorelo Context Check — Evidence artifact builder. Converts context-check results into
// EvidenceArtifact objects suitable for SessionState.evidenceAccumulated. These flow through
// the existing SessionEnd → runSlice1 → writeReceipt pipeline without modifying the kernel.

import type { EvidenceArtifact } from "../../shared/schemas/index.ts";
import type { ContextCheckResult } from "./types.ts";

export function contextCheckToEvidence(result: ContextCheckResult): EvidenceArtifact[] {
  const artifacts: EvidenceArtifact[] = [];

  artifacts.push({
    artifactId: `ctx_check_scan_${Date.now()}`,
    kind: "source_of_truth_readback",
    ref: `context-check:status=${result.status}:risk=${result.riskLevel}:sources=${result.sourcesChecked}`,
    detail: {
      status: result.status,
      riskLevel: result.riskLevel,
      sourcesChecked: result.sourcesChecked,
      findingCount: result.findings.length,
      agentFamilies: result.evidence.agentFamiliesDetected,
      scanDurationMs: result.evidence.scanDurationMs,
    },
  });

  for (const finding of result.findings) {
    if (finding.severity === "needs_attention" || finding.severity === "warning") {
      artifacts.push({
        artifactId: `ctx_check_finding_${finding.code}_${Date.now()}`,
        kind: "source_of_truth_readback",
        ref: `context-check:finding=${finding.code}:severity=${finding.severity}:path=${finding.path}`,
        detail: {
          code: finding.code,
          severity: finding.severity,
          confidence: finding.confidence,
          path: finding.path,
        },
      });
    }
  }

  return artifacts;
}
