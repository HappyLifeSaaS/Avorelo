// Avorelo Codex / AGENTS.md adapter. Instruction-only control via AGENTS.md managed block.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { updateManagedBlock, removeManagedBlock, hasManagedBlock } from "../../capabilities/instruction-management/managed-blocks.ts";
import type { AgentAdapter, AdapterDetection, AdapterInstallResult, AdapterUninstallResult, AdapterValidation } from "../adapter-interface.ts";

const BLOCK_ID = "agents-guidance";

function buildGuidance(extra?: string): string {
  const lines = [
    "This project uses Avorelo for AI work control.",
    "Check `npx avorelo status` before starting work.",
    "Do not claim production readiness without Avorelo receipts.",
    "Run existing tests before declaring work complete.",
  ];
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  displayName: "Codex / AGENTS.md",
  controlTier: "instruction-only",
  canInjectCorrection: true,
  canBlockAction: false,

  detect(dir: string): AdapterDetection {
    const signals: string[] = [];
    if (existsSync(join(dir, ".codex"))) signals.push(".codex/ directory found");
    if (existsSync(join(dir, "codex.md"))) signals.push("codex.md found");
    if (existsSync(join(dir, "AGENTS.md"))) signals.push("AGENTS.md found");
    return {
      detected: signals.length > 0,
      signals,
      instructionSurface: join(dir, "AGENTS.md"),
    };
  },

  install(dir: string, guidance?: string): AdapterInstallResult {
    const agentsMd = join(dir, "AGENTS.md");
    const result = updateManagedBlock(agentsMd, BLOCK_ID, buildGuidance(guidance));
    if (result.action === "blocked") {
      return { installed: false, surfaces: [], warnings: [result.reason ?? "blocked"] };
    }
    return { installed: true, surfaces: [agentsMd], warnings: [] };
  },

  uninstall(dir: string): AdapterUninstallResult {
    const agentsMd = join(dir, "AGENTS.md");
    const result = removeManagedBlock(agentsMd, BLOCK_ID);
    if (result.action === "removed") return { removed: [agentsMd], preserved: [] };
    return { removed: [], preserved: [] };
  },

  validate(dir: string): AdapterValidation {
    const agentsMd = join(dir, "AGENTS.md");
    if (!existsSync(agentsMd)) return { valid: false, issues: ["AGENTS.md not found"] };
    if (!hasManagedBlock(agentsMd, BLOCK_ID)) {
      return { valid: false, issues: ["Managed block not found in AGENTS.md"] };
    }
    return { valid: true, issues: [] };
  },

  getInstructionSurface(dir: string): string | null {
    return join(dir, "AGENTS.md");
  },
};
