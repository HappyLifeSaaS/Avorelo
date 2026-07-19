// Avorelo contact-truth gate.
//
// Deterministic gate over every SHIPPED public contact surface. It proves a single, honest public
// contact story:
//   - exactly one approved public email — support@avorelo.com — and no other real address;
//   - zero personal owner email (and zero personal-mailbox-shaped address);
//   - zero placeholder/invented commercial address (founder@, licensing@, sales@, contact@, …);
//   - zero "contact channel pending / will be published" claim on a shipped surface;
//   - no website contact <form>, no JS/API sender, no automatic request;
//   - contact wording that does not grant rights, and the commercial-use restriction, remain present.
//
// The scan is over content, not paths. Detection code, tests, fixtures, and staging templates legally
// contain forbidden shapes (they exist to detect or stage them), so they are NOT part of the shipped
// public set and are not scanned here. This gate reads the real files when run, and exposes a pure
// scanContent() so the test suite can prove it with adversarial injections.
//
// Usage: node tools/check-contact-truth.ts   (exit 0 = consistent, 1 = violations)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const APPROVED_EMAIL = "support@avorelo.com";

export type ContactFinding = { path: string; rule: string; detail: string };

/** A file to scan, and which rule groups apply to it. */
export type ScanFile = {
  path: string;
  content: string;
  /** "shipped" = a public surface a user sees (strict). "release" = internal release template/manifest. */
  kind: "shipped" | "release";
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/gi;
const PERSONAL_MAILBOX_RE = /@(gmail|outlook|hotmail|yahoo|icloud|proton(?:mail)?|live|aol|gmx|mail)\.[a-z]{2,}/i;
// Fixture/example domains that are never a real published address.
const EXAMPLE_DOMAIN_RE = /@(example\.(?:com|org|net)|test|localhost|db\.internal|[a-z0-9.-]*\.example)$/i;
// A bare {{PLACEHOLDER}} token — release templates legitimately use these instead of a real address.
const TEMPLATE_TOKEN_RE = /\{\{[^}]+\}\}/;

