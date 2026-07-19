// Avorelo adapter registry. Detects, installs, and manages all AI tool adapters.
// Selects the best available adapter by control tier.

import type { AgentAdapter, AdapterDetection, ControlTier } from "./adapter-interface.ts";
import { claudeCodeAdapter } from "./claude-code/adapter.ts";
import { cursorAdapter } from "./cursor/index.ts";
import { copilotAdapter } from "./copilot/index.ts";
import { codexAdapter } from "./codex/index.ts";
import { genericAdapter } from "./generic/index.ts";

const TIER_RANK: Record<ControlTier, number> = {
  "lifecycle-hooks": 4,
  "instruction-only": 3,
  "prompt-only": 2,
  "post-session-only": 1,
};

const ALL_ADAPTERS: AgentAdapter[] = [
  claudeCodeAdapter,
  cursorAdapter,
  copilotAdapter,
  codexAdapter,
  genericAdapter,
];

export type DetectedAdapter = {
  adapter: AgentAdapter;
  detection: AdapterDetection;
};

export function detectAllAdapters(dir: string): DetectedAdapter[] {
  const results: DetectedAdapter[] = [];
  for (const adapter of ALL_ADAPTERS) {
    const detection = adapter.detect(dir);
    if (detection.detected) {
      results.push({ adapter, detection });
    }
  }
  results.sort((a, b) => TIER_RANK[b.adapter.controlTier] - TIER_RANK[a.adapter.controlTier]);
  return results;
}

export function getBestAdapter(dir: string): DetectedAdapter | null {
  const detected = detectAllAdapters(dir);
  return detected.length > 0 ? detected[0] : null;
}

export function installAll(dir: string, adapters: DetectedAdapter[], guidance?: string): {
  installed: string[];
  skipped: string[];
  warnings: string[];
} {
  const installed: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  for (const { adapter } of adapters) {
    if (adapter.id === "generic" && adapters.length > 1) {
      skipped.push(adapter.id);
      continue;
    }
    const result = adapter.install(dir, guidance);
    if (result.installed) installed.push(adapter.id);
    else skipped.push(adapter.id);
    warnings.push(...result.warnings);
  }
  return { installed, skipped, warnings };
}

export function uninstallAll(dir: string): {
  removed: string[];
  preserved: string[];
} {
  const removed: string[] = [];
  const preserved: string[] = [];

  for (const adapter of ALL_ADAPTERS) {
    const result = adapter.uninstall(dir);
    removed.push(...result.removed);
    preserved.push(...result.preserved);
  }
  return { removed, preserved };
}

export function getAdapterById(id: string): AgentAdapter | undefined {
  return ALL_ADAPTERS.find(a => a.id === id);
}

export { ALL_ADAPTERS };
