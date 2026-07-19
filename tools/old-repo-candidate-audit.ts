#!/usr/bin/env node
// Avorelo Old Repo Candidate Audit Tool (Slice 4.5). Deterministic, read-only.
// Inspects an old repo path and produces a migration candidate inventory.
// Usage: node tools/old-repo-candidate-audit.ts --path <old-repo-path>
//
// If the old repo path is unavailable, documents the missing input as a narrow blocker
// and outputs the candidate template.

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const OLD_REPO_PATH = process.argv.includes("--path")
  ? process.argv[process.argv.indexOf("--path") + 1]
  : undefined;

type AuditCandidate = {
  name: string;
  path: string;
  exists: boolean;
  category: string;
  fileCount: number;
  hasTests: boolean;
  hasDocs: boolean;
  riskFlags: string[];
};

const KNOWN_ASSETS = [
  { name: "activation", path: "scripts/lib/activation", category: "capability", riskFlags: ["filesystem"] },
  { name: "receipts", path: "scripts/lib/work-control-receipts.js", category: "kernel", riskFlags: [] },
  { name: "proof-receipt", path: "scripts/lib/proof-receipt.js", category: "kernel", riskFlags: [] },
  { name: "proof-canonical", path: "scripts/lib/proof-canonical.js", category: "kernel", riskFlags: [] },
  { name: "dashboard", path: "scripts/cco-dashboard.js", category: "surface", riskFlags: [] },
  { name: "status", path: "scripts/cco-status.js", category: "surface", riskFlags: [] },
  { name: "session-start", path: "scripts/cco-session-start.js", category: "kernel", riskFlags: [] },
  { name: "pretooluse", path: "scripts/cco-pretooluse.js", category: "kernel", riskFlags: ["security"] },
  { name: "posttooluse", path: "scripts/cco-posttooluse.js", category: "kernel", riskFlags: [] },
  { name: "sessionend", path: "scripts/cco-sessionend.js", category: "kernel", riskFlags: [] },
  { name: "billing-adapter", path: "src/avorelo-hub/billing/billing-adapter.ts", category: "adapter", riskFlags: ["billing", "secrets"] },
  { name: "webhook-handler", path: "src/avorelo-hub/billing/webhook-handler.ts", category: "adapter", riskFlags: ["billing", "network"] },
  { name: "entitlements", path: "src/avorelo-hub/entitlements", category: "capability", riskFlags: [] },
  { name: "public-web", path: "apps/public-web/src", category: "surface", riskFlags: [] },
  { name: "founder-console", path: "src/founder/FounderConsolePage.tsx", category: "surface", riskFlags: ["auth"] },
  { name: "founder-metrics", path: "src/avorelo-hub/founder/founder-metrics.ts", category: "capability", riskFlags: [] },
  { name: "cloud-sync", path: "scripts/cco-cloud-sync.js", category: "capability", riskFlags: ["network"] },
  { name: "security-scan", path: "scripts/lib/security-scan.js", category: "capability", riskFlags: ["security"] },
  { name: "pro-moments", path: "scripts/lib/pro-moments.js", category: "capability", riskFlags: [] },
  { name: "worktree-hygiene", path: "scripts/lib/worktree-hygiene.js", category: "capability", riskFlags: [] },
  { name: "context-budget", path: "src/context_hygiene", category: "capability", riskFlags: [] },
  { name: "value-ledger", path: "scripts/lib/value-ledger.js", category: "capability", riskFlags: [] },
  { name: "adapters", path: "src/adapters", category: "adapter", riskFlags: ["production"] },
  { name: "hub-types", path: "src/avorelo-hub/types.ts", category: "kernel", riskFlags: [] },
  { name: "plans", path: "src/avorelo-hub/entitlements/plans.ts", category: "product_docs", riskFlags: [] },
  { name: "dogfood-evidence", path: "docs/internal", category: "evidence", riskFlags: [] },
  { name: "wasp-app", path: "main.wasp", category: "discard", riskFlags: [] },
];

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  if (!statSync(dir).isDirectory()) return 1;
  try {
    return readdirSync(dir).reduce((n, f) => {
      const p = join(dir, f);
      return n + (statSync(p).isDirectory() ? countFiles(p) : 1);
    }, 0);
  } catch { return 0; }
}

function audit(repoPath: string): AuditCandidate[] {
  return KNOWN_ASSETS.map(asset => {
    const fullPath = join(repoPath, asset.path);
    const exists = existsSync(fullPath);
    const fileCount = exists ? countFiles(fullPath) : 0;
    // Check for adjacent tests
    const testPath = fullPath.replace(/\.(ts|js)$/, ".test.$1");
    const hasTests = existsSync(testPath) || existsSync(join(repoPath, "tests"));
    const hasDocs = existsSync(join(repoPath, "docs"));
    return {
      name: asset.name,
      path: asset.path,
      exists,
      category: asset.category,
      fileCount,
      hasTests,
      hasDocs,
      riskFlags: asset.riskFlags,
    };
  });
}

function main() {
  if (!OLD_REPO_PATH) {
    process.stdout.write(JSON.stringify({
      ok: false,
      blocker: "OLD_REPO_PATH not provided. Run: node tools/old-repo-candidate-audit.ts --path <path>",
      knownAssets: KNOWN_ASSETS.length,
      template: KNOWN_ASSETS.map(a => ({ name: a.name, category: a.category, riskFlags: a.riskFlags })),
    }, null, 2) + "\n");
    process.exit(1);
  }

  if (!existsSync(OLD_REPO_PATH)) {
    process.stdout.write(JSON.stringify({
      ok: false,
      blocker: `Path does not exist: ${OLD_REPO_PATH}`,
      knownAssets: KNOWN_ASSETS.length,
    }, null, 2) + "\n");
    process.exit(1);
  }

  const candidates = audit(OLD_REPO_PATH);
  const found = candidates.filter(c => c.exists);
  const missing = candidates.filter(c => !c.exists);

  process.stdout.write(JSON.stringify({
    ok: true,
    repoPath: OLD_REPO_PATH,
    totalKnown: KNOWN_ASSETS.length,
    found: found.length,
    missing: missing.length,
    candidates: candidates.map(c => ({
      name: c.name,
      path: c.path,
      exists: c.exists,
      category: c.category,
      fileCount: c.fileCount,
      riskFlags: c.riskFlags,
    })),
    summary: {
      kernel: found.filter(c => c.category === "kernel").length,
      capability: found.filter(c => c.category === "capability").length,
      adapter: found.filter(c => c.category === "adapter").length,
      surface: found.filter(c => c.category === "surface").length,
      discard: found.filter(c => c.category === "discard").length,
    },
  }, null, 2) + "\n");
}

main();
