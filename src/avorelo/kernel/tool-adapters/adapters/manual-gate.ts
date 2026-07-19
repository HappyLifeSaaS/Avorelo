import type { AdapterCapabilityDescriptor, ToolAvailability } from "../types.ts";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "manual-gate",
  displayName: "Manual Approval Gate",
  localOnly: true,
  requiresNetwork: false,
  requiresLogin: false,
  supportsDryRun: true,
  supportsRealRun: false,
  supportsPatch: false,
  supportsShell: false,
  supportsReview: false,
  supportsLongContext: false,
  supportsSubagents: false,
  supportsHooks: false,
  supportsSandbox: false,
  supportsMCP: false,
  supportsProofCollection: true,
  supportedPlatforms: ["win32", "darwin", "linux"],
  riskCeiling: "critical",
  irreversibleActionPolicy: "approval_required",
  dataPolicy: "local_only",
  limitations: ["no_automatic_execution", "requires_human_approval"],
};

export function detect(now: number): ToolAvailability {
  return {
    adapterId: "manual-gate",
    status: "available",
    detectionMethod: "builtin",
    version: null,
    signals: ["always_available"],
    failureClass: null,
    checkedAt: now,
  };
}
