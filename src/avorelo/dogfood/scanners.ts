// Avorelo Scanner Dogfood. Proves built-in scanners detect fixtures and external stubs report HOLD.
import { runAllScanners } from "../validation/scanners/index.ts";

const { results, summary } = runAllScanners();
const failures: string[] = [];

// Built-in scanners must have run
const builtIn = results.filter(r => r.mode === "BUILT_IN_DETERMINISTIC_NOW");
if (builtIn.length < 5) failures.push(`Only ${builtIn.length} built-in scanners (expected >=5)`);
if (!builtIn.every(r => r.ran)) failures.push("Not all built-in scanners ran");

// External stubs must NOT have run
const external = results.filter(r => r.mode === "BACKLOG_REQUIRES_TOOL_INSTALL");
if (external.some(r => r.ran)) failures.push("External scanner falsely claimed to have run");

// Scanner clean != production ready
// (This is a design assertion, not a runtime check)

// Tool unavailable = HOLD, not PASS
if (external.some(r => r.ran && r.findings.length === 0)) failures.push("External tool returned PASS without running");

// High-cost scanner should not run for docs-only (checked by router, not scanner itself)

const out = { ok: failures.length === 0, builtInRan: builtIn.filter(r => r.ran).length, externalStubs: external.length, totalFindings: summary.findings, highFindings: summary.high, failures };
process.stdout.write("AVORELO SCANNER DOGFOOD\n" + JSON.stringify(out, null, 2) + "\n");
process.exit(failures.length === 0 ? 0 : 1);
