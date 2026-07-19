#!/usr/bin/env node
import { runAllScanners } from "../src/avorelo/validation/scanners/index.ts";
const { results, summary } = runAllScanners();
process.stdout.write(`AVORELO SCANNERS: ${summary.total} total, ${summary.ran} ran, ${summary.findings} findings, ${summary.high} high\n\n`);
for (const r of results) {
  const icon = r.ran ? (r.findings.length ? "FIND" : "PASS") : "SKIP";
  process.stdout.write(`${icon}  ${r.name} [${r.mode}] ${r.ran ? `(${r.findings.length} findings)` : `— ${r.reason}`}\n`);
  for (const f of r.findings) process.stdout.write(`     ${f.severity}  ${f.description} [${f.file}]\n`);
}
