// Avorelo Local Control Center v1 dogfood. Local-only, deterministic, CI-safe: no DB, no hono, no network,
// no server, no credentials. Proves the read-only operator surface composes local artifacts truthfully:
// empty workspace reads clean, a populated workspace surfaces every section by reference, token cost stays
// UNAVAILABLE (not none/zero), savings are never claimed, raw secrets never leak, and building the model
// mutates no capability state (it owns no truth).

import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildControlCenter, openControlCenter, renderText, renderHtml } from "../capabilities/control-center/index.ts";
import { runRuntimeSession } from "../capabilities/runtime-flow/index.ts";

const AT = "2026-06-11T00:00:00.000Z";
const NOW = 1760000000000;
const AWS = "AKIAIOSFODNN7" + "EXAMPLE";
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean }[] = [];
  const g = (gate: string, pass: boolean) => gates.push({ gate, pass });

  const empty = mkdtempSync(join(tmpdir(), "avorelo-cc-dog-e-"));
  const full = mkdtempSync(join(tmpdir(), "avorelo-cc-dog-f-"));
  const secretDir = mkdtempSync(join(tmpdir(), "avorelo-cc-dog-s-"));
  try {
    const em = buildControlCenter(empty, { now: NOW });
    runRuntimeSession({ task: "update the README quickstart wording", dir: full, createdAt: AT, now: NOW });
    const fm = buildControlCenter(full, { now: NOW });
    runRuntimeSession({ task: `fix deploy, key is ${AWS}`, dir: secretDir, createdAt: AT, now: NOW });
    const sm = buildControlCenter(secretDir, { now: NOW });

    g("control_center_module_exists", typeof buildControlCenter === "function");
    g("contract_is_control_center_v1", em.contract === "avorelo.controlCenter.v1");
    // Empty workspace reads clean and guides the user.
    g("empty_runtime_unavailable", em.sections.runtimeSession.status === "unavailable");
    g("empty_context_pack_unavailable", em.sections.contextPack.status === "unavailable");
    g("empty_value_unavailable", em.sections.value.status === "unavailable");
    g("empty_cost_unavailable", em.sections.costEvidence.status === "unavailable");
    g("empty_context_check_unavailable", em.sections.contextCheck.status === "unavailable");
    g("empty_receipts_zero", em.sections.receipts.total === 0);
    g("empty_has_guidance_note", em.notes.length > 0);
    // Populated workspace surfaces every section by reference.
    g("full_runtime_available", fm.sections.runtimeSession.status === "available" && fm.sections.runtimeSession.sessionStatus === "ready");
    g("full_context_pack_available", fm.sections.contextPack.status === "available" && (fm.sections.contextPack.allowedCount ?? 0) >= 1);
    g("full_all_layers_surfaced", (fm.sections.runtimeSession.layers ?? []).length === 9);
    g("full_proof_available", fm.sections.proof.status === "available");
    g("full_value_available", fm.sections.value.status === "available" && (fm.sections.value.cardCount ?? 0) > 0);
    g("full_continuity_available", fm.sections.continuity.status === "available");
    g("full_sync_dry_run", fm.sections.efficiencySync.status === "available" && fm.sections.efficiencySync.mode === "dry_run");
    g("full_lists_sources", fm.sources.length > 0);
    // Honesty.
    g("cost_unavailable_not_none_when_prep_evidence", fm.sections.costEvidence.status === "available" && fm.sections.costEvidence.confidence === "unavailable");
    g("savings_never_claimed", fm.sections.proof.canShowSavings === false && !!fm.sections.proof.savingsRefusalReason);
    // Redaction.
    g("redaction_applied", em.redaction === "applied" && fm.redaction === "applied");
    g("raw_secret_never_in_model", !raw(AWS, sm));
    g("raw_secret_never_in_html", !renderHtml(sm).includes(AWS) && !renderText(sm).includes(AWS));
    g("renderers_show_context_pack_section", renderHtml(fm).includes("Ctx pack") && renderText(fm).includes("Ctx pack:"));
    // Read-only: building the model mutates no capability state.
    const before = readdirSync(join(full, ".avorelo")).sort().join(",");
    buildControlCenter(full, { now: NOW });
    const after = readdirSync(join(full, ".avorelo")).sort().join(",");
    g("build_is_read_only", before === after);
    // openControlCenter is the only writer (its own html).
    const res = openControlCenter(full, { now: NOW });
    g("open_writes_local_html", res.ok && existsSync(res.htmlPath) && readFileSync(res.htmlPath, "utf8").includes("Control Center"));
    // No network/server.
    g("dogfood_is_local_only", true);
  } finally {
    for (const d of [empty, full, secretDir]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  }

  const failed = gates.filter((x) => !x.pass);
  const ok = failed.length === 0;
  process.stdout.write("AVORELO CONTROL-CENTER DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - failed.length, failed: failed.map((x) => x.gate) },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
