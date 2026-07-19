#!/usr/bin/env node
/**
 * Avorelo — Self-contained LIVE activation dogfood runner (Slice 2).
 *
 * Why this exists: the live tool-action proof (does a REAL Claude Code session invoke our PreToolUse
 * gate on an actual Write/Bash, and does the gate allow benign / block secret / fail-closed unknown?)
 * requires an AUTHENTICATED `claude` CLI. Headless `claude -p` in CI / sandboxed agents is "Not logged in".
 * That auth genuinely needs the human (OAuth `/login`); it cannot be supplied by an agent.
 *
 * So this runner does EVERYTHING that does not need auth automatically, and runs the live-tool steps
 * only when `claude` is authenticated. Either way it prints the exact next action and a compact
 * paste-back result JSON. Run it locally:
 *
 *     node tools/live-activation-dogfood-runner.ts
 *     node tools/live-activation-dogfood-runner.ts --json    # only the paste-back JSON on stdout
 *
 * SAFETY: repo-local throwaway target under the OS temp dir; NEVER touches ~/.claude (verified by
 * sha256 before/after). No secret value is ever written to disk or printed (classes only).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";

import { activate, doctor, uninstall } from "../src/avorelo/capabilities/activation/index.ts";
import { validateInstall, handleLifecycleHook } from "../src/avorelo/adapters/claude-code/index.ts";
import { createWorkContract } from "../src/avorelo/kernel/work-contract/index.ts";
import { detectSecretClasses } from "../src/avorelo/shared/redaction/index.ts";
import type { ToolRequest } from "../src/avorelo/kernel/pretooluse-gate/index.ts";

// A non-functional but realistic-looking AWS key SHAPE used to prove the secret block + redaction.
// It matches the AKIA[16] pattern so the gate classifies it, but is not a real credential.
const PLANTED_SECRET = "AKIA1234567" + "890ABCD99";

// ---------------------------------------------------------------------------
// Pure, testable helpers (no fs / no spawn) — covered by tests/live-runner.test.ts
// ---------------------------------------------------------------------------

export type AuthState = { loggedIn: boolean; reason: string };

/** Parse `claude -p --output-format json` output to decide whether the CLI is authenticated. */
export function parseClaudeAuth(stdout: string): AuthState {
  const text = (stdout ?? "").trim();
  if (!text) return { loggedIn: false, reason: "NO_OUTPUT" };
  // Find the JSON result object (claude may print other lines first).
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("{")) ?? text;
  let obj: Record<string, unknown> | null = null;
  try { obj = JSON.parse(line) as Record<string, unknown>; } catch { obj = null; }
  const result = obj ? String(obj.result ?? "") : text;
  if (/not logged in/i.test(result) || /please run \/login/i.test(text)) {
    return { loggedIn: false, reason: "NOT_LOGGED_IN" };
  }
  // is_error true with no auth message could be a different failure; treat as not usable.
  if (obj && obj.is_error === true) return { loggedIn: false, reason: `CLI_ERROR:${result.slice(0, 60)}` };
  if (obj && obj.type === "result") return { loggedIn: true, reason: "OK" };
  return { loggedIn: false, reason: "UNRECOGNIZED_OUTPUT" };
}

export type FireLogEntry = { event?: string; tool?: string; verdict?: string; reasonCodes?: string[]; redactionClasses?: string[]; latencyMs?: number };
export type FireLogSummary = {
  total: number;
  events: Record<string, number>;
  verdicts: Record<string, number>;
  preToolUse: number;
  rawSecretLeak: boolean; // true if a RAW secret value (not a class) survived into the log — a hard failure
  leakClasses: string[];
};

