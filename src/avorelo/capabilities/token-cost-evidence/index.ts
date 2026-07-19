// Avorelo Token & Cost Evidence v1 (Phase 6, Layer 4 — evidence only). Deterministic, local-first, redacted.
// A proof-grade token/cost measurement substrate. NOT a savings report, NOT a value ledger, NOT a pricing
// engine, NOT provider billing. Reuses Phase-1 EvidenceConfidence + receipt validation + redaction policy +
// cloud-eligibility. Hard rule: unavailable != zero != pass != savings. canUseForSavingsClaim is ALWAYS false.

import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { redactString } from "../secret-boundary/redactor.ts";
import { classifyPayload } from "../../shared/redaction/policy.ts";
import { validateReceiptSafety } from "../../kernel/receipts/validation.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import type {
  TokenCostEvidence,
  TokenCostEvidenceImport,
  TokenCostEvidenceSyncMetadata,
  TokenCostSummary,
  TokenCostScope,
  TokenCostSource,
  CostSource,
  EvidenceConfidence,
} from "../../shared/schemas/index.ts";

// Import keys that must NEVER cross the boundary — raw content. Rejection reports the KEY only, never value.
// NOTE: bare "source" is an ALLOWED metadata field (the evidence source). Only raw-content keys are forbidden.
const FORBIDDEN_IMPORT_KEYS = [
  "prompt", "completion", "transcript", "messages", "sourcecode", "source_code", "sourcedump",
  "diff", "gitdiff", "git_diff", "env", "envvalue", "secret", "terminallog", "terminal_log",
  "stdout", "stderr", "rawtooloutput", "raw_tool_output", "rawoutput",
];

function nowIso(createdAt?: string): string {
  return createdAt ?? new Date().toISOString();
}

function freshId(seed: string): string {
  return "tce_" + createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

function cleanSafety(): TokenCostEvidence["safety"] {
  return {
    redacted: true,
    containsRawPrompt: false, containsRawTranscript: false, containsRawSource: false,
    containsRawSecret: false, containsEnvValue: false, containsTerminalLog: false, containsGitDiff: false,
  };
}

function defaultLabels(canSummary: boolean, canTrend: boolean, canBilling: boolean): TokenCostEvidence["labels"] {
  return { canUseForSavingsClaim: false, canUseForCostSummary: canSummary, canUseForTrend: canTrend, canUseForExactBilling: canBilling };
}

// A token count must be a non-negative integer or null. Rejects NaN/Infinity/negative/non-integer.
function normToken(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) throw new Error("invalid_token_value");
  return v;
}

function normCostAmount(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error("invalid_cost_amount");
  return v;
}

// ---------- Builders ----------

export function createUnavailableTokenCostEvidence(reason: string, scope: TokenCostScope = "unknown"): TokenCostEvidence {
  const createdAt = nowIso();
  return {
    contract: "avorelo.tokenCostEvidence.v1", schemaVersion: 1, createdAt,
    evidenceId: freshId(`unavailable:${scope}:${reason}:${createdAt}`),
    source: "unavailable", confidence: "unavailable", scope,
    tokens: { inputTokens: null, outputTokens: null, totalTokens: null, confidence: "unavailable", unavailableReason: reason || "evidence_unavailable" },
    cost: { amount: null, currency: null, confidence: "unavailable", source: "unavailable", unavailableReason: reason || "evidence_unavailable" },
    safety: cleanSafety(),
    labels: defaultLabels(false, false, false),
  };
}

export type MeasuredInput = {
  scope: TokenCostScope;
  inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null;
  cacheReadTokens?: number | null; cacheWriteTokens?: number | null; reasoningTokens?: number | null;
  costAmount?: number | null; currency?: string | null; costSource?: CostSource;
  provider?: string; modelName?: string; relatedIds?: TokenCostEvidence["relatedIds"]; createdAt?: string; notes?: string[];
};

