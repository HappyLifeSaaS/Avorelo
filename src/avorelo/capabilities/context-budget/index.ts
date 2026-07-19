// Avorelo Context Budget Engine (Slice 4.5). Deterministic context cost attribution.
// THE ONE RULE: owns no policy/evidence/receipt truth. Produces context driver analysis
// that the kernel consumes. Every savings/value claim carries a measurement confidence label.

import type { ContextDriver, ContextCostCategory, MeasurementConfidence } from "../../shared/schemas/index.ts";

export type ContextBudgetInput = {
  drivers: ContextDriver[];
  maxBudget?: number; // optional ceiling; if exceeded, low-value drivers are deferred
};

export type ContextBudgetResult = {
  totalDrivers: number;
  used: number;
  loadedUnused: number;
  deferred: number;
  blocked: number;
  costSummary: { low: number; medium: number; high: number };
  deferredNextRun: string[]; // driverIds to defer
  recommendations: string[];
  measurementConfidence: MeasurementConfidence;
};

const COST_WEIGHT: Record<ContextCostCategory, number> = { low: 1, medium: 3, high: 7 };

/**
 * Evaluate context drivers and produce a budget analysis.
 * Deterministic given the same inputs. No LLM. No network.
 */
export function evaluateContextBudget(input: ContextBudgetInput): ContextBudgetResult {
  const drivers = input.drivers;
  const used = drivers.filter(d => d.usefulness === "used").length;
  const loadedUnused = drivers.filter(d => d.usefulness === "loaded_unused").length;
  const deferred = drivers.filter(d => d.usefulness === "deferred").length;
  const blocked = drivers.filter(d => d.usefulness === "blocked").length;

  const costSummary = {
    low: drivers.filter(d => d.contextCostCategory === "low").length,
    medium: drivers.filter(d => d.contextCostCategory === "medium").length,
    high: drivers.filter(d => d.contextCostCategory === "high").length,
  };

  // Identify drivers to defer next run: high-cost + loaded_unused
  const deferCandidates = drivers
    .filter(d => d.usefulness === "loaded_unused" && d.contextCostCategory !== "low")
    .map(d => d.driverId);

  const recommendations: string[] = [];
  if (loadedUnused > 0) {
    recommendations.push(`${loadedUnused} context driver(s) loaded but unused — consider deferring next run`);
  }
  if (costSummary.high > 0 && loadedUnused > 0) {
    recommendations.push(`${deferCandidates.length} high/medium-cost driver(s) loaded unused — will defer`);
  }

  // Determine overall measurement confidence: lowest among all drivers
  const confidences: MeasurementConfidence[] = drivers.map(d => d.measurementConfidence);
  const CONF_RANK: Record<MeasurementConfidence, number> = { measured: 3, estimated: 2, inferred: 1, unverified: 0 };
  const lowestConf = confidences.length > 0
    ? confidences.reduce((a, b) => CONF_RANK[a] < CONF_RANK[b] ? a : b)
    : "unverified";

  return {
    totalDrivers: drivers.length,
    used,
    loadedUnused,
    deferred,
    blocked,
    costSummary,
    deferredNextRun: deferCandidates,
    recommendations,
    measurementConfidence: lowestConf,
  };
}
