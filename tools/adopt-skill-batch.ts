#!/usr/bin/env node
// Avorelo Skill Adoption Batch Processor. Runs all baseline candidates through the adoption engine.
import { evaluateBatch } from "../src/avorelo/validation/skill-adoption/index.ts";
import { baselineCandidates, BASELINE_COUNT } from "../src/avorelo/validation/skill-adoption/baseline-candidates.ts";

const { results, summary } = evaluateBatch(baselineCandidates);

process.stdout.write("AVORELO SKILL ADOPTION BATCH\n============================\n\n");

for (const r of results) {
  const c = baselineCandidates.find(x => x.id === r.candidateId)!;
  process.stdout.write(`${r.finalDecision.padEnd(35)} ${c.name}\n`);
  if (r.findings.length) for (const f of r.findings) process.stdout.write(`  → ${f}\n`);
}

process.stdout.write(`\nSUMMARY\n`);
process.stdout.write(`  Total: ${summary.total} | Exec: ${summary.adoptedExec} | Checklist: ${summary.adoptedChecklist} | Reference: ${summary.reference} | Backlog: ${summary.backlog} | Rejected: ${summary.rejected}\n`);
process.stdout.write(`  Security rejects: ${summary.securityRejects} | Conflict merges: ${summary.conflictMerges} | Unknown: ${summary.unknown}\n`);
process.stdout.write(`\n  STATUS: ${summary.unknown === 0 ? "ALL_DECIDED" : "HAS_UNKNOWN"}\n`);
process.exit(summary.unknown > 0 ? 1 : 0);