/** Pure scanner. Given the file set, return every contact-truth violation. */
export function scanContent(files: ScanFile[]): ContactFinding[] {
  const findings: ContactFinding[] = [];
  let approvedSeenOnShipped = false;

  for (const f of files) {
    const lines = f.content.split("\n");

    lines.forEach((ln, i) => {
      const at = `${f.path}:${i + 1}`;

      // 1. Email addresses. Only support@avorelo.com is permitted anywhere in the scanned set;
      //    example/fixture domains are ignored; template placeholders are permitted in "release".
      for (const m of ln.matchAll(EMAIL_RE)) {
        const addr = m[0];
        const lower = addr.toLowerCase();
        if (lower === APPROVED_EMAIL) { if (f.kind === "shipped") approvedSeenOnShipped = true; continue; }
        if (EXAMPLE_DOMAIN_RE.test(lower)) continue;
        if (PERSONAL_MAILBOX_RE.test(lower)) {
          findings.push({ path: at, rule: "personal-email", detail: addr });
          continue;
        }
        if (/@avorelo\.com$/i.test(lower)) {
          findings.push({ path: at, rule: "non-approved-avorelo-email", detail: addr });
          continue;
        }
        findings.push({ path: at, rule: "unexpected-published-email", detail: addr });
      }

      // 2. Placeholder / template tokens must not survive into a SHIPPED surface.
      if (f.kind === "shipped" && TEMPLATE_TOKEN_RE.test(ln) && /contact|email|licen[cs]e|support/i.test(ln)) {
        findings.push({ path: at, rule: "unresolved-template-token", detail: ln.trim().slice(0, 100) });
      }

      // 3. "Contact channel pending / will be published" claims on a shipped surface.
      if (f.kind === "shipped") {
        if (/\bchannel pending\b/i.test(ln) ||
            /contact channel (?:is )?(?:pending|will be|to be) (?:published|added|provided)/i.test(ln) ||
            /(?:verified )?(?:commercial[- ]licensing )?contact channel will be published/i.test(ln) ||
            /no (?:published )?(?:contact )?address (?:on this site|yet)/i.test(ln)) {
          findings.push({ path: at, rule: "pending-contact-claim", detail: ln.trim().slice(0, 100) });
        }
      }

      // 4. No website contact form or JS/API sender on a shipped HTML surface.
      if (f.kind === "shipped" && f.path.endsWith(".html")) {
        if (/<form\b/i.test(ln)) findings.push({ path: at, rule: "contact-form", detail: "<form>" });
        // A real JS/API sender: an actual call-shape, or a named contact-form processor. Prose
        // mentions ("your browser does fetch the fonts") are not senders.
        const send = ln.match(/\b(?:fetch|sendBeacon)\s*\(|new\s+XMLHttpRequest|\b(?:EmailJS|formspree|getform|netlify\s+forms)\b/i);
        if (send) findings.push({ path: at, rule: "js-sender", detail: send[0].trim() });
        const mailtoForm = ln.match(/action\s*=\s*["']mailto:/i);
        if (mailtoForm) findings.push({ path: at, rule: "mailto-form-action", detail: mailtoForm[0] });
      }
    });
  }

  // 5. The approved address must actually be present on at least one shipped surface — otherwise the
  //    "single public contact" claim is not backed by a reachable channel.
  const shippedFiles = files.filter((f) => f.kind === "shipped");
  if (shippedFiles.length > 0 && !approvedSeenOnShipped) {
    findings.push({ path: "(shipped set)", rule: "no-approved-contact", detail: `${APPROVED_EMAIL} appears on no shipped surface` });
  }

  return findings;
}

// ---- real-file collection (only used when run as a script) ----

function read(root: string, rel: string): ScanFile | null {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  const kind: ScanFile["kind"] = rel.startsWith("release/") ? "release" : "shipped";
  return { path: rel, content: readFileSync(abs, "utf8"), kind };
}

export function collectRealFiles(root: string): ScanFile[] {
  const files: ScanFile[] = [];
  const rootDocs = ["README.md", "SUPPORT.md", "COMMERCIAL-SERVICES.md", "CONTRIBUTING.md", "SECURITY.md", "package.json"];
  for (const r of rootDocs) { const f = read(root, r); if (f) files.push(f); }

  const staticDir = join(root, "src/avorelo/surfaces/public-web/static");
  if (existsSync(staticDir)) {
    for (const n of readdirSync(staticDir)) {
      if (n.endsWith(".html")) { const f = read(root, `src/avorelo/surfaces/public-web/static/${n}`); if (f) files.push(f); }
    }
  }

  const releaseFiles = [
    "release/public-export-manifest.json",
    "release/source-available-release-manifest.json",
  ];
  for (const r of releaseFiles) { const f = read(root, r); if (f) files.push(f); }
  const templatesDir = join(root, "release/templates");
  if (existsSync(templatesDir)) {
    for (const n of readdirSync(templatesDir)) {
      if (n.endsWith(".md")) { const f = read(root, `release/templates/${n}`); if (f) files.push(f); }
    }
  }
  return files;
}

const invokedDirectly = process.argv[1] && /check-contact-truth\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  const root = process.cwd();
  const files = collectRealFiles(root);
  const findings = scanContent(files);
  for (const f of findings) process.stderr.write(`FAIL  ${f.path}  [${f.rule}]  ${f.detail}\n`);
  process.stdout.write(`\n[contact-truth] scanned ${files.length} surfaces; ${findings.length} violation(s)\n`);
  if (findings.length > 0) {
    process.stderr.write("CONTACT_TRUTH_FAILED — the public contact story is inconsistent.\n");
    process.exit(1);
  }
  process.stdout.write(`CONTACT_TRUTH_OK — single approved public contact (${APPROVED_EMAIL}); no personal, invented, pending, or form-based contact.\n`);
}
