// Avorelo Claude Code adapter (Slice 2). Repo-local hook install ONLY (never ~/.claude). Mines hook-apply
// safety concepts (backup + explicit approval + recursion guard + merge), rewritten clean. Avorelo-only naming.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { resolve, join, sep, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { preToolUse } from "../../kernel/pretooluse-gate/index.ts";
import type { ToolRequest, PreToolUseResult } from "../../kernel/pretooluse-gate/index.ts";
import { postToolUseRedact } from "../../capabilities/secret-boundary/runtime-gate.ts";
import type { WorkContract } from "../../shared/schemas/index.ts";

export const LIFECYCLE_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

type HookEntry = { type: "command"; command: string };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type Settings = { hooks?: Record<string, HookGroup[]>; [k: string]: unknown };

/** Absolute path to this repo's CLI, so an installed hook is genuinely executable by the runtime
 *  WITHOUT a global install. (A globally-installed product would use the bin name; for now the
 *  resolvable `node <abs>` form is what actually fires in a real Claude Code session.) Forward slashes
 *  for cross-shell safety. A globally-installed `avorelo` can override via AVORELO_HOOK_CMD. */
export function defaultHookCommand(event: string): string {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../../surfaces/cli/avorelo.ts").replace(/\\/g, "/");
  const base = process.env.AVORELO_HOOK_CMD ?? `node "${cli}"`;
  return `${base} lifecycle-hook ${event}`;
}

// Avorelo hooks are identified by the stable "avorelo … lifecycle-hook" marker (covers both the
// resolvable node form and a future global `avorelo` bin), so merge/uninstall never touch other tools' hooks.
const isAvoreloHook = (g: HookGroup) => g.hooks?.some((h) => /avorelo[\s\S]*lifecycle-hook/i.test(h.command ?? ""));

/** Claude Code settings.json hooks block (VERIFIED hooks format). PreToolUse uses matcher "*" (block point). */
export function buildHookConfig(): Record<string, HookGroup[]> {
  const out: Record<string, HookGroup[]> = {};
  for (const ev of LIFECYCLE_EVENTS) {
    const group: HookGroup = { hooks: [{ type: "command", command: defaultHookCommand(ev) }] };
    if (ev === "PreToolUse" || ev === "PostToolUse") group.matcher = "*";
    out[ev] = [group];
  }
  return out;
}

function assertRepoLocal(targetDir: string): void {
  const t = resolve(targetDir);
  const home = resolve(homedir());
  if (t === home) throw new Error("REFUSED: activation target is the home directory (would write global ~/.claude).");
  const globalClaude = resolve(home, ".claude");
  if (t === globalClaude || t.startsWith(globalClaude + sep)) throw new Error("REFUSED: target is inside global ~/.claude.");
}

export type InstallResult = { installed: boolean; settingsPath: string; backupPath: string | null; merged: boolean; reasonCodes: string[] };

/** Install Avorelo hooks into <targetDir>/.claude/settings.json. Repo-local only; explicit approval required. */
export function installHooks(targetDir: string, opts: { approve: boolean }): InstallResult {
  assertRepoLocal(targetDir);
  if (!opts.approve) throw new Error("REFUSED: hook install requires explicit approval (no silent install).");

  const claudeDir = join(targetDir, ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  mkdirSync(claudeDir, { recursive: true });

  let existing: Settings = {};
  let backupPath: string | null = null;
  let merged = false;
  if (existsSync(settingsPath)) {
    let parseable = true;
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
      merged = true;
    } catch {
      existing = {};
      parseable = false;
    }
    // Back up ONLY the pre-Avorelo baseline. On re-activation (settings already contain Avorelo hooks),
    // skip the backup so the pristine baseline from the first install is never overwritten by an
    // Avorelo-bearing snapshot — this is what makes uninstall idempotent across repeated activations.
    const alreadyHasAvorelo = parseable && LIFECYCLE_EVENTS.some((ev) => (existing.hooks?.[ev] ?? []).some(isAvoreloHook));
    if (!alreadyHasAvorelo) {
      const backupDir = join(targetDir, ".avorelo", "backups");
      mkdirSync(backupDir, { recursive: true });
      backupPath = join(backupDir, `settings-${Date.now()}.json`);
      copyFileSync(settingsPath, backupPath);
    }
  }

  const avoreloHooks = buildHookConfig();
  const hooks: Record<string, HookGroup[]> = { ...(existing.hooks ?? {}) };
  for (const ev of LIFECYCLE_EVENTS) {
    const others = (hooks[ev] ?? []).filter((g) => !isAvoreloHook(g)); // preserve non-Avorelo hooks; replace Avorelo ones
    hooks[ev] = [...others, ...avoreloHooks[ev]];
  }
  const next: Settings = { ...existing, hooks };
  writeFileSync(settingsPath, JSON.stringify(next, null, 2));
  return { installed: true, settingsPath, backupPath, merged, reasonCodes: merged ? ["MERGED_BACKED_UP"] : ["FRESH_INSTALL"] };
}

export type ValidateResult = { installed: boolean; wellFormed: boolean; missingEvents: string[]; problems: string[] };

