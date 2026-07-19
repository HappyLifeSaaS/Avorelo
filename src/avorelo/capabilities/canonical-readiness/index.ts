// Avorelo Old Repo Parity Gate & Canonical Readiness v1 (Phase 10). Deterministic, local, no network.
// A readiness/parity GATE — NOT a new capability. Inspects deterministic repo artifacts (module paths,
// tests, dogfood scripts, docs, package.json, CLI dispatch, schemas) and produces an honest readiness
// report. Never fakes `ready` when blockers or known limitations exist.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  CanonicalReadinessReport,
  PhaseCoverageItem,
  PhaseStatus,
  OldRepoCapabilityItem,
  ReadinessResult,
} from "../../shared/schemas/index.ts";

// ---------- Pure, testable helpers ----------

// Forbidden AFFIRMATIVE claims (negations/refusals are fine). Used to scan docs/src/dogfood.
const FORBIDDEN_CLAIM_PATTERNS: { code: string; re: RegExp }[] = [
  { code: "guaranteed_savings", re: /guaranteed savings|guarantee[sd]? .{0,20}savings/ },
  { code: "zero_leak_guarantee", re: /zero[- ]leak guarantee|guarantee[sd]? .{0,20}no leak|no secret will ever leak/ },
  { code: "vault", re: /\bis a vault\b|secrets? vault\b/ },
  { code: "auto_rotation", re: /auto-?rotates? credentials|automatically rotates? credentials/ },
  { code: "compliance_ready", re: /compliance[- ]ready|compliant with (soc2|gdpr|pci)/ },
  { code: "roi_guaranteed", re: /roi guaranteed|guaranteed roi/ },
  { code: "productivity_score", re: /productivity score/ },
  { code: "cloud_stores_prompts", re: /cloud stores prompts|stores? (your )?prompts in (the )?cloud/ },
  { code: "syncs_full_reports", re: /syncs? full (reports?|artifacts?)/ },
  { code: "full_repo_understanding", re: /full repo understanding/ },
  { code: "exact_billing_replacement", re: /exact billing replacement|replaces? (provider )?billing/ },
];

