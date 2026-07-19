// Avorelo Skill Adoption Dogfood. 10 scenarios proving the adoption process works.
import { evaluateCandidate, evaluateBatch } from "../validation/skill-adoption/index.ts";
import { baselineCandidates } from "../validation/skill-adoption/baseline-candidates.ts";
import type { Candidate } from "../validation/skill-adoption/index.ts";

function run() {
  const failures: string[] = [];

  // Scenario 1: Security scanner candidate → checklist
  const secScan: Candidate = { id: "test-sec", name: "Test Security Scanner", sourceType: "tool", sourceUrl: "", licenseStatus: "known_ok", provenance: "community", category: "code_security", targetUseCase: "scan for vulnerabilities", applicableLayers: ["Validation"], expectedValue: "Detect security issues", expectedRisk: "low", contextCost: "low", sideEffectLevel: "read_only", conflictsWith: [], overlapsWith: [], decision: "ADOPT_CHECKLIST_NOW", rationale: "", owner: "validation", status: "evaluated" };
  const r1 = evaluateCandidate(secScan);
  if (r1.finalDecision !== "ADOPT_CHECKLIST_NOW") failures.push(`S1: expected ADOPT_CHECKLIST_NOW, got ${r1.finalDecision}`);

  // Scenario 2: UX/visual candidate → backlog (browser unavailable)
  const uxVis: Candidate = { ...secScan, id: "test-ux", name: "Visual Regression Tool", category: "visual_proof", contextCost: "high", decision: "DEFER_BACKLOG", expectedValue: "Catches visual regressions when browser is available and worth the high context cost of screenshot comparison" };
  const r2 = evaluateCandidate(uxVis);
  if (r2.finalDecision !== "DEFER_BACKLOG") failures.push(`S2: expected DEFER_BACKLOG, got ${r2.finalDecision}`);

  // Scenario 3: Token optimizer → reference only
  const tokOpt: Candidate = { ...secScan, id: "test-tok", name: "Token Cost Optimizer", category: "token_cost_optimization", decision: "ADOPT_AS_REFERENCE" };
  const r3 = evaluateCandidate(tokOpt);
  if (r3.finalDecision !== "ADOPT_AS_REFERENCE") failures.push(`S3: expected ADOPT_AS_REFERENCE, got ${r3.finalDecision}`);

  // Scenario 4: MCP security tool → checklist
  const mcpSec: Candidate = { ...secScan, id: "test-mcp", name: "MCP Poisoning Checker", category: "mcp_security", decision: "ADOPT_CHECKLIST_NOW" };
  const r4 = evaluateCandidate(mcpSec);
  if (r4.finalDecision !== "ADOPT_CHECKLIST_NOW") failures.push(`S4: expected ADOPT_CHECKLIST_NOW, got ${r4.finalDecision}`);

  // Scenario 5: Unknown license → REJECT
  const unknownLic: Candidate = { ...secScan, id: "test-lic", name: "Unknown License Tool", licenseStatus: "unknown", decision: "ADOPT_EXECUTABLE_NOW" };
  const r5 = evaluateCandidate(unknownLic);
  if (r5.finalDecision !== "REJECT_LICENSE_UNKNOWN") failures.push(`S5: expected REJECT_LICENSE_UNKNOWN, got ${r5.finalDecision}`);

  // Scenario 6: Duplicate skill → merge
  const dup: Candidate = { ...secScan, id: "test-dup", name: "Duplicate Secret Scanner", overlapsWith: ["secret-protection"], decision: "MERGE_INTO_EXISTING_SKILL" };
  const r6 = evaluateCandidate(dup);
  if (r6.finalDecision !== "MERGE_INTO_EXISTING_SKILL") failures.push(`S6: expected MERGE_INTO_EXISTING_SKILL, got ${r6.finalDecision}`);

  // Scenario 7: High-cost skill for low-risk task
  const highCost: Candidate = { ...secScan, id: "test-hicost", name: "Heavy SAST Tool", contextCost: "high", expectedValue: "short", decision: "ADOPT_EXECUTABLE_NOW" };
  const r7 = evaluateCandidate(highCost);
  if (!r7.findings.some(f => f.includes("COST"))) failures.push("S7: high-cost skill should flag cost concern");

  // Scenario 8: Old repo capability
  const oldRepo: Candidate = { ...secScan, id: "test-old", name: "Old Repo Receipt Pattern", sourceType: "old_repo_artifact", provenance: "old_repo", decision: "ADOPT_AS_AVORELO_NATIVE_REWRITE" };
  const r8 = evaluateCandidate(oldRepo);
  if (r8.finalDecision !== "ADOPT_AS_AVORELO_NATIVE_REWRITE") failures.push(`S8: expected ADOPT_AS_AVORELO_NATIVE_REWRITE, got ${r8.finalDecision}`);

  // Scenario 9: Architecture conflict → reject
  const archConflict: Candidate = { ...secScan, id: "test-conflict", name: "Truth-Bypassing Dashboard", conflictsWith: ["kernel_truth"], decision: "ADOPT_EXECUTABLE_NOW" };
  const r9 = evaluateCandidate(archConflict);
  if (r9.finalDecision !== "REJECT_UNSAFE") failures.push(`S9: expected REJECT_UNSAFE, got ${r9.finalDecision}`);

  // Scenario 10: Unknown provenance executable → needs evidence
  const unknownProv: Candidate = { ...secScan, id: "test-prov", name: "Unknown Source Tool", provenance: "unknown", decision: "ADOPT_EXECUTABLE_NOW" };
  const r10 = evaluateCandidate(unknownProv);
  if (r10.finalDecision !== "NEEDS_MORE_EVIDENCE") failures.push(`S10: expected NEEDS_MORE_EVIDENCE, got ${r10.finalDecision}`);

  // Batch baseline verification
  const { summary } = evaluateBatch(baselineCandidates);
  if (summary.unknown > 0) failures.push(`Baseline has ${summary.unknown} UNKNOWN candidates`);

  const out = {
    ok: failures.length === 0,
    scenarios: 10,
    scenariosPassed: 10 - failures.length,
    baselineCandidates: summary.total,
    baselineAdoptedExec: summary.adoptedExec,
    baselineChecklist: summary.adoptedChecklist,
    baselineReference: summary.reference,
    baselineBacklog: summary.backlog,
    baselineRejected: summary.rejected,
    baselineUnknown: summary.unknown,
    securityRejects: summary.securityRejects,
    conflictMerges: summary.conflictMerges,
    failures,
  };
  process.stdout.write("AVORELO SKILL ADOPTION DOGFOOD\n" + JSON.stringify(out, null, 2) + "\n");
  process.exit(failures.length === 0 ? 0 : 1);
}

run();
