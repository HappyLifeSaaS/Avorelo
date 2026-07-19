// Avorelo Persona Runner V2. Consumes SkillOutputs, not just file existence.
// Reference-only or not-executed evidence CANNOT produce plain PASS.
// Adapted patterns: MetaGPT SOP roles, CrewAI role/goal/tools, AutoGen declarative specs.
// Avorelo-native: local-first, deterministic-first, no external agent framework.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PERSONA_CONTRACTS, type PersonaContract, type PersonaId, PERSONA_COUNT } from "./persona-contracts.ts";
import { collectAllSkillOutputs } from "../../skills/skill-output-collector.ts";
import { validateSkillOutput, type SkillOutput, type SkillOutputStatus } from "../../skills/skill-output-contract.ts";

export type PersonaStatus = "PASS" | "PASS_WITH_HOLDS" | "PASS_WITH_REFERENCE_ONLY" | "HOLD" | "HOLD_FOR_BROWSER_PROOF" | "HOLD_FOR_EXTERNAL_TOOL" | "HOLD_FOR_PRODUCTION_CONFIDENCE" | "MISSING_EVIDENCE" | "BLOCKED";

export type PersonaFinding = {
  persona: PersonaId;
  role: string;
  status: PersonaStatus;
  finding: string;
  consumedSkillOutputs: string[];
  referenceOnlyOutputs: string[];
  missingEvidence: string[];
  holdReasons: string[];
  evidencePaths: string[];
  recommendedFix: string;
  severity: string;
  reasonCodes: string[];
  redacted: true;
  sourceLabel: string;
  confidence: "measured" | "estimated" | "inferred" | "unverified";
  blocksActivation: boolean;
  blocksProduction: boolean;
};

export type CompanyLoopResult = {
  personas: PersonaFinding[];
  rollup: { pass: number; passWithHolds: number; passRefOnly: number; hold: number; missingEvidence: number; blocked: number };
  skillOutputCount: number;
  skillOutputValidationErrors: string[];
  found: string[];
  fixed: string[];
  protected: string[];
  verified: string[];
  frictionSignals: string[];
  proofGaps: string[];
  decisionsNeeded: string[];
  nextAction: string;
  activationAllowed: boolean;
  productionAllowed: boolean;
  caveats: string[];
  redacted: true;
  generatedAt: number;
};