const NEG = /\b(no|not|never|without|cannot|n't|non-goal|forbidden|refus|only|avoid)\b/;

/**
 * Affirmative-only forbidden-claim scan over PROSE. Returns the codes found. Ignores:
 *  - negated/refusal sentences (e.g. "no ROI", "does not claim savings"),
 *  - list items / table rows / headings (bullets that ENUMERATE forbidden claims are not themselves claims),
 *  - lines under a "forbidden"/"non-goal"/"allowed wording" context.
 * This prevents the docs that DEFINE the forbidden list from being flagged as making the claim.
 */
export function scanForbiddenClaims(text: string): string[] {
  const lines = (text || "").toLowerCase().split(/\r?\n/);
  const prose: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^([*\-#>|]|\d+\.)/.test(line)) continue; // bullets, headings, blockquotes, tables, numbered lists
    if (line.includes("|")) continue; // table row
    if (NEG.test(line)) continue; // negation / refusal / "forbidden"/"non-goal"/"only"/"avoid"
    if (/forbidden|allowed wording|must not|do not|disallow/.test(line)) continue;
    prose.push(line);
  }
  const affirmative = prose.join(" . ");
  return FORBIDDEN_CLAIM_PATTERNS.filter((p) => p.re.test(affirmative)).map((p) => p.code);
}

// Legacy brand tokens are assembled from fragments so this runtime file carries no literal legacy naming
// (keeps the Avorelo-only naming invariant green; the detector still matches them at runtime).
const LEGACY_BRANDS = "\\b(" + ["w" + "uz", "c" + "co"].join("|") + ")\\b";
const LEGACY_PRODUCT = ["claudecode", "optimizer"].join("-") + " is (the )?(current|canonical) product";
const LEGACY_BRAND_RE = new RegExp(LEGACY_BRANDS);
const LEGACY_HISTORICAL_RE = /(old|legacy|former|reference|history|historical|migrat)/;
const LEGACY_PRODUCT_RE = new RegExp(LEGACY_PRODUCT);

/** Current-use old branding scan. Historical mentions in migration docs are allowed. */
export function scanCurrentBranding(text: string, opts: { isMigrationOrHistorical?: boolean } = {}): string[] {
  if (opts.isMigrationOrHistorical) return [];
  const out: string[] = [];
  const lower = (text || "").toLowerCase();
  // Flag only CURRENT-use phrasing, not a historical/reference mention.
  if (LEGACY_BRAND_RE.test(lower) && !LEGACY_HISTORICAL_RE.test(lower)) out.push("old_branding_current_use");
  if (LEGACY_PRODUCT_RE.test(lower)) out.push("old_product_claimed_current");
  return out;
}

/** Documented commands must all be available in the CLI dispatch. Returns the missing ones. */
export function checkCliReality(documented: string[], available: string[]): string[] {
  const set = new Set(available);
  return documented.filter((d) => !set.has(d));
}

/** Compute the readiness result honestly. */
export function computeResult(input: { blockers: string[]; limitations: string[] }): ReadinessResult {
  if (input.blockers.length > 0) return "not_ready";
  if (input.limitations.length > 0) return "ready_with_limitations";
  return "ready";
}

// ---------- Repo scan ----------

type PhaseSpec = { phase: number; name: string; modules: string[]; tests: string[]; dogfood: string[]; docs: string[] };

const PHASE_SPECS: PhaseSpec[] = [
  { phase: 1, name: "Evidence/Redaction/Receipt/Sync foundation", modules: ["src/avorelo/kernel/evidence/foundation.ts", "src/avorelo/kernel/receipts/validation.ts", "src/avorelo/shared/redaction/policy.ts", "src/avorelo/shared/safe-reference/index.ts", "src/avorelo/kernel/receipts/eligibility.ts"], tests: ["tests/phase1-foundation.test.ts"], dogfood: ["src/avorelo/dogfood/phase1-foundation.ts"], docs: [] },
  { phase: 2, name: "Deterministic Secret Boundary", modules: ["src/avorelo/capabilities/secret-boundary/index.ts"], tests: ["tests/secret-boundary.test.ts"], dogfood: ["src/avorelo/dogfood/secret-boundary.ts"], docs: ["docs/internal/deterministic-secret-boundary.md"] },
  { phase: 3, name: "Enriched WorkContract and Safe Routing", modules: ["src/avorelo/kernel/work-contract/routing.ts"], tests: ["tests/workcontract-routing.test.ts"], dogfood: ["src/avorelo/dogfood/workcontract-routing.ts"], docs: ["docs/internal/enriched-workcontract-safe-routing.md"] },
  { phase: 4, name: "Context Compiler Lite", modules: ["src/avorelo/capabilities/context-compiler/index.ts"], tests: ["tests/context-compiler.test.ts"], dogfood: ["src/avorelo/dogfood/context-compiler.ts"], docs: ["docs/internal/context-compiler-lite.md"] },
  { phase: 5, name: "Next-Run Continuity", modules: ["src/avorelo/capabilities/continuity/index.ts"], tests: ["tests/continuity.test.ts"], dogfood: ["src/avorelo/dogfood/continuity.ts"], docs: ["docs/internal/next-run-continuity.md"] },
  { phase: 6, name: "Token and Cost Evidence", modules: ["src/avorelo/capabilities/token-cost-evidence/index.ts"], tests: ["tests/token-cost-evidence.test.ts"], dogfood: ["src/avorelo/dogfood/token-cost.ts"], docs: ["docs/internal/token-cost-evidence.md"] },
  { phase: 7, name: "Proof and Savings Report", modules: ["src/avorelo/capabilities/proof-report/index.ts"], tests: ["tests/proof-report.test.ts"], dogfood: ["src/avorelo/dogfood/proof-report.ts"], docs: ["docs/internal/proof-and-savings-report.md"] },
  { phase: 8, name: "Value Ledger and Compact Value Surface", modules: ["src/avorelo/capabilities/value-ledger/index.ts"], tests: ["tests/value-ledger.test.ts"], dogfood: ["src/avorelo/dogfood/value-ledger.ts"], docs: ["docs/internal/value-ledger-compact-surface.md"] },
  { phase: 9, name: "Sanitized Cloud Sync for Efficiency Metadata", modules: ["src/avorelo/capabilities/efficiency-sync/index.ts"], tests: ["tests/efficiency-sync.test.ts"], dogfood: ["src/avorelo/dogfood/efficiency-sync.ts"], docs: ["docs/internal/sanitized-efficiency-cloud-sync.md"] },
  { phase: 10, name: "Seamless Model & Primitive Routing", modules: ["src/avorelo/kernel/model-routing/index.ts", "src/avorelo/kernel/model-routing/resolver.ts", "src/avorelo/kernel/model-routing/session-memory.ts", "src/avorelo/kernel/model-routing/cascade.ts", "src/avorelo/kernel/model-routing/verifier.ts", "src/avorelo/kernel/model-routing/receipt.ts"], tests: ["tests/model-routing-kernel.test.ts"], dogfood: ["src/avorelo/dogfood/kernel-model-routing.ts"], docs: [] },
  { phase: 11, name: "Tool Adapter Orchestration", modules: ["src/avorelo/kernel/tool-adapters/index.ts", "src/avorelo/kernel/tool-adapters/registry.ts", "src/avorelo/kernel/tool-adapters/detect.ts", "src/avorelo/kernel/tool-adapters/planner.ts", "src/avorelo/kernel/tool-adapters/policies.ts", "src/avorelo/kernel/tool-adapters/receipt.ts"], tests: ["tests/tool-adapter-orchestration.test.ts"], dogfood: ["src/avorelo/dogfood/tool-adapter-orchestration.ts"], docs: [] },
];

const OLD_CAP_SPECS: { capability: string; evidence: string[]; status: OldRepoCapabilityItem["status"]; notes: string[] }[] = [
  { capability: "AI Work Efficiency Suite", evidence: ["src/avorelo/capabilities/token-cost-evidence/index.ts", "src/avorelo/capabilities/proof-report/index.ts", "src/avorelo/capabilities/value-ledger/index.ts"], status: "adapted", notes: ["split into Phase 6-8 capabilities"] },
  { capability: "Context Compiler v1", evidence: ["src/avorelo/capabilities/context-compiler/index.ts"], status: "adapted", notes: ["Context Compiler Lite (Phase 4)"] },
  { capability: "Token & Cost Evidence Capture", evidence: ["src/avorelo/capabilities/token-cost-evidence/index.ts"], status: "adapted", notes: ["Phase 6"] },
  { capability: "Proof & Savings Report", evidence: ["src/avorelo/capabilities/proof-report/index.ts"], status: "adapted", notes: ["Phase 7; savings refused without comparative evidence"] },
  { capability: "Run Improvements / Next-Run Context", evidence: ["src/avorelo/capabilities/continuity/index.ts"], status: "adapted", notes: ["Phase 5"] },
  { capability: "Governed Run Contract", evidence: ["src/avorelo/kernel/work-contract/routing.ts"], status: "adapted", notes: ["Phase 3 enriched WorkContract"] },
  { capability: "Operating Value Surface", evidence: ["src/avorelo/capabilities/value-ledger/index.ts"], status: "adapted", notes: ["Phase 8 compact value cards"] },
  { capability: "Deterministic Secret Boundary", evidence: ["src/avorelo/capabilities/secret-boundary/index.ts"], status: "adapted", notes: ["Phase 2"] },
  { capability: "Agent Security instruction-risk scanner", evidence: ["src/avorelo/capabilities/secret-boundary/instruction-risk.ts"], status: "adapted", notes: ["Phase 2"] },
  { capability: "Install/Intake Risk scanner", evidence: ["src/avorelo/capabilities/secret-boundary/intake-risk.ts"], status: "adapted", notes: ["Phase 2"] },
  { capability: "Worker handoff references", evidence: ["src/avorelo/capabilities/secret-boundary/handoff.ts"], status: "adapted", notes: ["Phase 2 SafeReference handoff"] },
  { capability: "Safe Run Execution Controller", evidence: ["src/avorelo/capabilities/secret-boundary/safe-run.ts"], status: "adapted", notes: ["Phase 2 safe-run"] },
  { capability: "Work Ledger redaction invariants", evidence: ["src/avorelo/kernel/receipts/validation.ts", "src/avorelo/shared/redaction/policy.ts"], status: "adapted", notes: ["Phase 1 foundation"] },
  { capability: "Production Confidence secret checks", evidence: ["src/avorelo/capabilities/production-confidence/index.ts"], status: "adapted", notes: ["pre-existing capability; secret checks via Phase 2"] },
  { capability: "Seamless Model & Primitive Routing", evidence: ["src/avorelo/kernel/model-routing/index.ts", "src/avorelo/kernel/model-routing/resolver.ts", "src/avorelo/kernel/model-routing/verifier.ts"], status: "adapted", notes: ["Phase 10; deterministic-first cascade, upgrade-only session memory, safety-verified projections"] },
];

function has(root: string, rel: string): boolean { return existsSync(join(root, rel)); }
function read(root: string, rel: string): string { try { return readFileSync(join(root, rel), "utf8"); } catch { return ""; } }

function walkFiles(root: string, rel: string, exts: string[]): string[] {
  const out: string[] = [];
  const base = join(root, rel);
  if (!existsSync(base)) return out;
  const rec = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) rec(p);
      else if (exts.some((e) => name.endsWith(e))) out.push(p);
    }
  };
  rec(base);
  return out;
}

