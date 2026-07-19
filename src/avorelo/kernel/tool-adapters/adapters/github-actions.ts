import type { AdapterCapabilityDescriptor, ToolAvailability, FailureClass } from "../types.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "github-actions",
  displayName: "GitHub Actions Proof Adapter",
  localOnly: false,
  requiresNetwork: true,
  requiresLogin: true,
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
  riskCeiling: "low",
  irreversibleActionPolicy: "block",
  dataPolicy: "zdr",
  limitations: [
    "read_only_status_artifact_summary_only",
    "requires_gh_auth_for_live_ci_reads",
    "never_triggers_workflows_automatically",
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
  if (envPath.toLowerCase().includes("github cli") || envPath.toLowerCase().includes("\\gh") || envPath.toLowerCase().includes("/gh")) {
    signals.push("gh_path_signal");
    status = "available";
    failureClass = null;
  }

  if (existsSync("C:\\Program Files\\GitHub CLI\\gh.exe") || existsSync("/usr/local/bin/gh")) {
    signals.push("gh_binary_found");
    status = "available";
    failureClass = null;
  }

  if (existsSync(join(dir, ".git"))) {
    signals.push("git_repo_found");
  }

  if (signals.length === 0) signals.push("no_github_actions_signals");

  return {
    adapterId: "github-actions",
    status,
    detectionMethod: "local_path_and_git_check",
    version: null,
    signals,
    failureClass,
    checkedAt: now,
  };
}
