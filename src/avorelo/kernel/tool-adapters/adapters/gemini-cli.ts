import type { AdapterCapabilityDescriptor, ToolAvailability, FailureClass } from "../types.ts";
import { existsSync } from "node:fs";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  localOnly: false,
  requiresNetwork: true,
  requiresLogin: true,
  supportsDryRun: false,
  supportsRealRun: true,
  supportsPatch: true,
  supportsShell: true,
  supportsReview: true,
  supportsLongContext: true,
  supportsSubagents: false,
  supportsHooks: false,
  supportsSandbox: false,
  supportsMCP: false,
  supportsProofCollection: false,
  supportedPlatforms: ["win32", "darwin", "linux"],
  riskCeiling: "high",
  irreversibleActionPolicy: "allow_with_proof",
  dataPolicy: "no_training",
  limitations: [
    "requires_google_account",
    "network_required_for_execution",
    "future_executor_assessment_only",
    "no_sandbox_support_yet",
    "no_proof_collection_yet",
    "no_hook_integration_yet",
  ],
};

export function detect(dir: string, now: number): ToolAvailability {
  const signals: string[] = [];
  let status: "available" | "unavailable" | "unknown" = "unavailable";
  let failureClass: FailureClass | null = "not_detected";

  if (existsSync(".gemini")) {
    signals.push(".gemini_dir_found");
    status = "available";
    failureClass = null;
  }
  if (existsSync("GEMINI.md")) {
    signals.push("GEMINI.md_found");
    status = "available";
    failureClass = null;
  }

  const envPath = process.env.PATH ?? "";
  if (envPath.includes("gemini") || existsSync("/usr/local/bin/gemini") || existsSync("C:\\Program Files\\Google\\gemini.exe")) {
    signals.push("gemini_binary_in_path");
    status = "available";
    failureClass = null;
  }

  if (signals.length === 0) {
    signals.push("no_gemini_signals");
    failureClass = "not_detected";
  }

  return {
    adapterId: "gemini-cli",
    status,
    detectionMethod: "local_file_and_path_check",
    version: null,
    signals,
    failureClass,
    checkedAt: now,
  };
}