function runPersona(contract: PersonaContract, outputs: SkillOutput[]): PersonaFinding {
  const consumed: string[] = [];
  const referenceOnly: string[] = [];
  const missing: string[] = [];
  const holds: string[] = [];
  const evidencePaths: string[] = [];
  let blocksActivation = false;
  let blocksProduction = false;

  // Skill name to SkillOutput ID mapping
  const SKILL_TO_OUTPUT: Record<string, string[]> = {
    "product-journey-e2e": ["df-core", "tool-site-check"],
    "claims-scanner": ["scanners-builtin"],
    "site-check": ["tool-site-check"],
    "test-runner": ["df-core"],
    "dogfood-core": ["df-core"],
    "receipt-validation": ["kernel-receipts"],
    "wcag-checklist": ["tool-review-refs"],
    "dashboard-comprehension": ["cap-local-dashboard"],
    "nng-heuristics": ["tool-review-refs"],
    "scanner-system": ["scanners-builtin"],
    "secret-protection": ["cap-secret-protection"],
    "mcp-scan-checklist": ["scanners-builtin"],
    "agent-security": ["scanners-builtin"],
    "site-preview": ["tool-site-check"],
    "naming-check": ["tool-naming"],
    "context-budget": ["cap-context-budget"],
    "tool-governance": ["cap-tool-governance"],
    "value-measurement": ["tool-measure-value"],
    "review-core": ["tool-review-core"],
    "review-references": ["tool-review-refs"],
    "review-architecture-deep": ["tool-review-arch"],
    "review-skills-os": ["skill-os-registry"],
    "production-confidence-check": ["production-confidence"],
    "tool-reattachment-check": ["tool-reattachment"],
    "feedback-analysis": ["df-company-loop"],
    "journey-contact-check": ["tool-site-check"],
    "positioning-check": ["scanners-builtin"],
    "activation-state-check": ["activation-state"],
    "activation-command-check": ["activation-command"],
    "activation-billing-check": ["activation-billing-hold"],
    "activation-auth-cloud-check": ["activation-auth-cloud-hold"],
    "legacy-reconciliation-check": ["activation-legacy-reconciliation"],
  };

  // Check each required skill against available outputs
  for (const skillName of contract.requiredSkills) {
    const outputIds = SKILL_TO_OUTPUT[skillName] || [];
    const match = outputIds.length > 0
      ? outputs.find(o => outputIds.includes(o.skillId))
      : outputs.find(o => o.skillId.includes(skillName.replace(/-/g, "")) || o.skillName.toLowerCase().includes(skillName.replace(/-/g, " ")));

    if (!match) {
      missing.push(skillName);
      continue;
    }

    consumed.push(match.skillId);
    evidencePaths.push(...match.evidencePaths);

    if (match.status === "REFERENCE_ONLY" || match.executionMode === "reference") {
      referenceOnly.push(match.skillId);
    }
    if (match.status.startsWith("HOLD")) {
      holds.push(`${match.skillId}: ${match.status}`);
    }
    // PASS_WITH_HOLDS propagates hold to persona
    if (match.status === "PASS_WITH_HOLDS") {
      holds.push(`${match.skillId}: ${match.status} (${match.blockers.join(", ") || match.findings.join(", ") || "non-blocking hold"})`);
    }
    if (match.status === "MISSING_EVIDENCE" || match.status === "NOT_AVAILABLE") {
      missing.push(match.skillId);
    }
    if (match.blocksActivation) blocksActivation = true;
    if (match.blocksProduction) blocksProduction = true;
  }

  // Check required scanners
  for (const scanner of contract.requiredScanners) {
    const match = outputs.find(o => o.skillId.includes("scanner") && o.category === "security");
    if (match) {
      consumed.push(match.skillId);
      if (match.status === "FAIL") holds.push(`scanner: ${match.findings.join(", ")}`);
    }
  }

  // Determine status using strict rules
  let status: PersonaStatus;
  let severity: string;

  if (missing.length > 0) {
    status = "MISSING_EVIDENCE";
    severity = "HIGH";
  } else if (holds.some(h => h.includes("BROWSER"))) {
    status = "HOLD_FOR_BROWSER_PROOF";
    severity = "MEDIUM";
  } else if (holds.some(h => h.includes("EXTERNAL_TOOL"))) {
    status = "HOLD_FOR_EXTERNAL_TOOL";
    severity = "MEDIUM";
  } else if (holds.some(h => h.includes("PRODUCTION_CONFIDENCE"))) {
    status = "HOLD_FOR_PRODUCTION_CONFIDENCE";
    severity = "MEDIUM";
  } else if (referenceOnly.length > 0 && consumed.length === referenceOnly.length) {
    // ALL evidence is reference-only — cannot plain PASS
    status = "PASS_WITH_REFERENCE_ONLY";
    severity = "LOW";
  } else if (holds.length > 0 || referenceOnly.length > 0) {
    status = "PASS_WITH_HOLDS";
    severity = "LOW";
  } else {
    status = "PASS";
    severity = "LOW";
  }

  const finding = status === "PASS"
    ? `All ${consumed.length} required evidence present and verified.`
    : status === "MISSING_EVIDENCE"
    ? `Missing evidence: ${missing.join(", ")}.`
    : `${consumed.length} outputs consumed. ${holds.length} holds. ${referenceOnly.length} reference-only.`;

  return {
    persona: contract.personaId, role: contract.role, status, finding,
    consumedSkillOutputs: consumed, referenceOnlyOutputs: referenceOnly,
    missingEvidence: missing, holdReasons: holds, evidencePaths,
    recommendedFix: missing.length > 0 ? `Add: ${missing.join(", ")}` : holds.length > 0 ? `Resolve: ${holds.join("; ")}` : "None",
    severity, reasonCodes: [...missing.map(m => `MISSING_${m}`), ...holds.map(() => "HAS_HOLD")],
    redacted: true, sourceLabel: "Local", confidence: "measured",
    blocksActivation, blocksProduction,
  };
}

