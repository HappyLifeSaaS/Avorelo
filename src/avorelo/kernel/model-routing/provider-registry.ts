// Provider health and cooldown tracking. In-memory, no persistence, no network.

import type { ProviderHealth } from "./types.ts";

const healthMap = new Map<string, ProviderHealth>();

const PROVIDERS = [
  { provider: "local", displayName: "Local", endpoint: "local" },
  { provider: "anthropic", displayName: "Anthropic", endpoint: "api.anthropic.com" },
  { provider: "openai", displayName: "OpenAI", endpoint: "api.openai.com" },
];

function defaultHealth(provider: string): ProviderHealth {
  return { provider, healthy: true, lastError: null, cooldownUntil: 0, consecutiveFailures: 0 };
}

export function getProviderHealth(provider: string): ProviderHealth {
  return healthMap.get(provider) ?? defaultHealth(provider);
}

export function getAllProviders(): readonly { provider: string; displayName: string }[] {
  return PROVIDERS;
}

export function isProviderAvailable(provider: string, now?: number): boolean {
  const h = healthMap.get(provider);
  if (!h) return true;
  const t = now ?? Date.now();
  if (!h.healthy && h.cooldownUntil > t) return false;
  if (!h.healthy && h.cooldownUntil <= t) {
    h.healthy = true;
    h.consecutiveFailures = 0;
    h.lastError = null;
  }
  return h.healthy;
}

export function markProviderUnhealthy(provider: string, errorCode: string, cooldownMs: number, now?: number): void {
  const t = now ?? Date.now();
  const h = healthMap.get(provider) ?? defaultHealth(provider);
  h.healthy = false;
  h.lastError = errorCode;
  h.cooldownUntil = t + cooldownMs;
  h.consecutiveFailures += 1;
  healthMap.set(provider, h);
}

export function markProviderHealthy(provider: string): void {
  const h = healthMap.get(provider) ?? defaultHealth(provider);
  h.healthy = true;
  h.lastError = null;
  h.cooldownUntil = 0;
  h.consecutiveFailures = 0;
  healthMap.set(provider, h);
}

export function resetAllHealth(): void {
  healthMap.clear();
}
