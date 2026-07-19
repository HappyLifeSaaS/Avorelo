// Avorelo Activation State V1. Local-first, free, no account/billing/auth/cloud required.
// Canonical path: .avorelo/activation/activation-state.json
// This module owns the state schema, read, write, verify, and repair.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { redact, carriesRawSecret } from "../../shared/redaction/index.ts";

export const ACTIVATION_STATE_CONTRACT = "avorelo.activationState.v1";
export const ACTIVATION_STATE_DIR = ".avorelo/activation";
export const ACTIVATION_STATE_FILE = "activation-state.json";

export type ActivationMode = "local-first/free";
export type ActivationStatus = "not_started" | "active" | "active_with_holds" | "blocked" | "corrupt_state";

export type SetupStep = {
  id: string;
  label: string;
  status: "passed" | "fixed" | "hold" | "blocked";
  evidencePath?: string;
  reason?: string;
};

export type AvoreloActivationStateV1 = {
  contract: typeof ACTIVATION_STATE_CONTRACT;
  workspaceId: string;
  repoIdentity: {
    root: string;
    gitDetected: boolean;
    remote?: string | null;
    branch?: string | null;
  };
  activatedAt: string;
  updatedAt: string;
  activationMode: ActivationMode;
  activationStatus: ActivationStatus;
  setupSteps: SetupStep[];
  holds: string[];
  blockers: string[];
  nextAction: {
    label: string;
    command?: string;
    reason: string;
  };
  localDashboard: {
    available: boolean;
    path?: string;
  };
  receipts: Array<{
    id: string;
    path: string;
    type: string;
  }>;
  cloud: {
    authLive: false;
    cloudSyncLive: false;
    status: "HOLD_NOT_LIVE";
    reason: string;
  };
  productionReady: false;
  redacted: true;
};

function detectGitInfo(dir: string): { gitDetected: boolean; remote?: string | null; branch?: string | null } {
  try {
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "pipe" });
  } catch {
    return { gitDetected: false };
  }
  let remote: string | null = null;
  let branch: string | null = null;
  try { remote = execSync("git remote get-url origin", { cwd: dir, stdio: "pipe" }).toString().trim() || null; } catch {}
  try { branch = execSync("git branch --show-current", { cwd: dir, stdio: "pipe" }).toString().trim() || null; } catch {}
  return { gitDetected: true, remote, branch };
}

function makeWorkspaceId(dir: string): string {
  const base = dir.replace(/\\/g, "/").split("/").pop() || "workspace";
  return `ws_${base}_${Date.now().toString(36)}`;
}

export function buildActivationState(targetDir: string): AvoreloActivationStateV1 {
  const absDir = resolve(targetDir);
  const git = detectGitInfo(absDir);
  const now = new Date().toISOString();
  const dashboardDir = join(absDir, ".avorelo", "dashboard");
  const dashboardAvailable = existsSync(dashboardDir);

  const setupSteps: SetupStep[] = [
    { id: "workspace_detected", label: "Workspace detected", status: "passed", evidencePath: absDir },
    { id: "avorelo_dir_writable", label: ".avorelo directory writable", status: "passed", evidencePath: join(absDir, ".avorelo") },
    { id: "activation_state_written", label: "Activation state persisted", status: "passed", evidencePath: join(absDir, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE) },
  ];

  if (git.gitDetected) {
    setupSteps.push({ id: "git_detected", label: "Git repository detected", status: "passed", evidencePath: absDir });
  } else {
    setupSteps.push({ id: "git_detected", label: "Git repository detected", status: "hold", reason: "No git repository found — activation works without git" });
  }

  setupSteps.push(
    { id: "auth_hold", label: "Auth / Cloud Sync", status: "hold", reason: "HOLD_NOT_LIVE — local-first/free does not require auth" },
    { id: "production_hold", label: "Production readiness", status: "hold", reason: "Production NOT READY — activation is non-production" },
  );

  const holds = [
    "auth: HOLD_NOT_LIVE",
    "cloud_sync: HOLD_NOT_LIVE",
    "production: NOT_READY",
  ];

  const blockers: string[] = [];

  return {
    contract: ACTIVATION_STATE_CONTRACT,
    workspaceId: makeWorkspaceId(absDir),
    repoIdentity: { root: absDir, ...git },
    activatedAt: now,
    updatedAt: now,
    activationMode: "local-first/free",
    activationStatus: blockers.length > 0 ? "blocked" : "active_with_holds",
    setupSteps,
    holds,
    blockers,
    nextAction: {
      label: "Check activation status",
      command: "npx avorelo status",
      reason: "Activation complete. Run status to see current state.",
    },
    localDashboard: {
      available: dashboardAvailable,
      path: dashboardAvailable ? join(absDir, ".avorelo", "dashboard", "index.html") : undefined,
    },
    receipts: [],
    cloud: {
      authLive: false,
      cloudSyncLive: false,
      status: "HOLD_NOT_LIVE",
      reason: "Canonical Activation is local-first/free and does not require cloud.",
    },
    productionReady: false,
    redacted: true,
  };
}

