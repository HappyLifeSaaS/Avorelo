// Avorelo Slice-2 tests (Safe Activation). Zero-dep, node:test. Synthetic + sandboxed (never ~/.claude).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { buildHookConfig, installHooks, validateInstall, uninstall, handleLifecycleHook, LIFECYCLE_EVENTS } from "../src/avorelo/adapters/claude-code/index.ts";
import { preToolUse } from "../src/avorelo/kernel/pretooluse-gate/index.ts";
import { checkWrite, checkModelRead, carriesRawSecret } from "../src/avorelo/kernel/runtime-boundary/index.ts";
import { activate, doctor, makeSandboxTarget, cleanupSandbox } from "../src/avorelo/capabilities/activation/index.ts";
import { createWorkContract } from "../src/avorelo/kernel/work-contract/index.ts";
import { buildKernelRegistry, OwnershipRegistry } from "../src/avorelo/kernel/registry/index.ts";
import type { ToolRequest } from "../src/avorelo/kernel/pretooluse-gate/index.ts";

const ctr = (dir: string) => createWorkContract({ contractId: "t", objective: "t", allowedPaths: [join(dir, "src")], planTier: "Free" });

test("hook config — 6 events, PreToolUse matcher *, avorelo commands", () => {
  const h = buildHookConfig();
  assert.deepEqual(Object.keys(h).sort(), [...LIFECYCLE_EVENTS].sort());
  assert.equal(h.PreToolUse[0].matcher, "*");
  assert.match(h.PreToolUse[0].hooks[0].command, /avorelo[\s\S]*lifecycle-hook PreToolUse$/i);
});

test("install refuses without --approve (no silent install)", () => {
  const dir = makeSandboxTarget();
  try {
    assert.throws(() => installHooks(dir, { approve: false }), /requires explicit approval/);
  } finally {
    cleanupSandbox(dir);
  }
});

test("install refuses to target the global ~/.claude / home dir", () => {
  assert.throws(() => installHooks(homedir(), { approve: true }), /REFUSED/);
  assert.throws(() => installHooks(join(homedir(), ".claude"), { approve: true }), /REFUSED/);
});

test("install is repo-local; backup created when settings pre-exist; non-avorelo hooks preserved", () => {
  const dir = makeSandboxTarget();
  try {
    // pre-existing settings with a NON-avorelo hook
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "other-tool x" }] }] }, foo: 1 }));
    const r = installHooks(dir, { approve: true });
    assert.ok(r.settingsPath.startsWith(dir)); // repo-local
    assert.ok(r.backupPath && existsSync(r.backupPath)); // backed up
    const s = JSON.parse(readFileSync(r.settingsPath, "utf8"));
    assert.equal(s.foo, 1); // preserved other keys
    const cmds = s.hooks.PreToolUse.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    assert.ok(cmds.includes("other-tool x")); // preserved non-avorelo hook
    assert.ok(cmds.some((c: string) => /avorelo[\s\S]*lifecycle-hook/i.test(c))); // added avorelo
  } finally {
    cleanupSandbox(dir);
  }
});

test("validate detects missing then well-formed; uninstall restores", () => {
  const dir = makeSandboxTarget();
  try {
    assert.equal(validateInstall(dir).installed, false);
    installHooks(dir, { approve: true });
    assert.equal(validateInstall(dir).wellFormed, true);
    // corrupt -> not well-formed
    writeFileSync(join(dir, ".claude", "settings.json"), "{ not json");
    assert.equal(validateInstall(dir).wellFormed, false);
  } finally {
    cleanupSandbox(dir);
  }
});

test("uninstall is idempotent — activate twice, uninstall once, no avorelo hooks remain, foreign hooks kept (Issue 1)", () => {
  const dir = makeSandboxTarget();
  try {
    // pre-existing settings with a NON-avorelo hook + an unrelated key
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "other-tool x" }] }] }, foo: 1 }));

    activate(dir, { approve: true }); // #1
    activate(dir, { approve: true }); // #2 (re-activation; must not overwrite the pristine backup)
    assert.equal(validateInstall(dir).wellFormed, true);

    const u = uninstall(dir);
    const s = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
    const cmds = Object.values(s.hooks ?? {}).flatMap((groups: any) => groups.flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command)));
    // no avorelo hooks anywhere
    assert.ok(!cmds.some((c: string) => /avorelo[\s\S]*lifecycle-hook/i.test(c)), `avorelo hook leaked after uninstall: ${cmds.join(" | ")}`);
    // foreign hook + unrelated key preserved
    assert.ok(cmds.includes("other-tool x"), "foreign hook was wrongly removed");
    assert.equal(s.foo, 1);
    // settings remain parseable; validate reflects removal
    assert.equal(validateInstall(dir).wellFormed, false);
    assert.ok(u.restored || u.reasonCodes.includes("STRIPPED_AVORELO_HOOKS"));
  } finally {
    cleanupSandbox(dir);
  }
});

test("uninstall is idempotent — no pre-existing settings, activate twice then uninstall leaves zero avorelo hooks", () => {
  const dir = makeSandboxTarget();
  try {
    activate(dir, { approve: true }); // #1 (fresh; no backup created)
    activate(dir, { approve: true }); // #2
    uninstall(dir);
    const s = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
    const cmds = Object.values(s.hooks ?? {}).flatMap((groups: any) => groups.flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command)));
    assert.ok(!cmds.some((c: string) => /avorelo[\s\S]*lifecycle-hook/i.test(c)));
    assert.equal(validateInstall(dir).wellFormed, false);
  } finally {
    cleanupSandbox(dir);
  }
});

