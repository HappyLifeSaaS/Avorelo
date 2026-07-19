// Avorelo Cursor adapter. Instruction-only control via .cursor/rules/avorelo.mdc.

import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AdapterDetection, AdapterInstallResult, AdapterUninstallResult, AdapterValidation } from "../adapter-interface.ts";

const RULE_PATH = ".cursor/rules/avorelo.mdc";

function buildRuleContent(guidance?: string): string {
  const lines = [
    "---",
    "description: Avorelo AI Work Control",
    "globs: ['**/*']",
    "alwaysApply: true",
    "---",
    "",
    "This project uses Avorelo for AI work control.",
    "Check `npx avorelo status` before starting work.",
    "Do not claim production readiness without Avorelo receipts.",
  ];
  if (guidance) {
    lines.push("", guidance);
  }
  return lines.join("\n") + "\n";
}

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  displayName: "Cursor",
  controlTier: "instruction-only",
  canInjectCorrection: true,
  canBlockAction: false,

  detect(dir: string): AdapterDetection {
    const signals: string[] = [];
    const cursorDir = join(dir, ".cursor");
    const cursorrules = join(dir, ".cursorrules");
    if (existsSync(cursorDir)) signals.push(".cursor/ directory found");
    if (existsSync(cursorrules)) signals.push(".cursorrules file found");
    return {
      detected: signals.length > 0,
      signals,
      instructionSurface: signals.length > 0 ? join(dir, RULE_PATH) : null,
    };
  },

  install(dir: string, guidance?: string): AdapterInstallResult {
    const rulePath = join(dir, RULE_PATH);
    const rulesDir = join(dir, ".cursor", "rules");
    const warnings: string[] = [];

    if (!existsSync(join(dir, ".cursor"))) {
      return { installed: false, surfaces: [], warnings: ["Cursor not detected — skipping"] };
    }

    try {
      if (!existsSync(rulesDir)) mkdirSync(rulesDir, { recursive: true });
      writeFileSync(rulePath, buildRuleContent(guidance));
      return { installed: true, surfaces: [rulePath], warnings };
    } catch (e) {
      return { installed: false, surfaces: [], warnings: [(e as Error).message] };
    }
  },

  uninstall(dir: string): AdapterUninstallResult {
    const rulePath = join(dir, RULE_PATH);
    if (existsSync(rulePath)) {
      try {
        const content = readFileSync(rulePath, "utf8");
        if (content.includes("Avorelo")) {
          unlinkSync(rulePath);
          return { removed: [rulePath], preserved: [] };
        }
        return { removed: [], preserved: [rulePath] };
      } catch {
        return { removed: [], preserved: [rulePath] };
      }
    }
    return { removed: [], preserved: [] };
  },

  validate(dir: string): AdapterValidation {
    const rulePath = join(dir, RULE_PATH);
    if (!existsSync(rulePath)) return { valid: false, issues: ["Rule file not found"] };
    const content = readFileSync(rulePath, "utf8");
    if (!content.includes("Avorelo")) return { valid: false, issues: ["Rule file missing Avorelo content"] };
    return { valid: true, issues: [] };
  },

  getInstructionSurface(dir: string): string | null {
    const rulePath = join(dir, RULE_PATH);
    return existsSync(join(dir, ".cursor")) ? rulePath : null;
  },
};
