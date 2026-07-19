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
    riskClass: "low",
    paymentTouched: false,
    authTouched: false,
    productionImpactPossible: false,
    deterministicEvidenceAvailable: false,
    deepMode: false,
    secretsPossible: false,
    browserProofRequested: true,
    dir: tmpdir(),
    now: NOW,
  });
  assert(plan.selectedAdapter === "playwright-proof", `selected=${plan.selectedAdapter}`);
  record("browser_routes_to_playwright", true, `selected=${plan.selectedAdapter}`);

  const result = runToolExecution(plan, { dir: tmpdir(), task: "verify signup flow in browser", now: NOW, approved: true, useFakeAdapters: false });
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.proofMetadata?.adapterClass === "browser_proof", "proof metadata class");
  assert(!String(result.output).includes("<html"), "no raw dom");
  record("fixture_proof_summarized", true, `${result.proofMetadata?.summary ?? "none"}`);
} catch (e: any) {
  record("playwright_proof_adapter", false, e.message);
}

if (prev === undefined) delete process.env.AVORELO_FAKE_PROOF_ADAPTERS;
else process.env.AVORELO_FAKE_PROOF_ADAPTERS = prev;

const failed = gates.filter(g => !g.pass);
console.log("AVORELO PLAYWRIGHT PROOF ADAPTER DOGFOOD");
console.log(JSON.stringify({ ok: failed.length === 0, gates: { total: gates.length, passed: gates.length - failed.length, failed: failed.map(g => g.gate) }, detail: { gates } }, null, 2));
if (failed.length > 0) process.exit(1);