function buildNumeric(source: TokenCostSource, confidence: EvidenceConfidence, input: MeasuredInput): TokenCostEvidence {
  const createdAt = nowIso(input.createdAt);
  const inputTokens = normToken(input.inputTokens);
  const outputTokens = normToken(input.outputTokens);
  let totalTokens = normToken(input.totalTokens);
  if (totalTokens === null && (inputTokens !== null || outputTokens !== null)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }
  // measured/imported require at least one token value present.
  if ((confidence === "measured" || confidence === "imported") && inputTokens === null && outputTokens === null && totalTokens === null) {
    throw new Error("measured_evidence_requires_token_values");
  }
  const costAmount = normCostAmount(input.costAmount);
  const currency = input.currency ?? null;
  if (costAmount !== null && (currency === null || currency === "")) throw new Error("cost_amount_requires_currency");
  if ((currency !== null && currency !== "") && costAmount === null) throw new Error("currency_requires_cost_amount");
  const costConfidence: EvidenceConfidence = costAmount === null ? "unavailable" : confidence;
  const costSource: CostSource = costAmount === null ? "unavailable" : (input.costSource ?? (confidence === "measured" ? "measured" : confidence === "imported" ? "imported" : "configured_rate_estimate"));

  const canSummary = confidence === "measured" || confidence === "imported";
  const canBilling = costAmount !== null && (costSource === "measured" || costSource === "imported");

  return {
    contract: "avorelo.tokenCostEvidence.v1", schemaVersion: 1, createdAt,
    evidenceId: freshId(`${source}:${input.scope}:${createdAt}:${inputTokens}:${outputTokens}`),
    source, confidence, scope: input.scope,
    relatedIds: input.relatedIds,
    model: input.provider || input.modelName ? { provider: input.provider, modelName: input.modelName, sourceConfidence: confidence } : undefined,
    tokens: {
      inputTokens, outputTokens, totalTokens,
      cacheReadTokens: normToken(input.cacheReadTokens), cacheWriteTokens: normToken(input.cacheWriteTokens), reasoningTokens: normToken(input.reasoningTokens),
      confidence,
    },
    cost: { amount: costAmount, currency, confidence: costConfidence, source: costSource },
    safety: cleanSafety(),
    labels: defaultLabels(canSummary, canSummary, canBilling),
    notes: input.notes?.map((n) => redactString(n, "handoff", "tce").redacted),
  };
}

export function createMeasuredTokenCostEvidence(input: MeasuredInput): TokenCostEvidence {
  return buildNumeric("measured_runtime", "measured", input);
}
export function createImportedTokenCostEvidence(input: MeasuredInput & { source?: "imported_provider_usage" | "imported_cli_usage" }): TokenCostEvidence {
  return buildNumeric(input.source ?? "imported_provider_usage", "imported", input);
}
export function createEstimatedTokenCostEvidence(input: MeasuredInput): TokenCostEvidence {
  // Estimated context-budget evidence is NOT measured token usage; it stays labelled estimated.
  const e = buildNumeric("estimated_context_budget", "estimated", { ...input, costSource: input.costAmount != null ? "configured_rate_estimate" : undefined });
  return e;
}
export function createInferredTokenCostEvidence(input: MeasuredInput): TokenCostEvidence {
  return buildNumeric("inferred_from_metadata", "inferred", input);
}

// ---------- Validation ----------

export type ValidationResult = { valid: boolean; reasons: string[] };

export function validateTokenCostEvidence(e: TokenCostEvidence): ValidationResult {
  const reasons: string[] = [];
  if (e.contract !== "avorelo.tokenCostEvidence.v1") reasons.push("bad_contract");
  if (e.labels.canUseForSavingsClaim !== false) reasons.push("savings_claim_forbidden");

  // unavailable must keep values null (never zero).
  if (e.confidence === "unavailable") {
    if (e.tokens.inputTokens !== null || e.tokens.outputTokens !== null || e.tokens.totalTokens !== null) reasons.push("unavailable_with_numeric_tokens");
    if (e.cost.amount !== null) reasons.push("unavailable_with_numeric_cost");
  }
  // measured/imported require token values.
  if ((e.confidence === "measured" || e.confidence === "imported") && e.tokens.inputTokens === null && e.tokens.outputTokens === null && e.tokens.totalTokens === null) {
    reasons.push("measured_without_token_values");
  }
  // numeric sanity
  for (const k of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const) {
    const v = e.tokens[k];
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0 || !Number.isInteger(v))) reasons.push(`invalid_token:${k}`);
  }
  if (e.cost.amount !== null && (!Number.isFinite(e.cost.amount) || e.cost.amount < 0)) reasons.push("invalid_cost_amount");
  if (e.cost.amount !== null && (e.cost.currency === null || e.cost.currency === "")) reasons.push("cost_without_currency");
  if (e.cost.currency !== null && e.cost.currency !== "" && e.cost.amount === null) reasons.push("currency_without_cost");

  // safety: classify ONLY the content-bearing fields. The structural `safety`/`labels` blocks have key names
  // like `containsRawTranscript` that would trip the key-name redaction policy — those are declarations, not
  // content, so they are excluded from the content scan.
  const contentOnly = {
    notes: e.notes ?? [],
    model: e.model ? { provider: e.model.provider, modelName: e.model.modelName } : undefined,
    relatedIds: e.relatedIds,
    tokensUnavailableReason: e.tokens.unavailableReason,
    costUnavailableReason: e.cost.unavailableReason,
    currency: e.cost.currency,
  };
  const c = classifyPayload(contentOnly);
  if (!c.safe) reasons.push(...c.violations.map((v) => `unsafe:${v}`));
  if (e.safety.redacted !== true) reasons.push("not_redacted");

  return { valid: reasons.length === 0, reasons };
}

