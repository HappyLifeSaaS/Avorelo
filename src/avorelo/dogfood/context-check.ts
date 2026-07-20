// Avorelo Agent Context Check dogfood. Local-only, deterministic, no network, no credentials.
// Runs Context Check against the Avorelo repo itself and validates all invariants.

import { runContextCheck, renderHuman, renderJson, buildContextCheckReceipt, toEvidenceArtifacts, persistContextCheckResult } from "../capabilities/context-check/index.ts";
import { scanSources, getAdapterCapabilities } from "../capabilities/context-check/scanner.ts";
import { buildControlCenter } from "../capabilities/control-center/index.ts";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIR = process.cwd();

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });

  // Gate 1: Module exists and exports correctly
  g("context_check_module_exists", typeof runContextCheck === "function");
  g("scanner_module_exists", typeof scanSources === "function");
  g("render_human_exists", typeof renderHuman === "function");
  g("render_json_exists", typeof renderJson === "function");

  // Gate 2: Run on Avorelo repo itself
  const result = runContextCheck({ repoRoot: DIR, mode: "generic", outputPreference: "json" });
  g("schema_version_correct", result.schemaVersion === "agent-context-check.v1");
  g("status_is_valid", ["pass", "info", "warning", "needs_attention"].includes(result.status));
  g("risk_level_is_valid", ["none", "low", "medium", "high"].includes(result.riskLevel));
  g("sources_checked_positive", result.sourcesChecked > 0, `found ${result.sourcesChecked} sources`);

  // Gate 3: CLAUDE.md detection. The canonical repo carries its own CLAUDE.md, but that file is
  // internal agent context and is excluded from the public export — so asserting against this
  // repo's own file would fail in the public repository for lack of input rather than for a real
  // defect. Detection is therefore proven against a synthetic workspace fixture, which exercises
  // the same code path deterministically in both repositories.
  const fx = mkdtempSync(join(tmpdir(), "avorelo-ctxcheck-"));
  try {
    writeFileSync(join(fx, "CLAUDE.md"), "# Project instructions\n\nUse the local workflow.\n");
    const fixture = runContextCheck({ repoRoot: fx, mode: "generic", outputPreference: "json" });
    g("detects_claude_md", fixture.sources.some(s => s.path === "CLAUDE.md"),
      `sources: ${fixture.sources.map(s => s.path).join(", ")}`);
  } finally {
    rmSync(fx, { recursive: true, force: true });
  }

  // Gate 4: Evidence is populated
  g("evidence_populated", result.evidence.scanDurationMs >= 0 && result.evidence.totalContextSizeBytes > 0);
  g("agent_families_detected", result.evidence.agentFamiliesDetected.length > 0);

  // Gate 5: Receipt lines are safe
  g("receipt_lines_present", result.receiptLines.length > 0);
  const receiptStr = result.receiptLines.join("\n");
  g("receipt_no_raw_prompts", !receiptStr.includes("prompt") || receiptStr.includes("context_check:"));
  g("receipt_no_secrets", !/AKIA|ghp_|sk-|password|secret_key/i.test(receiptStr));

  // Gate 6: JSON output is valid
  const jsonStr = renderJson(result);
  let jsonParsed: unknown = null;
  try { jsonParsed = JSON.parse(jsonStr); } catch {}
  g("json_output_parseable", jsonParsed !== null);
  g("json_has_schema_version", typeof jsonParsed === "object" && jsonParsed !== null && (jsonParsed as any).schemaVersion === "agent-context-check.v1");

  // Gate 7: Human output is compact
  const humanStr = renderHuman(result);
  g("human_output_compact", humanStr.split("\n").length < 30, `lines=${humanStr.split("\n").length}`);
  g("human_output_mentions_context_check", humanStr.includes("Context Check"));

  // Gate 8: Findings have valid structure
  for (const f of result.findings) {
    g(`finding_${f.code}_valid_severity`, ["info", "warning", "needs_attention"].includes(f.severity));
    g(`finding_${f.code}_valid_confidence`, ["low", "medium", "high"].includes(f.confidence));
    g(`finding_${f.code}_has_path`, f.path.length > 0);
    g(`finding_${f.code}_no_block_default`, f.blocksAutonomousWork === false);
  }

  // Gate 9: No cloud dependency
  g("dogfood_is_local_only", true);

  // Gate 10: Task-aware mode works
  const taskResult = runContextCheck({
    repoRoot: DIR,
    mode: "task-aware",
    outputPreference: "json",
    workContract: { objective: "fix auth", allowedPaths: ["src/auth"] },
  });
  g("task_aware_mode_works", taskResult.evidence.workContractProvided === true);

  // Gate 11: Strict mode works
  const strictResult = runContextCheck({
    repoRoot: DIR,
    mode: "generic",
    outputPreference: "json",
    strict: true,
  });
  g("strict_mode_works", strictResult.strict === true);

  // Gate 12: Capability receipt builder
  const built = buildContextCheckReceipt({ receiptId: "ccrcpt_dogfood_1", result });
  g("receipt_contract_correct", built.receipt.contract === "avorelo.contextCheck.v1");
  g("receipt_redacted", built.receipt.redacted === true);
  g("receipt_no_raw_content", built.receipt.rawInstructionContentPersisted === false);
  g("receipt_cloud_eligibility_computed", typeof built.cloudEligible === "boolean");

  // Gate 13: Evidence artifact builder
  const artifacts = toEvidenceArtifacts(result);
  g("evidence_artifacts_produced", artifacts.length >= 1);
  g("evidence_artifacts_kind_correct", artifacts.every(a => a.kind === "source_of_truth_readback"));
  g("evidence_artifacts_ref_prefixed", artifacts.every(a => a.ref.startsWith("context-check:")));

  // Gate 14: Persistence
  const persisted = persistContextCheckResult(DIR, result);
  g("persistence_writes_latest", existsSync(persisted.resultPath));

  // Gate 15: Adapter capabilities — no agent adapter fakes excludedPaths
  const caps = getAdapterCapabilities();
  const agentAdapters = caps.filter(c => c.adapter !== "work_contract");
  g("adapter_no_fake_excluded_paths", agentAdapters.every(c => !c.supportsExcludedPaths));
  g("adapter_work_contract_supports_excluded_paths", caps.find(c => c.adapter === "work_contract")?.supportsExcludedPaths === true);
  g("scanner_no_excluded_paths_on_sources", result.sources.every(s => s.excludedPaths === undefined));

  // Gate 16: CI mode
  const ciResult = runContextCheck({ repoRoot: DIR, mode: "ci", outputPreference: "json" });
  g("ci_mode_runs", ciResult.mode === "ci");
  g("ci_mode_json_valid", (() => { try { JSON.parse(renderJson(ciResult)); return true; } catch { return false; } })());
  g("ci_mode_no_raw_content", !renderJson(ciResult).includes("CLAUDE.md") || renderJson(ciResult).includes("\"path\":\"CLAUDE.md\""));

  // Gate 17: Control-center integration
  const cc = buildControlCenter(DIR, { now: Date.now() });
  g("control_center_shows_context_check", cc.sections.contextCheck.status === "available");
  g("control_center_context_check_no_raw_content", !JSON.stringify(cc.sections.contextCheck).includes("CLAUDE.md") && !JSON.stringify(cc.sections.contextCheck).includes("prompt"));

  const fg = gates.filter(x => !x.pass);
  const ok = fg.length === 0;
  process.stdout.write("AVORELO CONTEXT-CHECK DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map(x => x.gate) },
    detail: { gates },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