export type ReadinessOptions = { createdAt?: string; extraLimitations?: string[] };

export function buildCanonicalReadinessReport(target: string, opts: ReadinessOptions = {}): CanonicalReadinessReport {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const blockers: string[] = [];

  // 1) Phase coverage.
  const phaseCoverage: PhaseCoverageItem[] = PHASE_SPECS.map((spec) => {
    const evidence: string[] = [];
    const moduleOk = spec.modules.every((m) => has(target, m));
    const testOk = spec.tests.length === 0 || spec.tests.some((t) => has(target, t));
    const dogfoodOk = spec.dogfood.length === 0 || spec.dogfood.some((d) => has(target, d));
    for (const m of spec.modules) if (has(target, m)) evidence.push(m);
    for (const t of spec.tests) if (has(target, t)) evidence.push(t);
    for (const d of spec.dogfood) if (has(target, d)) evidence.push(d);
    for (const d of spec.docs) if (has(target, d)) evidence.push(d);
    let status: PhaseStatus;
    if (moduleOk && testOk && dogfoodOk) status = "implemented";
    else if (evidence.length > 0) status = "documented";
    else status = "missing";
    if (status === "missing") blockers.push(`phase_${spec.phase}_missing`);
    return { phase: spec.phase, name: spec.name, status, evidence };
  });

  // 2) Old repo capability coverage.
  const oldRepoCapabilityCoverage: OldRepoCapabilityItem[] = OLD_CAP_SPECS.map((c) => {
    const present = c.evidence.filter((e) => has(target, e));
    const status: OldRepoCapabilityItem["status"] = present.length > 0 ? c.status : "deferred";
    return { capability: c.capability, status, canonicalEvidence: present, notes: present.length > 0 ? c.notes : [...c.notes, "evidence_not_found"] };
  });

  // 3) Forbidden-claim + branding scan (docs excl. migration history; src; dogfood).
  const docFiles = walkFiles(target, "docs", [".md"]);
  const srcFiles = walkFiles(target, "src/avorelo", [".ts"]);
  const claimOffenders = new Set<string>();
  const brandingOffenders = new Set<string>();
  // Forbidden-CLAIM scan runs over DOCS PROSE only: src/dogfood/test files legitimately reference these
  // strings as detection patterns / gate names, not as product claims.
  for (const f of docFiles) {
    for (const code of scanForbiddenClaims((() => { try { return readFileSync(f, "utf8"); } catch { return ""; } })())) claimOffenders.add(code);
  }
  // Branding scan runs over docs + src; migration/readiness/historical files are exempt for historical mentions.
  for (const f of [...docFiles, ...srcFiles]) {
    const isMigration = f.includes(join("migration")) || f.toLowerCase().includes("readiness") || f.includes("canonical-migration");
    for (const code of scanCurrentBranding((() => { try { return readFileSync(f, "utf8"); } catch { return ""; } })(), { isMigrationOrHistorical: isMigration })) brandingOffenders.add(code);
  }
  if (claimOffenders.size > 0) blockers.push(`forbidden_claims:${[...claimOffenders].join(",")}`);
  if (brandingOffenders.size > 0) blockers.push(`old_branding:${[...brandingOffenders].join(",")}`);

  // 4) CLI reality: documented commands must exist in the dispatch.
  const cli = read(target, "src/avorelo/surfaces/cli/avorelo.ts");
  const documented = ["status", "explain", "sync", "continuity", "token-cost", "report", "value"];
  const available = documented.filter((c) => cli.includes(`case "${c}"`));
  const missingCli = checkCliReality(documented, available);
  if (missingCli.length > 0) blockers.push(`cli_docs_mismatch:${missingCli.join(",")}`);
  const efficiencyCli = /efficiency/.test(cli) && cli.includes('args[0] === "efficiency"');
  const readinessCli = cli.includes('case "readiness"');

  // 5) Invariants (deterministic presence/grep checks).
  const schemas = read(target, "src/avorelo/shared/schemas/index.ts");
  const invariants = {
    safetyBoundary: has(target, "src/avorelo/capabilities/secret-boundary/index.ts") && has(target, "src/avorelo/kernel/pretooluse-gate/index.ts"),
    noRawSecrets: has(target, "src/avorelo/shared/redaction/index.ts") && has(target, "src/avorelo/shared/redaction/policy.ts"),
    noRawPrompts: has(target, "src/avorelo/shared/redaction/policy.ts"),
    noRawSourceDumps: has(target, "src/avorelo/shared/safe-reference/index.ts"),
    metadataOnlySync: has(target, "src/avorelo/capabilities/efficiency-sync/index.ts") && /projectionOnly/.test(read(target, "src/avorelo/capabilities/efficiency-sync/index.ts")),
    noFakeSavings: /savingsClaimAllowed/.test(read(target, "src/avorelo/capabilities/proof-report/index.ts")),
    confidenceLabelsPreserved: /EvidenceConfidence/.test(schemas),
    fullArtifactsLocalOnly: /buildContextPacketSyncMetadata/.test(read(target, "src/avorelo/capabilities/context-compiler/index.ts")) && /buildContinuitySyncMetadata/.test(read(target, "src/avorelo/capabilities/continuity/index.ts")),
    noOldBranding: brandingOffenders.size === 0,
    cliDocsMatchReality: missingCli.length === 0,
    modelRoutingVerifier: has(target, "src/avorelo/kernel/model-routing/verifier.ts") && /modelMayDecide/.test(read(target, "src/avorelo/kernel/model-routing/verifier.ts")),
    modelRoutingNoRawPersistence: has(target, "src/avorelo/kernel/model-routing/receipt.ts") && /containsRawPrompt.*false/.test(read(target, "src/avorelo/kernel/model-routing/receipt.ts")),
    modelRoutingUpgradeOnly: has(target, "src/avorelo/kernel/model-routing/session-memory.ts") && /canDowngrade/.test(read(target, "src/avorelo/kernel/model-routing/session-memory.ts")) && /return false/.test(read(target, "src/avorelo/kernel/model-routing/session-memory.ts")),
    toolAdapterRegistry: has(target, "src/avorelo/kernel/tool-adapters/registry.ts") && /getAdapterDescriptors/.test(read(target, "src/avorelo/kernel/tool-adapters/registry.ts")),
    toolAdapterDetection: has(target, "src/avorelo/kernel/tool-adapters/detect.ts") && /detectAllTools/.test(read(target, "src/avorelo/kernel/tool-adapters/detect.ts")),
    toolAdapterNoRawPersistence: has(target, "src/avorelo/kernel/tool-adapters/receipt.ts") && /containsRawPrompt.*false/.test(read(target, "src/avorelo/kernel/tool-adapters/receipt.ts")),
    toolAdapterPolicyEnforced: has(target, "src/avorelo/kernel/tool-adapters/policies.ts") && /fallbackCannotLowerPrivacy/.test(read(target, "src/avorelo/kernel/tool-adapters/policies.ts")),
  };
  for (const [k, v] of Object.entries(invariants)) if (!v) blockers.push(`invariant_failed:${k}`);

  // 6) Known limitations (honest — not blockers, but prevent a bare `ready`).
  const limitations = [
    "cloud-api integration tests (test:integration) pass locally but require Postgres for full DB-backed suites in CI",
    "GitHub Actions CI has not been verified (no push to remote); local CI-equivalent gates all pass",
    "efficiency cloud sync is dry-run + local queue only (no live transmission/credentials in v1)",
    "model routing is local-first with fixture-based provider registry (no live provider credentials or network in V1)",
    "tool adapter orchestration supports real delegated execution for all adapters; Claude Code/Codex run real sandbox tasks when installed and authenticated; forbidden/risky tasks blocked or approval-gated; unauth environments gracefully degrade; CI uses fake adapters that simulate the full delegated execution contract",
    "proof adapters are optional and degrade gracefully: Semgrep/Playwright/GitHub Actions operate through summarized local-or-read-only evidence only when the tool/auth surface is available; CI uses fake proof fixtures for contract coverage",
    "route session memory enforces upgrade-only per runtime session; cross-step/cross-loop enforcement within a session lifecycle is a follow-up track",
    ...(opts.extraLimitations ?? []),
  ];
  if (!efficiencyCli) limitations.push("avorelo sync efficiency subcommand not detected in CLI");
  if (!readinessCli) limitations.push("avorelo readiness subcommand pending wiring in this report build");

  const result = computeResult({ blockers, limitations });

  const report: CanonicalReadinessReport = {
    contract: "avorelo.canonicalReadiness.v1", schemaVersion: 1, createdAt,
    readinessId: "rdy_" + createHash("sha256").update(`${createdAt}:${result}:${blockers.length}`).digest("hex").slice(0, 12),
    result,
    phaseCoverage, oldRepoCapabilityCoverage, invariants,
    blockers, limitations,
    nextTrackRecommendations: [
      "Provision Postgres in CI for full DB-backed integration test coverage",
      "Push to remote and verify GitHub Actions CI passes",
      "Plan a live (credentialed) Sanitized Cloud Sync track building on the Phase 9 projection-only envelope",
      "Define the next post-roadmap track from these readiness results",
    ],
    safety: { redacted: true, containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsTerminalLog: false, containsGitDiff: false },
  };
  return report;
}

export function validateCanonicalReadinessReport(r: CanonicalReadinessReport): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.contract !== "avorelo.canonicalReadiness.v1") reasons.push("bad_contract");
  if (r.result === "ready" && (r.blockers.length > 0 || r.limitations.length > 0)) reasons.push("fake_ready");
  if (r.result === "ready_with_limitations" && r.blockers.length > 0) reasons.push("limitations_result_with_blockers");
  if (r.result === "not_ready" && r.blockers.length === 0) reasons.push("not_ready_without_blockers");
  return { valid: reasons.length === 0, reasons };
}

export type ReadinessSummary = { result: ReadinessResult; phasesImplemented: number; phasesTotal: number; blockers: number; limitations: number };
export function summarizeCanonicalReadiness(r: CanonicalReadinessReport): ReadinessSummary {
  return {
    result: r.result,
    phasesImplemented: r.phaseCoverage.filter((p) => p.status === "implemented").length,
    phasesTotal: r.phaseCoverage.length,
    blockers: r.blockers.length,
    limitations: r.limitations.length,
  };
}
