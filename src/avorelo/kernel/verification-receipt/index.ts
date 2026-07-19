import { createHash, randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProofContract } from "../proof-contract/index.ts";
import type { ProofRunResult } from "../proof-adapters/index.ts";
import type { GateResult } from "../evidence-gate/index.ts";

export interface VerificationReceipt {
  id: string;
  timestamp: string;
  projectRootHash: string;
  workType: string;
  safeToClose: boolean;
  overallStatus: "safe" | "blocked" | "needs_review";
  proofSummary: {
    adaptersRun: string[];
    satisfiedCount: number;
    totalRequired: number;
    totalDuration: number;
    blockingReasons: string[];
    warnings: string[];
  };
  closureRules: string[];
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  contentStored: false;
}

export function createVerificationReceipt(
  projectRoot: string,
  contract: ProofContract,
  proofRun: ProofRunResult,
  gate: GateResult,
): VerificationReceipt {
  return {
    id: `vr_${randomUUID().slice(0, 12)}`,
    timestamp: new Date().toISOString(),
    projectRootHash: createHash("sha256").update(projectRoot).digest("hex"),
    workType: contract.workType,
    safeToClose: gate.safeToClose,
    overallStatus: gate.overallStatus,
    proofSummary: {
      adaptersRun: proofRun.results.map(r => r.adapterId),
      satisfiedCount: gate.satisfiedCount,
      totalRequired: gate.totalRequired,
      totalDuration: proofRun.totalDuration,
      blockingReasons: gate.blockingReasons.map(r => r.slice(0, 200)),
      warnings: gate.warnings.map(w => w.slice(0, 200)),
    },
    closureRules: contract.closureRules,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    contentStored: false,
  };
}

const MAX_RECEIPTS = 100;

export function storeVerificationReceipt(receipt: VerificationReceipt, projectRoot: string): string {
  const dir = join(projectRoot, ".avorelo", "verification-receipts");
  mkdirSync(dir, { recursive: true });

  const filename = `receipt-${receipt.timestamp.replace(/[:.]/g, "-")}.json`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");

  pruneOldReceipts(dir);

  return filePath;
}

function pruneOldReceipts(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith("receipt-") && f.endsWith(".json"))
      .sort();
    while (files.length > MAX_RECEIPTS) {
      const oldest = files.shift();
      if (oldest) unlinkSync(join(dir, oldest));
    }
  } catch {
    // skip
  }
}

export function loadLatestVerificationReceipt(projectRoot: string): VerificationReceipt | null {
  const dir = join(projectRoot, ".avorelo", "verification-receipts");
  if (!existsSync(dir)) return null;

  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith("receipt-") && f.endsWith(".json"))
      .sort();
    if (files.length === 0) return null;
    const latest = files[files.length - 1];
    return JSON.parse(readFileSync(join(dir, latest), "utf-8"));
  } catch {
    return null;
  }
}

export function loadAllVerificationReceipts(projectRoot: string): VerificationReceipt[] {
  const dir = join(projectRoot, ".avorelo", "verification-receipts");
  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter(f => f.startsWith("receipt-") && f.endsWith(".json"))
      .sort()
      .map(f => JSON.parse(readFileSync(join(dir, f), "utf-8")));
  } catch {
    return [];
  }
}

export function renderVerificationReceipt(receipt: VerificationReceipt): string {
  const lines = [
    `Verification Receipt: ${receipt.id}`,
    `Work type: ${receipt.workType}`,
    `Status: ${receipt.overallStatus}`,
    `Safe to close: ${receipt.safeToClose ? "YES" : "NO"}`,
    `Proof: ${receipt.proofSummary.satisfiedCount}/${receipt.proofSummary.totalRequired} satisfied`,
    `Duration: ${receipt.proofSummary.totalDuration}ms`,
    `Adapters: ${receipt.proofSummary.adaptersRun.join(", ")}`,
  ];

  if (receipt.proofSummary.blockingReasons.length > 0) {
    lines.push("");
    lines.push("Blocking:");
    for (const r of receipt.proofSummary.blockingReasons) {
      lines.push(`  !! ${r}`);
    }
  }

  if (receipt.proofSummary.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of receipt.proofSummary.warnings) {
      lines.push(`  -- ${w}`);
    }
  }

  lines.push("");
  lines.push("Privacy invariants:");
  lines.push(`  containsRawPrompt: ${receipt.containsRawPrompt}`);
  lines.push(`  containsRawSource: ${receipt.containsRawSource}`);
  lines.push(`  containsRawSecret: ${receipt.containsRawSecret}`);
  lines.push(`  contentStored: ${receipt.contentStored}`);

  return lines.join("\n");
}