export function assertTokenCostEvidenceSafe(e: TokenCostEvidence): void {
  const r = validateTokenCostEvidence(e);
  if (!r.valid) throw new Error(`token_cost_evidence_invalid: ${r.reasons.join(",")}`);
}

// ---------- Import (sanitized, local-only) ----------

export type ImportResult = { ok: true; evidence: TokenCostEvidence } | { ok: false; rejectedFields: string[]; reasons: string[] };

/** Parse a sanitized import object. Rejects (without echoing values) if any forbidden raw field is present. */
export function importTokenCostEvidence(raw: unknown): ImportResult {
  if (!raw || typeof raw !== "object") return { ok: false, rejectedFields: [], reasons: ["not_an_object"] };
  const obj = raw as Record<string, unknown>;
  const rejectedFields: string[] = [];
  for (const k of Object.keys(obj)) {
    const nk = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_IMPORT_KEYS.some((f) => nk === f.replace(/[^a-z0-9]/g, ""))) rejectedFields.push(k);
  }
  if (rejectedFields.length > 0) return { ok: false, rejectedFields, reasons: ["forbidden_fields_present"] };

  const imp = obj as TokenCostEvidenceImport;
  const confidence: EvidenceConfidence = imp.confidence ?? "imported";
  try {
    if (confidence === "unavailable") {
      const e = createUnavailableTokenCostEvidence("imported_unavailable", imp.scope ?? "manual_import");
      return { ok: true, evidence: e };
    }
    const common: MeasuredInput = {
      scope: imp.scope ?? "manual_import",
      inputTokens: imp.inputTokens ?? null, outputTokens: imp.outputTokens ?? null, totalTokens: imp.totalTokens ?? null,
      cacheReadTokens: imp.cacheReadTokens ?? null, cacheWriteTokens: imp.cacheWriteTokens ?? null, reasoningTokens: imp.reasoningTokens ?? null,
      costAmount: imp.costAmount ?? null, currency: imp.currency ?? null,
      provider: imp.provider, modelName: imp.modelName, relatedIds: imp.relatedIds, createdAt: imp.createdAt,
    };
    let e: TokenCostEvidence;
    if (confidence === "measured") e = createMeasuredTokenCostEvidence(common);
    else if (confidence === "estimated") e = createEstimatedTokenCostEvidence(common);
    else if (confidence === "inferred") e = createInferredTokenCostEvidence(common);
    else e = createImportedTokenCostEvidence(common);
    const v = validateTokenCostEvidence(e);
    if (!v.valid) return { ok: false, rejectedFields: [], reasons: v.reasons };
    return { ok: true, evidence: e };
  } catch (err) {
    return { ok: false, rejectedFields: [], reasons: [(err as Error).message] };
  }
}

// ---------- Summary ----------

