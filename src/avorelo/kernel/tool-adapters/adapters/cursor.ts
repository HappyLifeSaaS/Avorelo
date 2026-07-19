import type { AdapterCapabilityDescriptor, ToolAvailability, FailureClass } from "../types.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "cursor",
  displayName: "Cursor",
  localOnly: false,
  requiresNetwork: true,
  requiresLogin: true,
  supportsDryRun: false,
  supportsRealRun: false,
  supportsPatch: false,
  supportsShell: false,
  supportsReview: true,
  supportsLongContext: true,
  supportsSubagents: false,
  supportsHooks: false,
  supportsSandbox: false,
  supportsMCP: true,
  supportsProofCollection: false,
  supportedPlatforms: ["win32", "darwin", "linux"],
  riskCeiling: "low",
  irreversibleActionPolicy: "block",
  dataPolicy: "unknown",
  limitations: [
    "requires_cursor_subscription",
    "ide_only_no_cli_execution",
    "future_executor_assessment_only",
    "no_real_run_support",
    "no_patch_generation",
    "no_shell_execution",
    "no_proof_collection_yet",
    "no_hook_integration_yet",
    "data_policy_unknown",
  ],
};

export function detect(dir: string, now: number): ToolAvailability {
  const signals: string[] = [];
  let status: "available" | "unavailable" | "unknown" = "unavailable";
  let failureClass: FailureClass | null = "not_detected";

  if (existsSync(join(dir, ".cursor"))) {
    signals.push(".cursor_dir_found");
    status = "available";
    failureClass = null;
  }
  if (existsSync(join(dir, ".cursorules"))) {
    signals.push(".cursorules_found");
    status = "available";
    failureClass = null;
  }
  if (existsSync(join(dir, ".cursorrules"))) {
    signals.push(".cursorrules_found");
    status = "available";
    failureClass = null;
  }

  const homeCursor = process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? "", "Programs", "cursor", "Cursor.exe")
    : process.platform === "darwin"
      ? "/Applications/Cursor.app"
      : "/usr/bin/cursor";
  if (existsSync(homeCursor)) {
    signals.push("cursor_app_found");
    status = "available";
    failureClass = null;
  }

  if (signals.length === 0) {
    signals.push("no_cursor_signals");
    failureClass = "not_detected";
  }

  return {
    adapterId: "cursor",
    status,
    detectionMethod: "local_file_and_path_check",
    version: null,
    signals,
    failureClass,
    checkedAt: now,
  };
}
