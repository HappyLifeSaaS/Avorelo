#!/usr/bin/env node
// Avorelo Core Review Runner. Executes all 12 review skills and produces a report.
// Usage: node tools/review-core.ts
// Exits 0 if no BLOCKER/FAIL, 1 otherwise.

import { runAllSkills } from "../src/avorelo/validation/review-skills/index.ts";

const { skills, summary } = runAllSkills();

process.stdout.write("AVORELO CORE ARCHITECTURE REVIEW\n");
process.stdout.write("================================\n\n");

for (const s of skills) {
  const icon = s.status === "PASS" ? "PASS" : s.status === "HOLD" ? "HOLD" : "FAIL";
  process.stdout.write(`${icon}  ${s.name} (${s.layer})\n`);
  process.stdout.write(`     files: ${s.filesReviewed.length} | evidence: ${s.evidence.length} | findings: ${s.findings.length}\n`);
  for (const f of s.findings) {
    process.stdout.write(`     ${f.severity}  ${f.description} [${f.file}]\n`);
  }
  if (s.limitations.length) {
    process.stdout.write(`     limitations: ${s.limitations.join("; ")}\n`);
  }
  process.stdout.write("\n");
}

process.stdout.write("SUMMARY\n");
process.stdout.write(`  Skills: ${summary.total} | PASS: ${summary.pass} | HOLD: ${summary.hold} | FAIL: ${summary.fail}\n`);
process.stdout.write(`  Blockers: ${summary.blockers} | High: ${summary.high} | Files reviewed: ${summary.filesReviewed}\n`);

const decision = summary.fail > 0 ? "CORE_BLOCKED_ARCHITECTURE"
  : summary.blockers > 0 ? "CORE_BLOCKED_ARCHITECTURE"
  : summary.hold > 0 ? "CORE_READY_WITH_HOLDS"
  : "CORE_READY_FOR_SLICE_6";

process.stdout.write(`\n  DECISION: ${decision}\n`);
process.exit(summary.fail > 0 || summary.blockers > 0 ? 1 : 0);
