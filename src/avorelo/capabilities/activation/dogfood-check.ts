// Avorelo dogfood-check — `avorelo.dogfoodCheck.v1`.
//
// A tiny, LOCAL-FIRST, READ-ONLY readiness summary for an external dogfood tester: "is my local repo set up,
// did a run happen, is there a report / value / control-center to look at, and what should I do next?"
// It COMPOSES existing read-models (workspace, runtime session, control center) — it owns no truth. It
// collects nothing, uploads nothing, contacts no network, needs no DB/auth, and never exposes source/secrets.

import { loadWorkspace } from "./init.ts";
import { loadLatestRuntimeSession } from "../runtime-flow/index.ts";
import { buildControlCenter } from "../control-center/index.ts";

export const DOGFOOD_CHECK_CONTRACT = "avorelo.dogfoodCheck.v1";

export type DogfoodCheckItem = { id: string; label: string; ok: boolean };

export type DogfoodCheckResult = {
  contract: typeof DOGFOOD_CHECK_CONTRACT;
  schemaVersion: 1;
  target: string;
  initialized: boolean;
  latestRuntimeSession: boolean;
  controlCenterData: boolean;
  reportAvailable: boolean;
  valueCardsAvailable: boolean;
  cloudClaimed: false;
  localOnly: true;
  ready: boolean;                 // initialized AND at least one run happened
  safeNextStep: { command: string; reason: string };
  checks: DogfoodCheckItem[];
  safety: { redacted: true; containsRawSecret: false; containsRawSource: false; containsEnvValue: false };
};

/** Build the read-only dogfood-check summary for `dir`. Pure read; writes/collects/uploads nothing. */
export function buildDogfoodCheck(dir: string, opts?: { now?: number }): DogfoodCheckResult {
  const now = opts?.now ?? Date.now();
  const initialized = !!loadWorkspace(dir);
  const latest = loadLatestRuntimeSession(dir);
  const latestRuntimeSession = !!latest;

  // The control center is itself a read-only projection of local artifacts — reuse it for availability.
  // Gate report/value/control-center on a real run: the proof report always *builds* (even empty), so
  // without this gate a pristine repo would misleadingly show "report available" before anything has run.
  const cc = buildControlCenter(dir, { now });
  const reportAvailable = latestRuntimeSession && cc.sections.proof.status === "available";
  const valueCardsAvailable = latestRuntimeSession && cc.sections.value.status === "available";
  const controlCenterData = latestRuntimeSession && cc.sources.length > 0;

  const safeNextStep = !initialized
    ? { command: `avorelo init --target ${dir}`, reason: "Initialize the local workspace first (no signup)." }
    : !latestRuntimeSession
      ? { command: `avorelo run "run tests" --target ${dir}`, reason: "Run your first focused task." }
      : { command: `avorelo control-center --target ${dir}`, reason: "Review the local control center, then capture feedback." };

  const checks: DogfoodCheckItem[] = [
    { id: "initialized", label: "Local workspace initialized (avorelo init)", ok: initialized },
    { id: "runtime_session", label: "A runtime session exists (avorelo run)", ok: latestRuntimeSession },
    { id: "control_center", label: "Control center has local data", ok: controlCenterData },
    { id: "report", label: "Proof report available", ok: reportAvailable },
    { id: "value_cards", label: "Value cards available", ok: valueCardsAvailable },
    { id: "local_only", label: "Local-only (cloud not claimed)", ok: true },
  ];

  return {
    contract: DOGFOOD_CHECK_CONTRACT,
    schemaVersion: 1,
    target: dir,
    initialized,
    latestRuntimeSession,
    controlCenterData,
    reportAvailable,
    valueCardsAvailable,
    cloudClaimed: false,
    localOnly: true,
    ready: initialized && latestRuntimeSession,
    safeNextStep,
    checks,
    safety: { redacted: true, containsRawSecret: false, containsRawSource: false, containsEnvValue: false },
  };
}

// --- dogfood-summary: a safe, pre-send summary a tester reviews before giving feedback ---

export const DOGFOOD_SUMMARY_CONTRACT = "avorelo.dogfoodSummary.v1";

