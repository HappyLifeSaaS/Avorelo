// Legal boundary: docs/legal/ holds counsel-review drafts (including a Personal Use License draft
// that is NOT an active license). A draft published by accident cannot be recalled from copies
// already made, so the exclusion is a hard invariant, not a convention. These tests prove the
// exclusion holds against every distribution surface and — critically — that it is directory-scoped,
// so a newly added draft inherits the exclusion with no test change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const LEGAL = "docs/legal";
const toPosix = (p: string) => p.split(sep).join("/");

// docs/legal and release/ are canonical-only and are intentionally excluded from the public
// export. When this test runs inside an export tree those inputs are absent, so the release-infra
// assertions skip cleanly rather than fail. In the canonical repo they run in full.
const CANONICAL = existsSync(join(ROOT, LEGAL)) && existsSync(join(ROOT, "release", "public-export-manifest.json"));
const skip = CANONICAL ? false : "canonical-only inputs (docs/legal, release/) absent — export tree";

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}
function legalFiles(): string[] {
  return walk(join(ROOT, LEGAL)).map((f) => toPosix(relative(ROOT, f)));
}

test("docs/legal contains review material to guard", { skip }, () => {
  const files = legalFiles();
  assert.ok(files.length > 0, "docs/legal/ should contain counsel-review material");
  assert.ok(
    files.some((f) => f.endsWith("personal-use-license-draft.md")),
    "the Personal Use License draft should be present",
  );
});

test("package.json files allowlist cannot reach docs/legal", { skip }, () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { files?: string[] };
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, "package.json must have a files allowlist");
  for (const f of pkg.files!) {
    assert.ok(!toPosix(f).startsWith("docs"), `files entry must not reach docs/: ${f}`);
  }
});

test("export exclusion policy denies docs/legal and fails closed", { skip }, () => {
  const policy = JSON.parse(
    readFileSync(join(ROOT, "release", "public-export-exclusions.json"), "utf8"),
  ) as {
    policy?: { onUndeclaredFile?: string };
    deniedPathPrefixes?: Array<{ path: string }>;
    contentDenylist?: Array<{ id: string; allowlistPaths?: string[] }>;
  };
  assert.equal(policy.policy?.onUndeclaredFile, "fail", "export must fail closed on undeclared files");
  assert.ok(
    (policy.deniedPathPrefixes ?? []).some((e) => toPosix(e.path) === `${LEGAL}/`),
    "policy must deny docs/legal/",
  );
  // No content allowlist may re-admit docs/legal.
  for (const rule of policy.contentDenylist ?? []) {
    for (const p of rule.allowlistPaths ?? []) {
      assert.ok(
        !toPosix(p).includes("docs/legal"),
        `content rule ${rule.id} must not allowlist docs/legal`,
      );
    }
  }
});

test("directory-scoped: every current legal file is covered by the docs/legal denial", { skip }, () => {
  // The denial is a prefix, so any file under docs/legal is covered regardless of name. This
  // proves a NEW draft needs no policy edit — the guarantee the README and blockers doc rely on.
  const files = legalFiles();
  for (const f of files) {
    assert.ok(f.startsWith(`${LEGAL}/`), `guarded file must live under ${LEGAL}/: ${f}`);
  }
});

test("license-like drafts carry the draft banner and no effective date", { skip }, () => {
  const BANNER = "DRAFT FOR LEGAL REVIEW — NOT AN ACTIVE LICENSE";
  const draft = join(ROOT, LEGAL, "personal-use-license-draft.md");
  const body = readFileSync(draft, "utf8");
  assert.ok(body.includes(BANNER), "license draft must carry the draft banner");
  // Banner must appear at least twice (top and near the end) so it cannot be lost by truncation.
  assert.ok(body.split(BANNER).length - 1 >= 2, "draft banner must appear at top and near the end");
  assert.ok(
    body.includes("[LEGAL LICENSOR NAME — OWNER/COUNSEL TO CONFIRM]"),
    "license draft must use the licensor placeholder, not a real identity",
  );
});

test("active LICENSE is Apache-2.0 and no draft is installed", { skip }, () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { license?: string };
  assert.equal(pkg.license, "Apache-2.0", "package license is Apache-2.0");
  const license = readFileSync(join(ROOT, "LICENSE"), "utf8");
  assert.ok(/Apache License\s+Version 2\.0/i.test(license), "LICENSE must be the Apache License 2.0");
  assert.ok(!license.includes("DRAFT FOR LEGAL REVIEW"), "LICENSE must not contain a draft banner");
  assert.ok(!/avorelo personal use license/i.test(license), "the personal-use draft must not be installed as LICENSE");
});

test("generated site (if built) carries no legal draft banner", { skip }, () => {
  const siteDir = join(ROOT, "dist", "site");
  if (!existsSync(siteDir)) return; // built surface; validated by check:legal-boundary when present
  const BANNER = "DRAFT FOR LEGAL REVIEW";
  for (const f of walk(siteDir)) {
    if (statSync(f).size > 4_000_000) continue;
    const body = readFileSync(f, "utf8");
    assert.ok(!body.includes(BANNER), `site page must not carry the legal draft banner: ${f}`);
  }
});
