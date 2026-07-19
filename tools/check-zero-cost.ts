// Avorelo zero-cost boundary gate.
//
// Fails if a change to INFRASTRUCTURE CONFIG would reintroduce a paid/metered surface, keeping the
// project at $0/month + the annual domain renewal only (see release/ZERO-COST-OPERATING-MODEL.md).
//
// Scope is deliberately narrow: it scans netlify.toml, .github/workflows/*, package.json dependencies,
// and the presence of deploy/DB config files. It does NOT scan src/tests/tools/docs — the retained
// product contains secret-detection heuristics and generic user-project detection that legitimately name
// these providers to detect them. Scanning only infra config catches real cost-adding changes without
// false-flagging detection code.
//
// Usage: node tools/check-zero-cost.ts   (exit 0 = clean, 1 = a cost-adding surface was found)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type ZeroCostFinding = { surface: string; rule: string; detail: string };

export type ZeroCostInputs = {
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  netlifyToml: string;
  workflows: Array<{ name: string; content: string }>;
  /** Repo-relative paths of deploy/DB/devcontainer config files that exist at the root. */
  presentConfigFiles: string[];
};

// Dependency names (exact or scope prefix) that imply a hosted backend, database, analytics, email
// sender, or paid SaaS integration. A local-first CLI needs none of these at runtime.
const BANNED_DEP = [
  // databases / clients
  "pg", "postgres", "mysql", "mysql2", "mongodb", "mongoose", "redis", "ioredis",
  "@neondatabase/serverless", "@planetscale/database", "@supabase/supabase-js", "drizzle-orm", "prisma", "@prisma/client",
  // billing / auth SaaS
  "stripe", "@lemonsqueezy/lemonsqueezy.js", "lemonsqueezy.ts", "@clerk/clerk-sdk-node", "@clerk/nextjs", "auth0", "better-auth",
  // analytics / telemetry
  "@sentry/node", "@sentry/browser", "posthog-js", "posthog-node", "@vercel/analytics", "mixpanel", "analytics-node",
  // email senders / messaging
  "nodemailer", "resend", "@sendgrid/mail", "mailgun.js", "mailgun-js", "postmark", "twilio",
  // cloud SDKs
  "aws-sdk", "@aws-sdk/client-s3", "firebase", "firebase-admin", "@google-cloud/storage",
];
const BANNED_DEP_PREFIX = ["@aws-sdk/", "@google-cloud/", "@sentry/", "@clerk/", "@supabase/", "@prisma/"];

// Deploy/DB/Codespaces config file presence is itself a cost signal for a local-first project.
const BANNED_CONFIG_FILE = [
  "railway.json", "railway.toml", "nixpacks.toml", "Procfile",
  "vercel.json", "render.yaml", "render.yml", "fly.toml", "app.yaml",
  "drizzle.config.ts", "drizzle.config.js", "prisma/schema.prisma",
  ".devcontainer/devcontainer.json", ".env",
];

const CLOUD_SECRET_RE = /\b(RAILWAY_[A-Z_]*TOKEN|NETLIFY_AUTH_TOKEN|VERCEL_TOKEN|RENDER_API_KEY|FLY_API_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|DATABASE_URL|POSTGRES_URL|SUPABASE_[A-Z_]+|STRIPE_[A-Z_]+|LEMON_?SQUEEZY_[A-Z_]+)\b/;
// A "standard" GitHub-hosted runner is free-tier on public repos. Anything else is a cost signal.
const STANDARD_RUNNER_RE = /^(ubuntu|windows|macos)-(latest|\d[\d.]*)$/i;
const BILLING_URL_RE = /(checkout\.stripe\.com|billing\.stripe\.com|[a-z0-9-]+\.lemonsqueezy\.com\/(?:checkout|buy)|\brailway\.app\b)/i;

