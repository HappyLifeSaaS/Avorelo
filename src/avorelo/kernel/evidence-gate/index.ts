import type { ProofContract, ProofRequirement } from "../proof-contract/index.ts";
import type { ProofRunResult } from "../proof-adapters/index.ts";
import type { AdapterResult } from "../proof-adapters/types.ts";

export interface EvidenceVerdict {
  requirementId: string;
  description: string;
  critical: boolean;
  satisfied: boolean;
  reason: string;
  adapterId: string;
}

export interface GateResult {
  timestamp: string;
  safeToClose: boolean;
  overallStatus: "safe" | "blocked" | "needs_review";
  verdicts: EvidenceVerdict[];
  blockingReasons: string[];
  warnings: string[];
  satisfiedCount: number;
  totalRequired: number;
  closureRulesApplied: string[];
  containsRawSecret: false;
}

function matchRequirementToResult(
  req: ProofRequirement,
  results: AdapterResult[],
): { satisfied: boolean; reason: string } {
  const adapterResult = results.find(r => r.adapterId === req.adapterId);
  if (!adapterResult) {
    return { satisfied: false, reason: `No adapter result for ${req.adapterId}` };
  }

  if (adapterResult.status === "error") {
    return { satisfied: false, reason: `Adapter error: ${adapterResult.errorMessage ?? "unknown"}` };
  }

  if (adapterResult.status === "skip") {
    return { satisfied: !req.critical, reason: adapterResult.skipReason ?? "Adapter skipped" };
  }

  const relevantEvidence = adapterResult.evidence.filter(e => {
    if (req.id === "build_pass") return e.type === "build_passed";
    if (req.id === "tests_pass") return e.type === "tests_passed";
    if (req.id === "artifact_guard") return e.type === "no_secret_findings" || e.type === "product_surface_clean";
    if (req.id === "secret_scan" || req.id === "no_raw_secrets") return e.type === "no_secret_findings";
    if (req.id === "dep_audit") return e.type === "package_audit";
    if (req.id === "product_surface" || req.id === "claims_check") return e.type === "product_surface_clean";
    if (req.id === "browser_proof") return e.type === "browser_tooling_detected";
    if (req.id === "api_contract") return e.type === "api_schema_valid";
    return false;
  });

  if (relevantEvidence.length === 0) {
    if (adapterResult.status === "pass") {
      return { satisfied: true, reason: "Adapter passed overall" };
    }
    return { satisfied: false, reason: `No matching evidence for ${req.id}` };
  }

  const allPassed = relevantEvidence.every(e => e.passed);
  if (allPassed) {
    return { satisfied: true, reason: relevantEvidence.map(e => e.summary).join("; ") };
  }
  const failures = relevantEvidence.filter(e => !e.passed);
  return { satisfied: false, reason: failures.map(e => e.summary).join("; ") };
}

export function evaluateEvidence(
  contract: ProofContract,
  proofRun: ProofRunResult,
): GateResult {
  const verdicts: EvidenceVerdict[] = [];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  for (const req of contract.requiredProof) {
    const { satisfied, reason } = matchRequirementToResult(req, proofRun.results);
    verdicts.push({
      requirementId: req.id,
      description: req.description,
      critical: req.critical,
      satisfied,
      reason,
      adapterId: req.adapterId,
    });

    if (!satisfied && req.critical) {
      blockingReasons.push(`${req.description}: ${reason}`);
    }
    if (!satisfied && !req.critical) {
      warnings.push(`${req.description}: ${reason}`);
    }
  }

  for (const req of contract.optionalProof) {
    const { satisfied, reason } = matchRequirementToResult(req, proofRun.results);
    verdicts.push({
      requirementId: req.id,
      description: req.description,
      critical: false,
      satisfied,
      reason,
      adapterId: req.adapterId,
    });

    if (!satisfied) {
      warnings.push(`Optional: ${req.description}: ${reason}`);
    }
  }

  const satisfiedCount = verdicts.filter(v => v.satisfied).length;
  const totalRequired = verdicts.length;
  const safeToClose = blockingReasons.length === 0;
  const overallStatus: GateResult["overallStatus"] = safeToClose
    ? warnings.length === 0 ? "safe" : "needs_review"
    : "blocked";

  return {
    timestamp: new Date().toISOString(),
    safeToClose,
    overallStatus,
    verdicts,
    blockingReasons,
    warnings,
    satisfiedCount,
    totalRequired,
    closureRulesApplied: contract.closureRules,
    containsRawSecret: false,
  };
}

export function renderGateResult(gate: GateResult): string {
  const lines = [
    `Evidence Gate: ${gate.overallStatus.toUpperCase()}`,
    `Safe to close: ${gate.safeToClose ? "YES" : "NO"}`,
    `Satisfied: ${gate.satisfiedCount}/${gate.totalRequired}`,
    "",
  ];

  if (gate.blockingReasons.length > 0) {
    lines.push("Blocking:");
    for (const r of gate.blockingReasons) {
      lines.push(`  !! ${r}`);
    }
    lines.push("");
  }

  if (gate.warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of gate.warnings) {
      lines.push(`  -- ${w}`);
    }
    lines.push("");
  }

  lines.push("Verdicts:");
  for (const v of gate.verdicts) {
    const icon = v.satisfied ? "ok" : v.critical ? "!!" : "--";
    lines.push(`  [${icon}] ${v.description}`);
    lines.push(`       ${v.reason}`);
  }

  lines.push("");
  lines.push("Closure rules:");
  for (const r of gate.closureRulesApplied) {
    lines.push(`  - ${r}`);
  }

  return lines.join("\n");
}

export function gateResultToJson(gate: GateResult): Record<string, unknown> {
  return gate as unknown as Record<string, unknown>;
}
