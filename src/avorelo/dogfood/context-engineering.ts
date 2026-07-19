// Avorelo Context Engineering v1 dogfood. Local-only, deterministic, CI-safe: no DB, no hono,
// no network, no credentials, no activation. Proves ContextPack stays bounded/redacted, sync-safe
// metadata is counts-only, reviewer packs downgrade excerpts, adapter guidance stays specific, and
// runtime/control-center persist only the sanitized projection.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContextPack,
  buildContextPackSyncMetadata,
  compileContext,
  loadLatestContextPack,
  writeContextPack,
} from "../capabilities/context-compiler/index.ts";
import { runRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderHtml, renderText } from "../capabilities/control-center/index.ts";

const DIR = process.cwd();
const AT = "2026-06-17T00:00:00.000Z";
const NOW = 1760611200000;
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  const sandbox = mkdtempSync(join(tmpdir(), "avorelo-context-engineering-"));
  try {
    const packet = compileContext({ task: `update .env and src/auth/login.ts with ${TOK}`, dir: DIR, createdAt: AT });
    const executorPack = buildContextPack({ packet, selectedAdapter: "claude-code", consumer: "executor" });
    const reviewerPacket = compileContext({ task: "fix src/util/format.ts and update README", dir: DIR, createdAt: AT });
    const reviewerPack = buildContextPack({
      packet: reviewerPacket,
      selectedAdapter: "codex",
      consumer: "reviewer",
      reviewerOfAdapter: "claude-code",
      relevantReceipts: ["tpr_test123"],
      sanitizedDiffSummary: "modified 2 files",
    });
    const semgrepPack = buildContextPack({
      packet: compileContext({ task: "scan src/security/auth.ts", dir: DIR, createdAt: AT }),
      selectedAdapter: "semgrep",
      consumer: "proof_adapter",
    });
    const sync = buildContextPackSyncMetadata(executorPack);

    g("context_pack_contract_exists", executorPack.contract === "avorelo.contextPack.v1" && executorPack.schemaVersion === 1);
    g("executor_pack_redacted", executorPack.redacted === true && executorPack.containsRawSecret === false && !raw(TOK, executorPack));
    g("secret_file_excluded", executorPack.forbiddenContext.some((item) => item.reasonCode === "secret_file_excluded"));
    g("reviewer_downgrades_excerpts", reviewerPack.allowedContext.every((item) => item.includeMode !== "excerpt"));
    g("reviewer_preserves_sanitized_diff_summary", reviewerPack.sanitizedDiffSummary === "modified 2 files" && reviewerPack.relevantReceipts.includes("tpr_test123"));
    g("adapter_specific_instructions_exist", semgrepPack.toolInstructions.some((line) => /summarize findings only/i.test(line)));
    g("provenance_and_budget_exist", executorPack.provenanceTags.length > 0 && executorPack.contextBudgetUsed >= executorPack.allowedContext.length);
    g("sync_projection_counts_only", (() => {
      const obj = sync as unknown as Record<string, unknown>;
      return sync.contract === "avorelo.contextPack.sync.v1"
        && obj.allowedContext === undefined
        && obj.toolInstructions === undefined
        && !JSON.stringify(sync).includes("README")
        && !JSON.stringify(sync).includes("login.ts");
    })());

    writeContextPack(sandbox, executorPack);
    const persisted = loadLatestContextPack(sandbox);
    g("persisted_pack_loads", persisted?.contextPackId === executorPack.contextPackId);
    g("persisted_pack_stays_redacted", !raw(TOK, readFileSync(join(sandbox, ".avorelo", "context", "context-pack.latest.json"), "utf8")));

    const runtime = runRuntimeSession({ task: "update the README wording", dir: sandbox, createdAt: AT, now: NOW });
    const controlCenter = buildControlCenter(sandbox, { now: NOW });
    g("runtime_projects_context_pack", runtime.record.contextPack?.contextPackId !== undefined && (runtime.record.contextPack?.allowedCount ?? 0) >= 1);
    g("control_center_surfaces_context_pack", controlCenter.sections.contextPack.status === "available" && renderText(controlCenter).includes("Ctx pack:") && renderHtml(controlCenter).includes("Ctx pack"));
    g("runtime_context_pack_ref_persisted", runtime.record.contextPack?.ref?.includes("context-pack.latest.json") === true);
    g("runtime_persistence_stays_secret_safe", !raw(TOK, runtime.record));

    s("1_executor_pack_bounded", executorPack.allowedContext.length >= 1 && executorPack.safeForModel === true);
    s("2_reviewer_pack_summary_only", reviewerPack.allowedContext.every((item) => item.includeMode === "summary" || item.includeMode === "path_only"));
    s("3_sync_metadata_local_only", sync.allowedCount >= 0 && !raw("toolInstructions", sync));
    s("4_runtime_writes_context_pack", !!loadLatestContextPack(sandbox));
    s("5_control_center_shows_pack", controlCenter.sections.contextPack.status === "available");
  } finally {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
  }

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO CONTEXT-ENGINEERING DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
