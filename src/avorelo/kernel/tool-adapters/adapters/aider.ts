import type { AdapterCapabilityDescriptor, ToolAvailability, FailureClass } from "../types.ts";
import { existsSync } from "node:fs";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "aider",
  displayName: "Aider",
  localOnly: false,
  requiresNetwork: true,
  requiresLogin: false,
  supportsDryRun: true,
  supportsRealRun: true,
  supportsPatch: true,
  supportsShell: false,
  supportsReview: false,
  supportsLongContext: true,
  supportsSubagents: false,
  supportsHooks: false,
  supportsSandbox: false,
  supportsMCP: false,
  supportsProofCollection: false,
  supportedPlatforms: ["win32", "darwin", "linux"],
  riskCeiling: "medium",
  irreversibleActionPolicy: "block",
  dataPolicy: "no_training",
  limitations: [
    "requires_api_key_for_backend_model",
    "network_required_for_execution",
    "future_executor_assessment_only",
    "no_shell_execution",
    "no_review_capability",
    "no_proof_collection_yet",
    "no_hook_integration_yet",
  ],
};

export function detect(dir: string, now: number): ToolAvailability {
  const signals: string[] = [];
  let status: "available" | "unavailable" | "unknown" = "unavailable";
  let failureClass: FailureClass | null = "not_detected";

  if (existsSync(".aider.conf.yml") || existsSync(".aider.model.settings.yml")) {
    signals.push("aider_config_found");
    status = "available";
    failureClass = null;
  }

  const envPath = process.env.PATH ?? "";
  if (envPath.includes("aider") || existsSync("/usr/local/bin/aider") || existsSync("C:\\Python312\\Scripts\\aider.exe")) {
    signals.push("aider_binary_in_path");
    status = "available";
    failureClass = null;
  }

  if (signals.length === 0) {
    signals.push("no_aider_signals");
    failureClass = "not_detected";
  }

  return {
    adapterId: "aider",
    status,
    detectionMethod: "local_file_and_path_check",
    version: null,
    signals,
    failureClass,
    checkedAt: now,
  };
}
