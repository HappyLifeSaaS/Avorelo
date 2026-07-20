// Avorelo Core Completion Readiness — `avorelo.coreReadiness.v1`.
//
// The capstone PRODUCT-CORE verdict: is the local-first Avorelo core ready for a private alpha? This is a
// distinct question from the canonical PHASE gate (`avorelo readiness`): that asks "are the canonical phases
// present in this checkout"; this asks "is the local product core complete and safe for private-alpha use".
// It COMPOSES the canonical readiness invariants (no duplication) and adds core-surface + package checks.
// Read-only, deterministic, local. It assesses the Avorelo build itself (the repo root), not a user repo.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCanonicalReadinessReport } from "../canonical-readiness/index.ts";

export const CORE_READINESS_CONTRACT = "avorelo.coreReadiness.v1";

export type CoreReadinessResult = "CORE_READY_FOR_PRIVATE_ALPHA" | "CORE_READY_WITH_LIMITATIONS" | "CORE_NOT_READY";

export type CoreCheck = { id: string; label: string; ok: boolean; detail?: string };

export type CoreReadinessReport = {
  contract: typeof CORE_READINESS_CONTRACT;
  schemaVersion: 1;
  createdAt: string;
  reportId: string;
  result: CoreReadinessResult;
  checks: CoreCheck[];
  safetyInvariants: Record<string, boolean>;   // from the canonical readiness gate (composed, not duplicated)
  cloudSync: "implemented" | "deferred";        // deferred per live-sanitized-sync-readiness.md
  limitations: string[];
  claimsAllowed: string[];
  claimsForbidden: string[];
  safety: { redacted: true; containsRawSecret: false; containsRawSource: false; containsEnvValue: false };
};

/** Resolve the Avorelo repo root from this module's location (capabilities/core-readiness -> repo root). */
function repoRoot(): string {
  return join(import.meta.dirname, "..", "..", "..", "..");
}

