#!/usr/bin/env node
import { routeSkills } from "../src/avorelo/validation/skill-operating-system/router.ts";

// Default: simulate a medium-risk code change
const frame = { taskType: "code", changedFiles: ["src/avorelo/kernel/run.ts"], touchedLayers: ["Kernel"], riskClass: "medium" as const, browserAvailable: false, deepMode: false, paymentTouched: false, dashboardTouched: false, publicCopyTouched: false, mcpTouched: false, skillConfigTouched: false };

const r = routeSkills(frame);
process.stdout.write(`SKILL ROUTING for: ${frame.taskType} (risk=${frame.riskClass}, layers=${frame.touchedLayers.join(",")})\n`);
process.stdout.write(`  Selected: ${r.selected.length} | Skipped: ${r.skipped.length}\n`);
process.stdout.write(`  Estimated latency: ${r.estimatedLatencyMs}ms | Context cost: ${r.estimatedContextCost}\n\n`);
process.stdout.write(`Selected:\n`);
for (const s of r.selected) process.stdout.write(`  ${s.adoptionDecision.padEnd(35)} ${s.name}\n`);