export function validateInstall(targetDir: string): ValidateResult {
  const settingsPath = join(targetDir, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return { installed: false, wellFormed: false, missingEvents: [...LIFECYCLE_EVENTS], problems: ["settings.json not found"] };
  let s: Settings;
  try {
    s = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
  } catch (e) {
    return { installed: true, wellFormed: false, missingEvents: [], problems: [`settings.json not parseable: ${(e as Error).message}`] };
  }
  const missingEvents: string[] = [];
  for (const ev of LIFECYCLE_EVENTS) {
    const groups = s.hooks?.[ev] ?? [];
    if (!groups.some(isAvoreloHook)) missingEvents.push(ev);
  }
  return { installed: true, wellFormed: missingEvents.length === 0, missingEvents, problems: [] };
}

/**
 * Idempotent uninstall. Restores the pristine pre-Avorelo backup if present, then ALWAYS strips any
 * remaining Avorelo hooks as defense-in-depth (never touching non-Avorelo hooks). Running activate any
 * number of times then uninstall leaves zero Avorelo hooks and all foreign hooks intact.
 */
export function uninstall(targetDir: string): { restored: boolean; reasonCodes: string[] } {
  const settingsPath = join(targetDir, ".claude", "settings.json");
  const backupDir = join(targetDir, ".avorelo", "backups");
  const reasonCodes: string[] = [];
  let restored = false;

  if (existsSync(backupDir)) {
    // All retained backups are pre-Avorelo by construction (installHooks skips backup on re-activation),
    // so the most recent backup is a clean baseline to restore.
    const backups = readdirSync(backupDir).filter((f) => f.startsWith("settings-")).sort();
    if (backups.length > 0) {
      copyFileSync(join(backupDir, backups[backups.length - 1]), settingsPath);
      restored = true;
      reasonCodes.push("RESTORED_FROM_BACKUP");
    }
  }

  // Defense-in-depth: strip any Avorelo hooks still present (idempotent regardless of restore path).
  if (existsSync(settingsPath)) {
    try {
      const s = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
      if (s.hooks) {
        for (const ev of LIFECYCLE_EVENTS) {
          if (s.hooks[ev]) s.hooks[ev] = s.hooks[ev].filter((g) => !isAvoreloHook(g));
        }
      }
      writeFileSync(settingsPath, JSON.stringify(s, null, 2));
      if (!restored) reasonCodes.push("STRIPPED_AVORELO_HOOKS");
    } catch {
      reasonCodes.push("SETTINGS_UNPARSEABLE_LEFT_INTACT");
    }
  }
  if (reasonCodes.length === 0) reasonCodes.push("NOTHING_TO_UNINSTALL");
  return { restored, reasonCodes };
}

export type HookHandlerResult = { event: string; verdict: string; reasonCodes: string[]; redactionClasses: string[]; exitCode: number; latencyMs: number; recursionSkipped?: boolean; correction?: string; updatedToolOutput?: unknown; updatedMcpToolOutput?: unknown };

/**
 * Handle a Claude Code lifecycle hook event. PreToolUse is the deterministic block point.
 * All events route through the session orchestrator when a session exists.
 * Recursion-guarded via AVORELO_HOOK_ACTIVE.
 */
export function handleLifecycleHook(event: LifecycleEvent | string, payload: unknown, ctx: { contract: WorkContract; dir?: string }): HookHandlerResult {
  const start = process.hrtime.bigint();
  if (process.env.AVORELO_HOOK_ACTIVE === "1") {
    return { event, verdict: "allow", reasonCodes: ["RECURSION_GUARD_SKIP"], redactionClasses: [], exitCode: 0, latencyMs: 0, recursionSkipped: true };
  }
  process.env.AVORELO_HOOK_ACTIVE = "1";
  try {
    const dir = ctx.dir;
    let sessionResult: { verdict: string; corrections?: string; driftSignals: unknown[] } | null = null;

    // Route through session orchestrator if dir is available
    if (dir) {
      try {
        const { processHookEvent } = require("../../capabilities/session/index.ts");
        const req = payload as Record<string, unknown>;
        sessionResult = processHookEvent(dir, event, {
          toolName: req.tool as string,
          filePath: req.writePath as string,
          content: req.content as string,
          command: req.tool === "bash" ? req.content as string : undefined,
          success: undefined,
        });
      } catch {}
    }

    if (event === "PreToolUse") {
      const req = payload as ToolRequest;
      const r: PreToolUseResult = preToolUse(req, ctx);
      const exitCode = r.verdict === "allow" ? 0 : 2;

      // If session detected drift requiring approval, override to block
      if (sessionResult && sessionResult.verdict === "needs_approval" && r.verdict === "allow") {
        const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
        return { event, verdict: "needs_approval", reasonCodes: [...r.reasonCodes, "SESSION_DRIFT_APPROVAL"], redactionClasses: r.redactionClasses, exitCode: 2, latencyMs, correction: sessionResult.corrections };
      }

      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      return { event, verdict: r.verdict, reasonCodes: r.reasonCodes, redactionClasses: r.redactionClasses, exitCode, latencyMs, correction: sessionResult?.corrections };
    }

    // PostToolUse: redact tool output via Secret Boundary, return mutation fields.
    if (event === "PostToolUse") {
      const req = payload as Record<string, unknown>;
      const toolOutput = req.tool_response ?? req.tool_output ?? req.output ?? req.content ?? "";
      const redaction = postToolUseRedact(toolOutput);
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      return { event, verdict: "allow", reasonCodes: redaction.findings.map(f => f.code), redactionClasses: redaction.findings.map(f => `${f.code}:${f.severity}`), exitCode: 0, latencyMs, correction: sessionResult?.corrections, updatedToolOutput: redaction.updatedToolOutput, updatedMcpToolOutput: redaction.updatedMcpToolOutput };
    }

    // SessionEnd: session orchestrator writes receipt
    if (event === "SessionEnd" && dir) {
      try {
        const { processHookEvent } = require("../../capabilities/session/index.ts");
        processHookEvent(dir, "SessionEnd");
      } catch {}
    }

    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { event, verdict: "allow", reasonCodes: ["RECORDED"], redactionClasses: [], exitCode: 0, latencyMs, correction: sessionResult?.corrections };
  } finally {
    delete process.env.AVORELO_HOOK_ACTIVE;
  }
}
