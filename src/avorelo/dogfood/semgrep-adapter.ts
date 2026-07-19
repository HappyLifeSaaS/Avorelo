import { planToolExecution, runToolExecution } from "../kernel/tool-adapters/index.ts";
import { tmpdir } from "node:os";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];
const NOW = 1718500000000;

function record(gate: string, pass: boolean, detail: string) { gates.push({ gate, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

const prev = process.env.AVORELO_FAKE_PROOF_ADAPTERS;
process.env.AVORELO_FAKE_PROOF_ADAPTERS = "1";

try {
  const plan = planToolExecution({
    taskType: "code_generation",
    riskClass: "high",
    paymentTouched: false,
    authTouched: true,
    productionImpactPossible: false,
    deterministicEvidenceAvailable: false,
    deepMode: false,
    secretsPossible: true,
    dir: tmpdir(),
    now: NOW,
  });
  assert(plan.selectedAdapter === "semgrep", `selected=${plan.selectedAdapter}`);
  record("security_routes_to_semgrep", true, `selected=${plan.selectedAdapter}`);

  const result = runToolExecution(plan, { dir: tmpdir(), task: "review auth secret handling", now: NOW, approved: true, useFakeAdapters: false });
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.proofMetadata?.adapterClass === "security_scan", "proof metadata class");
  assert(!String(result.output).includes("function "), "no raw source");
  record("fake_findings_summarized", true, `${result.proofMetadata?.summary ?? "none"}`);
} catch (e: any) {
  record("semgrep_adapter", false, e.message);
}

if (prev === undefined) delete process.env.AVORELO_FAKE_PROOF_ADAPTERS;
else process.env.AVORELO_FAKE_PROOF_ADAPTERS = prev;

const failed = gates.filter(g => !g.pass);
console.log("AVORELO SEMGREP ADAPTER DOGFOOD");
console.log(JSON.stringify({ ok: failed.length === 0, gates: { total: gates.length, passed: gates.length - failed.length, failed: failed.map(g => g.gate) }, detail: { gates } }, null, 2));
if (failed.length > 0) process.exit(1);
