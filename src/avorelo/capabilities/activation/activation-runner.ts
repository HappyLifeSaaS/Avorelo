// Avorelo Activation Runner V2. Orchestrates: detect → repair → run-entry → verify → first-value.
// Local-first, deterministic, safe. No network calls. No secrets.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { runFullDetection, type DetectionResult } from "./activation-detector.ts";
import { runSafeRepairs, type RepairAction } from "./activation-repair.ts";
import { installRunEntry, type RunEntryResult } from "./activation-run-entry.ts";
import {
  readActivationState, writeActivationState,
  ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE,
  type AvoreloActivationStateV1, ACTIVATION_STATE_CONTRACT,
} from "./activation-state.ts";

export const ACTIVATION_STATE_V2_CONTRACT = "avorelo.activationState.v2";

export type ActivationStatusV2 = "not_started" | "active" | "active_with_holds" | "blocked" | "corrupt_state";

export type FirstValue = {
  available: boolean;
  found: string[];
  fixed: string[];
  savedOrProved: string[];
  needsAttention: string[];
  nextAction: string;
};

export type ActivationStateV2 = {
  contract: typeof ACTIVATION_STATE_V2_CONTRACT;
  workspaceId: string;
  repoIdentity: DetectionResult["repo"];
  activatedAt: string;
  updatedAt: string;
  activationMode: "local-first/free";
  activationStatus: ActivationStatusV2;
  environment: DetectionResult["environment"];
  aiTools: DetectionResult["aiTools"];
  modelsAndTools: DetectionResult["modelsAndTools"];
  runEntry: RunEntryResult;
  safeRepairs: RepairAction[];
  setupSteps: Array<{ id: string; label: string; status: "passed" | "fixed" | "hold" | "blocked"; evidencePath?: string; reason?: string }>;
  firstValue: FirstValue;
  localDashboard: { available: boolean; path?: string };
  receipts: Array<{ id: string; path: string; type: string }>;
  productionReady: false;
  redacted: true;
};

function makeWorkspaceId(dir: string): string {
  const base = dir.replace(/\\/g, "/").split("/").pop() || "workspace";
  return `ws_${base}_${Date.now().toString(36)}`;
}

export function runFullActivation(targetDir: string): ActivationStateV2 {
  const now = new Date().toISOString();

  // Phase 1: Detection
  const detection = runFullDetection(targetDir);

  // Phase 2: Safe repairs
  const repairs = runSafeRepairs(targetDir);

  // Phase 3: Run entry
  const runEntry = installRunEntry(targetDir);

  // Community Edition: no account/auth model and no cloud sync. Activation state carries
  // no auth, cloud, billing, plan, subscription, or entitlement fields — absence is the schema.

  // Build setup steps
  const setupSteps: ActivationStateV2["setupSteps"] = [];
  setupSteps.push({ id: "workspace_detected", label: "Workspace detected", status: "passed", evidencePath: targetDir });
  setupSteps.push({ id: "environment_scanned", label: "Environment scanned", status: "passed", evidencePath: `OS: ${detection.environment.os}, Node: ${detection.environment.nodeVersion || "?"}` });

  if (detection.summary.toolsDetected.length > 0) {
    setupSteps.push({ id: "tools_detected", label: `Tools detected: ${detection.summary.toolsDetected.join(", ")}`, status: "passed" });
  }
  if (detection.summary.modelsDetected.length > 0) {
    setupSteps.push({ id: "models_detected", label: `Models/routing: ${detection.summary.modelsDetected.join(", ")}`, status: "passed" });
  }

  const repairsApplied = repairs.filter(r => r.status === "applied");
  const repairsBlocked = repairs.filter(r => r.status === "blocked");
  if (repairsApplied.length > 0) {
    setupSteps.push({ id: "safe_repairs", label: `${repairsApplied.length} safe repairs applied`, status: "fixed" });
  }
  if (repairsBlocked.length > 0) {
    setupSteps.push({ id: "repairs_blocked", label: `${repairsBlocked.length} repairs blocked`, status: "blocked", reason: repairsBlocked.map(r => r.reason).join("; ") });
  }

  if (runEntry.installed) {
    setupSteps.push({ id: "run_entry_installed", label: "Run entry guidance installed", status: "passed" });
  } else {
    setupSteps.push({ id: "run_entry", label: "Run entry guidance", status: "hold", reason: "No instruction surfaces available" });
  }

  setupSteps.push({ id: "production", label: "Production readiness", status: "hold", reason: "Production NOT READY — activation is non-production" });

  // Build first value
  const found = [...detection.summary.toolsDetected.map(t => `Detected: ${t}`), ...detection.summary.modelsDetected.map(m => `Available: ${m}`)];
  const fixed = repairsApplied.map(r => `Fixed: ${r.label}`);
  const savedOrProved = runEntry.installed ? ["Run entry installed"] : [];
  const needsAttention = [...detection.summary.missingAdvisory.map(m => `Missing: ${m}`), ...repairsBlocked.map(r => `Blocked: ${r.label}`)];

  const firstValue: FirstValue = {
    available: true,
    found,
    fixed,
    savedOrProved,
    needsAttention,
    nextAction: "Run: npx avorelo status",
  };

  // Dashboard availability
  const dashboardPath = join(targetDir, ".avorelo", "dashboard", "index.html");
  const localDashboard = { available: existsSync(dashboardPath), path: existsSync(dashboardPath) ? dashboardPath : undefined };

  // Determine activation status
  const blockers = repairsBlocked.length;
  const activationStatus: ActivationStatusV2 = blockers > 0 ? "blocked" : "active_with_holds";

  // Check for V1 state to preserve workspace ID
  const existingState = readActivationState(targetDir);
  const workspaceId = existingState?.workspaceId || makeWorkspaceId(targetDir);

  const state: ActivationStateV2 = {
    contract: ACTIVATION_STATE_V2_CONTRACT,
    workspaceId,
    repoIdentity: detection.repo,
    activatedAt: existingState?.activatedAt || now,
    updatedAt: now,
    activationMode: "local-first/free",
    activationStatus,
    environment: detection.environment,
    aiTools: detection.aiTools,
    modelsAndTools: detection.modelsAndTools,
    runEntry,
    safeRepairs: repairs,
    setupSteps,
    firstValue,
    localDashboard,
    receipts: [],
    productionReady: false,
    redacted: true,
  };

  return state;
}

/** Write V2 state to disk (uses V1 writer path for compatibility) */
export function persistActivationV2(targetDir: string, state: ActivationStateV2): string {
  // Write as-is to the canonical path — V2 state is a superset of V1
  return writeActivationState(targetDir, state as any);
}