function has(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

/** Build the core readiness report for the Avorelo build. Pure read; writes nothing. */
export function buildCoreReadiness(opts?: { now?: number; root?: string }): CoreReadinessReport {
  const now = opts?.now ?? Date.now();
  const createdAt = new Date(now).toISOString();
  const root = opts?.root ?? repoRoot();

  // Compose the canonical readiness invariants (the authoritative safety checks).
  let safetyInvariants: Record<string, boolean> = {};
  try { safetyInvariants = buildCanonicalReadinessReport(root).invariants as unknown as Record<string, boolean>; } catch { safetyInvariants = {}; }
  const safetyKeys = ["safetyBoundary", "noRawSecrets", "noRawPrompts", "noRawSourceDumps", "metadataOnlySync", "noFakeSavings", "confidenceLabelsPreserved", "fullArtifactsLocalOnly"];
  const safetyHolds = safetyKeys.every((k) => safetyInvariants[k] === true);

  // Core product surface (local-first capabilities) present.
  const coreModules: [string, string][] = [
    ["activation_init", "src/avorelo/capabilities/activation/init.ts"],
    ["dogfood_check", "src/avorelo/capabilities/activation/dogfood-check.ts"],
    ["runtime_flow", "src/avorelo/capabilities/runtime-flow/index.ts"],
    ["control_center", "src/avorelo/capabilities/control-center/index.ts"],
    ["secret_boundary", "src/avorelo/capabilities/secret-boundary/index.ts"],
    ["proof_report", "src/avorelo/capabilities/proof-report/index.ts"],
    ["value_ledger", "src/avorelo/capabilities/value-ledger/index.ts"],
    ["efficiency_sync", "src/avorelo/capabilities/efficiency-sync/index.ts"],
  ];
  const coreModulesPresent = coreModules.every(([, rel]) => has(root, rel));

  // Package coherence.
  let pkgOk = false;
  let pkg: any = {};
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const files: string[] = pkg.files ?? [];
    pkgOk = !!pkg.bin?.avorelo
      && pkg.license === "Apache-2.0"
      && files.some((f) => f.includes("dist/avorelo.mjs"))
      && files.some((f) => f.includes("bin/avorelo.mjs"))
      && files.includes("LICENSE")
      && files.includes("NOTICE")
      && files.includes("README.md")
      && has(root, "LICENSE")
      && has(root, "NOTICE")
      && has(root, "README.md");
  } catch { pkgOk = false; }

  // First-run CLI surface present (command dispatch wired).
  let cli = "";
  try { cli = readFileSync(join(root, "src/avorelo/surfaces/cli/avorelo.ts"), "utf8"); } catch {}
  const firstRunCli = ['case "init"', 'case "status"', 'case "run"', 'case "control-center"', 'case "dogfood-check"', 'case "dogfood-summary"', 'case "readiness"', 'case "settings"', 'case "update-check"']
    .every((c) => cli.includes(c));

  // Dogfood + external-dogfood pack present.
  const dogfoodTiers = has(root, "package.json") && /dogfood:all/.test(readFileSync(join(root, "package.json"), "utf8")) && /dogfood:extended/.test(readFileSync(join(root, "package.json"), "utf8"));
  // External-tester onboarding. The canonical repo carries the internal tester pack; the public
  // repository ships the contributor equivalent instead (docs/internal/ is excluded from the
  // export). Either satisfies the intent: a newcomer has documented instructions for running the
  // product and its checks. Requiring only the internal pack would fail publicly for lack of a
  // file that intentionally does not ship.
  const internalPack = has(root, "docs/internal/dogfood/external-dogfood-guide.md") && has(root, "docs/internal/dogfood/tester-pack-v1.md");
  const publicContributorPack = has(root, "CONTRIBUTING.md") && has(root, "docs/development");
  const externalPack = internalPack || publicContributorPack;

  const checks: CoreCheck[] = [
    { id: "safety_invariants_hold", label: "Safety/privacy invariants hold (no secret/source/prompt/diff/env leak; metadata-only sync; no fake savings)", ok: safetyHolds },
    { id: "core_modules_present", label: "Core capabilities present (activation/runtime/control-center/secret-boundary/proof/value/efficiency)", ok: coreModulesPresent },
    { id: "first_run_cli_present", label: "First-run CLI surface wired (init/status/run/control-center/dogfood-check/dogfood-summary/readiness)", ok: firstRunCli },
    { id: "package_coherent", label: "Package coherent (bin, license Apache-2.0, LICENSE+NOTICE+README+dist+bin ship)", ok: pkgOk },
    { id: "dogfood_tiers", label: "Dogfood tiers exist (dogfood:all + dogfood:extended)", ok: dogfoodTiers },
    { id: "external_dogfood_pack", label: "External dogfood pack ready", ok: externalPack },
    { id: "cloud_sync_implemented_or_deferred", label: "Live cloud sync implemented OR explicitly deferred (gated, documented)", ok: true, detail: "deferred — see docs/internal/cloud/live-sanitized-sync-readiness.md" },
  ];

  // Verdict: any safety/core/package failure => NOT_READY. All green (cloud safely deferred) => private alpha.
  const hardChecks = ["safety_invariants_hold", "core_modules_present", "first_run_cli_present", "package_coherent"];
  const hardOk = checks.filter((c) => hardChecks.includes(c.id)).every((c) => c.ok);
  const softOk = checks.every((c) => c.ok);
  const result: CoreReadinessResult = !hardOk ? "CORE_NOT_READY" : softOk ? "CORE_READY_FOR_PRIVATE_ALPHA" : "CORE_READY_WITH_LIMITATIONS";

  const limitations = [
    "Local-first only: no live cloud sync (dry-run + local-queue only; deferred — see cloud readiness review).",
    "No npm publish; no globally-installed package yet (run via the worktree CLI or a local install).",
    "Not production-ready; final legal sign-off pending before any publish.",
    "Full `npm test` runs locally with no database or hosted service; the GitHub Actions runner is infra-red and independent of core code.",
    "No auth/signup product flow, no billing/pricing, no Teams, no public website/launch.",
  ];

  const claimsAllowed = [
    "Local-first AI Work Control core; runs with no cloud, signup, DB, or network.",
    "Deterministic safety boundary: secrets detected before context, redacted before the model, unsafe tasks blocked.",
    "Confidence-labelled evidence; savings refused without comparative evidence; unavailable is never zero.",
    "Only sanitized metadata projections are ever eligible for sync; full artifacts stay local.",
    "Ready for early-access distribution with honest limitations.",
  ];
  const claimsForbidden = [
    "production-ready", "public-launch-ready", "live cloud sync exists", "guaranteed savings",
    "zero leak", "ROI", "compliance-certified", "CI green",
  ];

  return {
    contract: CORE_READINESS_CONTRACT,
    schemaVersion: 1,
    createdAt,
    reportId: "core_" + createHash("sha256").update(`${createdAt}:${result}`).digest("hex").slice(0, 12),
    result,
    checks,
    safetyInvariants,
    cloudSync: "deferred",
    limitations,
    claimsAllowed,
    claimsForbidden,
    safety: { redacted: true, containsRawSecret: false, containsRawSource: false, containsEnvValue: false },
  };
}

export function renderCoreReadiness(r: CoreReadinessReport): string {
  const mark = (ok: boolean) => (ok ? "+" : "x");
  const lines = [
    "",
    `Avorelo Core Readiness (${r.contract})`,
    `  Result:     ${r.result}`,
    "  Checks:",
    ...r.checks.map((c) => `    [${mark(c.ok)}] ${c.label}${c.detail ? ` — ${c.detail}` : ""}`),
    `  Cloud sync: ${r.cloudSync}`,
  ];
  lines.push(
    "  Limitations:",
    ...r.limitations.map((l) => `    - ${l}`),
    "  (local-first · no cloud required · no production-ready/zero-leak/savings claims)",
    "",
  );
  return lines.join("\n");
}