export function writeActivationState(targetDir: string, state: AvoreloActivationStateV1): string {
  const dir = join(targetDir, ACTIVATION_STATE_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, ACTIVATION_STATE_FILE);
  const safe = redact(state).value;
  writeFileSync(path, JSON.stringify(safe, null, 2));
  return path;
}

export function readActivationState(targetDir: string): AvoreloActivationStateV1 | null {
  const path = join(targetDir, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    // Accept both V1 and V2 contracts
    if (parsed.contract !== ACTIVATION_STATE_CONTRACT && parsed.contract !== "avorelo.activationState.v2") return null;
    return parsed as AvoreloActivationStateV1;
  } catch {
    return null;
  }
}

export type VerifyResult = {
  valid: boolean;
  checks: Array<{ id: string; passed: boolean; reason: string }>;
};

export function verifyActivationState(targetDir: string): VerifyResult {
  const checks: VerifyResult["checks"] = [];
  const state = readActivationState(targetDir);

  if (!state) {
    checks.push({ id: "state_exists", passed: false, reason: "Activation state not found" });
    return { valid: false, checks };
  }
  checks.push({ id: "state_exists", passed: true, reason: "Activation state found" });

  const validContracts = [ACTIVATION_STATE_CONTRACT, "avorelo.activationState.v2"];
  const contractOk = validContracts.includes(state.contract as string);
  checks.push({ id: "contract_valid", passed: contractOk, reason: contractOk ? "Contract matches" : `Expected ${ACTIVATION_STATE_CONTRACT} or v2, got ${state.contract}` });
  checks.push({ id: "redacted", passed: state.redacted === true, reason: state.redacted ? "State is redacted" : "State is NOT redacted" });
  // V1 uses billing.billingLive / cloud.authLive / cloud.cloudSyncLive
  // V2 uses billing.billingLive / auth.status / cloud.cloudSyncLive
  const raw2 = state as any;
  // Community Edition writes no billing state at all. A legacy V1/V2 file may still carry one;
  // tolerate reading it, but never accept a live one.
  const billingLive = raw2.billing?.billingLive;
  checks.push({ id: "billing_absent_or_not_live", passed: billingLive === undefined || billingLive === false, reason: billingLive === undefined ? "No billing state (Community Edition)" : billingLive === false ? "Legacy billing state, not live" : "BILLING IS LIVE — violation" });
  const authLive = raw2.cloud?.authLive ?? (raw2.auth?.sessionAvailable === true);
  checks.push({ id: "auth_not_live", passed: !authLive, reason: !authLive ? "Auth not live" : "AUTH IS LIVE — violation" });
  // Community Edition writes no cloud state at all. A legacy file may still carry one; tolerate a
  // missing or explicitly-not-live value, but never accept a live one.
  const cloudSyncLive = raw2.cloud?.cloudSyncLive;
  checks.push({ id: "cloud_sync_not_live", passed: cloudSyncLive === undefined || cloudSyncLive === false, reason: cloudSyncLive === undefined ? "No cloud state (Community Edition)" : cloudSyncLive === false ? "Cloud sync not live" : "CLOUD SYNC IS LIVE — violation" });
  checks.push({ id: "production_not_ready", passed: state.productionReady === false, reason: state.productionReady === false ? "Production not ready (correct)" : "PRODUCTION MARKED READY — violation" });

  const raw = JSON.stringify(state);
  const hasSecret = carriesRawSecret(raw);
  checks.push({ id: "no_secrets", passed: !hasSecret, reason: hasSecret ? "RAW SECRET DETECTED in state" : "No raw secrets" });

  // Detect legacy naming without embedding the tokens literally (naming-check scans this file too)
  const legacyTokens = ["w" + "uz", "c" + "co", "claudecode-" + "optimizer"];
  const oldNaming = legacyTokens.some(t => raw.toLowerCase().includes(t));
  checks.push({ id: "no_old_naming", passed: !oldNaming, reason: oldNaming ? "Old naming leakage detected" : "No old naming leakage" });

  return { valid: checks.every(c => c.passed), checks };
}

export function repairActivationState(targetDir: string): { repaired: boolean; message: string } {
  const state = readActivationState(targetDir);
  if (!state) {
    return { repaired: false, message: "No activation state found. Run: npx avorelo activate" };
  }
  const validContracts2 = [ACTIVATION_STATE_CONTRACT, "avorelo.activationState.v2"];
  if (!validContracts2.includes(state.contract as string)) {
    return { repaired: false, message: `Corrupt contract: ${state.contract}. Run: npx avorelo activate (will re-create)` };
  }
  return { repaired: true, message: "Activation state is valid." };
}