export function scanZeroCost(inp: ZeroCostInputs): ZeroCostFinding[] {
  const f: ZeroCostFinding[] = [];

  // 1. Dependencies.
  const deps = { ...(inp.packageJson.dependencies ?? {}), ...(inp.packageJson.devDependencies ?? {}) };
  for (const name of Object.keys(deps)) {
    if (BANNED_DEP.includes(name) || BANNED_DEP_PREFIX.some((p) => name.startsWith(p))) {
      f.push({ surface: "package.json", rule: "banned-dependency", detail: name });
    }
  }

  // 2. netlify.toml — no functions/edge/plugins/identity/forms.
  const nt = inp.netlifyToml;
  if (/\[functions\]|\[\[edge_functions\]\]|(^|\n)\s*functions\s*=|netlify\/functions|\[\[plugins\]\]/i.test(nt)) {
    f.push({ surface: "netlify.toml", rule: "netlify-functions-or-plugins", detail: "functions/edge/plugins config" });
  }
  if (/netlify-identity|\[\[?identity\]\]?|data-netlify|\[forms\]/i.test(nt)) {
    f.push({ surface: "netlify.toml", rule: "netlify-identity-or-forms", detail: "Identity/Forms config" });
  }
  if (BILLING_URL_RE.test(nt)) f.push({ surface: "netlify.toml", rule: "billing-url", detail: "billing/checkout URL" });

  // 3. Config-file presence.
  for (const p of inp.presentConfigFiles) {
    if (BANNED_CONFIG_FILE.includes(p.replace(/\\/g, "/"))) {
      f.push({ surface: p, rule: "deploy-or-db-config-file", detail: p });
    }
  }

  // 4. Workflows.
  for (const wf of inp.workflows) {
    const lines = wf.content.split("\n");
    lines.forEach((ln, i) => {
      const at = `${wf.name}:${i + 1}`;
      const ro = ln.match(/runs-on:\s*\[?\s*["']?([A-Za-z0-9._-]+)/i);
      if (ro && !STANDARD_RUNNER_RE.test(ro[1])) {
        f.push({ surface: at, rule: "non-standard-runner", detail: `runs-on: ${ro[1]}` });
      }
      if (/^\s*(schedule|cron)\s*:/i.test(ln) || /-\s*cron\s*:/i.test(ln)) {
        f.push({ surface: at, rule: "scheduled-workflow", detail: ln.trim().slice(0, 60) });
      }
      if (/codespaces|prebuild/i.test(ln)) {
        f.push({ surface: at, rule: "codespaces-config", detail: ln.trim().slice(0, 60) });
      }
      const sec = ln.match(CLOUD_SECRET_RE);
      if (sec) f.push({ surface: at, rule: "cloud-deploy-secret", detail: sec[1] });
      if (BILLING_URL_RE.test(ln)) f.push({ surface: at, rule: "billing-url", detail: ln.trim().slice(0, 60) });
    });
  }

  return f;
}

export function collectInputs(root: string): ZeroCostInputs {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const netlify = existsSync(join(root, "netlify.toml")) ? readFileSync(join(root, "netlify.toml"), "utf8") : "";
  const wfDir = join(root, ".github/workflows");
  const workflows: Array<{ name: string; content: string }> = [];
  if (existsSync(wfDir)) {
    for (const n of readdirSync(wfDir)) {
      if (n.endsWith(".yml") || n.endsWith(".yaml")) {
        workflows.push({ name: `.github/workflows/${n}`, content: readFileSync(join(wfDir, n), "utf8") });
      }
    }
  }
  const candidates = [
    "railway.json", "railway.toml", "nixpacks.toml", "Procfile", "vercel.json", "render.yaml", "render.yml",
    "fly.toml", "app.yaml", "drizzle.config.ts", "drizzle.config.js", "prisma/schema.prisma",
    ".devcontainer/devcontainer.json", ".env",
  ];
  const presentConfigFiles = candidates.filter((p) => existsSync(join(root, p)));
  return { packageJson: pkg, netlifyToml: netlify, workflows, presentConfigFiles };
}

const invokedDirectly = process.argv[1] && /check-zero-cost\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  const findings = scanZeroCost(collectInputs(process.cwd()));
  for (const x of findings) process.stderr.write(`FAIL  ${x.surface}  [${x.rule}]  ${x.detail}\n`);
  process.stdout.write(`\n[zero-cost] infrastructure config scanned; ${findings.length} cost-adding surface(s)\n`);
  if (findings.length > 0) {
    process.stderr.write("ZERO_COST_BOUNDARY_FAILED — a paid/metered surface would be reintroduced.\n");
    process.exit(1);
  }
  process.stdout.write("ZERO_COST_OK — no hosted backend, DB, paid CI, analytics, email sender, or paid SaaS config.\n");
}
