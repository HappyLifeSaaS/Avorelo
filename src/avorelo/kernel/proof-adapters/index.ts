import type { ProofAdapter, AdapterResult } from "./types.ts";
import { buildTestAdapter } from "./build-test.ts";
import { securitySecretsAdapter } from "./security-secrets.ts";
import { productSurfaceAdapter } from "./product-surface.ts";
import { uiBrowserAdapter } from "./ui-browser.ts";
import { apiContractAdapter } from "./api-contract.ts";

export type { ProofAdapter, AdapterResult, AdapterEvidence } from "./types.ts";

export const ALL_ADAPTERS: ProofAdapter[] = [
  buildTestAdapter,
  securitySecretsAdapter,
  productSurfaceAdapter,
  uiBrowserAdapter,
  apiContractAdapter,
];

export function getAdapter(id: string): ProofAdapter | undefined {
  return ALL_ADAPTERS.find(a => a.id === id);
}

export function getAvailableAdapters(dir: string): ProofAdapter[] {
  return ALL_ADAPTERS.filter(a => a.detect(dir));
}

export function getAutomaticAdapters(dir: string): ProofAdapter[] {
  return getAvailableAdapters(dir).filter(a => a.canRunAutomatically());
}

export interface ProofRunResult {
  timestamp: string;
  results: AdapterResult[];
  overallStatus: "pass" | "fail" | "partial";
  totalDuration: number;
  containsRawSecret: false;
}

export async function runAllProof(
  dir: string,
  changedFiles?: string[],
  adapterIds?: string[],
): Promise<ProofRunResult> {
  const start = Date.now();
  const adapters = adapterIds
    ? ALL_ADAPTERS.filter(a => adapterIds.includes(a.id))
    : getAutomaticAdapters(dir);

  const results: AdapterResult[] = [];
  for (const adapter of adapters) {
    const result = await adapter.execute(dir, changedFiles);
    results.push(result);
  }

  const hasFailure = results.some(r => r.status === "fail" || r.status === "error");
  const allPass = results.every(r => r.status === "pass" || r.status === "skip");

  return {
    timestamp: new Date().toISOString(),
    results,
    overallStatus: allPass ? "pass" : hasFailure ? "fail" : "partial",
    totalDuration: Date.now() - start,
    containsRawSecret: false,
  };
}

export function renderProofRun(run: ProofRunResult): string {
  const lines = [
    `Proof Run: ${run.overallStatus.toUpperCase()}`,
    `Duration: ${run.totalDuration}ms`,
    "",
  ];

  for (const r of run.results) {
    const icon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : r.status === "skip" ? "SKIP" : "ERR";
    lines.push(`  [${icon}] ${r.adapterId} (${r.duration}ms)`);
    for (const e of r.evidence) {
      lines.push(`    ${e.passed ? "ok" : "!!"} ${e.summary}`);
    }
    if (r.skipReason) lines.push(`    skip: ${r.skipReason}`);
    if (r.errorMessage) lines.push(`    error: ${r.errorMessage}`);
  }

  return lines.join("\n");
}
