import type { AdapterCapabilityDescriptor, ToolAvailability } from "../types.ts";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "deterministic-local",
  displayName: "Deterministic Local",
  localOnly: true,
  requiresNetwork: false,
  requiresLogin: false,
  supportsDryRun: true,
  supportsRealRun: true,
  supportsPatch: false,
  supportsShell: true,
  supportsReview: false,
  supportsLongContext: false,
  supportsSubagents: false,
  supportsHooks: false,
  supportsSandbox: false,
  supportsMCP: false,
  supportsProofCollection: true,
  supportedPlatforms: ["win32", "darwin", "linux"],
  riskCeiling: "low",
  irreversibleActionPolicy: "block",
  dataPolicy: "local_only",
  limitations: ["no_agent_execution", "deterministic_checks_only"],
};

export function detect(now: number): ToolAvailability {
  return {
    adapterId: "deterministic-local",
    status: "available",
    detectionMethod: "builtin",
    version: null,
    signals: ["always_available"],
    failureClass: null,
    checkedAt: now,
  };
}
