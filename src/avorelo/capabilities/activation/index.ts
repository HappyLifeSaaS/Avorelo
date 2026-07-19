// Avorelo Activation capability (Slice 2). Orchestrates: install hooks -> validate -> synthetic fire ->
// activation receipt. Owns no policy/evidence/receipt (calls Kernel). Repo-local, approval-gated, safe.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installHooks, validateInstall, uninstall, handleLifecycleHook } from "../../adapters/claude-code/index.ts";
import { createWorkContract } from "../../kernel/work-contract/index.ts";
import { StateLedger } from "../../kernel/state-ledger/index.ts";
import { writeReceipt } from "../../kernel/receipts/index.ts";
import type { GradedEvidence, Receipt, DecisionBasis } from "../../shared/schemas/index.ts";
import type { ToolRequest } from "../../kernel/pretooluse-gate/index.ts";

export type ActivateResult = { ok: boolean; targetDir: string; install: ReturnType<typeof installHooks>; validate: ReturnType<typeof validateInstall>; firing: { verdict: string; latencyMs: number }; receipt: Receipt };

export function activate(targetDir: string, opts: { approve: boolean }): ActivateResult {
  const contract = createWorkContract({
    contractId: "activate",
    objective: "activate avorelo locally (install + validate hooks)",
    allowedPaths: [join(targetDir, ".claude"), join(targetDir, ".avorelo")],
    successCriteria: ["hooks installed", "hooks validated", "hook fires + gate responds"],
    planTier: "Free",
  });

  const install = installHooks(targetDir, { approve: opts.approve });
  const validate = validateInstall(targetDir);

  // Synthetic "fire" proof: invoke the lifecycle handler with a benign PreToolUse request -> gate responds.
  // The probe uses its own contract scoped to where it writes (src), so a benign edit is a truthful ALLOW
  // (the activation contract above scopes to .claude/.avorelo, which is correct for activation work itself).
  const probeContract = createWorkContract({
    contractId: "activate-probe",
    objective: "synthetic gate probe (benign edit)",
    allowedPaths: [join(targetDir, "src")],
    planTier: "Free",
  });
  const benign: ToolRequest = { tool: "edit", writePath: join(targetDir, "src", "x.ts"), workingDir: targetDir };
  const fired = handleLifecycleHook("PreToolUse", benign, { contract: probeContract });

  const installedOk = validate.installed && validate.wellFormed;
  const firedOk = typeof fired.verdict === "string";

  // OUTCOME = hooks installed+valid; POST_ACTION = hook fired and gate returned a decision.
  const graded: GradedEvidence[] = [];
  if (installedOk) graded.push({ artifactId: "g1", level: "OUTCOME", ref: "ev:hooks-installed-valid" });
  if (firedOk) graded.push({ artifactId: "g2", level: "POST_ACTION", ref: "ev:hook-fired-gate-responded" });

  const decisionBasis: DecisionBasis = {
    method: "deterministic",
    confidence: "LOW",
    evidenceRefs: graded.map((g) => g.ref),
    reasonCodes: ["ACTIVATION", ...install.reasonCodes],
    fallbackUsed: false,
  };

  const ledger = new StateLedger();
  const decision = installedOk && firedOk ? "STOP_DONE" : "STOP_BLOCKED";
  const receipt = writeReceipt(ledger, {
    contractId: contract.contractId,
    decision,
    graded,
    safeNextActions: decision === "STOP_DONE" ? [] : ["re-run avorelo doctor; fix hook install"],
    decisionBasis,
    sampleSize: 1,
    redactionClasses: fired.redactionClasses,
    receiptId: "rcpt_activation",
  });

  return { ok: decision === "STOP_DONE", targetDir, install, validate, firing: { verdict: fired.verdict, latencyMs: fired.latencyMs }, receipt };
}

export type DoctorCheck = { id: string; label: string; passed: boolean; details: string };
export type DoctorResult = { ok: boolean; checks: DoctorCheck[]; hookLatencyMs: number };

export function doctor(targetDir: string): DoctorResult {
  const checks: DoctorCheck[] = [];

  // 1) Real write-probe under .avorelo (proves local write works).
  let writeOk = false;
  try {
    const probeDir = join(targetDir, ".avorelo");
    mkdirSync(probeDir, { recursive: true });
    const probe = join(probeDir, ".doctor-probe");
    writeFileSync(probe, "ok");
    rmSync(probe);
    writeOk = true;
  } catch (e) {
    checks.push({ id: "write-probe", label: "Local write probe", passed: false, details: (e as Error).message });
  }
  if (writeOk) checks.push({ id: "write-probe", label: "Local write probe", passed: true, details: ".avorelo writable" });

  // 2) Install present + well-formed.
  const v = validateInstall(targetDir);
  checks.push({
    id: "hooks-installed",
    label: "Claude Code hooks installed + well-formed",
    passed: v.installed && v.wellFormed,
    details: v.installed ? (v.wellFormed ? "all 6 events reference avorelo" : `missing: ${v.missingEvents.join(", ")}`) : "settings.json not found",
  });

  // 3) Hook-firing: the gate actually responds to a synthetic PreToolUse.
  const contract = createWorkContract({ contractId: "doctor", objective: "doctor", allowedPaths: [join(targetDir, "src")], planTier: "Free" });
  const fired = handleLifecycleHook("PreToolUse", { tool: "edit", writePath: join(targetDir, "src", "x.ts"), workingDir: targetDir } as ToolRequest, { contract });
  checks.push({ id: "hook-firing", label: "Hook fires + Kernel gate responds", passed: typeof fired.verdict === "string", details: `verdict=${fired.verdict} latency=${fired.latencyMs.toFixed(3)}ms` });

  return { ok: checks.every((c) => c.passed), checks, hookLatencyMs: fired.latencyMs };
}

/** Test/dogfood helper: a throwaway repo-local target under the OS temp dir (NEVER ~/.claude). */
export function makeSandboxTarget(): string {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-activate-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

export function cleanupSandbox(dir: string): void {
  if (existsSync(dir) && dir.includes("avorelo-activate-")) rmSync(dir, { recursive: true, force: true });
}

export { uninstall };