export function summarizeTokenCostEvidence(items: TokenCostEvidence[]): TokenCostSummary {
  const breakdown: Record<EvidenceConfidence, number> = { measured: 0, imported: 0, estimated: 0, inferred: 0, unavailable: 0 };
  let inSum = 0, outSum = 0, totSum = 0, costSum = 0;
  let anyTokens = false, anyCost = false;
  const currencies = new Set<string>();
  const unavailableReasons: string[] = [];

  for (const e of items) {
    breakdown[e.confidence] = (breakdown[e.confidence] ?? 0) + 1;
    if (e.confidence === "unavailable") {
      if (e.tokens.unavailableReason) unavailableReasons.push(e.tokens.unavailableReason);
      continue; // unavailable NEVER contributes zero — it is counted separately, not summed
    }
    if (e.tokens.inputTokens !== null) { inSum += e.tokens.inputTokens; anyTokens = true; }
    if (e.tokens.outputTokens !== null) { outSum += e.tokens.outputTokens; anyTokens = true; }
    if (e.tokens.totalTokens !== null) { totSum += e.tokens.totalTokens; anyTokens = true; }
    if (e.cost.amount !== null) { costSum += e.cost.amount; anyCost = true; if (e.cost.currency) currencies.add(e.cost.currency); }
  }

  const mixedCurrency = currencies.size > 1;
  const measuredCount = breakdown.measured, importedCount = breakdown.imported;
  return {
    totalInputTokens: anyTokens ? inSum : null,
    totalOutputTokens: anyTokens ? outSum : null,
    totalTokens: anyTokens ? totSum : null,
    totalCost: anyCost && !mixedCurrency ? costSum : null, // mixed currency → totalCost null
    currency: !mixedCurrency && currencies.size === 1 ? [...currencies][0] : null,
    mixedCurrency,
    confidenceBreakdown: breakdown,
    measuredCount, importedCount, estimatedCount: breakdown.estimated, inferredCount: breakdown.inferred, unavailableCount: breakdown.unavailable,
    canUseForCostSummary: (measuredCount + importedCount) > 0,
    canUseForSavingsClaim: false,
    unavailableReasons,
  };
}

// ---------- Sync projection ----------

export function buildTokenCostEvidenceSyncMetadata(e: TokenCostEvidence): TokenCostEvidenceSyncMetadata {
  const codes: string[] = [];
  if (e.tokens.unavailableReason) codes.push(e.tokens.unavailableReason);
  if (e.cost.unavailableReason && e.cost.unavailableReason !== e.tokens.unavailableReason) codes.push(e.cost.unavailableReason);
  return {
    contract: "avorelo.tokenCostEvidence.sync.v1",
    evidenceId: e.evidenceId, source: e.source, confidence: e.confidence, scope: e.scope,
    inputTokens: e.tokens.inputTokens, outputTokens: e.tokens.outputTokens, totalTokens: e.tokens.totalTokens,
    costAmount: e.cost.amount, currency: e.cost.currency, costConfidence: e.cost.confidence,
    unavailableReasonCodes: codes,
    redacted: true, createdAt: e.createdAt,
  };
}

export function tokenCostProjectionCloudEligible(e: TokenCostEvidence): boolean {
  return evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: buildTokenCostEvidenceSyncMetadata(e), reasonCodes: ["REDACTED"] }).eligible;
}

// ---------- Persistence (local-first, redacted) ----------

function evidenceDir(dir: string): string { return join(dir, ".avorelo", "evidence"); }

export function writeTokenCostEvidence(dir: string, e: TokenCostEvidence): { path: string; cloudEligible: boolean } {
  assertTokenCostEvidenceSafe(e);
  validateReceiptSafety({ schemaName: e.contract, schemaVersion: String(e.schemaVersion), redacted: true, payload: { notes: e.notes ?? [] }, reasonCodes: ["REDACTED"] });
  const d = evidenceDir(dir);
  mkdirSync(d, { recursive: true });
  const path = join(d, "token-cost.jsonl");
  appendFileSync(path, JSON.stringify(e) + "\n");
  return { path, cloudEligible: tokenCostProjectionCloudEligible(e) };
}

export function loadTokenCostEvidence(dir: string): TokenCostEvidence[] {
  const path = join(evidenceDir(dir), "token-cost.jsonl");
  if (!existsSync(path)) return [];
  const out: TokenCostEvidence[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line) as TokenCostEvidence; if (e.contract === "avorelo.tokenCostEvidence.v1") out.push(e); } catch { /* skip */ }
  }
  return out;
}
