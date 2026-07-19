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
    taskType: "code_review",
    riskClass: "medium",
    paymentTouched: false,
    authTouched: false,
    productionImpactPossible: false,
    deterministicEvidenceAvailable: false,
    deepMode: false,
    secretsPossible: false,
    ciVerificationRequested: true,
    dir: tmpdir(),
    now: NOW,
  });
  assert(plan.selectedAdapter === "github-actions", `selected=${plan.selectedAdapter}`);
  record("ci_routes_to_github_actions", true, `selected=${plan.selectedAdapter}`);

  const result = runToolExecution(plan, { dir: tmpdir(), task: "check github actions workflow status", now: NOW, approved: true, useFakeAdapters: false });
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.proofMetadata?.adapterClass === "ci_readonly", "proof metadata class");
  record("fake_ci_fixture_summarized", true, `${result.proofMetadata?.summary ?? "none"}`);

  const blocked = runToolExecution(plan, { dir: tmpdir(), task: "trigger deploy workflow", now: NOW, approved: true, useFakeAdapters: false });
  assert(blocked.status === "blocked", `status=${blocked.status}`);
  assert(blocked.reasonCodes.includes("GITHUB_ACTIONS_TRIGGER_BLOCKED"), "trigger blocked");
  record("trigger_requests_blocked", true, "read-only gate enforced");
} catch (e: any) {
  record("github_actions_proof_adapter", false, e.message);
}

if (prev === undefined) delete process.env.AVORELO_FAKE_PROOF_ADAPTERS;
else process.env.AVORELO_FAKE_PROOF_ADAPTERS = prev;

const failed = gates.filter(g => !g.pass);
console.log("AVORELO GITHUB ACTIONS PROOF ADAPTER DOGFOOD");
console.log(JSON.stringify({ ok: failed.length === 0, gates: { total: gates.length, passed: gates.length - failed.length, failed: failed.map(g => g.gate) }, detail: { gates } }, null, 2));
if (failed.length > 0) process.exit(1);
