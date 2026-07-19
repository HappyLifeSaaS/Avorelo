#!/usr/bin/env node
// Avorelo Reference-Backed Review Runner. 12 skills with named external references.
import { runAllReferenceSkills } from "../src/avorelo/validation/reference-skills/index.ts";

const { skills, summary } = runAllReferenceSkills();

process.stdout.write("AVORELO REFERENCE-BACKED CORE REVIEW\n");
process.stdout.write("====================================\n");
process.stdout.write("Reference criteria supplied by Benjamin / training knowledge.\nNo live web access in Claude Code — sources listed per skill.\n\n");

for (const s of skills) {
  const icon = s.status === "PASS" ? "PASS" : s.status === "HOLD" ? "HOLD" : "FAIL";
  process.stdout.write(`${icon}  ${s.name}\n`);
  process.stdout.write(`     ref: ${s.reference}\n`);
  process.stdout.write(`     files: ${s.filesReviewed.length} | evidence: ${s.evidence.length} | findings: ${s.findings.length}\n`);
  for (const f of s.findings) {
    process.stdout.write(`     ${f.severity}  ${f.description}\n`);
  }
  if (s.limitations.length) process.stdout.write(`     limits: ${s.limitations.join("; ")}\n`);
  process.stdout.write("\n");
}

process.stdout.write("SUMMARY\n");
process.stdout.write(`  Skills: ${summary.total} | PASS: ${summary.pass} | HOLD: ${summary.hold} | FAIL: ${summary.fail}\n`);
process.stdout.write(`  Blockers: ${summary.blockers} | High: ${summary.high} | Medium: ${summary.medium}\n`);
process.stdout.write(`  Files reviewed: ${summary.filesReviewed}\n`);

const decision = summary.fail > 0 || summary.blockers > 0 ? "CORE_BLOCKED_REFERENCE_REVIEW"
  : summary.hold > 0 ? "CORE_READY_WITH_REFERENCE_HOLDS"
  : "CORE_READY_FOR_SLICE_6";

process.stdout.write(`\n  DECISION: ${decision}\n`);
process.exit(summary.fail > 0 || summary.blockers > 0 ? 1 : 0);
