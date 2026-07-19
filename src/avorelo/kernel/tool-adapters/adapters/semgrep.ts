import type { AdapterCapabilityDescriptor, ToolAvailability, FailureClass } from "../types.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "semgrep",
  displayName: "Semgrep Proof Adapter",
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
  limitations: [
    "requires_semgrep_install_for_live_scan",
    "summaries_only_no_raw_source_persistence",
    "never_final_decision_owner",
  ],
};

export function detect(dir: string, now: number): ToolAvailability {
  const signals: string[] = [];
  let status: "available" | "unavailable" | "unknown" = "unavailable";
  let failureClass: FailureClass | null = "not_detected";

  if (process.env.AVORELO_FAKE_PROOF_ADAPTERS === "1" || process.env.CI) {
    signals.push("fake_proof_adapters_enabled");
    status = "available";
    failureClass = null;
  }

  const envPath = process.env.PATH ?? "";
  if (envPath.toLowerCase().includes("semgrep") || existsSync("/usr/local/bin/semgrep") || existsSync("C:\\Program Files\\Semgrep\\semgrep.exe")) {
    signals.push("semgrep_binary_in_path");
    status = "available";
    failureClass = null;
  }

  if (existsSync(join(dir, ".semgrep")) || existsSync(join(dir, ".semgrepignore"))) {
    signals.push("semgrep_repo_signal_found");
  }

  if (signals.length === 0) signals.push("no_semgrep_signals");

  return {
    adapterId: "semgrep",
    status,
    detectionMethod: "local_path_check",
    version: null,
    signals,
    failureClass,
    checkedAt: now,
  };
}
