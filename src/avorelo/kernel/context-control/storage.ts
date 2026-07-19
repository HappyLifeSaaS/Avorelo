import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  DiscoveryResult,
  ContextMemoryItem,
  ContextConflict,
  ModeDetectionResult,
  ContextReceipt,
  DashboardContextState,
  WorkMode,
} from "./types.ts";

const MAX_RECEIPTS = 100;

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function storeDiscovery(repoRoot: string, discovery: DiscoveryResult): string {
  const dir = join(repoRoot, ".avorelo", "context");
  ensureDir(dir);
  const filePath = join(dir, "discovery.json");
  writeFileSync(filePath, JSON.stringify(discovery, null, 2), "utf-8");
  return filePath;
}

export function storeItems(repoRoot: string, items: ContextMemoryItem[]): string {
  const dir = join(repoRoot, ".avorelo", "context");
  ensureDir(dir);
  const filePath = join(dir, "items.jsonl");
  const content = items.map((i) => JSON.stringify(i)).join("\n");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function loadItems(repoRoot: string): ContextMemoryItem[] {
  const filePath = join(repoRoot, ".avorelo", "context", "items.jsonl");
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function storeConflicts(repoRoot: string, conflicts: ContextConflict[]): string {
  const dir = join(repoRoot, ".avorelo", "context");
  ensureDir(dir);
  const filePath = join(dir, "conflicts.json");
  writeFileSync(filePath, JSON.stringify({ schemaVersion: "1.0.0", conflicts }, null, 2), "utf-8");
  return filePath;
}

export function loadConflicts(repoRoot: string): ContextConflict[] {
  const filePath = join(repoRoot, ".avorelo", "context", "conflicts.json");
  if (!existsSync(filePath)) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.conflicts ?? [];
  } catch {
    return [];
  }
}

export function storeMode(repoRoot: string, mode: ModeDetectionResult): string {
  const dir = join(repoRoot, ".avorelo", "context");
  ensureDir(dir);
  const filePath = join(dir, "mode.json");
  writeFileSync(filePath, JSON.stringify(mode, null, 2), "utf-8");
  return filePath;
}

export function loadMode(repoRoot: string): ModeDetectionResult | null {
  const filePath = join(repoRoot, ".avorelo", "context", "mode.json");
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function storeBrief(repoRoot: string, markdown: string): { latestPath: string; timestampPath: string } {
  const dir = join(repoRoot, ".avorelo", "work-briefs");
  ensureDir(dir);

  const latestPath = join(dir, "latest.md");
  writeFileSync(latestPath, markdown, "utf-8");

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const timestampPath = join(dir, `${ts}.md`);
  writeFileSync(timestampPath, markdown, "utf-8");

  return { latestPath, timestampPath };
}

export function loadLatestBrief(repoRoot: string): string | null {
  const filePath = join(repoRoot, ".avorelo", "work-briefs", "latest.md");
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function storeContextReceipt(repoRoot: string, receipt: ContextReceipt): string {
  const dir = join(repoRoot, ".avorelo", "receipts", "context");
  ensureDir(dir);

  const ts = receipt.createdAt.replace(/[:.]/g, "-");
  const filePath = join(dir, `${receipt.type}_${ts}.json`);
  writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");

  pruneReceipts(dir);
  return filePath;
}

export function loadLatestContextReceipt(repoRoot: string): ContextReceipt | null {
  const dir = join(repoRoot, ".avorelo", "receipts", "context");
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) return null;
    return JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf-8"));
  } catch {
    return null;
  }
}

export function storeDashboardState(repoRoot: string, state: DashboardContextState): string {
  const dir = join(repoRoot, ".avorelo", "context");
  ensureDir(dir);
  const filePath = join(dir, "state.json");
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return filePath;
}

export function buildDashboardState(
  mode: WorkMode,
  confidence: number,
  latestBriefPath: string | null,
  latestReceiptId: string | null,
  blockers: string[],
  conflicts: string[],
  receiptHistoryEmpty: boolean,
): DashboardContextState {
  return {
    schemaVersion: "1.0.0",
    projectConnected: true,
    workingTruth: {
      mode,
      confidence,
      productionActions: mode === "production_release" ? "owner_only" : "blocked",
      npmPublish: "owner_side_only",
      latestBriefPath,
      latestReceiptId,
      openBlockers: blockers,
      conflicts,
    },
    emptyStates: {
      receiptHistoryEmpty,
      proofPending: latestReceiptId === null,
    },
  };
}

function pruneReceipts(dir: string): void {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    while (files.length > MAX_RECEIPTS) {
      const oldest = files.shift();
      if (oldest) unlinkSync(join(dir, oldest));
    }
  } catch {
    // skip
  }
}
