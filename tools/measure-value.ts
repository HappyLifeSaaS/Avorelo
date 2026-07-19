#!/usr/bin/env node
// Avorelo AI Work Economics Value Measurement.
import { measureValueScenarios } from "../src/avorelo/value/ai-work-economics.ts";

const report = measureValueScenarios();

process.stdout.write("AVORELO AI WORK ECONOMICS VALUE MEASUREMENT\n");
process.stdout.write("============================================\n\n");

for (const s of report.scenarios) {
  process.stdout.write(`Scenario: ${s.name}\n  ${s.description}\n`);
  for (const m of s.metrics) {
    process.stdout.write(`  ${m.name}: ${m.value} ${m.unit} [${m.confidence}] — ${m.note}\n`);
  }
  process.stdout.write("\n");
}

process.stdout.write("TOKEN SUMMARY\n");
process.stdout.write(`  Tokens avoided: ~${report.tokenSummary.avoided} [${report.tokenSummary.confidence}]\n\n`);

process.stdout.write("TIME SUMMARY\n");
process.stdout.write(`  Estimated time saved: ~${report.timeSummary.savedMinutes} minutes [${report.timeSummary.confidence}]\n\n`);

process.stdout.write("OUTCOME SUMMARY\n");
process.stdout.write(`  Verified outcomes: ${report.outcomeSummary.verified}\n  Fake READY blocked: ${report.outcomeSummary.fakeBlocked}\n  Risky actions blocked: ${report.outcomeSummary.riskyBlocked}\n\n`);

process.stdout.write("COST PER VERIFIED OUTCOME\n");
process.stdout.write(`  ${report.costPerVerifiedOutcome.value} [${report.costPerVerifiedOutcome.confidence}]\n\n`);

process.stdout.write("CLAIM MAP\n");
for (const c of report.claimMap) {
  process.stdout.write(`  ${c.claim}\n    support: ${c.support}\n    allowed: ${c.allowed}\n    forbidden: ${c.forbidden}\n\n`);
}
