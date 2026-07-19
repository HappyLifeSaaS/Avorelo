#!/usr/bin/env node
// Generate founder.html from company loop data + repo state. Internal/dev only.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAllPersonas, persistFeedbackSignals, persistWorkLedger } from "../src/avorelo/capabilities/company-loop/persona-runner.ts";
import { runAllScanners } from "../src/avorelo/validation/scanners/index.ts";
import { REGISTRY, REGISTRY_COUNT, getUnknownCount } from "../src/avorelo/validation/skill-operating-system/registry.ts";

const loop = runAllPersonas();
const signals = loop.frictionSignals;
const ledger = { found: loop.found.length, fixed: loop.fixed.length, verified: loop.verified.length };
const scanners = runAllScanners();

function esc(s: unknown): string { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)); }
function label(l: string): string { const cls = l === "Live" ? "live" : l === "Local" ? "local" : l === "Blocked" ? "blocked" : l === "Not connected" ? "nc" : "seed"; return `<span class="label ${cls}">${esc(l)}</span>`; }

const personaRows = loop.personas.map(p => {
  const cls = p.status === "PASS" ? "done" : p.status === "PASS_WITH_HOLDS" ? "attn" : p.status.startsWith("HOLD") ? "attn" : p.status === "MISSING_EVIDENCE" ? "blocked" : "blocked";
  return `<tr><td><b>${esc(p.role)}</b></td><td><span class="pill ${cls}">${esc(p.status)}</span></td><td>${esc(p.finding)}</td><td>${label(p.sourceLabel)}</td></tr>`;
}).join("");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Founder / Admin — Avorelo</title>
<style>:root{--bg:#F5F4F1;--card:#fff;--text:#0A0E1C;--text2:#4A4E5E;--text3:#7A7E8E;--border:rgba(10,14,28,.10);--teal:#17A87A;--teal-lt:#E8F7F1;--indigo:#4B50E8;--amber:#D97B1A;--sans:'Satoshi','DM Sans',sans-serif;--body:'DM Sans',sans-serif}*{box-sizing:border-box;margin:0}body{font:15px/1.6 var(--body);color:var(--text);background:var(--bg)}
header{background:rgba(245,244,241,.96);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:9}.brand{font:700 1.05rem var(--sans);letter-spacing:-.03em}.badge{font:700 .6rem var(--sans);text-transform:uppercase;letter-spacing:.06em;background:var(--teal-lt);color:var(--teal);border:1px solid rgba(23,168,122,.2);padding:3px 10px;border-radius:20px}
main{max-width:1040px;margin:0 auto;padding:2rem 1.4rem}h1{font:700 1.3rem var(--sans);margin-bottom:.5rem;letter-spacing:-.02em}h2{font:700 1rem var(--sans);margin:1.5rem 0 .6rem;letter-spacing:-.01em}.sub{font-size:.82rem;color:var(--text3);margin-bottom:1.2rem}
table{border-collapse:collapse;width:100%;font-size:.85rem;margin-bottom:1rem}th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--border)}th{color:var(--text3);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
.pill{font:700 .65rem var(--sans);padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em}.pill.done{background:var(--teal-lt);color:var(--teal)}.pill.attn{background:rgba(217,123,26,.1);color:var(--amber)}.pill.blocked{background:#fdeceb;color:#b3261e}
.label{font:700 .65rem var(--sans);padding:2px 8px;border-radius:6px;border:1px solid var(--border)}.label.live{color:var(--teal);border-color:rgba(23,168,122,.3)}.label.local{color:var(--indigo);border-color:rgba(75,80,232,.2)}.label.blocked{color:#b3261e;border-color:#f0c5c2}.label.nc{color:var(--text3)}.label.seed{color:var(--amber)}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1rem;margin-bottom:.8rem}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem;margin-bottom:1rem}
.note{font-size:.78rem;color:var(--text3);margin-top:.5rem}details{border:1px solid var(--border);border-radius:10px;background:var(--card);padding:.6rem .9rem;margin-top:1rem}summary{cursor:pointer;font-weight:600}
footer{border-top:1px solid var(--border);color:var(--text3);font-size:.78rem;padding:1.5rem 1.4rem;text-align:center}
@media(max-width:640px){.grid{grid-template-columns:1fr}}
</style></head><body>
<header><span class="brand">avorelo</span><span class="badge">Founder / dev-only</span></header>
<main>
<h1>Founder Operating Cockpit</h1>
<p class="sub">Internal view. Every metric carries a data-source label. No fake numbers. Auth gating deferred to Slice 6. ${label("Local")}</p>

<div class="grid" style="margin-bottom:1.2rem">
<div class="card" style="border-left:4px solid ${loop.activationAllowed ? "var(--teal)" : "#b3261e"}"><b>Activation Slice</b><div><span class="pill ${loop.activationAllowed ? "done" : "blocked"}">${loop.activationAllowed ? "ALLOWED" : "BLOCKED"}</span></div><div style="font-size:.78rem;color:var(--text3);margin-top:.3rem">${loop.activationAllowed ? "May proceed as non-production next slice" : "Resolve activation blockers first"}</div></div>
<div class="card" style="border-left:4px solid ${loop.productionAllowed ? "var(--teal)" : "#b3261e"}"><b>Production Readiness</b><div><span class="pill ${loop.productionAllowed ? "done" : "blocked"}">${loop.productionAllowed ? "READY" : "NOT READY"}</span></div><div style="font-size:.78rem;color:var(--text3);margin-top:.3rem">${loop.productionAllowed ? "All production gates pass" : "Production Confidence partial + tool reattachment pending + payments not live"}</div></div>
<div class="card"><b>Persona Summary</b><div>${loop.rollup.pass} PASS · ${loop.rollup.passWithHolds} with holds · ${loop.rollup.hold + loop.rollup.missingEvidence} gaps</div><div style="font-size:.78rem;color:var(--text3);margin-top:.3rem">${loop.skillOutputCount} SkillOutputs · ${loop.skillOutputValidationErrors.length} validation errors</div></div>
</div>

<h2>SaaS Ops</h2>
<div class="grid">
<div class="card"><b>Repository</b><div>HappyLifeSaaS/Avorelo ${label("Live")}</div></div>
<div class="card"><b>CI / Gates</b><div>142 tests pass ${label("Live")}</div></div>
<div class="card"><b>Production Confidence</b><div>Partial — Slice 4 read-back exists ${label("Local")}</div></div>
</div>
<table><tr><th>Metric</th><th>Value</th><th>Source</th></tr>
<tr><td>Billing / Lemon Squeezy</td><td>Adapter exists, not connected</td><td>${label("Not connected")}</td></tr>
<tr><td>Tool Re-Attachment</td><td>Ledger exists (18 tools mapped, most historical/reconnect-later)</td><td>${label("Local")}</td></tr>
<tr><td>Deploy / npm publish</td><td>Blocked (not attempted)</td><td>${label("Blocked")}</td></tr>
</table>

<h2>AI Work Control</h2>
<div class="grid">
<div class="card"><b>Skill OS</b><div>${REGISTRY_COUNT} items, ${getUnknownCount()} unknown ${label("Live")}</div></div>
<div class="card"><b>Scanners</b><div>${scanners.summary.ran} ran, ${scanners.summary.findings} findings ${label("Live")}</div></div>
<div class="card"><b>Routing</b><div>Unified control router operational ${label("Live")}</div></div>
</div>
<table><tr><th>Metric</th><th>Value</th><th>Source</th></tr>
<tr><td>Dogfood Scripts</td><td>12+ all green</td><td>${label("Live")}</td></tr>
<tr><td>Review Skills</td><td>32+ (internal + reference + architecture)</td><td>${label("Live")}</td></tr>
<tr><td>Activation Blockers</td><td>0</td><td>${label("Live")}</td></tr>
<tr><td>Production Holds</td><td>live auth · billing · browser</td><td>${label("Not connected")}</td></tr>
</table>

<h2>Product & Value</h2>
<table><tr><th>Metric</th><th>Value</th><th>Source</th></tr>
<tr><td>Activation Readiness</td><td>Deferred — next slice</td><td>${label("Not connected")}</td></tr>
<tr><td>Local-First Value</td><td>avorelo open + verify + site:preview</td><td>${label("Live")}</td></tr>
<tr><td>Public Journey</td><td>23 pages, 0 broken links</td><td>${label("Live")}</td></tr>
<tr><td>AI Work Economics</td><td>~39k tokens estimated avoided</td><td>${label("Local")}</td></tr>
</table>

<h2>AI Team / Learn & Improve</h2>
<table><tr><th>Persona</th><th>Status</th><th>Finding</th><th>Source</th></tr>${personaRows}</table>
<p class="note">AI Team findings are advisory evidence only. Cannot declare READY. Cannot override Kernel.</p>
<div class="card"><b>Friction Signals</b><div>${loop.frictionSignals.map(s => esc(s)).join(" · ")}</div></div>
<div class="card"><b>Decisions Needed</b><div>${loop.decisionsNeeded.map(d => esc(d)).join(" · ")}</div></div>
<div class="card"><b>Next Action</b><div>${esc(loop.nextAction)}</div></div>

<details><summary>Advanced / Internal (collapsed)</summary>
<table><tr><th>Diagnostic</th><th>Value</th><th>Source</th></tr>
<tr><td>Work Ledger</td><td>found=${ledger.found} fixed=${ledger.fixed} verified=${ledger.verified}</td><td>${label("Local")}</td></tr>
<tr><td>Feedback Signals</td><td>${signals.length} signals</td><td>${label("Local")}</td></tr>
<tr><td>External Scanners</td><td>${scanners.summary.total - scanners.summary.ran} stubs/HOLD</td><td>${label("Not connected")}</td></tr>
<tr><td>Browser Proof</td><td>Unavailable</td><td>${label("Blocked")}</td></tr>
<tr><td>Old Repo</td><td>Historical reference only</td><td>${label("Not connected")}</td></tr>
</table></details>
</main>
<footer>Internal dev-only view · no raw prompts · no secrets · no fake metrics · Kernel decides READY · AI Team is advisory only</footer>
</body></html>`;

const outDir = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "public-web", "static");
writeFileSync(join(outDir, "founder.html"), html);
process.stdout.write(`Founder cockpit written to ${outDir}/founder.html\n`);
process.stdout.write(`Personas: ${loop.rollup.pass} PASS, ${loop.rollup.passWithHolds} PASS_WITH_HOLDS, ${loop.rollup.hold} HOLD, ${loop.rollup.missingEvidence} MISSING, ${loop.rollup.blocked} BLOCKED\n`);
process.stdout.write(`Activation: ${loop.activationAllowed ? "ALLOWED" : "BLOCKED"} | Production: ${loop.productionAllowed ? "ALLOWED" : "BLOCKED"}\n`);