test("PreToolUse gate — benign allow / out-of-scope block / secret block / destructive block / external approval / unknown fail-closed", () => {
  const dir = "/work";
  const c = createWorkContract({ contractId: "g", objective: "g", allowedPaths: ["/work/src"], planTier: "Free" });
  const mk = (r: Partial<ToolRequest>) => preToolUse({ tool: "edit", workingDir: dir, ...r } as ToolRequest, { contract: c });
  assert.equal(mk({ tool: "edit", writePath: "/work/src/a.ts" }).verdict, "allow");
  assert.equal(mk({ tool: "edit", writePath: "/etc/passwd" }).verdict, "block");
  assert.equal(mk({ tool: "bash", content: "echo AKIA1234567" + "890ABCD99" }).verdict, "block");
  assert.equal(mk({ tool: "bash", content: "rm -rf /" }).verdict, "block");
  assert.equal(mk({ tool: "web_fetch", content: "https://x" }).verdict, "needs_approval");
  assert.equal(mk({ tool: "frobnicate", content: "?" }).verdict, "needs_approval"); // fail-closed unknown
});

test("runtime boundary — write confinement + secret-file read denial", () => {
  assert.equal(checkWrite("/work/src/a.ts", { workingDir: "/work" }).allowed, true);
  assert.equal(checkWrite("/etc/passwd", { workingDir: "/work" }).allowed, false);
  assert.equal(checkModelRead("/home/u/.ssh/id_rsa").allowedForModel, false);
  assert.equal(checkModelRead("/home/u/.aws/credentials").allowedForModel, false);
  assert.equal(checkModelRead("/work/src/a.ts").allowedForModel, true);
  assert.equal(carriesRawSecret({ x: "AKIA1234567" + "890ABCD99" }), true);
});

test("runtime boundary — checkWrite enforces allowedPaths AND blocks sensitive paths (Issue 2)", () => {
  const wd = "/work";
  // allowedPaths narrows within the working dir
  assert.equal(checkWrite("/work/src/a.ts", { workingDir: wd, allowedPaths: ["/work/src"] }).allowed, true);
  assert.equal(checkWrite("/work/other.txt", { workingDir: wd, allowedPaths: ["/work/src"] }).allowed, false);
  // sensitive paths are blocked even when inside working dir (and even with permissive allowedPaths)
  assert.equal(checkWrite("/work/.env", { workingDir: wd }).allowed, false);
  assert.equal(checkWrite("/work/.env", { workingDir: wd, allowedPaths: ["/work"] }).allowed, false);
  assert.equal(checkWrite("/work/.ssh/id_rsa", { workingDir: wd }).allowed, false);
  assert.equal(checkWrite("/work/.aws/credentials", { workingDir: wd }).allowed, false);
  assert.equal(checkWrite("/work/secret.pem", { workingDir: wd }).allowed, false);
  // outside the working dir is always blocked
  assert.equal(checkWrite("/etc/passwd", { workingDir: wd }).allowed, false);
  // path traversal that resolves outside the working dir is blocked
  assert.equal(checkWrite("/work/../etc/passwd", { workingDir: wd }).allowed, false);
  // empty allowedPaths => anywhere inside working dir (minus sensitive) is allowed
  assert.equal(checkWrite("/work/anything.txt", { workingDir: wd }).allowed, true);
});

test("lifecycle-hook — secret PreToolUse blocked (exit 2), no raw secret in result; recursion guarded", () => {
  const dir = "/work";
  const res = handleLifecycleHook("PreToolUse", { tool: "bash", content: "use AKIA1234567" + "890ABCD99", workingDir: dir } as ToolRequest, { contract: ctr(dir) });
  assert.equal(res.verdict, "block");
  assert.equal(res.exitCode, 2);
  assert.ok(!JSON.stringify(res).includes("AKIA1234567" + "890ABCD99"));
  assert.equal(typeof res.latencyMs, "number");
  // recursion guard
  process.env.AVORELO_HOOK_ACTIVE = "1";
  const guarded = handleLifecycleHook("PreToolUse", { tool: "edit", workingDir: dir } as ToolRequest, { contract: ctr(dir) });
  delete process.env.AVORELO_HOOK_ACTIVE;
  assert.equal(guarded.recursionSkipped, true);
});

test("activate (sandbox) — ok, repo-local, receipt redacted, never ~/.claude; doctor passes then detects breakage", () => {
  const dir = makeSandboxTarget();
  try {
    assert.ok(!dir.startsWith(join(homedir(), ".claude")));
    const r = activate(dir, { approve: true });
    assert.equal(r.ok, true);
    assert.ok(r.install.settingsPath.startsWith(dir)); // repo-local only
    assert.equal(r.receipt.decision, "STOP_DONE");
    assert.ok(!JSON.stringify(r.receipt).includes("AKIA")); // redacted/no secret
    const d1 = doctor(dir);
    assert.equal(d1.ok, true);
    writeFileSync(join(dir, ".claude", "settings.json"), "{ broken");
    const d2 = doctor(dir);
    assert.equal(d2.ok, false); // broken install detected
  } finally {
    cleanupSandbox(dir);
  }
});

test("capability-collision — runtime-boundary single owner; canonical registry clean", () => {
  assert.doesNotThrow(() => buildKernelRegistry());
  const reg = new OwnershipRegistry();
  reg.register("runtime-boundary", "kernel/runtime-boundary");
  assert.throws(() => reg.register("runtime-boundary", "adapters/claude-code"), /CAPABILITY_COLLISION/);
});