export function runAllPersonas(): CompanyLoopResult {
  const outputs = collectAllSkillOutputs();

  // Validate all outputs
  const validationErrors = outputs.flatMap(validateSkillOutput);

  const personas = PERSONA_CONTRACTS.map(c => runPersona(c, outputs));

  const rollup = {
    pass: personas.filter(p => p.status === "PASS").length,
    passWithHolds: personas.filter(p => p.status === "PASS_WITH_HOLDS").length,
    passRefOnly: personas.filter(p => p.status === "PASS_WITH_REFERENCE_ONLY").length,
    hold: personas.filter(p => p.status.startsWith("HOLD")).length,
    missingEvidence: personas.filter(p => p.status === "MISSING_EVIDENCE").length,
    blocked: personas.filter(p => p.status === "BLOCKED").length,
  };

  const activationBlockers = personas.filter(p => p.blocksActivation);
  const productionBlockers = personas.filter(p => p.blocksProduction);

  return {
    personas, rollup,
    skillOutputCount: outputs.length,
    skillOutputValidationErrors: validationErrors,
    found: outputs.filter(o => o.ran || o.evidencePaths.length > 0).map(o => o.skillId),
    fixed: personas.filter(p => p.status === "PASS").map(p => `${p.role}: all evidence verified`),
    protected: ["secret_protection", "redaction", "deterministic_gates", "reference_only_cannot_pass"],
    verified: personas.filter(p => p.status === "PASS").map(p => p.role),
    frictionSignals: personas.filter(p => p.status !== "PASS").map(p => `${p.role}: ${p.status} — ${p.finding}`),
    proofGaps: [...new Set(personas.flatMap(p => p.missingEvidence))],
    decisionsNeeded: personas.filter(p => p.holdReasons.length > 0).map(p => `${p.role}: ${p.holdReasons.join("; ")}`),
    nextAction: activationBlockers.length > 0
      ? `Resolve ${activationBlockers.length} activation blockers before activation`
      : `Activation allowed with ${rollup.passWithHolds + rollup.hold} explicit holds`,
    activationAllowed: activationBlockers.length === 0,
    productionAllowed: productionBlockers.length === 0 && rollup.missingEvidence === 0,
    caveats: [
      "AI Team findings are advisory only — Kernel decides READY",
      "Reference-only evidence produces PASS_WITH_REFERENCE_ONLY, not plain PASS",
      "All evidence is local/synthetic — no production data",
      validationErrors.length > 0 ? `${validationErrors.length} SkillOutput validation errors` : "0 validation errors",
    ],
    redacted: true,
    generatedAt: Date.now(),
  };
}

// Persist feedback signals
export function persistFeedbackSignals(result: CompanyLoopResult, outDir: string): string {
  const dir = join(outDir, ".avorelo", "internal", "feedback");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "feedback-signals.jsonl");
  const signals = result.frictionSignals.map((s, i) => JSON.stringify({
    signalId: `fb_${result.generatedAt}_${i}`, source: "company_loop", summary: s,
    severity: "MEDIUM", createdAt: result.generatedAt, redacted: true, confidence: "inferred",
  }));
  writeFileSync(path, signals.join("\n") + "\n");
  return path;
}

// Persist work ledger
export function persistWorkLedger(result: CompanyLoopResult, outDir: string): string {
  const dir = join(outDir, ".avorelo", "internal", "work-ledger");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "latest-ledger.json");
  writeFileSync(path, JSON.stringify({
    contract: "avorelo.workLedger.v1", generatedAt: result.generatedAt,
    entries: result.personas.length, rollup: result.rollup,
    found: result.found.length, fixed: result.fixed.length,
    protected: result.protected.length, verified: result.verified.length,
    frictionSignals: result.frictionSignals.length, proofGaps: result.proofGaps.length,
    activationAllowed: result.activationAllowed, productionAllowed: result.productionAllowed,
    skillOutputCount: result.skillOutputCount, validationErrors: result.skillOutputValidationErrors.length,
    nextAction: result.nextAction, caveats: result.caveats, redacted: true,
  }, null, 2));
  return path;
}
