// Avorelo GitHub Copilot adapter. Instruction-only control via .github/copilot-instructions.md.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { updateManagedBlock, removeManagedBlock, hasManagedBlock } from "../../capabilities/instruction-management/managed-blocks.ts";
import type { AgentAdapter, AdapterDetection, AdapterInstallResult, AdapterUninstallResult, AdapterValidation } from "../adapter-interface.ts";

const BLOCK_ID = "copilot-guidance";
const INSTRUCTION_PATH = ".github/copilot-instructions.md";

function buildGuidance(extra?: string): string {
  const lines = [
    "This project uses Avorelo for AI work control.",
    "Check `npx avorelo status` before starting work.",
    "Do not claim production readiness without Avorelo receipts.",
  ];
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

export const copilotAdapter: AgentAdapter = {
  id: "copilot",
  displayName: "GitHub Copilot",
  controlTier: "instruction-only",
  canInjectCorrection: true,
  canBlockAction: false,

  detect(dir: string): AdapterDetection {
    const signals: string[] = [];
    const instrPath = join(dir, INSTRUCTION_PATH);
    const ghDir = join(dir, ".github");
    if (existsSync(instrPath)) signals.push("copilot-instructions.md found");
    else if (existsSync(ghDir)) signals.push(".github/ directory found (Copilot may be used)");
    return {
      detected: signals.length > 0,
      signals,
      instructionSurface: signals.length > 0 ? instrPath : null,
    };
  },

  install(dir: string, guidance?: string): AdapterInstallResult {
    const instrPath = join(dir, INSTRUCTION_PATH);
    const result = updateManagedBlock(instrPath, BLOCK_ID, buildGuidance(guidance));
    if (result.action === "blocked") {
      return { installed: false, surfaces: [], warnings: [result.reason ?? "blocked"] };
    }
    return { installed: true, surfaces: [instrPath], warnings: [] };
  },

  uninstall(dir: string): AdapterUninstallResult {
    const instrPath = join(dir, INSTRUCTION_PATH);
    const result = removeManagedBlock(instrPath, BLOCK_ID);
    if (result.action === "removed") return { removed: [instrPath], preserved: [] };
    return { removed: [], preserved: [] };
  },

  validate(dir: string): AdapterValidation {
    const instrPath = join(dir, INSTRUCTION_PATH);
    if (!hasManagedBlock(instrPath, BLOCK_ID)) {
      return { valid: false, issues: ["Managed block not found in copilot-instructions.md"] };
    }
    return { valid: true, issues: [] };
  },

  getInstructionSurface(dir: string): string | null {
    return join(dir, INSTRUCTION_PATH);
  },
};
