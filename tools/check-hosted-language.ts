// B5 static language guard (Community Edition).
// HARD-FAILS if active runtime surfaces contain paid-product language or active hosted identifiers.
// The discontinued hosted stack (billing / lemon-squeezy / cloud-sync / cloud-api / webhook-server /
// auth / db / entitlement-context) and the static website (Milestone E) are KNOWN removal inventory:
// they are reported, not silently ignored, and not treated as active clean surfaces.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// Active runtime surfaces that MUST be clean now (Milestone B/C).
const ACTIVE = [
  "src/avorelo/surfaces/cli/avorelo.ts",
  "src/avorelo/capabilities/control-center",
  "src/avorelo/capabilities/local-dashboard/index.ts",
  "src/avorelo/capabilities/activation/activation-detector.ts",
  "src/avorelo/capabilities/activation/activation-runner.ts",
  "src/avorelo/capabilities/settings/index.ts",
];

// Known removal inventory (reported, not failed). Milestone C/D (hosted stack) and E (website).
const INVENTORY = [
  "src/avorelo/capabilities/billing",
  "src/avorelo/adapters/lemon-squeezy",
  "src/avorelo/capabilities/cloud-sync",
  "src/avorelo/surfaces/cloud-api",
  "src/avorelo/surfaces/webhook-server",
  "src/avorelo/auth",
  "src/avorelo/db",
  "src/avorelo/surfaces/cli/capability-middleware.ts",
  "src/avorelo/capabilities/local-dashboard/dashboard-entitlement-context.ts",
  "src/avorelo/capabilities/local-dashboard/dashboard-entitlement-injection.ts",
  "src/avorelo/capabilities/local-dashboard/dashboard-entitlement-renderer.ts",
  "src/avorelo/surfaces/public-web/static",
];

const FORBIDDEN_PHRASES = [
  "Upgrade to Pro", "Subscription required", "Sign in to continue", "Link your account",
  "Start checkout", "Customer portal", "Manage subscription", "Current plan", "Billing settings",
  "Missing: Billing env", "Missing: Auth env",
];
const ACTIVE_IDENTIFIERS = [
  "__AVORELO_GATE__", "__AVORELO_CHECKOUT_URL__", "app.avorelo.com", "/api/billing", "/api/activation/claim",
  "entitlementSource", "billingEnvDetected", "authEnvDetected", "allowedLegacyFeatures",
  "LEMON_SQUEEZY_", "resolveSubscriptionEntitlements",
];
const NEEDLES = [...FORBIDDEN_PHRASES, ...ACTIVE_IDENTIFIERS];

function walk(p: string): string[] {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [p];
  const out: string[] = [];
  for (const name of readdirSync(abs)) out.push(...walk(join(p, name)));
  return out;
}

function scan(files: string[]): { file: string; needle: string; line: number }[] {
  const hits: { file: string; needle: string; line: number }[] = [];
  for (const f of files) {
    const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
    lines.forEach((ln, i) => {
      for (const n of NEEDLES) if (ln.includes(n)) hits.push({ file: f, needle: n, line: i + 1 });
    });
  }
  return hits;
}

const activeFiles = ACTIVE.flatMap(walk).filter((f) => /\.(ts|js|mjs|html)$/.test(f));
const activeHits = scan(activeFiles);

const inventoryFiles = INVENTORY.flatMap(walk).filter((f) => /\.(ts|js|mjs|html)$/.test(f));
const inventoryHits = scan(inventoryFiles);

console.log(`[hosted-language] active surfaces scanned: ${activeFiles.length} files`);
console.log(`[hosted-language] known removal inventory: ${new Set(inventoryHits.map((h) => h.file)).size} files still contain hosted language/identifiers (Milestone C/D/E)`);

if (activeHits.length > 0) {
  console.error("HOSTED_LANGUAGE_FOUND in active runtime surfaces:");
  for (const h of activeHits) console.error(`  ${h.file}:${h.line}  ${h.needle}`);
  process.exit(1);
}

console.log("HOSTED_LANGUAGE_OK — active CLI, Control Center, and local dashboard runtime are clean.");
