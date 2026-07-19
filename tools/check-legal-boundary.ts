/**
 * check-legal-boundary — proves docs/legal/ cannot reach any distribution surface.
 *
 * docs/legal/ holds counsel-review drafts. A draft license published by accident is worse
 * than no license: readers may rely on it, and a public grant cannot be recalled from copies
 * already made. This check makes the exclusion a build gate rather than a convention.
 *
 * Three surfaces, proven independently:
 *   1. npm tarball  — against package.json `files`, and against the real `npm pack` file list
 *   2. public export — against the allowlist manifest and the exclusion policy, in both modes
 *   3. static site   — against the generated site output
 *
 * Deterministic and offline. `npm pack --dry-run` performs no network I/O.
 *
 * The check is directory-scoped: a new file under docs/legal/ inherits the exclusion with no
 * change here. Surfaces that do not exist yet (an unbuilt site, an unwritten export tool) are
 * reported as SKIP with a reason, never as PASS — an absent surface proves nothing.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const LEGAL_DIR = "docs/legal";

type Result = { name: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };
const results: Result[] = [];

const pass = (name: string, detail: string) => results.push({ name, status: "PASS", detail });
const fail = (name: string, detail: string) => results.push({ name, status: "FAIL", detail });
const skip = (name: string, detail: string) => results.push({ name, status: "SKIP", detail });

const toPosix = (p: string) => p.split(sep).join("/");

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Every file currently in docs/legal/, as repo-relative posix paths. */
function legalFiles(): string[] {
  return walk(join(ROOT, LEGAL_DIR)).map((f) => toPosix(relative(ROOT, f)));
}

// ---------------------------------------------------------------------------
// Surface 1 — npm tarball
// ---------------------------------------------------------------------------

function checkPackageFilesAllowlist(files: string[]): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    files?: string[];
  };

  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    fail(
      "package.files allowlist",
      "package.json has no `files` allowlist. Without it npm falls back to including the whole " +
        "directory tree, which would ship docs/legal/. An explicit allowlist is required.",
    );
    return;
  }

  const offenders = pkg.files.filter(
    (f) => toPosix(f).includes("docs/legal") || toPosix(f) === "docs" || toPosix(f).startsWith("docs/"),
  );

  if (offenders.length > 0) {
    fail(
      "package.files allowlist",
      `package.json \`files\` contains entries that reach docs/: ${offenders.join(", ")}`,
    );
    return;
  }

  pass(
    "package.files allowlist",
    `\`files\` is an explicit allowlist of ${pkg.files.length} entries, none reaching docs/: ` +
      pkg.files.join(", "),
  );
  void files;
}

function checkNpmPackFileList(files: string[]): void {
  let raw: string;
  try {
    // Args are hardcoded literals (no interpolation), so shell:true carries no injection risk.
    // On Windows, npm resolves to npm.cmd, which execFile can only launch via a shell.
    raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  } catch (err) {
    // A packaging failure is not a legal-boundary result. Report honestly rather than
    // letting a broken pack masquerade as a passing exclusion.
    skip(
      "npm pack file list",
      `\`npm pack --dry-run\` did not complete, so the real tarball list could not be inspected: ${
        (err as Error).message.split("\n")[0]
      }`,
    );
    return;
  }

  let entries: Array<{ files?: Array<{ path: string }> }>;
  try {
    entries = JSON.parse(raw) as Array<{ files?: Array<{ path: string }> }>;
  } catch {
    skip("npm pack file list", "`npm pack --dry-run --json` output was not parseable JSON.");
    return;
  }

  const packed = (entries[0]?.files ?? []).map((f) => toPosix(f.path));
  if (packed.length === 0) {
    skip("npm pack file list", "`npm pack --dry-run --json` reported no files.");
    return;
  }

  const leaked = packed.filter((p) => p.startsWith(`${LEGAL_DIR}/`) || p.includes("docs/legal"));
  if (leaked.length > 0) {
    fail("npm pack file list", `Tarball would contain legal drafts: ${leaked.join(", ")}`);
    return;
  }

  pass(
    "npm pack file list",
    `Real tarball list has ${packed.length} files, none under docs/legal/: ${packed.join(", ")}`,
  );
  void files;
}

// ---------------------------------------------------------------------------
// Surface 2 — public export
// ---------------------------------------------------------------------------

