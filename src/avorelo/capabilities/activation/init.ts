// Avorelo local first-run / Activation v1 — `avorelo.activation.v1`.
//
// The lightweight, LOCAL-FIRST entry point a brand-new user hits first. `avorelo init` initializes a local
// workspace under `<dir>/.avorelo/` and writes a redacted activation contract describing what is ready and
// what to run next. No signup, no cloud credentials, no network beyond local `git`, no Postgres, no auth,
// no source-file dump, no secret scanning. It REUSES the existing activation detectors for git/package
// detection rather than reimplementing them.
//
// Files written (both local-only; `.avorelo/` is gitignored):
//   <dir>/.avorelo/workspace.json   — stable workspace identity (avorelo.workspace.v1)
//   <dir>/.avorelo/activation.json  — the activation contract (avorelo.activation.v1)

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { detectRepoIdentity, detectEnvironment } from "./activation-detector.ts";

export const ACTIVATION_V1_CONTRACT = "avorelo.activation.v1";
export const WORKSPACE_V1_CONTRACT = "avorelo.workspace.v1";

export type WorkspaceRecord = {
  contract: typeof WORKSPACE_V1_CONTRACT;
  schemaVersion: 1;
  workspaceId: string;
  createdAt: string;
  target: string;
  localOnly: true;
};

export type ActivationContractV1 = {
  contract: typeof ACTIVATION_V1_CONTRACT;
  schemaVersion: 1;
  activationId: string;
  createdAt: string;
  target: string;
  workspaceId: string;
  repoDetected: boolean;       // a recognizable project (package.json or a git repo)
  gitDetected: boolean;
  packageDetected: boolean;    // package.json present
  packageManager: string | null; // safe enum only (npm/pnpm/yarn/bun), never file contents
  avoreloDirReady: boolean;
  initialized: boolean;        // workspace.json exists and is well-formed
  localOnly: true;
  cloudClaimed: false;
  cloudClaimAvailable: boolean; // false in v1 — cloud claim/sync is not live
  commandsAvailable: {
    status: boolean;
    run: boolean;
    controlCenter: boolean;
    readiness: boolean;
    syncDryRun: boolean;
  };
  firstRunRecommended: { command: string; reason: string };
  limitations: string[];
  safety: {
    redacted: true;
    containsRawSecret: false;
    containsRawSource: false;
    containsEnvValue: false;
  };
};

export type InitResult = {
  ok: boolean;
  reason?: string;            // present when ok=false (honest failure)
  created: boolean;           // true if a new workspace was created this run
  workspacePath?: string;
  activationPath?: string;
  contract?: ActivationContractV1;
};

function avoreloDir(dir: string): string { return join(dir, ".avorelo"); }
function workspacePath(dir: string): string { return join(avoreloDir(dir), "workspace.json"); }
function activationPath(dir: string): string { return join(avoreloDir(dir), "activation.json"); }

