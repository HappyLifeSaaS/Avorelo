// Avorelo Claude Code adapter — AgentAdapter wrapper around existing hook system.
// Full lifecycle-hooks control tier. Delegates to the existing installHooks/uninstall/validate.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { installHooks, validateInstall, uninstall as uninstallHooks } from "./index.ts";
import { updateManagedBlock, removeManagedBlock, hasManagedBlock } from "../../capabilities/instruction-management/managed-blocks.ts";
import type { AgentAdapter, AdapterDetection, AdapterInstallResult, AdapterUninstallResult, AdapterValidation } from "../adapter-interface.ts";

const BLOCK_ID = "claude-guidance";

function buildGuidance(extra?: string): string {
  const lines = [
    "This project uses Avorelo for AI work control.",
    "Check `npx avorelo status` before starting work.",
    "Do not claim production readiness without Avorelo receipts.",
  ];
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  controlTier: "lifecycle-hooks",
  canInjectCorrection: true,
  canBlockAction: true,

  detect(dir: string): AdapterDetection {
    const signals: string[] = [];
    if (existsSync(join(dir, ".claude"))) signals.push(".claude/ directory found");
    if (existsSync(join(dir, "CLAUDE.md"))) signals.push("CLAUDE.md found");
    return {
      detected: signals.length > 0,
      signals,
      instructionSurface: join(dir, "CLAUDE.md"),
    };
  },

  install(dir: string, guidance?: string): AdapterInstallResult {
    const warnings: string[] = [];
    const surfaces: string[] = [];

    const claudeMd = join(dir, "CLAUDE.md");
    const blockResult = updateManagedBlock(claudeMd, BLOCK_ID, buildGuidance(guidance));
    if (blockResult.action !== "blocked") surfaces.push(claudeMd);
    else warnings.push(`CLAUDE.md: ${blockResult.reason}`);

    return { installed: surfaces.length > 0, surfaces, warnings };
  },

  uninstall(dir: string): AdapterUninstallResult {
    const removed: string[] = [];
    const preserved: string[] = [];

    const claudeMd = join(dir, "CLAUDE.md");
    const blockResult = removeManagedBlock(claudeMd, BLOCK_ID);
    if (blockResult.action === "removed") removed.push(claudeMd);

    try {
      const hookResult = uninstallHooks(dir);
      if (hookResult.restored || hookResult.stripped) removed.push(join(dir, ".claude", "settings.json"));
    } catch {
      // hooks may not have been installed
    }

    return { removed, preserved };
  },

  validate(dir: string): AdapterValidation {
    const issues: string[] = [];
    if (!hasManagedBlock(join(dir, "CLAUDE.md"), BLOCK_ID)) {
      issues.push("Managed block not found in CLAUDE.md");
    }
    try {
      const hookValidation = validateInstall(dir);
      if (!hookValidation.wellFormed) issues.push("Hooks not fully installed");
    } catch {
      issues.push("Hooks not installed");
    }
    return { valid: issues.length === 0, issues };
  },

  getInstructionSurface(dir: string): string | null {
    return join(dir, "CLAUDE.md");
  },
};
