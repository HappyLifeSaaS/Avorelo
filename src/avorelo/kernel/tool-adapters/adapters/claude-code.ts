import type { AdapterCapabilityDescriptor, ToolAvailability, FailureClass } from "../types.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "claude-code",
  displayName: "Claude Code",
  localOnly: false,
  requiresNetwork: true,
  requiresLogin: true,
  supportsDryRun: true,
  supportsRealRun: true,
  supportsPatch: true,
  supportsShell: true,
  supportsReview: true,
  supportsLongContext: true,
  supportsSubagents: true,
  supportsHooks: true,
  supportsSandbox: false,
  supportsMCP: true,
  supportsProofCollection: true,
  supportedPlatforms: ["win32", "darwin", "linux"],
  riskCeiling: "high",
  irreversibleActionPolicy: "allow_with_proof",
  dataPolicy: "no_training",
  limitations: [
    "requires_anthropic_account",
    "network_required_for_execution",
    "real_execution_is_dry_run_only_in_v1",
  ],
};

export function detect(dir: string, now: number): ToolAvailability {
  const signals: string[] = [];
  let status: "available" | "unavailable" | "unknown" = "unavailable";
  let failureClass: FailureClass | null = "not_detected";

  if (existsSync(join(dir, ".claude"))) {
    signals.push(".claude_dir_found");
    status = "available";
    failureClass = null;
  }
  if (existsSync(join(dir, "CLAUDE.md"))) {
    signals.push("CLAUDE.md_found");
    status = "available";
    failureClass = null;
  }

  const envPath = process.env.PATH ?? "";
  if (envPath.includes("claude") || existsSync("/usr/local/bin/claude") || existsSync("C:\\Program Files\\Claude\\claude.exe")) {
    signals.push("claude_binary_in_path");
    status = "available";
    failureClass = null;
  }

  if (signals.length === 0) {
    signals.push("no_claude_code_signals");
    failureClass = "not_detected";
  }

  return {
    adapterId: "claude-code",
    status,
    detectionMethod: "local_file_and_path_check",
    version: null,
    signals,
    failureClass,
    checkedAt: now,
  };
}
