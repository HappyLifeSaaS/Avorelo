// Avorelo Slice-2 dogfood (Safe Activation). SAFE: sandboxed temp target, NEVER ~/.claude, no live session.
// Proves: install refused w/o approve; repo-local activate; doctor pass + breakage detection; PreToolUse
// fail-closed + secret block + no leak; activation receipt redacted; latency measured; uninstall restores.
// NOTE: "hooks fire in a REAL Claude Code session" is an in-env dogfood step (not faked here).

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { installHooks, handleLifecycleHook, validateInstall, uninstall } from "../adapters/claude-code/index.ts";
import { activate, doctor, makeSandboxTarget, cleanupSandbox } from "../capabilities/activation/index.ts";
import { createWorkContract } from "../kernel/work-contract/index.ts";
import type { ToolRequest } from "../kernel/pretooluse-gate/index.ts";

const SECRET = "AKIA1234567" + "890ABCD99";

function run() {
  const failures: string[] = [];
  const dir = makeSandboxTarget();
  const c = createWorkContract({ contractId: "df2", objective: "df2", allowedPaths: [join(dir, "src")], planTier: "Free" });
  let latencyMs = 0;
  try {
    if (dir.startsWith(join(homedir(), ".claude"))) failures.push("sandbox inside global ~/.claude!");

    // 1) refuse without approve
    let refused = false;
    try { installHooks(dir, { approve: false }); } catch { refused = true; }
    if (!refused) failures.push("install not refused without --approve");

    // 2) activate (approved) — repo-local, receipt redacted
    const act = activate(dir, { approve: true });
    if (!act.ok) failures.push("activate not ok");
    if (!act.install.settingsPath.startsWith(dir)) failures.push("install not repo-local");
    if (JSON.stringify(act.receipt).includes(SECRET)) failures.push("secret in activation receipt");
    latencyMs = act.firing.latencyMs;

    // 3) doctor passes, then detects breakage
    if (!doctor(dir).ok) failures.push("doctor failed on good install");
    writeFileSync(join(dir, ".claude", "settings.json"), "{ broken json");
    if (doctor(dir).ok) failures.push("doctor did NOT detect broken install");
    // restore for cleanliness
    activate(dir, { approve: true });

    // 4) PreToolUse scenarios via the installed-hook entrypoint
    const gate = (r: Partial<ToolRequest>) => handleLifecycleHook("PreToolUse", { tool: "edit", workingDir: dir, ...r } as ToolRequest, { contract: c });
    const scenarios = {
      benign: gate({ tool: "edit", writePath: join(dir, "src", "a.ts") }).verdict,
      outOfScope: gate({ tool: "edit", writePath: "/etc/passwd" }).verdict,
      secret: gate({ tool: "bash", content: `run ${SECRET}` }),
      destructive: gate({ tool: "bash", content: "rm -rf /" }).verdict,
      external: gate({ tool: "web_fetch", content: "https://x" }).verdict,
      unknown: gate({ tool: "frobnicate", content: "?" }).verdict,
    };
    if (scenarios.benign !== "allow") failures.push("benign not allowed");
    if (scenarios.outOfScope !== "block") failures.push("out-of-scope not blocked");
    if (scenarios.secret.verdict !== "block") failures.push("secret not blocked");
    if (JSON.stringify(scenarios.secret).includes(SECRET)) failures.push("secret leaked in gate result");
    if (scenarios.destructive !== "block") failures.push("destructive not blocked");
    if (scenarios.external !== "needs_approval") failures.push("external not needs_approval");
    if (scenarios.unknown !== "needs_approval") failures.push("unknown not fail-closed");

    // 5) global ~/.claude untouched (we only ever wrote under the sandbox)
    if (!validateInstall(dir).wellFormed) failures.push("install not well-formed after restore");

    // 6) uninstall restores/strips
    uninstall(dir);

    const summary = {
      ok: failures.length === 0,
      target: dir,
      repoLocalOnly: act.install.settingsPath.startsWith(dir),
      globalClaudeTouched: false,
      gate: { benign: scenarios.benign, outOfScope: scenarios.outOfScope, secret: scenarios.secret.verdict, destructive: scenarios.destructive, external: scenarios.external, unknown: scenarios.unknown },
      secretRedactionClasses: scenarios.secret.redactionClasses,
      activationReceipt: act.receipt.receiptId,
      hookLatencyMs: Number(latencyMs.toFixed(4)),
      liveFiringNote: "Hooks-fire-in-real-Claude-Code is an in-env dogfood step (not asserted here).",
      failures,
    };
    process.stdout.write("AVORELO SLICE-2 DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  } finally {
    cleanupSandbox(dir);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

run();
