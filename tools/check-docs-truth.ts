// D4 documentation-truth gate (Community Edition).
// HARD-FAILS if ACTIVE user/contributor documentation still gives hosted instructions or makes
// claims that are false for the local-only architecture, or cites a package script / CLI command
// that does not exist.
//
// Historical transition/audit/internal documents are EXEMPT by explicit path prefix: they record
// what was migrated and must keep describing the discontinued hosted architecture.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

// Active user/contributor documentation that MUST describe the current architecture.
const ACTIVE_DOCS = [
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "COMMERCIAL-SERVICES.md",
  "CONTRIBUTING.md",
  "docs/getting-started.md",
  "docs/install.md",
  "docs/update.md",
  "docs/troubleshooting.md",
  "docs/uninstall.md",
  "docs/privacy-and-learning.md",
  "docs/development",
  "docs/architecture",
  "docs/security",
  "docs/support",
  "docs/usage",
];

// Historical evidence / internal planning — exempt (they document the migration itself).
const HISTORICAL_PREFIXES = [
  "docs/maintenance/", "docs/internal/", "docs/planning/", "docs/release/", "docs/migration/",
  "docs/marketing/", "docs/founder/", "docs/private-alpha/", "docs/product/", "docs/qa/",
  "docs/dogfood/", "docs/dogfooding/", "docs/legal/", "docs/public/", "docs/capabilities/",
  "CHANGELOG.md", "CLAUDE.md",
];

// Stale ACTIVE instructions/claims that are false for Community Edition.
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\bnpm start\b/, why: "npm start was the hosted cloud-api server launcher (removed)" },
  { re: /\bDATABASE_URL\b/, why: "no database in Community Edition" },
  { re: /configure\s+postgres|install\s+postgres|postgres\s+(setup|required)/i, why: "no Postgres" },
  { re: /\bAUTH_SECRET\b/, why: "no hosted auth" },
  { re: /OAuth\s+(client|setup|provider)/i, why: "no OAuth" },
  { re: /Lemon\s*Squeezy/i, why: "no billing provider" },
  { re: /railway\s+(deploy|up|login)/i, why: "no Railway deployment" },
  { re: /webhook\s+(server|secret|setup)/i, why: "no webhook server" },
  { re: /app\.avorelo\.com\/api/i, why: "no hosted API" },
  { re: /\bnpm run (test:integration|db:migrate|db:generate|db:studio|cloud:dev|webhook:serve)\b/, why: "script removed" },
  { re: /\bdogfood:live\b/, why: "renamed to dogfood:optional-claude-live" },
  { re: /settings set (auto-update|dogfood-learning|update-channel)/, why: "setting removed" },
  { re: /\bdogfood-learning\b/, why: "subsystem removed" },
  { re: /(sign in|sign up|signup|log in|login|create an account) (to|for|and) (use|continue|start|access)/i, why: "no account required" },
  { re: /\b(Pro|Teams) plan\b|current plan|upgrade to pro/i, why: "no plans" },
  { re: /subscription (required|active)|entitlement (required|check)/i, why: "no subscription/entitlement" },
  { re: /cloud sync (setup|enable|configure)/i, why: "cloud sync discontinued" },
  { re: /automatic (telemetry|update check)|updates? (are )?checked automatically/i, why: "no automatic telemetry/update" },
  { re: /@(gmail|outlook|hotmail|yahoo|icloud|proton(mail)?)\.[a-z]{2,}/i, why: "no personal email in active docs" },
];

// The only public contact address permitted in active documentation is support@avorelo.com.
// Any other @avorelo.com mailbox (founder@, licensing@, sales@, contact@, admin@, …) is a
// stale/invented channel and must not appear. Enforced separately from FORBIDDEN because it
// requires inspecting the local-part of each match, not a plain per-line regex.
const APPROVED_LOCALPART = "support";

function walk(p: string): string[] {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return p.endsWith(".md") ? [p] : [];
  const out: string[] = [];
  for (const n of readdirSync(abs)) out.push(...walk(join(p, n).replace(/\\/g, "/")));
  return out;
}
const isHistorical = (f: string) => HISTORICAL_PREFIXES.some((h) => f.replace(/\\/g, "/").startsWith(h));

const files = [...new Set(ACTIVE_DOCS.flatMap(walk))].filter((f) => !isHistorical(f));
const violations: string[] = [];

for (const f of files) {
  const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
  lines.forEach((ln, i) => {
    for (const { re, why } of FORBIDDEN) {
      if (re.test(ln)) violations.push(`${f}:${i + 1}  ${why}\n      > ${ln.trim().slice(0, 110)}`);
    }
    for (const m of ln.matchAll(/([a-z0-9._%+-]+)@avorelo\.com/gi)) {
      if (m[1].toLowerCase() !== APPROVED_LOCALPART) {
        violations.push(`${f}:${i + 1}  only support@avorelo.com is an approved contact (found ${m[0]})\n      > ${ln.trim().slice(0, 110)}`);
      }
    }
  });
}

// Every `npm run <script>` cited in active docs must exist.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));
for (const f of files) {
  const src = readFileSync(join(ROOT, f), "utf8");
  for (const m of src.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
    if (!scripts.has(m[1])) violations.push(`${f}  cites missing package script: npm run ${m[1]}`);
  }
}

// Every CLI command cited in active docs as code (`avorelo <cmd>` in backticks or a fenced
// block) must exist in the dispatch. Prose mentions of the product name are not commands.
const cli = readFileSync(join(ROOT, "src/avorelo/surfaces/cli/avorelo.ts"), "utf8");
const known = new Set([...cli.matchAll(/case "([a-z-]+)"/g)].map((m) => m[1]));
for (const f of files) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const codeCited = new Set<string>();
  for (const m of src.matchAll(/`avorelo ([a-z][a-z-]+)/g)) codeCited.add(m[1]);
  for (const m of src.matchAll(/^\s*(?:\$ )?avorelo ([a-z][a-z-]+)/gm)) codeCited.add(m[1]);
  for (const cmd of codeCited) {
    if (["install", "latest"].includes(cmd)) continue;
    if (!known.has(cmd)) violations.push(`${f}  cites unknown CLI command: avorelo ${cmd}`);
  }
}

// Internal Markdown links and referenced relative files must resolve. External URLs are
// validated for syntax only — no network access.
let linksChecked = 0;
for (const f of files) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const dir = join(ROOT, f, "..");
  for (const m of src.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(href)) {
      if (/^https?:/.test(href) && !/^https?:\/\/[a-z0-9.-]+/i.test(href)) {
        violations.push(`${f}  malformed external URL: ${href}`);
      }
      continue;
    }
    linksChecked++;
    const target = join(dir, href.split("#")[0]);
    if (!existsSync(target)) violations.push(`${f}  broken internal link: ${href}`);
  }
}

console.log(`[docs-truth] active documentation scanned: ${files.length} files`);
console.log(`[docs-truth] internal links resolved: ${linksChecked}`);
console.log(`[docs-truth] historical/internal exempt prefixes: ${HISTORICAL_PREFIXES.length}`);

if (violations.length > 0) {
  console.error("DOCS_TRUTH_FAILED — active documentation contains stale hosted guidance or dead references:");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log("DOCS_TRUTH_OK — active documentation matches the local-only architecture.");