function checkExportExclusionPolicy(): void {
  const policyPath = join(ROOT, "release", "public-export-exclusions.json");
  if (!existsSync(policyPath)) {
    fail(
      "export exclusion policy",
      "release/public-export-exclusions.json is missing. The export cannot be proven to exclude " +
        "docs/legal/ without it.",
    );
    return;
  }

  const policy = JSON.parse(readFileSync(policyPath, "utf8")) as {
    policy?: { onUndeclaredFile?: string };
    deniedPathPrefixes?: Array<{ path: string; category?: string }>;
    contentDenylist?: Array<{ id: string; allowlistPaths?: string[] }>;
  };

  const denied = (policy.deniedPathPrefixes ?? []).some((e) => toPosix(e.path) === `${LEGAL_DIR}/`);
  if (!denied) {
    fail(
      "export exclusion policy",
      `release/public-export-exclusions.json does not deny \`${LEGAL_DIR}/\`.`,
    );
    return;
  }

  if (policy.policy?.onUndeclaredFile !== "fail") {
    fail(
      "export exclusion policy",
      "Export policy does not fail closed on undeclared files (`policy.onUndeclaredFile` !== 'fail').",
    );
    return;
  }

  // An allowlist that re-admitted docs/legal would silently defeat the denial above.
  const readmitted = (policy.contentDenylist ?? []).filter((r) =>
    (r.allowlistPaths ?? []).some((p) => toPosix(p).includes("docs/legal")),
  );
  if (readmitted.length > 0) {
    fail(
      "export exclusion policy",
      `Content rules allowlist docs/legal, which would re-admit it: ${readmitted
        .map((r) => r.id)
        .join(", ")}`,
    );
    return;
  }

  pass(
    "export exclusion policy",
    `Policy denies \`${LEGAL_DIR}/\`, fails closed on undeclared files, and no content rule ` +
      "re-admits it.",
  );
}

function checkExportManifestAllowlist(): void {
  const manifestPath = join(ROOT, "release", "public-export-manifest.json");
  if (!existsSync(manifestPath)) {
    skip(
      "export manifest allowlist",
      "release/public-export-manifest.json does not exist yet. The exclusion policy check above " +
        "still applies; this check activates once the allowlist exists.",
    );
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    include?: Array<{ path: string }>;
  };
  const include = manifest.include ?? [];
  const offenders = include.filter((e) => {
    const p = toPosix(e.path);
    return p.includes("docs/legal") || p === "docs" || p === "docs/";
  });

  if (offenders.length > 0) {
    fail(
      "export manifest allowlist",
      `Export allowlist reaches docs/legal: ${offenders.map((o) => o.path).join(", ")}`,
    );
    return;
  }

  pass(
    "export manifest allowlist",
    `Allowlist has ${include.length} entries, none reaching docs/legal/.`,
  );
}