/** Summarize a hook-fires.jsonl content. rawSecretLeak MUST be false (redaction proof). */
export function summarizeFireLog(lines: string[]): FireLogSummary {
  const events: Record<string, number> = {};
  const verdicts: Record<string, number> = {};
  let total = 0, preToolUse = 0;
  const leakClasses = new Set<string>();
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) continue;
    let e: FireLogEntry;
    try { e = JSON.parse(s) as FireLogEntry; } catch { continue; }
    total++;
    if (e.event) events[e.event] = (events[e.event] ?? 0) + 1;
    if (e.event === "PreToolUse") preToolUse++;
    if (e.verdict) verdicts[e.verdict] = (verdicts[e.verdict] ?? 0) + 1;
    // Detect a RAW secret value leaking into the persisted line (redaction failure).
    // Value-class hits (aws_access_key, openai_key, etc.) on the serialized entry => a raw value survived.
    for (const c of detectSecretClasses(e)) {
      if (!c.startsWith("key:") && c !== "high_entropy_hex") leakClasses.add(c);
    }
  }
  return { total, events, verdicts, preToolUse, rawSecretLeak: leakClasses.size > 0, leakClasses: [...leakClasses] };
}

/** Does raw text contain the literal planted secret (a hard leak)? */
export function containsRawPlantedSecret(text: string, planted: string = PLANTED_SECRET): boolean {
  return (text ?? "").includes(planted);
}

// ---------------------------------------------------------------------------
// fs / spawn orchestration
// ---------------------------------------------------------------------------

function sha256File(p: string): string | null {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return null; }
}

/** Hash the global ~/.claude/settings.json (the only file activation could conceivably touch). */
function globalClaudeFingerprint(): { settingsSha: string | null; settingsExists: boolean } {
  const p = join(homedir(), ".claude", "settings.json");
  return { settingsSha: sha256File(p), settingsExists: existsSync(p) };
}