function freshActivationId(seed: string): string {
  return "act_" + createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

/** Read the local workspace record, or null if absent/unparseable. */
export function loadWorkspace(dir: string): WorkspaceRecord | null {
  const p = workspacePath(dir);
  if (!existsSync(p)) return null;
  try {
    const w = JSON.parse(readFileSync(p, "utf8")) as WorkspaceRecord;
    return w.contract === WORKSPACE_V1_CONTRACT && typeof w.workspaceId === "string" ? w : null;
  } catch { return null; }
}

export function loadActivationContract(dir: string): ActivationContractV1 | null {
  const p = activationPath(dir);
  if (!existsSync(p)) return null;
  try {
    const a = JSON.parse(readFileSync(p, "utf8")) as ActivationContractV1;
    return a.contract === ACTIVATION_V1_CONTRACT ? a : null;
  } catch { return null; }
}

/**
 * Build the activation contract (read-model) for `dir`. Pure: it does not write. Safe detection only —
 * local `git` and `package.json` metadata; never source contents, env values, or secrets.
 */
export function buildActivationContract(dir: string, opts?: { now?: number; workspaceId?: string; createdAt?: string }): ActivationContractV1 {
  const now = opts?.now ?? Date.now();
  const createdAt = opts?.createdAt ?? new Date(now).toISOString();
  const existing = loadWorkspace(dir);
  const workspaceId = opts?.workspaceId ?? existing?.workspaceId ?? "ws_uninitialized";

  let gitDetected = false;
  let packageManager: string | null = null;
  try { gitDetected = detectRepoIdentity(dir).gitDetected; } catch { gitDetected = false; }
  try { packageManager = detectEnvironment(dir).packageManager; } catch { packageManager = null; }
  const packageDetected = existsSync(join(dir, "package.json"));
  const repoDetected = packageDetected || gitDetected;
  const avoreloDirReady = existsSync(avoreloDir(dir));
  const initialized = !!existing;

  const firstRunRecommended = !initialized
    ? { command: `avorelo init --target ${dir}`, reason: "Initialize the local Avorelo workspace first." }
    : { command: `avorelo run "run tests" --target ${dir}`, reason: "Run your first focused task; Avorelo saves proof locally." };

  const limitations = [
    "Local-first only: no cloud account, credentials, or network are used.",
    "Cloud claim/sync is not live in v1 (efficiency sync is dry-run + local-queue only).",
    "No installer or globally-published package yet; run via the worktree CLI or a local install.",
    "Not production-ready; final legal sign-off is still required before any publish.",
  ];

  const contract: ActivationContractV1 = {
    contract: ACTIVATION_V1_CONTRACT,
    schemaVersion: 1,
    activationId: freshActivationId(`${workspaceId}:${createdAt}`),
    createdAt,
    target: dir,
    workspaceId,
    repoDetected,
    gitDetected,
    packageDetected,
    packageManager,
    avoreloDirReady,
    initialized,
    localOnly: true,
    cloudClaimed: false,
    cloudClaimAvailable: false,
    commandsAvailable: { status: true, run: true, controlCenter: true, readiness: true, syncDryRun: true },
    firstRunRecommended,
    limitations,
    safety: { redacted: true, containsRawSecret: false, containsRawSource: false, containsEnvValue: false },
  };
  // The contract is constructed entirely from safe primitives (booleans, safe enums, a local path, static
  // limitation strings) — it never ingests source, env, or secret content, so it is redacted by
  // construction. We do NOT run it through redact() here: that classifier flags key NAMES containing
  // "secret"/"env" (e.g. containsRawSecret / containsEnvValue) and would corrupt those boolean flags.
  return contract;
}

/**
 * Initialize (or refresh) the local Avorelo workspace at `dir`. Idempotent: the workspaceId and original
 * createdAt are preserved across runs unless `reset` is set. Fails honestly (ok:false + reason) for a
 * missing/invalid/non-writable target.
 */
export function initWorkspace(dir: string, opts?: { now?: number; reset?: boolean }): InitResult {
  const now = opts?.now ?? Date.now();

  // Validate the target exists and is a directory.
  try {
    if (!existsSync(dir)) return { ok: false, created: false, reason: "target_does_not_exist" };
    if (!statSync(dir).isDirectory()) return { ok: false, created: false, reason: "target_not_a_directory" };
  } catch {
    return { ok: false, created: false, reason: "target_not_accessible" };
  }
  // Confirm the target is writable before we try to create .avorelo/.
  try { accessSync(dir, constants.W_OK); } catch { return { ok: false, created: false, reason: "target_not_writable" }; }

  const existing = opts?.reset ? null : loadWorkspace(dir);
  const workspaceId = existing?.workspaceId ?? ("ws_" + randomUUID().replace(/-/g, "").slice(0, 16));
  const createdAt = existing?.createdAt ?? new Date(now).toISOString();
  const created = !existing;

  try {
    mkdirSync(avoreloDir(dir), { recursive: true });
    const workspace: WorkspaceRecord = {
      contract: WORKSPACE_V1_CONTRACT,
      schemaVersion: 1,
      workspaceId,
      createdAt,
      target: dir,
      localOnly: true,
    };
    writeFileSync(workspacePath(dir), JSON.stringify(workspace, null, 2));
    const contract = buildActivationContract(dir, { now, workspaceId, createdAt });
    writeFileSync(activationPath(dir), JSON.stringify(contract, null, 2));
    return { ok: true, created, workspacePath: workspacePath(dir), activationPath: activationPath(dir), contract };
  } catch {
    return { ok: false, created: false, reason: "avorelo_dir_not_writable" };
  }
}

/** Deterministic invariants: the activation contract must stay local-only, unclaimed, and carry no raw content. */
export function validateActivationContract(c: ActivationContractV1): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (c.contract !== ACTIVATION_V1_CONTRACT) reasons.push("wrong_contract");
  if (c.localOnly !== true) reasons.push("not_local_only");
  if (c.cloudClaimed !== false) reasons.push("cloud_claimed_in_v1");
  if (c.safety.redacted !== true) reasons.push("not_redacted");
  if (c.safety.containsRawSecret !== false) reasons.push("contains_raw_secret");
  if (c.safety.containsRawSource !== false) reasons.push("contains_raw_source");
  if (c.safety.containsEnvValue !== false) reasons.push("contains_env_value");
  return { valid: reasons.length === 0, reasons };
}
