// Avorelo public-source secret-literal gate.
//
// Rejects any COMPLETE, contiguous credential-shaped literal in files that ship publicly — the same
// classes GitHub Push Protection blocks. Synthetic test fixtures must be assembled at runtime (so the
// product's own detector still sees the full value) rather than written as a literal. This gate keeps a
// clean public repo without ever weakening a scanner or bypassing Push Protection.
//
// It distinguishes: (a) detector REGEX definitions (character classes like sk_live_[A-Za-z0-9]+ — not a
// contiguous literal), (b) runtime fragment construction ("sk_live_ABC" + "DEF..." — broken literal),
// and (c) a complete literal secret (rejected). Detection rules and this gate's own tests legitimately
// name the shapes, so their paths are allowlisted.
//
// Usage: node tools/check-public-secret-literals.ts   (exit 0 clean, 1 on any literal)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

export type SecretFinding = { path: string; rule: string; match: string; line: number };

// Known-safe, non-secret placeholders that scanners and docs legitimately use.
const ALLOWED_LITERALS = [
  "AKIAIOSFODNN7EXAMPLE", // AWS's official documentation example key (allowlisted by GitHub too)
];

const RULES: Array<{ rule: string; re: RegExp }> = [
  { rule: "stripe-secret-key", re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{24,}/g },
  { rule: "stripe-publishable-key", re: /\bpk_(live|test)_[A-Za-z0-9]{24,}/g },
  { rule: "stripe-webhook-secret", re: /\bwhsec_[A-Za-z0-9]{24,}/g },
  { rule: "github-token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/g },
  { rule: "github-fine-grained-pat", re: /\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { rule: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{32,}/g },
  { rule: "openai-key", re: /\bsk-[A-Za-z0-9]{40,}/g },
  { rule: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{20,}/g },
  { rule: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { rule: "private-key-block", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { rule: "db-url-with-credentials", re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^:/\s"'`]+:[^@/\s"'`]{3,}@[^\s"'`/]+/g },
];

/** Pure scanner over a set of files. Returns every complete credential-shaped literal. */
export function scanForSecretLiterals(files: Array<{ path: string; content: string }>): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const f of files) {
    const lines = f.content.split("\n");
    lines.forEach((ln, i) => {
      for (const { rule, re } of RULES) {
        re.lastIndex = 0;
        for (const m of ln.matchAll(re)) {
          if (ALLOWED_LITERALS.includes(m[0])) continue;
          findings.push({ path: f.path, rule, match: m[0].slice(0, 12) + "…", line: i + 1 });
        }
      }
    });
  }
  return findings;
}

// Paths whose job is to NAME these shapes (detection rules + this gate + its tests).
const ALLOWLIST_PATHS = [
  "src/avorelo/kernel/scanners/",
  "tools/check-public-secret-literals.ts",
  "tools/check-legal-boundary.ts",
  "release/public-export-exclusions.json",
  "tests/public-secret-literals.test.ts",
];

const SCAN_ROOTS = ["src", "tests", "tools", "fixtures"];
const SCAN_ROOT_FILES = ["README.md", "SECURITY.md", "SUPPORT.md", "CONTRIBUTING.md", "COMMERCIAL-SERVICES.md", "package.json"];
const SKIP_DIR = new Set(["node_modules", ".git", "dist", ".avorelo", ".npm-cache"]);

function walk(root: string, base: string, out: Array<{ path: string; content: string }>): void {
  const abs = join(base, root);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    const rel = join(root, name).replace(/\\/g, "/");
    if (SKIP_DIR.has(name)) continue;
    const full = join(base, rel);
    if (statSync(full).isDirectory()) { walk(rel, base, out); continue; }
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|pdf)$/i.test(name)) continue;
    if (ALLOWLIST_PATHS.some((p) => rel.startsWith(p))) continue;
    out.push({ path: rel, content: readFileSync(full, "utf8") });
  }
}

export function collectPublicFiles(base: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const r of SCAN_ROOTS) walk(r, base, out);
  for (const f of SCAN_ROOT_FILES) {
    const full = join(base, f);
    if (existsSync(full) && !ALLOWLIST_PATHS.includes(f)) out.push({ path: f, content: readFileSync(full, "utf8") });
  }
  return out;
}

const invokedDirectly = process.argv[1] && /check-public-secret-literals\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  const base = process.argv[2] ?? process.cwd();
  const files = collectPublicFiles(base);
  const findings = scanForSecretLiterals(files);
  for (const x of findings) process.stderr.write(`FAIL  ${x.path}:${x.line}  [${x.rule}]  ${x.match}\n`);
  process.stdout.write(`\n[public-secret-literals] scanned ${files.length} public files under ${relative(process.cwd(), base) || "."}; ${findings.length} literal(s)\n`);
  if (findings.length > 0) {
    process.stderr.write("PUBLIC_SECRET_LITERALS_FOUND — assemble synthetic fixtures at runtime; never write a complete credential literal.\n");
    process.exit(1);
  }
  process.stdout.write("PUBLIC_SECRET_LITERALS_OK — no complete credential-shaped literal in public source.\n");
}