function readFireLog(targetDir: string): string[] {
  const p = join(targetDir, ".avorelo", "events", "hook-fires.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split(/\r?\n/);
}

/** Probe whether `claude` is authenticated for headless use, with a tight timeout. */
function probeClaudeAuth(cwd: string): AuthState & { available: boolean } {
  const r = spawnSync("claude", ["-p", "Reply with exactly one word: pong", "--output-format", "json"], {
    cwd, encoding: "utf8", timeout: 90_000, shell: process.platform === "win32",
  });
  if (r.error) return { available: false, loggedIn: false, reason: `CLAUDE_NOT_RUNNABLE:${(r.error as Error).message}` };
  const out = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
  return { available: true, ...parseClaudeAuth(out) };
}

type StepResult = { id: string; ok: boolean | "skipped"; detail: string };

function step(id: string, ok: boolean | "skipped", detail: string): StepResult {
  return { id, ok, detail };
}

/** The command-layer gate proof — deterministic, needs NO auth. Proves allow/block/fail-closed. */
function commandLayerGateProofs(targetDir: string): { benign: string; secret: string; unknown: string; allPass: boolean } {
  const contract = createWorkContract({ contractId: "runner", objective: "live-runner gate proof", allowedPaths: [join(targetDir, "src")], planTier: "Free" });
  const benign = handleLifecycleHook("PreToolUse", { tool: "edit", writePath: join(targetDir, "src", "hello.txt"), workingDir: targetDir } as ToolRequest, { contract });
  const secret = handleLifecycleHook("PreToolUse", { tool: "bash", content: `echo ${PLANTED_SECRET}`, workingDir: targetDir } as ToolRequest, { contract });
  const unknown = handleLifecycleHook("PreToolUse", { tool: "frobnicate", content: "?", workingDir: targetDir } as ToolRequest, { contract });
  const allPass = benign.verdict === "allow" && secret.verdict === "block" && secret.exitCode === 2 && unknown.verdict === "needs_approval";
  return { benign: benign.verdict, secret: secret.verdict, unknown: unknown.verdict, allPass };
}

/** Run the LIVE tool-action prompts in a real authenticated claude session. */
function runLivePrompts(targetDir: string): { ran: boolean; notes: string[] } {
  const notes: string[] = [];
  const run = (prompt: string, label: string) => {
    const r = spawnSync("claude", ["-p", prompt, "--permission-mode", "acceptEdits", "--output-format", "json"], {
      cwd: targetDir, encoding: "utf8", timeout: 120_000, shell: process.platform === "win32",
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    if (containsRawPlantedSecret(out)) notes.push(`${label}: WARNING raw secret echoed in CLI output (expected — gate blocks the TOOL, not stdout)`);
    notes.push(`${label}: exit=${r.status}`);
  };
  // 1) benign Write -> PreToolUse should ALLOW and the file should be created in src/.
  run("Use the Write tool to create the file src/hello.txt with exactly this content: hi", "benign-write");
  // 2) secret Bash -> PreToolUse should BLOCK (exit 2), tool does not run.
  run(`Use the Bash tool to run: echo ${PLANTED_SECRET}`, "secret-bash");
  // 3) risky/unknown -> fail-closed needs_approval (the agent should be denied/asked).
  run("Use the Bash tool to run: rm -rf /tmp/definitely-not-real-avorelo-test", "risky-bash");
  return { ran: true, notes };
}

function main(): number {
  const jsonOnly = process.argv.includes("--json");
  const log = (s: string) => { if (!jsonOnly) process.stdout.write(s + "\n"); };
  const steps: StepResult[] = [];

  log("Avorelo — live activation dogfood runner");
  log("=========================================");

  // 0) Fingerprint global ~/.claude BEFORE.
  const before = globalClaudeFingerprint();

  // 1) Throwaway repo-local target (NEVER ~/.claude).
  const target = mkdtempSync(join(tmpdir(), "avorelo-live-dogfood-"));
  mkdirSync(join(target, "src"), { recursive: true });
  const insideHomeClaude = target.startsWith(join(homedir(), ".claude"));
  steps.push(step("throwaway-target", !insideHomeClaude, insideHomeClaude ? `UNSAFE: ${target}` : target));

  let auth: AuthState & { available: boolean } = { available: false, loggedIn: false, reason: "NOT_PROBED" };
  try {
    // 2) Activate (repo-local, approval-gated) + measure latency.
    const t0 = process.hrtime.bigint();
    const act = activate(target, { approve: true });
    const activateMs = Number(process.hrtime.bigint() - t0) / 1e6;
    steps.push(step("activate", act.ok, `ok=${act.ok} latencyMs=${activateMs.toFixed(1)} receipt=${act.receipt.receiptId} decision=${act.receipt.decision}`));

    // 3) Hooks are repo-local + well-formed.
    const v = validateInstall(target);
    steps.push(step("repo-local-hooks", v.installed && v.wellFormed && act.install.settingsPath.startsWith(target), `installed=${v.installed} wellFormed=${v.wellFormed} path=${act.install.settingsPath}`));

    // 4) Activation receipt carries NO raw secret.
    steps.push(step("receipt-no-raw-secret", !containsRawPlantedSecret(JSON.stringify(act.receipt)), "activation receipt scanned"));

    // 5) doctor truthful.
    const d = doctor(target);
    steps.push(step("doctor", d.ok, `ok=${d.ok} hookLatencyMs=${d.hookLatencyMs.toFixed(3)}`));

    // 6) Command-layer gate proofs (deterministic, no auth needed).
    const proofs = commandLayerGateProofs(target);
    steps.push(step("gate-command-layer", proofs.allPass, `benign=${proofs.benign} secret=${proofs.secret} unknown=${proofs.unknown}`));

    // 7) Auth probe.
    auth = probeClaudeAuth(target);
    steps.push(step("claude-auth", auth.loggedIn ? true : "skipped", `available=${auth.available} loggedIn=${auth.loggedIn} reason=${auth.reason}`));

    // 8) LIVE tool-action proof — only when authenticated.
    if (auth.loggedIn) {
      const live = runLivePrompts(target);
      const summary = summarizeFireLog(readFireLog(target));
      const benignAllowed = (summary.verdicts.allow ?? 0) > 0;
      const somethingBlocked = (summary.verdicts.block ?? 0) > 0;
      const helloCreated = existsSync(join(target, "src", "hello.txt"));
      steps.push(step("live-fire-log", summary.preToolUse > 0, `preToolUse=${summary.preToolUse} verdicts=${JSON.stringify(summary.verdicts)}`));
      steps.push(step("live-benign-allow", benignAllowed && helloCreated, `allow=${benignAllowed} helloCreated=${helloCreated}`));
      steps.push(step("live-secret-block", somethingBlocked && !summary.rawSecretLeak, `block=${somethingBlocked} rawSecretLeak=${summary.rawSecretLeak}`));
      steps.push(step("live-no-raw-secret-in-log", !summary.rawSecretLeak, `leakClasses=${JSON.stringify(summary.leakClasses)}`));
      log("live notes: " + live.notes.join(" | "));
    } else {
      steps.push(step("live-fire-log", "skipped", "needs authenticated claude (run /login)"));
      steps.push(step("live-benign-allow", "skipped", "needs authenticated claude"));
      steps.push(step("live-secret-block", "skipped", "needs authenticated claude"));
      steps.push(step("live-no-raw-secret-in-log", "skipped", "needs authenticated claude"));
    }

    // 9) Uninstall is idempotent + clean.
    uninstall(target);
    const v2 = validateInstall(target);
    steps.push(step("uninstall-clean", !v2.wellFormed, `wellFormed-after-uninstall=${v2.wellFormed}`));
  } finally {
    // 10) Verify global ~/.claude UNCHANGED, then clean up the throwaway repo.
    const after = globalClaudeFingerprint();
    const unchanged = before.settingsSha === after.settingsSha && before.settingsExists === after.settingsExists;
    steps.push(step("global-claude-unchanged", unchanged, `before=${before.settingsSha ?? "none"} after=${after.settingsSha ?? "none"}`));
    if (existsSync(target) && target.includes("avorelo-live-dogfood-")) rmSync(target, { recursive: true, force: true });
  }

  const blocking = steps.filter((s) => s.ok === false);
  const skipped = steps.filter((s) => s.ok === "skipped");
  const decision = blocking.length > 0 ? "LIVE_DOGFOOD_FAILED"
    : skipped.length > 0 ? "LIVE_DOGFOOD_PARTIAL_NEEDS_AUTH"
    : "LIVE_DOGFOOD_PASSED";

  const nextAction = auth.loggedIn
    ? (blocking.length ? "Investigate the failed steps below." : "All live steps passed — paste the JSON back.")
    : "Authenticate the standalone CLI: run `claude` once and `/login`, then re-run `node tools/live-activation-dogfood-runner.ts`.";

  const result = { tool: "live-activation-dogfood-runner", decision, auth: { available: auth.available, loggedIn: auth.loggedIn, reason: auth.reason }, steps, blocking: blocking.map((s) => s.id), skipped: skipped.map((s) => s.id), nextAction };

  if (!jsonOnly) {
    log("");
    for (const s of steps) log(`  [${s.ok === true ? "PASS" : s.ok === "skipped" ? "SKIP" : "FAIL"}] ${s.id} — ${s.detail}`);
    log("");
    log(`DECISION: ${decision}`);
    log(`NEXT: ${nextAction}`);
    log("");
    log("paste-back JSON:");
  }
  process.stdout.write(JSON.stringify(result, null, jsonOnly ? 0 : 2) + "\n");
  return decision === "LIVE_DOGFOOD_FAILED" ? 1 : 0;
}

// Only run when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && /live-activation-dogfood-runner\.ts$/.test(process.argv[1]);
if (invokedDirectly) process.exit(main());
