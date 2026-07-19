// Avorelo Run Entry. Installs marker-managed Avorelo guidance block into
// supported AI instruction surfaces (CLAUDE.md, AGENTS.md, .cursor/rules, etc.).
// Preserves all user content outside markers. Idempotent. Repair-safe.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const MARKER_START = "<!-- >>> Avorelo Run Entry (managed — do not edit between markers) >>> -->";
const MARKER_END = "<!-- <<< Avorelo Run Entry <<< -->";

const RUN_ENTRY_BLOCK = `${MARKER_START}

This project is activated with Avorelo.

Supported AI coding sessions should start by checking Avorelo status, current receipts, and run-entry guidance.

Before edits or pushes, check dirty/collision risk.

Do not claim deploy, publish, production, payment, or cloud sync unless proven by Avorelo receipts.

Use Avorelo validators and dogfood artifacts for proof.

Commands:
- \`npx avorelo status\` — check current activation state
- \`npx avorelo open\` — local receipts dashboard
- \`npx avorelo verify\` — validate activation invariants
- \`npx avorelo doctor\` — health check

${MARKER_END}`;

export type RunEntryAction = {
  path: string;
  action: "created" | "updated" | "unchanged" | "skipped" | "blocked";
  reason?: string;
};

export type RunEntryResult = {
  installed: boolean;
  instructionSurfaces: RunEntryAction[];
  contractPath?: string;
  guardAvailable: boolean;
  preflightAvailable: boolean;
  advisoryMissing: string[];
};

function installBlock(filePath: string, blockContent: string): RunEntryAction {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch {
      return { path: filePath, action: "blocked", reason: "Cannot create directory" };
    }
  }

  if (!existsSync(filePath)) {
    // New file — create with just the block
    try {
      writeFileSync(filePath, blockContent + "\n");
      return { path: filePath, action: "created" };
    } catch (e) {
      return { path: filePath, action: "blocked", reason: (e as Error).message };
    }
  }

  const content = readFileSync(filePath, "utf8");

  // Already has current block
  if (content.includes(MARKER_START) && content.includes(MARKER_END)) {
    // Check if block content is stale
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END) + MARKER_END.length;
    const existingBlock = content.slice(startIdx, endIdx);
    if (existingBlock === blockContent.trim()) {
      return { path: filePath, action: "unchanged" };
    }
    // Update stale block — preserve everything outside markers
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx);
    try {
      writeFileSync(filePath, before + blockContent.trim() + after);
      return { path: filePath, action: "updated", reason: "Stale block refreshed" };
    } catch (e) {
      return { path: filePath, action: "blocked", reason: (e as Error).message };
    }
  }

  // No markers — append block at end, preserving all user content
  try {
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(filePath, content + separator + blockContent + "\n");
    return { path: filePath, action: "updated", reason: "Block appended" };
  } catch (e) {
    return { path: filePath, action: "blocked", reason: (e as Error).message };
  }
}

export function installRunEntry(targetDir: string): RunEntryResult {
  const surfaces: RunEntryAction[] = [];
  const advisory: string[] = [];

  // CLAUDE.md — primary instruction surface for Claude Code
  const claudeMd = join(targetDir, "CLAUDE.md");
  surfaces.push(installBlock(claudeMd, RUN_ENTRY_BLOCK));

  // AGENTS.md — if it exists already, add block; don't create from scratch
  const agentsMd = join(targetDir, "AGENTS.md");
  if (existsSync(agentsMd)) {
    surfaces.push(installBlock(agentsMd, RUN_ENTRY_BLOCK));
  } else {
    surfaces.push({ path: agentsMd, action: "skipped", reason: "AGENTS.md does not exist — not creating" });
    advisory.push("AGENTS.md not present");
  }

  // .cursor/rules — if .cursor dir exists, add a rule file
  const cursorDir = join(targetDir, ".cursor", "rules");
  if (existsSync(join(targetDir, ".cursor"))) {
    const cursorRule = join(cursorDir, "avorelo.mdc");
    // For Cursor rules, use a simpler format
    const cursorBlock = [
      "---",
      "description: Avorelo AI Work Control",
      "globs: ['**/*']",
      "alwaysApply: true",
      "---",
      "",
      "This project is activated with Avorelo.",
      "Check `npx avorelo status` before starting work.",
      "Use Avorelo validators for proof. Do not claim production readiness without receipts.",
    ].join("\n");
    if (!existsSync(cursorRule)) {
      try {
        mkdirSync(cursorDir, { recursive: true });
        writeFileSync(cursorRule, cursorBlock + "\n");
        surfaces.push({ path: cursorRule, action: "created" });
      } catch (e) {
        surfaces.push({ path: cursorRule, action: "blocked", reason: (e as Error).message });
      }
    } else {
      surfaces.push({ path: cursorRule, action: "unchanged", reason: "Already exists" });
    }
  } else {
    advisory.push(".cursor not present");
  }

  // .codex — if exists, skip (don't modify codex config files)
  if (existsSync(join(targetDir, ".codex"))) {
    advisory.push("Codex detected — manual run-entry recommended");
  }

  // Write run-entry contract
  let contractPath: string | undefined;
  const contractDir = join(targetDir, ".avorelo", "run-entry");
  try {
    mkdirSync(contractDir, { recursive: true });
    const cp = join(contractDir, "run-entry.json");
    writeFileSync(cp, JSON.stringify({
      contract: "avorelo.runEntry.v1",
      installedAt: new Date().toISOString(),
      surfaces: surfaces.map(s => ({ path: s.path.replace(targetDir, "."), action: s.action })),
      advisoryMissing: advisory,
      redacted: true,
    }, null, 2));
    contractPath = cp;
  } catch {}

  const installed = surfaces.some(s => s.action === "created" || s.action === "updated" || s.action === "unchanged");

  return {
    installed,
    instructionSurfaces: surfaces,
    contractPath,
    guardAvailable: false, // collision guard not yet implemented
    preflightAvailable: false, // preflight not yet implemented
    advisoryMissing: advisory,
  };
}
