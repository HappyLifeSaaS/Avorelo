// Avorelo managed block system. Idempotent upsert/remove of Avorelo-owned content
// within user-controlled instruction files. User content outside markers is never touched.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export type ManagedBlockResult = {
  action: "created" | "updated" | "unchanged" | "removed" | "not_found" | "blocked";
  reason?: string;
  userEditDetected?: boolean;
};

function markers(blockId: string): { start: string; end: string } {
  return {
    start: `<!-- AVORELO:BEGIN ${blockId} -->`,
    end: `<!-- AVORELO:END ${blockId} -->`,
  };
}

function checksumOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function hasManagedBlock(filePath: string, blockId: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf8");
  const m = markers(blockId);
  return content.includes(m.start) && content.includes(m.end);
}

export function readManagedBlock(filePath: string, blockId: string): string | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8");
  const m = markers(blockId);
  const startIdx = content.indexOf(m.start);
  const endIdx = content.indexOf(m.end);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return null;
  return content.slice(startIdx + m.start.length, endIdx).trim();
}

export function detectUserEdits(filePath: string, blockId: string, expectedContent: string): boolean {
  const existing = readManagedBlock(filePath, blockId);
  if (existing === null) return false;
  return checksumOf(existing) !== checksumOf(expectedContent);
}

export function updateManagedBlock(filePath: string, blockId: string, content: string): ManagedBlockResult {
  const m = markers(blockId);
  const block = `${m.start}\n${content}\n${m.end}`;
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      return { action: "blocked", reason: `Cannot create directory: ${(e as Error).message}` };
    }
  }

  if (!existsSync(filePath)) {
    try {
      writeFileSync(filePath, block + "\n");
      return { action: "created" };
    } catch (e) {
      return { action: "blocked", reason: (e as Error).message };
    }
  }

  const existing = readFileSync(filePath, "utf8");
  const startIdx = existing.indexOf(m.start);
  const endIdx = existing.indexOf(m.end);

  if (startIdx >= 0 && endIdx >= 0 && endIdx > startIdx) {
    const oldBlock = existing.slice(startIdx, endIdx + m.end.length);
    if (oldBlock === block) return { action: "unchanged" };

    const oldInner = existing.slice(startIdx + m.start.length, endIdx).trim();
    const userEdited = checksumOf(oldInner) !== checksumOf(content) && oldInner !== content;

    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + m.end.length);
    try {
      writeFileSync(filePath, before + block + after);
      return { action: "updated", reason: "Block refreshed", userEditDetected: userEdited };
    } catch (e) {
      return { action: "blocked", reason: (e as Error).message };
    }
  }

  try {
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(filePath, existing + separator + block + "\n");
    return { action: "created", reason: "Block appended to existing file" };
  } catch (e) {
    return { action: "blocked", reason: (e as Error).message };
  }
}

export function removeManagedBlock(filePath: string, blockId: string): ManagedBlockResult {
  if (!existsSync(filePath)) return { action: "not_found" };

  const content = readFileSync(filePath, "utf8");
  const m = markers(blockId);
  const startIdx = content.indexOf(m.start);
  const endIdx = content.indexOf(m.end);

  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return { action: "not_found" };

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + m.end.length);
  const cleaned = (before + after).replace(/\n{3,}/g, "\n\n").trim();

  try {
    if (cleaned.length === 0) {
      writeFileSync(filePath, "");
    } else {
      writeFileSync(filePath, cleaned + "\n");
    }
    return { action: "removed" };
  } catch (e) {
    return { action: "blocked", reason: (e as Error).message };
  }
}
