#!/usr/bin/env node
import { collectAllSkillOutputs } from "../src/avorelo/skills/skill-output-collector.ts";
import { validateSkillOutput } from "../src/avorelo/skills/skill-output-contract.ts";

const outputs = collectAllSkillOutputs();
const errors = outputs.flatMap(validateSkillOutput);
const byStatus = new Map<string, number>();
for (const o of outputs) byStatus.set(o.status, (byStatus.get(o.status) || 0) + 1);

process.stdout.write(`AVORELO SKILL OUTPUTS: ${outputs.length} collected\n\n`);
process.stdout.write("By status:\n");
for (const [s, c] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${String(c).padStart(3)}  ${s}\n`);
}
process.stdout.write(`\nValidation errors: ${errors.length}\n`);
for (const e of errors) process.stdout.write(`  ERROR: ${e}\n`);
process.stdout.write(`\nBlocks activation: ${outputs.filter(o => o.blocksActivation).length}\n`);
process.stdout.write(`Blocks production: ${outputs.filter(o => o.blocksProduction).length}\n`);
