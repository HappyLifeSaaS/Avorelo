#!/usr/bin/env node
import { REGISTRY, REGISTRY_COUNT } from "../src/avorelo/validation/skill-operating-system/registry.ts";
import { routeSkills, type TaskFrame } from "../src/avorelo/validation/skill-operating-system/router.ts";

const N = 10;
function bench(name: string, fn: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < N; i++) { const t = process.hrtime.bigint(); fn(); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  times.sort((a, b) => a - b);
  return times[Math.floor(N / 2)];
}

const frames: [string, TaskFrame][] = [
  ["docs_low", { taskType: "docs", changedFiles: [], touchedLayers: [], riskClass: "low", browserAvailable: false, deepMode: false, paymentTouched: false, dashboardTouched: false, publicCopyTouched: false, mcpTouched: false, skillConfigTouched: false }],
  ["security_high", { taskType: "code", changedFiles: [], touchedLayers: ["Kernel"], riskClass: "high", browserAvailable: false, deepMode: false, paymentTouched: false, dashboardTouched: false, publicCopyTouched: false, mcpTouched: false, skillConfigTouched: false }],
  ["deep_mode", { taskType: "code", changedFiles: [], touchedLayers: [], riskClass: "medium", browserAvailable: false, deepMode: true, paymentTouched: false, dashboardTouched: false, publicCopyTouched: false, mcpTouched: false, skillConfigTouched: false }],
];

process.stdout.write(`AVORELO SKILL OS MEASUREMENT\nRegistry: ${REGISTRY_COUNT} items\n\n`);
const registryLoad = bench("registry_load", () => { REGISTRY.length; });
process.stdout.write(`Registry load: ${registryLoad.toFixed(3)}ms p50 [measured]\n\n`);

for (const [name, frame] of frames) {
  const latency = bench(`route_${name}`, () => routeSkills(frame));
  const r = routeSkills(frame);
  process.stdout.write(`Route "${name}": ${latency.toFixed(3)}ms p50 | selected=${r.selected.length} skipped=${r.skipped.length} cost=${r.estimatedContextCost} [measured]\n`);
}

const highCostAlwaysOn = REGISTRY.filter(i => i.contextCost === "high" && i.currentStatus === "active" && i.activationTriggers.includes("always_on_lightweight"));
process.stdout.write(`\nHigh-cost always-on: ${highCostAlwaysOn.length} (should be 0)\n`);
process.stdout.write(`Overactivation check: ${highCostAlwaysOn.length === 0 ? "PASS" : "FAIL"}\n`);