export type DogfoodSummaryResult = {
  contract: typeof DOGFOOD_SUMMARY_CONTRACT;
  schemaVersion: 1;
  target: string;
  initialized: boolean;
  lastRuntimeStatus: string | null;     // ready / awaiting_approval / blocked / null
  route: string | null;                 // safe routing enum from the latest runtime session
  riskClass: string | null;
  proofTier: string | null;
  dogfoodCheckReady: boolean;
  controlCenterSourceCount: number;
  reportAvailable: boolean;
  valueCardsAvailable: boolean;
  cloudClaimed: false;
  localOnly: true;
  limitations: string[];
  suggestedFeedbackFields: string[];
  safety: { redacted: true; containsRawSecret: false; containsRawSource: false; containsEnvValue: false };
};

/**
 * Build a safe local summary a tester can review before sending feedback. Read-only; composes the
 * dogfood-check, the latest runtime session (safe enums only), and the control center source count.
 * Collects no source/logs/diffs/env/secrets; uploads nothing; needs no network.
 */
export function buildDogfoodSummary(dir: string, opts?: { now?: number }): DogfoodSummaryResult {
  const now = opts?.now ?? Date.now();
  const check = buildDogfoodCheck(dir, { now });
  const latest = loadLatestRuntimeSession(dir);
  const cc = buildControlCenter(dir, { now });
  return {
    contract: DOGFOOD_SUMMARY_CONTRACT,
    schemaVersion: 1,
    target: dir,
    initialized: check.initialized,
    lastRuntimeStatus: latest?.status ?? null,
    route: latest?.route ?? null,
    riskClass: latest?.riskClass ?? null,
    proofTier: latest?.proofTier ?? null,
    dogfoodCheckReady: check.ready,
    controlCenterSourceCount: cc.sources.length,
    reportAvailable: check.reportAvailable,
    valueCardsAvailable: check.valueCardsAvailable,
    cloudClaimed: false,
    localOnly: true,
    limitations: [
      "Local-first alpha; no cloud account, sync, or network.",
      "Not production-ready; published/installed package not available yet.",
    ],
    suggestedFeedbackFields: [
      "First point of confusion (which command?)",
      "First value moment (if any)",
      "Was the .env safety task blocked/redacted?",
      "Anything that felt scary or untrustworthy?",
      "Missing next step after any command?",
      "Would you run it again? why / why not?",
    ],
    safety: { redacted: true, containsRawSecret: false, containsRawSource: false, containsEnvValue: false },
  };
}

/** Plain-text rendering of the pre-send summary. */
export function renderDogfoodSummary(r: DogfoodSummaryResult): string {
  return [
    "Avorelo dogfood-summary (local, read-only — safe to review before sending feedback)",
    `  target:        ${r.target}`,
    `  initialized:   ${r.initialized ? "yes" : "no"}`,
    `  last run:      ${r.lastRuntimeStatus ?? "none"}${r.route ? ` (route=${r.route} risk=${r.riskClass} proof=${r.proofTier})` : ""}`,
    `  ready:         ${r.dogfoodCheckReady ? "yes" : "not yet"}`,
    `  control ctr:   ${r.controlCenterSourceCount} local source(s)`,
    `  report:        ${r.reportAvailable ? "available" : "none"}`,
    `  value cards:   ${r.valueCardsAvailable ? "available" : "none"}`,
    `  cloud:         not claimed (local-only)`,
    "  Suggested feedback to send (sanitized words only — no source/secrets/logs):",
    ...r.suggestedFeedbackFields.map((f) => `    - ${f}`),
    "  (collects nothing · uploads nothing · no network · no secrets/source/logs)",
    "",
  ].join("\n");
}

/** Plain-text rendering for the terminal. */
export function renderDogfoodCheck(r: DogfoodCheckResult): string {
  const mark = (ok: boolean) => (ok ? "+" : "·");
  return [
    "Avorelo dogfood-check (local, read-only)",
    `  target:   ${r.target}`,
    ...r.checks.map((c) => `  [${mark(c.ok)}] ${c.label}`),
    `  ready:    ${r.ready ? "yes" : "not yet"}`,
    `  cloud:    not claimed (local-only)`,
    `  next:     ${r.safeNextStep.command}`,
    `            ${r.safeNextStep.reason}`,
    "  (collects nothing · uploads nothing · no network · no secrets)",
    "",
  ].join("\n");
}
