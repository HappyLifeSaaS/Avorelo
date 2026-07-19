import type { AdapterCapabilityDescriptor, ToolAvailability, FailureClass } from "../types.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const descriptor: AdapterCapabilityDescriptor = {
  id: "playwright-proof",
  displayName: "Playwright Proof Adapter",
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
  riskCeiling: "medium",
  irreversibleActionPolicy: "block",
  dataPolicy: "local_only",
  limitations: [
    "fixture_only_browser_proof_in_v1",
    "no_screenshots_persisted_by_default",
    "no_raw_dom_persistence",
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

  if (existsSync(join(dir, "node_modules", "playwright")) || existsSync(join(dir, "node_modules", "@playwright", "test"))) {
    signals.push("playwright_module_found");
    status = "available";
    failureClass = null;
  }

  if (existsSync(join(dir, "node_modules", ".bin", "playwright")) || existsSync(join(dir, "node_modules", ".bin", "playwright.cmd"))) {
    signals.push("playwright_cli_found");
    status = "available";
    failureClass = null;
  }

  const envPath = process.env.PATH ?? "";
  if (envPath.toLowerCase().includes("playwright")) {
    signals.push("playwright_path_signal");
    status = "available";
    failureClass = null;
  }

  if (signals.length === 0) signals.push("no_playwright_signals");

  return {
    adapterId: "playwright-proof",
    status,
    detectionMethod: "local_module_and_path_check",
    version: null,
    signals,
    failureClass,
    checkedAt: now,
  };
}
