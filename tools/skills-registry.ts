#!/usr/bin/env node
import { REGISTRY, REGISTRY_COUNT, getByDecision } from "../src/avorelo/validation/skill-operating-system/registry.ts";

const decisions = new Map<string, number>();
for (const i of REGISTRY) decisions.set(i.adoptionDecision, (decisions.get(i.adoptionDecision) || 0) + 1);

process.stdout.write(`AVORELO SKILL OS REGISTRY: ${REGISTRY_COUNT} items\n\n`);
for (const [d, c] of [...decisions.entries()].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${String(c).padStart(3)}  ${d}\n`);
}
process.stdout.write(`\nCategories:\n`);
const cats = new Map<string, number>();
for (const i of REGISTRY) cats.set(i.category, (cats.get(i.category) || 0) + 1);
for (const [c, n] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${String(n).padStart(3)}  ${c}\n`);
}
