// Avorelo feedback bundle. Creates a sanitized, inspectable local bundle
// that the user can review before any sharing. No secrets, no env values,
// no source code, no private prompts.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { platform, release, arch } from "node:os";
import { redact } from "../../shared/redaction/index.ts";
import { getFeedbackConfig } from "./config.ts";
import { detectAllAdapters } from "../../adapters/registry.ts";
import { loadLatestSession } from "../session/session-store.ts";
import { detectMonorepo } from "../workspace/monorepo.ts";

export type FeedbackBundle = {
  bundleId: string;
  createdAt: string;
  avorelo: { version: string };
  platform: { os: string; release: string; arch: string; nodeVersion: string };
  workspace: { packageManager: string | null; framework: string | null; isMonorepo: boolean; workspaceCount: number };
  adapters: { id: string; tier: string; detected: boolean }[];
  session: { active: boolean; objective: string | null; controlTier: string | null; toolCalls: number; driftSignals: number; corrections: number } | null;
  proof: { receiptCount: number; doneCount: number; blockedCount: number; inProgressCount: number };
  feedback: { enabled: boolean; optedIn: boolean };
  excludedCategories: string[];
  redaction: "applied";
};

// Where a user manually takes a reviewed support bundle. Local-first: these are
// references the user visits themselves; nothing is contacted automatically.
export const SUPPORT_ISSUES_URL = "https://github.com/HappyLifeSaaS/Avorelo/issues";
export const SUPPORT_SECURITY_URL = "https://github.com/HappyLifeSaaS/Avorelo/blob/main/SECURITY.md";
// The sole public contact address. Printed only as a static instruction the user acts on
// themselves — never embedded in a generated bundle, never auto-opened, never contacted.
export const SUPPORT_EMAIL = "support@avorelo.com";

// Exact set of top-level keys allowed in a support artifact. Anything outside
// this allowlist is a bug — the artifact must never grow an upload target,
// contact address, secret, or raw content field.
export const SUPPORT_BUNDLE_ALLOWLIST = [
  "bundleId", "createdAt", "avorelo", "platform", "workspace",
  "adapters", "session", "proof", "feedback", "excludedCategories", "redaction",
] as const;

export function validateSupportBundle(bundle: unknown): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!bundle || typeof bundle !== "object") return { valid: false, violations: ["not an object"] };
  const allowed = new Set<string>(SUPPORT_BUNDLE_ALLOWLIST);
  for (const key of Object.keys(bundle as Record<string, unknown>)) {
    if (!allowed.has(key)) violations.push(`disallowed key: ${key}`);
  }
  return { valid: violations.length === 0, violations };
}

export function renderSupportMarkdown(bundle: FeedbackBundle): string {
  const lines = [
    "# Avorelo support bundle",
    "",
    `- Bundle: \`${bundle.bundleId}\``,
    `- Created: ${bundle.createdAt}`,
    `- Avorelo: ${bundle.avorelo.version}`,
    `- Platform: ${bundle.platform.os} ${bundle.platform.arch} (Node ${bundle.platform.nodeVersion})`,
    `- Workspace: ${bundle.workspace.packageManager ?? "unknown"} / ${bundle.workspace.framework ?? "none"}` +
      `${bundle.workspace.isMonorepo ? ` / monorepo (${bundle.workspace.workspaceCount})` : ""}`,
    `- Adapters detected: ${bundle.adapters.filter(a => a.detected).length}/${bundle.adapters.length}`,
    `- Proof: ${bundle.proof.receiptCount} receipts (${bundle.proof.doneCount} done, ${bundle.proof.blockedCount} blocked, ${bundle.proof.inProgressCount} in progress)`,
    "",
    "## Excluded from this bundle",
    "",
    bundle.excludedCategories.map(c => `- ${c}`).join("\n"),
    "",
    "## Nothing was sent",
    "",
    "This bundle stays on your machine. Avorelo does not upload it, attach it, or",
    "contact any server. Review the JSON companion file, then — only if you choose",
    "to — share it yourself:",
    "",
    `- Bugs & feedback: ${SUPPORT_ISSUES_URL}`,
    `- Security reports (private): ${SUPPORT_SECURITY_URL}`,
    "",
    "Do not paste secrets, credentials, or private source into an issue.",
    "",
  ];
  return lines.join("\n");
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    return pkg.version ?? "unknown";
  } catch { return "unknown"; }
}

