import type { AdapterCapabilityDescriptor, ToolAvailability } from "../types.ts";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "scanner",
  displayName: "Local Scanner",
  localOnly: true,
  requiresNetwork: false,
  requiresLogin: false,
  supportsDryRun: true,
  supportsRealRun: true,
  supportsPatch: false,
  supportsShell: false,
  supportsReview: true,
  supportsLongContext: false,
  supportsSubagents: false,
  supportsHooks: false,
  supportsSandbox: false,
  supportsMCP: false,
  supportsProofCollection: true,
  supportedPlatforms: ["win32", "darwin", "linux"],
  riskCeiling: "high",
  irreversibleActionPolicy: "block",
  dataPolicy: "local_only",
  limitations: ["pattern_based_only", "no_semantic_analysis"],
};

export function detect(now: number): ToolAvailability {
  return {
    adapterId: "scanner",
    status: "available",
    detectionMethod: "builtin",
    version: null,
    signals: ["builtin_scanners_available"],
    failureClass: null,
    checkedAt: now,
  };
}