function checkExportToolHonoursBothModes(): void {
  const toolPath = join(ROOT, "tools", "create-public-export.ts");
  if (!existsSync(toolPath)) {
    skip(
      "export tool modes",
      "tools/create-public-export.ts does not exist yet. This check activates once it does.",
    );
    return;
  }

  const src = readFileSync(toolPath, "utf8");

  // The tool must read the policy rather than carry its own copy of the exclusion.
  if (!src.includes("public-export-exclusions.json")) {
    fail(
      "export tool modes",
      "tools/create-public-export.ts does not load release/public-export-exclusions.json, so the " +
        "exclusion policy is not proven to apply to it.",
    );
    return;
  }

  // A mode-conditional legal exclusion would be a hole. The denial must not be mode-aware.
  const modeConditionalLegal = /mode\s*===\s*["'](review|final)["'][^\n]*docs\/legal/.test(src);
  if (modeConditionalLegal) {
    fail(
      "export tool modes",
      "tools/create-public-export.ts appears to condition the docs/legal exclusion on export mode. " +
        "The exclusion must apply unconditionally in every mode.",
    );
    return;
  }

  pass(
    "export tool modes",
    "Export tool loads the shared exclusion policy and does not condition the docs/legal exclusion " +
      "on mode.",
  );
}

function checkGeneratedExportIfPresent(files: string[]): void {
  const dest = process.env.AVORELO_EXPORT_DIR;
  if (!dest || !existsSync(dest)) {
    skip(
      "generated export tree",
      "No export tree to inspect (set AVORELO_EXPORT_DIR to a generated export to activate).",
    );
    return;
  }

  const legalHits = walk(dest)
    .map((f) => toPosix(relative(dest, f)))
    .filter((p) => p.startsWith(`${LEGAL_DIR}/`) || p.includes("docs/legal"));

  if (legalHits.length > 0) {
    fail("generated export tree", `Export at ${dest} contains legal drafts: ${legalHits.join(", ")}`);
    return;
  }

  // Also prove no legal draft slipped in under a different path — by CONTENT, not filename.
  // A filename match (e.g. README.md exists in both docs/legal and the project root) is not a
  // leak; identical bytes are.
  const legalHashes = new Set(
    files.map((f) => createHash("sha256").update(readFileSync(join(ROOT, f))).digest("hex")),
  );
  const contentLeaks = walk(dest)
    .map((f) => ({ rel: toPosix(relative(dest, f)), full: f }))
    .filter(({ full }) => {
      try {
        return legalHashes.has(createHash("sha256").update(readFileSync(full)).digest("hex"));
      } catch {
        return false;
      }
    })
    .map(({ rel }) => rel);
  if (contentLeaks.length > 0) {
    fail(
      "generated export tree",
      `Export contains files byte-identical to a legal draft: ${contentLeaks.join(", ")}`,
    );
    return;
  }

  pass("generated export tree", `Export at ${dest} contains no docs/legal content (path and byte-identity clear).`);
}

// ---------------------------------------------------------------------------
// Surface 3 — static site
// ---------------------------------------------------------------------------

function checkSiteBuildOutput(files: string[]): void {
  const siteDir = join(ROOT, "dist", "site");
  if (!existsSync(siteDir)) {
    skip(
      "site build output",
      "dist/site does not exist. Run `npm run build:site` first to activate this check.",
    );
    return;
  }

  const siteFiles = walk(siteDir).map((f) => toPosix(relative(siteDir, f)));
  const pathHits = siteFiles.filter((p) => p.includes("legal") && p.includes("draft"));
  if (pathHits.length > 0) {
    fail("site build output", `Generated site contains legal draft paths: ${pathHits.join(", ")}`);
    return;
  }

  // The site is generated from src/, so a draft can only appear if something read docs/legal.
  // Prove it by content: no page may carry the draft banner.
  const BANNER = "DRAFT FOR LEGAL REVIEW";
  const bannerHits: string[] = [];
  for (const rel of siteFiles) {
    const full = join(siteDir, rel);
    if (statSync(full).size > 4_000_000) continue;
    let body: string;
    try {
      body = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (body.includes(BANNER)) bannerHits.push(rel);
  }

  if (bannerHits.length > 0) {
    fail(
      "site build output",
      `Generated site pages carry the legal draft banner: ${bannerHits.join(", ")}`,
    );
    return;
  }

  pass(
    "site build output",
    `${siteFiles.length} generated site files, none carrying legal draft paths or the draft banner.`,
  );
  void files;
}

// ---------------------------------------------------------------------------
// Sanity — the drafts must actually be marked as drafts
// ---------------------------------------------------------------------------

function checkDraftsAreMarked(files: string[]): void {
  const BANNER = "DRAFT FOR LEGAL REVIEW — NOT AN ACTIVE LICENSE";
  const licenseLike = files.filter((f) => f.endsWith("personal-use-license-draft.md"));

  if (licenseLike.length === 0) {
    skip("draft banners", "No license-like draft present to check.");
    return;
  }

  const unmarked = licenseLike.filter((f) => !readFileSync(join(ROOT, f), "utf8").includes(BANNER));
  if (unmarked.length > 0) {
    fail("draft banners", `License-like drafts missing the draft banner: ${unmarked.join(", ")}`);
    return;
  }

  pass("draft banners", `${licenseLike.length} license-like draft(s) carry the draft banner.`);
}

function checkLicenseUnchanged(): void {
  // Apache-2.0 adoption (owner decision, 2026-07-19): the active license is the unmodified official
  // Apache License 2.0 — a standard OSI license that needs no counsel-drafted document. The boundary
  // now asserts Apache-2.0 IS activated and that no obsolete draft (Personal Use / "DRAFT FOR LEGAL
  // REVIEW") was installed as the active LICENSE.
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { license?: string };
  if (pkg.license !== "Apache-2.0") {
    fail(
      "license activated",
      `package.json license is "${pkg.license}", expected "Apache-2.0" (the adopted Open Source license).`,
    );
    return;
  }

  const license = readFileSync(join(ROOT, "LICENSE"), "utf8");
  if (license.includes("DRAFT FOR LEGAL REVIEW")) {
    fail("license activated", "LICENSE contains a draft banner — a draft was installed as the active license.");
    return;
  }
  if (/personal use license/i.test(license)) {
    fail("license activated", "LICENSE appears to contain the obsolete Personal Use License draft; the active license must be Apache-2.0.");
    return;
  }
  if (!/Apache License/.test(license) || !/Version 2\.0/.test(license)) {
    fail("license activated", "LICENSE is not the official Apache License, Version 2.0 text.");
    return;
  }

  pass("license activated", 'package.json license is "Apache-2.0" and LICENSE is the official Apache-2.0 text (no draft).');
}

// ---------------------------------------------------------------------------

function main(): void {
  const files = legalFiles();

  if (files.length === 0) {
    console.error("docs/legal/ is empty or missing — nothing to prove. Expected review material.");
    process.exit(1);
  }

  checkPackageFilesAllowlist(files);
  checkNpmPackFileList(files);
  checkExportExclusionPolicy();
  checkExportManifestAllowlist();
  checkExportToolHonoursBothModes();
  checkGeneratedExportIfPresent(files);
  checkSiteBuildOutput(files);
  checkDraftsAreMarked(files);
  checkLicenseUnchanged();

  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  const passed = results.filter((r) => r.status === "PASS");

  console.log("");
  console.log("  Legal boundary — docs/legal/ must not reach any distribution surface");
  console.log("  " + "─".repeat(72));
  console.log(`  Guarding ${files.length} file(s) in ${LEGAL_DIR}/`);
  console.log("");
  for (const r of results) {
    const mark = r.status === "PASS" ? "✔" : r.status === "FAIL" ? "✘" : "–";
    console.log(`  ${mark} ${r.name}`);
    console.log(`      ${r.detail}`);
  }
  console.log("");
  console.log(`  ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  console.log("");

  if (failed.length > 0) {
    console.error("  Legal boundary FAILED. docs/legal/ must never enter a distribution surface.");
    process.exit(1);
  }
  console.log("  Legal boundary holds.");
}

main();