function detectPackageManager(dir: string): string | null {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb"))) return "bun";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  if (existsSync(join(dir, "package.json"))) return "npm";
  return null;
}

function detectFramework(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["next"]) return "next";
    if (deps["nuxt"]) return "nuxt";
    if (deps["hono"]) return "hono";
    if (deps["express"]) return "express";
    if (deps["react"]) return "react";
    if (deps["vue"]) return "vue";
    if (deps["svelte"]) return "svelte";
    return null;
  } catch { return null; }
}

function countReceipts(dir: string): { total: number; done: number; blocked: number; inProgress: number } {
  const receiptsDir = join(dir, ".avorelo", "receipts");
  if (!existsSync(receiptsDir)) return { total: 0, done: 0, blocked: 0, inProgress: 0 };
  let done = 0, blocked = 0, inProgress = 0;
  try {
    for (const f of readdirSync(receiptsDir).filter(f => f.endsWith(".json"))) {
      try {
        const r = JSON.parse(readFileSync(join(receiptsDir, f), "utf8"));
        if (r.decision === "STOP_DONE") done++;
        else if (r.decision === "STOP_BLOCKED") blocked++;
        else inProgress++;
      } catch {}
    }
  } catch {}
  return { total: done + blocked + inProgress, done, blocked, inProgress };
}

export function prepareFeedbackBundle(dir: string): { bundle: FeedbackBundle; path: string } {
  const config = getFeedbackConfig(dir);
  const adapters = detectAllAdapters(dir);
  const session = loadLatestSession(dir);
  const mono = detectMonorepo(dir);
  const receipts = countReceipts(dir);

  const bundle: FeedbackBundle = {
    bundleId: `fb_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    avorelo: { version: getVersion() },
    platform: { os: platform(), release: release(), arch: arch(), nodeVersion: process.version },
    workspace: {
      packageManager: detectPackageManager(dir),
      framework: detectFramework(dir),
      isMonorepo: mono.isMonorepo,
      workspaceCount: mono.workspaces.length,
    },
    adapters: adapters.map(a => ({ id: a.adapter.id, tier: a.adapter.controlTier, detected: a.detection.detected })),
    session: session ? {
      active: session.status === "open",
      objective: session.objective ? session.objective.slice(0, 100) : null,
      controlTier: session.controlTier,
      toolCalls: session.toolCallCount,
      driftSignals: session.driftSignals.length,
      corrections: session.interventionLog.length,
    } : null,
    proof: { receiptCount: receipts.total, doneCount: receipts.done, blockedCount: receipts.blocked, inProgressCount: receipts.inProgress },
    feedback: { enabled: config.enabled, optedIn: !!config.optedInAt },
    excludedCategories: [
      "secrets", "env_values", "source_code", "private_prompts",
      "full_logs", "file_contents", "api_keys", "tokens", "credentials",
      "raw_stack_traces", "hidden_files",
    ],
    redaction: "applied",
  };

  const redacted = redact(bundle).value as FeedbackBundle;
  const bundleDir = join(dir, ".avorelo", "feedback");
  mkdirSync(bundleDir, { recursive: true });
  const bundlePath = join(bundleDir, `${redacted.bundleId}.json`);
  writeFileSync(bundlePath, JSON.stringify(redacted, null, 2));

  return { bundle: redacted, path: bundlePath };
}

export function prepareSupportBundle(dir: string): { bundle: FeedbackBundle; path: string; markdownPath: string } {
  const { bundle } = prepareFeedbackBundle(dir);
  const supportDir = join(dir, ".avorelo", "support");
  mkdirSync(supportDir, { recursive: true });
  const supportPath = join(supportDir, `support_${bundle.bundleId}.json`);
  writeFileSync(supportPath, JSON.stringify(bundle, null, 2));
  const markdownPath = join(supportDir, `support_${bundle.bundleId}.md`);
  writeFileSync(markdownPath, renderSupportMarkdown(bundle));
  return { bundle, path: supportPath, markdownPath };
}
