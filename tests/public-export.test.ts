// Public export pipeline: proves the export is allowlist-based, fails closed, is deterministic,
// carries no private material, produces a fresh Git repo with no history and no commit, and that
// final mode refuses without validated real values. These invariants gate whether Avorelo can be
// prepared for a public source-available release at all, so they are exercised end-to-end here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const TOOL = join(REPO, "tools", "create-public-export.ts");

// The export pipeline (release/ manifests + the tool's inputs) is canonical-only and is excluded
// from the public export itself. Inside an export tree these inputs are absent, so these tests skip
// cleanly. In the canonical repo they run in full.
const CANONICAL =
  existsSync(join(REPO, "release", "public-export-manifest.json")) &&
  existsSync(join(REPO, "release", "public-export-exclusions.json"));
const skip = CANONICAL ? false : "canonical-only export pipeline inputs absent — export tree";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
function runExport(args: string[], env: Record<string, string | undefined> = {}) {
  return execFileSync(process.execPath, [TOOL, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function runExportExpectFail(args: string[], env: Record<string, string | undefined> = {}) {
  try {
    execFileSync(process.execPath, [TOOL, ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { failed: false, output: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { failed: true, code: e.status, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
  }
}
function sha256(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

test("review export produces a clean tree with the expected guards", { skip }, () => {
  const dest = tmp("avorelo-exp-review-");
  try {
    runExport(["--mode", "review", "--destination", dest]);

    // Forbidden material absent.
    for (const forbidden of [
      "docs/legal",
      ".claude",
      ".avorelo",
      "scripts",
      "release",
      "node_modules",
      "CLAUDE.md",
      "docs/internal",
      "docs/maintenance",
    ]) {
      assert.ok(!existsSync(join(dest, forbidden)), `export must not contain ${forbidden}`);
    }

    // Expected material present.
    for (const req of [
      "package.json",
      "package-lock.json",
      "README.md",
      "SECURITY.md",
      "bin/avorelo.mjs",
      "src/avorelo/surfaces/cli/avorelo.ts",
      "PRE-RELEASE-NOTICE.md",
      "PUBLIC-EXPORT-MANIFEST.json",
      "docs/project-history.md",
    ]) {
      assert.ok(existsSync(join(dest, req)), `export must contain ${req}`);
    }

    // Review package guards: Apache-2.0 metadata, but private + prepublish guard mark the LOCAL copy.
    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"));
    assert.equal(pkg.version, "1.0.0-rc.1", "candidate version applied in export");
    assert.equal(pkg.private, true, "review package is private (local inspection copy)");
    assert.equal(pkg.license, "Apache-2.0", "review package carries the Apache-2.0 license");
    assert.ok(pkg.scripts?.prepublishOnly, "review package has a prepublish guard");

    // Review notice content: Apache-2.0, review copy, not the published artifact.
    const notice = readFileSync(join(dest, "PRE-RELEASE-NOTICE.md"), "utf8");
    assert.match(notice, /review export/i);
    assert.match(notice, /Apache License 2\.0/i);
    assert.match(notice, /must not be published to npm/i);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("export manifest records commit, mode, sorted paths, and per-file hashes", { skip }, () => {
  const dest = tmp("avorelo-exp-manifest-");
  try {
    runExport(["--mode", "review", "--destination", dest]);
    const m = JSON.parse(readFileSync(join(dest, "PUBLIC-EXPORT-MANIFEST.json"), "utf8"));
    assert.equal(m.mode, "review");
    assert.match(m.canonicalCommit, /^[0-9a-f]{40}$/, "records the canonical commit sha");
    assert.ok(m.fileCount > 100, "records a plausible file count");
    assert.equal(m.paths.length, m.fileCount, "paths length matches fileCount");
    const sorted = [...m.paths].sort();
    assert.deepEqual(m.paths, sorted, "paths are sorted");
    assert.ok(m.files.every((f: { sha256: string }) => /^[0-9a-f]{64}$/.test(f.sha256)), "each file has a sha256");
    assert.ok(m.excludedCategorySummary && Object.keys(m.excludedCategorySummary).length > 0, "excluded summary present");
    // No local absolute path leaked into the manifest.
    const blob = JSON.stringify(m);
    assert.ok(!/C:\\\\Users|C:\/Users/.test(blob), "manifest has no local absolute path");
    assert.ok(!blob.includes("docs/legal"), "manifest lists no docs/legal path");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("review export is deterministic: two runs produce identical manifests", { skip }, () => {
  const a = tmp("avorelo-exp-det-a-");
  const b = tmp("avorelo-exp-det-b-");
  try {
    runExport(["--mode", "review", "--destination", a]);
    runExport(["--mode", "review", "--destination", b]);
    assert.equal(
      sha256(join(a, "PUBLIC-EXPORT-MANIFEST.json")),
      sha256(join(b, "PUBLIC-EXPORT-MANIFEST.json")),
      "manifest bytes must be identical across runs from the same commit",
    );
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("export initializes a fresh git repo with no history and no remote", { skip }, () => {
  const dest = tmp("avorelo-exp-git-");
  try {
    runExport(["--mode", "review", "--destination", dest]);
    assert.ok(existsSync(join(dest, ".git")), "fresh .git exists");
    const count = execFileSync("git", ["-C", dest, "rev-list", "--all", "--count"], {
      encoding: "utf8",
    }).trim();
    assert.equal(count, "0", "no commits — initial commit is blocked pending an approved author");
    const remotes = execFileSync("git", ["-C", dest, "remote"], { encoding: "utf8" }).trim();
    assert.equal(remotes, "", "no remote configured");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("final mode refuses with no validated values", { skip }, () => {
  const r = runExportExpectFail(["--mode", "final", "--dry-run"], { AVORELO_FINAL_VALUES: undefined });
  assert.ok(r.failed, "final mode must fail without values");
  assert.match(r.output, /FINAL MODE REFUSED/);
  assert.match(r.output, /No placeholder fallback/);
});

test("final mode refuses placeholder values (UNLICENSED, TBD, PENDING, licensor placeholder)", { skip }, () => {
  const valuesPath = tmp("avorelo-final-") + ".json";
  writeFileSync(
    valuesPath,
    JSON.stringify({
      licenseFile: "LICENSE",
      packageLicense: "UNLICENSED",
      licensor: "[LEGAL LICENSOR NAME — OWNER/COUNSEL TO CONFIRM]",
      commercialContact: "TBD",
      repositoryUrl: "https://github.com/HappyLifeSaaS/Avorelo",
      homepageUrl: "https://avorelo.com",
      bugsUrl: "PENDING",
      version: "1.0.0",
      contributionPolicy: "TBD",
      ownerApprovalMarker: "pending",
    }),
  );
  try {
    const r = runExportExpectFail(["--mode", "final", "--dry-run"], { AVORELO_FINAL_VALUES: valuesPath });
    assert.ok(r.failed, "final mode must reject placeholders");
    assert.match(r.output, /placeholder/i);
    assert.match(r.output, /UNLICENSED/);
    assert.match(r.output, /OWNER\/COUNSEL TO CONFIRM/);
  } finally {
    rmSync(valuesPath, { force: true });
  }
});

test("final mode refuses unfilled <FILL: …> template values, even in dry-run", { skip }, () => {
  // Regression: the final-mode gate previously accepted angle-bracket <FILL:…> placeholders and a
  // non-existent license path in --dry-run. Both must be rejected before any external action.
  const valuesPath = tmp("avorelo-fill-") + ".json";
  writeFileSync(
    valuesPath,
    JSON.stringify({
      licenseFile: "<FILL: absolute path to the counsel-approved final Personal Use License>",
      packageLicense: "SEE LICENSE IN LICENSE",
      licensor: "<FILL: exact individual or legal-entity name>",
      commercialContact: "<FILL: verified role-based email or approved commercial contact URL>",
      repositoryUrl: "https://github.com/HappyLifeSaaS/Avorelo",
      homepageUrl: "https://avorelo.com",
      bugsUrl: "https://github.com/HappyLifeSaaS/Avorelo/issues",
      version: "1.0.0-rc.1",
      contributionPolicy: "Contributions are not currently accepted.",
      ownerApprovalMarker: "<FILL: public Git author name>",
    }),
  );
  try {
    const r = runExportExpectFail(["--mode", "final", "--dry-run"], { AVORELO_FINAL_VALUES: valuesPath });
    assert.ok(r.failed, "final mode must reject <FILL> template values");
    assert.match(r.output, /unfilled template|<FILL|FINAL MODE REFUSED/);
    assert.match(r.output, /ownerApprovalMarker must contain "APPROVED"/);
  } finally {
    rmSync(valuesPath, { force: true });
  }
});

test("allowlist manifest and exclusion policy never reach docs/legal", { skip }, () => {
  const manifest = JSON.parse(
    readFileSync(join(REPO, "release", "public-export-manifest.json"), "utf8"),
  );
  for (const e of manifest.include) {
    assert.ok(!String(e.path).includes("docs/legal"), `allowlist must not include ${e.path}`);
    assert.ok(String(e.path) !== "docs" && String(e.path) !== "docs/", "allowlist must not include all of docs/");
  }
  const ex = JSON.parse(
    readFileSync(join(REPO, "release", "public-export-exclusions.json"), "utf8"),
  );
  assert.ok(
    ex.deniedPathPrefixes.some((d: { path: string }) => d.path === "docs/legal/"),
    "exclusion policy must deny docs/legal/",
  );
  // scripts/ (hosted-era) and internal docs must be denied.
  for (const denied of ["scripts/", "docs/internal/", "docs/maintenance/", "release/"]) {
    assert.ok(
      ex.deniedPathPrefixes.some((d: { path: string }) => d.path === denied),
      `exclusion policy must deny ${denied}`,
    );
  }
});
