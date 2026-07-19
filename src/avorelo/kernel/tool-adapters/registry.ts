// Tool adapter registry. Manages descriptors and health state.
// Pattern: adapter registry + health/cooldown (LiteLLM), provider order (OpenRouter).

import type { AdapterCapabilityDescriptor, AdapterHealthState, ToolAdapterId } from "./types.ts";
import { descriptor as deterministicLocal } from "./adapters/deterministic-local.ts";
import { descriptor as manualGate } from "./adapters/manual-gate.ts";
import { descriptor as scanner } from "./adapters/scanner.ts";
import { descriptor as semgrep } from "./adapters/semgrep.ts";
import { descriptor as playwrightProof } from "./adapters/playwright-proof.ts";
import { descriptor as githubActions } from "./adapters/github-actions.ts";
import { descriptor as claudeCode } from "./adapters/claude-code.ts";
import { descriptor as codex } from "./adapters/codex.ts";
import { descriptor as geminiCli } from "./adapters/gemini-cli.ts";
import { descriptor as aider } from "./adapters/aider.ts";
import { descriptor as cursor } from "./adapters/cursor.ts";

const ALL_DESCRIPTORS: AdapterCapabilityDescriptor[] = [
  deterministicLocal, manualGate, scanner, semgrep, playwrightProof, githubActions, claudeCode, codex,
  geminiCli, aider, cursor,
];

const healthMap = new Map<ToolAdapterId, AdapterHealthState>();

export function getAdapterDescriptors(): AdapterCapabilityDescriptor[] {
  return [...ALL_DESCRIPTORS];
}

export function getDescriptor(id: ToolAdapterId): AdapterCapabilityDescriptor | undefined {
  return ALL_DESCRIPTORS.find(d => d.id === id);
}

export function getAdapterHealth(id: ToolAdapterId, now: number): AdapterHealthState {
  const existing = healthMap.get(id);
  if (existing && existing.cooldownUntil > now) return existing;
  if (existing && existing.cooldownUntil <= now) {
    existing.healthy = true;
    existing.lastError = null;
    existing.cooldownUntil = 0;
    existing.consecutiveFailures = 0;
    return existing;
  }
  return { adapterId: id, healthy: true, lastError: null, cooldownUntil: 0, consecutiveFailures: 0 };
}

export function markAdapterUnhealthy(id: ToolAdapterId, error: string, cooldownMs: number, now: number): void {
  const existing = healthMap.get(id) ?? { adapterId: id, healthy: true, lastError: null, cooldownUntil: 0, consecutiveFailures: 0 };
  existing.healthy = false;
  existing.lastError = error;
  existing.cooldownUntil = now + cooldownMs;
  existing.consecutiveFailures += 1;
  healthMap.set(id, existing);
}

export function resetAllAdapterHealth(): void {
  healthMap.clear();
}

export function isAdapterHealthy(id: ToolAdapterId, now: number): boolean {
  return getAdapterHealth(id, now).healthy;
}
