// Route session memory. Upgrade-only: once a session touches a sensitive surface,
// the route can escalate but never silently downgrade.

import type { ModelProfile } from "./types.ts";

const PROFILE_RANK: Record<ModelProfile, number> = {
  none: 0,
  cheap_classification: 1,
  fallback_only: 2,
  standard_synthesis: 3,
  privacy_sensitive_summary: 4,
  code_generation: 5,
  high_reasoning: 6,
  security_sensitive_review: 7,
};

export type RouteSessionMemory = {
  sessionId: string;
  highWaterProfile: ModelProfile;
  escalationHistory: Array<{ from: ModelProfile; to: ModelProfile; reason: string }>;
  sensitiveSurfacesTouched: string[];
  downgradeAttempts: number;
};

export function createRouteSession(sessionId: string): RouteSessionMemory {
  return {
    sessionId,
    highWaterProfile: "none",
    escalationHistory: [],
    sensitiveSurfacesTouched: [],
    downgradeAttempts: 0,
  };
}

export type UpgradeResult = {
  allowed: boolean;
  profile: ModelProfile;
  wasEscalation: boolean;
  reason: string;
};

export function requestProfileChange(
  memory: RouteSessionMemory,
  requested: ModelProfile,
  reason: string,
): UpgradeResult {
  const currentRank = PROFILE_RANK[memory.highWaterProfile];
  const requestedRank = PROFILE_RANK[requested];

  if (requestedRank < currentRank) {
    memory.downgradeAttempts += 1;
    return {
      allowed: false,
      profile: memory.highWaterProfile,
      wasEscalation: false,
      reason: `downgrade_blocked: ${requested} < ${memory.highWaterProfile}`,
    };
  }

  if (requestedRank > currentRank) {
    memory.escalationHistory.push({ from: memory.highWaterProfile, to: requested, reason });
    memory.highWaterProfile = requested;
    return { allowed: true, profile: requested, wasEscalation: true, reason };
  }

  return { allowed: true, profile: requested, wasEscalation: false, reason: "no_change" };
}

export function canDowngrade(memory: RouteSessionMemory): boolean {
  return false;
}

export function recordSensitiveSurface(memory: RouteSessionMemory, surface: string): void {
  if (!memory.sensitiveSurfacesTouched.includes(surface)) {
    memory.sensitiveSurfacesTouched.push(surface);
  }
}
