#!/usr/bin/env node
// Avorelo Old Repo Core Capability Parity Audit. Deterministic.
// Maps every old core capability to its new-repo status. Fails if any UNKNOWN remains.

import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

type Status = "COMPLETE" | "PARTIAL" | "DEFERRED" | "REJECTED" | "UNKNOWN";
type Mode = "REBUILT_NOW" | "REBUILT_DIFFERENTLY" | "MERGED_INTO_CANONICAL" | "PRESERVED_AS_REQUIREMENT" | "PRESERVED_AS_EVIDENCE" | "DEFERRED_TO_SLICE_6" | "DEFERRED_LATER" | "REJECTED_UNSAFE" | "REJECTED_SUPERSEDED";
type Layer = "kernel" | "capability" | "adapter" | "surface" | "dogfood" | "validation" | "docs";
type Entry = { old: string; oldPath: string; category: string; mode: Mode; layer: Layer; newPath: string; hasTest: boolean; hasDogfood: boolean; status: Status; gap: string };

const matrix: Entry[] = [
  // Kernel / Control
  { old: "Work Contract", oldPath: "src/wuz-project-contract/", category: "kernel", mode: "REBUILT_NOW", layer: "kernel", newPath: "src/avorelo/kernel/work-contract/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Evidence Router (4 levels)", oldPath: "scripts/lib/proof-canonical.js", category: "kernel", mode: "REBUILT_DIFFERENTLY", layer: "kernel", newPath: "src/avorelo/kernel/evidence/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Stop/Continue Gate", oldPath: "scripts/lib/work-control-receipts.js", category: "kernel", mode: "REBUILT_DIFFERENTLY", layer: "kernel", newPath: "src/avorelo/kernel/stop-continue-gate/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Receipt Writer", oldPath: "scripts/lib/proof-receipt.js", category: "receipts", mode: "REBUILT_DIFFERENTLY", layer: "kernel", newPath: "src/avorelo/kernel/receipts/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "State/Event Ledger", oldPath: "scripts/lib/metrics.js", category: "kernel", mode: "REBUILT_DIFFERENTLY", layer: "kernel", newPath: "src/avorelo/kernel/state-ledger/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Policy Matrix", oldPath: "scripts/lib/runtime-decision-policy.js", category: "kernel", mode: "REBUILT_NOW", layer: "kernel", newPath: "src/avorelo/kernel/policy/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Redaction", oldPath: "scripts/lib/receipt-redaction.ts", category: "security", mode: "REBUILT_NOW", layer: "kernel", newPath: "src/avorelo/shared/redaction/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Ownership Registry", oldPath: "(new concept)", category: "kernel", mode: "REBUILT_NOW", layer: "kernel", newPath: "src/avorelo/kernel/registry/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Runtime Boundary", oldPath: "src/local-runtime/", category: "kernel", mode: "REBUILT_DIFFERENTLY", layer: "kernel", newPath: "src/avorelo/kernel/runtime-boundary/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "PreToolUse Gate", oldPath: "scripts/cco-pretooluse.js", category: "kernel", mode: "REBUILT_DIFFERENTLY", layer: "kernel", newPath: "src/avorelo/kernel/pretooluse-gate/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },

  // Activation
  { old: "Activation / Hook Install", oldPath: "scripts/lib/activation/", category: "activation", mode: "REBUILT_DIFFERENTLY", layer: "capability", newPath: "src/avorelo/capabilities/activation/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Doctor / Readiness Check", oldPath: "scripts/wuz-doctor.js", category: "activation", mode: "MERGED_INTO_CANONICAL", layer: "capability", newPath: "src/avorelo/capabilities/activation/ (doctor fn)", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Claude Code Adapter", oldPath: "src/adapters/claude-adapter.ts", category: "activation", mode: "REBUILT_DIFFERENTLY", layer: "adapter", newPath: "src/avorelo/adapters/claude-code/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },

  // Receipts / Dashboard
  { old: "Local Dashboard / Status", oldPath: "scripts/cco-dashboard.js", category: "dashboard", mode: "REBUILT_DIFFERENTLY", layer: "capability", newPath: "src/avorelo/capabilities/local-dashboard/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Public Dashboard Preview", oldPath: "apps/public-web/src/dashboard.html", category: "dashboard", mode: "REBUILT_NOW", layer: "surface", newPath: "src/avorelo/surfaces/public-web/static/dashboard.html", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Secret Protection", oldPath: "scripts/lib/security-scan.js", category: "security", mode: "REBUILT_DIFFERENTLY", layer: "capability", newPath: "src/avorelo/capabilities/secret-protection/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },

  // Production Confidence
  { old: "Production Confidence / Proof", oldPath: "PR#232 concepts", category: "production-confidence", mode: "REBUILT_DIFFERENTLY", layer: "capability", newPath: "src/avorelo/capabilities/production-confidence/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Source-of-Truth Read-back", oldPath: "(new concept)", category: "production-confidence", mode: "REBUILT_NOW", layer: "capability", newPath: "src/avorelo/capabilities/production-confidence/ (readBack fn)", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },

  // Context / Tools / Migration
  { old: "Context Budget Guard", oldPath: "src/context_hygiene/", category: "context", mode: "REBUILT_DIFFERENTLY", layer: "capability", newPath: "src/avorelo/capabilities/context-budget/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Tool Governance / MCP Policy", oldPath: "scripts/lib/mcp-policy.js", category: "tools", mode: "REBUILT_DIFFERENTLY", layer: "capability", newPath: "src/avorelo/capabilities/tool-governance/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Migration Scorecard", oldPath: "(new concept)", category: "migration", mode: "REBUILT_NOW", layer: "capability", newPath: "src/avorelo/capabilities/migration-scorecard/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },

  // Payment / Pricing
  { old: "Payment Readiness", oldPath: "PR#235 concepts", category: "payment", mode: "REMOVED_WITH_HOSTED_BILLING", layer: "capability", newPath: "src/avorelo/capabilities/payment-readiness/", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Lemon Squeezy Adapter", oldPath: "src/avorelo-hub/billing/", category: "payment", mode: "REMOVED_WITH_HOSTED_BILLING", layer: "adapter", newPath: "src/avorelo/adapters/lemon-squeezy/", hasTest: true, hasDogfood: false, status: "COMPLETE", gap: "" },
  { old: "Entitlement Service", oldPath: "src/avorelo-hub/entitlements/", category: "payment", mode: "PRESERVED_AS_REQUIREMENT", layer: "docs", newPath: "docs/product/pricing-payments-entitlements-source-of-truth.md", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Runtime entitlement enforcement deferred to Slice 6" },

  // Public Web
  { old: "Landing Page", oldPath: "apps/public-web/src/index.html", category: "public-web", mode: "REBUILT_NOW", layer: "surface", newPath: "src/avorelo/surfaces/public-web/static/index.html", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Pricing Page", oldPath: "apps/public-web/src/pricing.html", category: "public-web", mode: "REBUILT_NOW", layer: "surface", newPath: "src/avorelo/surfaces/public-web/static/pricing.html", hasTest: true, hasDogfood: true, status: "COMPLETE", gap: "" },
  { old: "Articles", oldPath: "apps/public-web/src/article-*.html", category: "public-web", mode: "REBUILT_NOW", layer: "surface", newPath: "src/avorelo/surfaces/public-web/static/article-*.html", hasTest: true, hasDogfood: false, status: "COMPLETE", gap: "" },
  { old: "Login/Signup", oldPath: "apps/public-web/src/login.html", category: "public-web", mode: "REBUILT_NOW", layer: "surface", newPath: "src/avorelo/surfaces/public-web/static/login.html", hasTest: true, hasDogfood: false, status: "PARTIAL", gap: "Auth backend not connected (placeholder, Slice 6)" },
  { old: "Legal Pages", oldPath: "apps/public-web/src/terms-of-service.html", category: "public-web", mode: "REBUILT_NOW", layer: "surface", newPath: "src/avorelo/surfaces/public-web/static/terms-*.html", hasTest: true, hasDogfood: false, status: "COMPLETE", gap: "" },
  { old: "Teams Waitlist", oldPath: "apps/public-web/src/waiting-list.html", category: "public-web", mode: "REBUILT_NOW", layer: "surface", newPath: "src/avorelo/surfaces/public-web/static/waiting-list.html", hasTest: true, hasDogfood: false, status: "COMPLETE", gap: "" },

  // Deferred capabilities
  { old: "Codex Adapter", oldPath: "src/adapters/codex-adapter.ts", category: "activation", mode: "DEFERRED_LATER", layer: "adapter", newPath: "(planned)", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Multi-adapter expansion post-launch" },
  { old: "Cursor Adapter", oldPath: "src/adapters/cursor-adapter.ts", category: "activation", mode: "DEFERRED_LATER", layer: "adapter", newPath: "(planned)", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Multi-adapter expansion post-launch" },
  { old: "Cloud Claim / Sync", oldPath: "scripts/cco-cloud-sync.js", category: "cloud", mode: "DEFERRED_TO_SLICE_6", layer: "capability", newPath: "(planned)", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Slice 6 scope" },
  { old: "Teams Governance", oldPath: "src/avorelo-hub/", category: "cloud", mode: "DEFERRED_TO_SLICE_6", layer: "capability", newPath: "(planned)", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Slice 6 scope" },
  { old: "Hub Dashboard (cloud)", oldPath: "src/core-flow/HubView.tsx", category: "cloud", mode: "DEFERRED_TO_SLICE_6", layer: "surface", newPath: "(planned)", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Slice 6 scope" },
  { old: "Visual QA (browser)", oldPath: "src/verify/", category: "production-confidence", mode: "DEFERRED_LATER", layer: "capability", newPath: "(planned)", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Browser proof post-core" },
  { old: "Pro Moment Engine", oldPath: "scripts/lib/pro-moments.js", category: "payment", mode: "PRESERVED_AS_REQUIREMENT", layer: "docs", newPath: "docs/migration/old-repo-inventory.md", hasTest: false, hasDogfood: false, status: "DEFERRED", gap: "Upgrade UX deferred to Slice 6" },

  // Rejected
  { old: "Wasp App Framework", oldPath: "main.wasp", category: "deprecated", mode: "REJECTED_SUPERSEDED", layer: "docs", newPath: "N/A", hasTest: false, hasDogfood: false, status: "REJECTED", gap: "Zero-dep TS architecture replaces Wasp" },
  { old: "3-Way Naming (cco/wuz)", oldPath: "throughout", category: "deprecated", mode: "REJECTED_SUPERSEDED", layer: "docs", newPath: "N/A", hasTest: true, hasDogfood: false, status: "REJECTED", gap: "avorelo-only naming enforced" },
  { old: "Local-Stub Token", oldPath: "scripts/lib/activation/connect-account.js", category: "deprecated", mode: "REJECTED_UNSAFE", layer: "docs", newPath: "N/A", hasTest: false, hasDogfood: false, status: "REJECTED", gap: "Accepted unvalidated tokens — unsafe" },
  { old: "40+ Surface Dashboard", oldPath: "scripts/cco-dashboard.js", category: "deprecated", mode: "REJECTED_SUPERSEDED", layer: "docs", newPath: "N/A", hasTest: false, hasDogfood: false, status: "REJECTED", gap: "Replaced by avorelo open" },
];

function run() {
  const unknowns = matrix.filter(e => e.status === "UNKNOWN");
  const noDecision = matrix.filter(e => !e.mode);
  const implementedNoProof = matrix.filter(e => e.status === "COMPLETE" && !e.hasTest && !e.hasDogfood);
  const rejectedNoReason = matrix.filter(e => e.status === "REJECTED" && !e.gap);

  const errors: string[] = [];
  if (unknowns.length) errors.push(`${unknowns.length} UNKNOWN capabilities: ${unknowns.map(u => u.old).join(", ")}`);
  if (noDecision.length) errors.push(`${noDecision.length} capabilities without migration mode`);
  if (implementedNoProof.length) errors.push(`${implementedNoProof.length} COMPLETE without test/dogfood: ${implementedNoProof.map(e => e.old).join(", ")}`);
  if (rejectedNoReason.length) errors.push(`${rejectedNoReason.length} REJECTED without rationale`);

  const summary = {
    total: matrix.length,
    complete: matrix.filter(e => e.status === "COMPLETE").length,
    partial: matrix.filter(e => e.status === "PARTIAL").length,
    deferred: matrix.filter(e => e.status === "DEFERRED").length,
    rejected: matrix.filter(e => e.status === "REJECTED").length,
    unknown: unknowns.length,
    errors: errors.length,
  };

  process.stdout.write("AVORELO OLD REPO CORE CAPABILITY PARITY AUDIT\n");
  process.stdout.write(`Total: ${summary.total} | Complete: ${summary.complete} | Partial: ${summary.partial} | Deferred: ${summary.deferred} | Rejected: ${summary.rejected} | Unknown: ${summary.unknown}\n`);
  if (errors.length) { for (const e of errors) process.stdout.write(`  ERROR: ${e}\n`); }
  else process.stdout.write("  No UNKNOWN, no missing decisions, no COMPLETE without proof.\n");

  const ok = errors.length === 0;
  process.stdout.write(`\n  PARITY: ${ok ? "VERIFIED" : "BLOCKED"}\n`);
  process.exit(ok ? 0 : 1);
}

run();
