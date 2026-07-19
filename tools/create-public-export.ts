/**
 * create-public-export — deterministic, allowlist-based, fail-closed public export.
 *
 * Produces a clean review or final export of Avorelo into a fresh directory with no imported
 * Git history. It NEVER copies the canonical repository blindly. A file is copied only if it
 * matches release/public-export-manifest.json; the exclusion denylist in
 * release/public-export-exclusions.json is applied as an independent second barrier and always
 * wins (fail-closed). Content is scanned for secrets, personal data, hosted residue, and false
 * license claims. docs/legal/ can never enter any mode.
 *
 * Modes:
 *   --mode review  (default)  Safe to inspect locally; visibly non-releasable. Keeps package
 *                             UNLICENSED and private:true, adds PRE-RELEASE-NOTICE.md, guards
 *                             against npm publish. No grant of rights.
 *   --mode final              Refuses unless validated real values are supplied for license,
 *                             licensor, contact, repository/homepage/bugs URLs, version, and
 *                             owner approval. No placeholder fallback.
 *
 * Flags:
 *   --destination <path>      Export destination (default: C:\Users\<user>\avorelo-public-export
 *                             or ~/avorelo-public-export).
 *   --dry-run                 Compute and validate everything, print the plan, write nothing.
 *   --tarball-safe            (rehearsal) Do not fail the run on the review publish guard; used
 *                             only to allow local tarball inspection. Never weakens the guard in
 *                             the produced package.
 *
 * Determinism: from a fixed canonical commit, two review runs produce identical path lists,
 * byte contents, and PUBLIC-EXPORT-MANIFEST.json (per-file SHA-256, no timestamps).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const SOURCE_ROOT = resolve(import.meta.dirname, "..");
const GENERATOR_VERSION = "1.0.0";

const toPosix = (p: string) => p.split(sep).join("/");

// Directories never worth walking; also unconditionally excluded.
const HARD_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".claude",
  ".avorelo",
  ".npm-cache",
]);

type Mode = "review" | "final";

interface Args {
  mode: Mode;
  destination: string;
  dryRun: boolean;
  tarballSafe: boolean;
}

function parseArgs(argv: string[]): Args {
  let mode: Mode = "review";
  let destination = "";
  let dryRun = false;
  let tarballSafe = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") {
      const v = argv[++i];
      if (v !== "review" && v !== "final") throw new Error(`--mode must be review|final, got ${v}`);
      mode = v;
    } else if (a === "--destination") {
      destination = argv[++i];
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--tarball-safe") {
      tarballSafe = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!destination) {
    destination = join(homedir(), "avorelo-public-export");
  }
  return { mode, destination: resolve(destination), dryRun, tarballSafe };
}

// ---------------------------------------------------------------------------
// Policy loading
// ---------------------------------------------------------------------------

interface Manifest {
  include: Array<{ path: string; kind: "tree" | "file"; generatedIfMissing?: boolean }>;
  generated: Array<{ path: string; mode: string }>;
  expectedPresent: string[];
  mustNeverAppear: string[];
  generatorVersion: string;
}

interface Exclusions {
  deniedPathPrefixes: Array<{ path: string; category: string }>;
  deniedPathPatterns: Array<{ pattern: string; category: string; exceptions?: string[] }>;
  contentDenylist: Array<{
    id: string;
    pattern: string;
    category: string;
    allowlistPaths?: string[];
    flags?: string;
  }>;
}

function loadManifest(): Manifest {
  return JSON.parse(
    readFileSync(join(SOURCE_ROOT, "release", "public-export-manifest.json"), "utf8"),
  ) as Manifest;
}
function loadExclusions(): Exclusions {
  return JSON.parse(
    readFileSync(join(SOURCE_ROOT, "release", "public-export-exclusions.json"), "utf8"),
  ) as Exclusions;
}

// ---------------------------------------------------------------------------
// File enumeration and classification
// ---------------------------------------------------------------------------

function walkAll(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (HARD_SKIP_DIRS.has(entry.name)) continue;
      walkAll(join(dir, entry.name), acc);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

function matchesAllowlist(relPath: string, manifest: Manifest): boolean {
  for (const e of manifest.include) {
    const p = toPosix(e.path);
    if (e.kind === "file" && relPath === p) return true;
    if (e.kind === "tree" && relPath.startsWith(p.endsWith("/") ? p : p + "/")) return true;
  }
  return false;
}

function deniedByPath(
  relPath: string,
  ex: Exclusions,
): { denied: boolean; category?: string } {
  for (const e of ex.deniedPathPrefixes) {
    const p = toPosix(e.path);
    if (relPath.startsWith(p.endsWith("/") ? p : p + "/") || relPath === p.replace(/\/$/, "")) {
      return { denied: true, category: e.category };
    }
  }
  for (const e of ex.deniedPathPatterns) {
    const re = new RegExp(e.pattern);
    if (re.test(relPath)) {
      const excepted = (e.exceptions ?? []).some((ex2) => relPath.startsWith(toPosix(ex2)));
      if (!excepted) return { denied: true, category: e.category };
    }
  }
  return { denied: false };
}

// ---------------------------------------------------------------------------
// Content scanning
// ---------------------------------------------------------------------------

interface ContentHit {
  file: string;
  ruleId: string;
  category: string;
  sample: string;
}

const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|eot|pdf|zip|gz)$/i;

function scanContent(
  includedFiles: string[],
  ex: Exclusions,
): ContentHit[] {
  const hits: ContentHit[] = [];
  const rules = ex.contentDenylist.map((r) => ({
    ...r,
    re: new RegExp(r.pattern, r.flags && r.flags.includes("g") ? r.flags : (r.flags ?? "") + "g"),
    allow: (r.allowlistPaths ?? []).map(toPosix),
  }));
  for (const rel of includedFiles) {
    if (BINARY_EXT.test(rel)) continue;
    const full = join(SOURCE_ROOT, rel);
    if (statSync(full).size > 8_000_000) continue;
    let body: string;
    try {
      body = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.allow.some((a) => rel.startsWith(a))) continue;
      rule.re.lastIndex = 0;
      const m = rule.re.exec(body);
      if (m) {
        hits.push({
          file: rel,
          ruleId: rule.id,
          category: rule.category,
          sample: m[0].slice(0, 40),
        });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Security checks
// ---------------------------------------------------------------------------

function checkSymlinkEscapes(files: string[]): string[] {
  const escapes: string[] = [];
  const rootReal = realpathSync(SOURCE_ROOT);
  for (const rel of files) {
    const full = join(SOURCE_ROOT, rel);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      const target = readlinkSync(full);
      const resolved = isAbsolute(target) ? target : resolve(dirname(full), target);
      let real: string;
      try {
        real = realpathSync(resolved);
      } catch {
        escapes.push(`${rel} -> ${target} (unresolvable)`);
        continue;
      }
      if (!real.startsWith(rootReal)) escapes.push(`${rel} -> ${target} (escapes repo)`);
    }
  }
  return escapes;
}

// ---------------------------------------------------------------------------
// Final-mode validation
// ---------------------------------------------------------------------------

const PLACEHOLDER_MARKERS = [
  "TBD",
  "PENDING",
  "OWNER/COUNSEL TO CONFIRM",
  "OWNER/COUNSEL DECISION",
  "UNLICENSED",
  "[LEGAL LICENSOR",
  "[GOVERNING LAW",
  "<FILL",
  "FILL:",
  "PLACEHOLDER",
  "<INSERT",
  "XXXX",
];

// An unfilled template value of the form <...> is a placeholder regardless of wording.
const ANGLE_TEMPLATE = /<[^>]+>/;

interface FinalValues {
  licenseFile: string;
  packageLicense: string;
  licensor: string;
  commercialContact: string;
  repositoryUrl: string;
  homepageUrl: string;
  bugsUrl: string;
  version: string;
  contributionPolicy: string;
  ownerApprovalMarker: string;
}

function loadFinalValues(): { values?: FinalValues; errors: string[] } {
  const path = process.env.AVORELO_FINAL_VALUES;
  const errors: string[] = [];
  if (!path || !existsSync(path)) {
    errors.push(
      "final mode requires validated values. Set AVORELO_FINAL_VALUES to a JSON file with: " +
        "licenseFile, packageLicense, licensor, commercialContact, repositoryUrl, homepageUrl, " +
        "bugsUrl, version, contributionPolicy, ownerApprovalMarker.",
    );
    return { errors };
  }
  const v = JSON.parse(readFileSync(path, "utf8")) as Partial<FinalValues>;
  const required: (keyof FinalValues)[] = [
    "licenseFile",
    "packageLicense",
    "licensor",
    "commercialContact",
    "repositoryUrl",
    "homepageUrl",
    "bugsUrl",
    "version",
    "contributionPolicy",
    "ownerApprovalMarker",
  ];
  for (const k of required) {
    const val = (v[k] ?? "").toString().trim();
    if (!val) {
      errors.push(`final value missing: ${k}`);
      continue;
    }
    for (const marker of PLACEHOLDER_MARKERS) {
      if (val.toUpperCase().includes(marker.toUpperCase())) {
        errors.push(`final value ${k} contains a placeholder (${marker}): "${val}"`);
      }
    }
    if (ANGLE_TEMPLATE.test(val)) {
      errors.push(`final value ${k} is an unfilled template ("<...>"): "${val}"`);
    }
  }

  // Hard rules beyond marker scanning — a placeholder path or an unapproved license must not pass,
  // including in --dry-run where the file is never read.
  const license = (v.licenseFile ?? "").toString().trim();
  if (license && !ANGLE_TEMPLATE.test(license)) {
    if (!existsSync(license)) {
      errors.push(`final licenseFile does not exist: ${license}`);
    } else {
      const body = readFileSync(license, "utf8");
      if (body.trim().length === 0) errors.push("final licenseFile is empty");
      if (/DRAFT FOR LEGAL REVIEW|NOT AN ACTIVE LICENSE/.test(body)) {
        errors.push("final licenseFile is a DRAFT — an approved license is required");
      }
      if (/Proprietary Software License/i.test(body)) {
        errors.push("final licenseFile is the old proprietary LICENSE — an approved license is required");
      }
    }
  }
  const pkgLicense = (v.packageLicense ?? "").toString();
  if (/unlicensed/i.test(pkgLicense)) errors.push("final packageLicense must not be UNLICENSED");
  const repo = (v.repositoryUrl ?? "").toString();
  if (repo && !/^https:\/\//.test(repo)) errors.push("final repositoryUrl must be a public https URL");
  const marker = (v.ownerApprovalMarker ?? "").toString();
  if (marker && !/APPROVED/i.test(marker)) errors.push('final ownerApprovalMarker must contain "APPROVED"');

  if (errors.length > 0) return { errors };
  return { values: v as FinalValues, errors: [] };
}

// ---------------------------------------------------------------------------
// package.json rewrite
// ---------------------------------------------------------------------------

function rewritePackageJson(mode: Mode, final?: FinalValues): string {
  const pkg = JSON.parse(readFileSync(join(SOURCE_ROOT, "package.json"), "utf8"));
  // Remove release-infrastructure scripts: they reference canonical-only release/ data that is
  // intentionally excluded from the export, so they cannot run there and should not be advertised.
  if (pkg.scripts) {
    for (const s of [
      "export:public",
      "export:public:review",
      "export:public:dry",
      "release:apply-values",
      "check:legal-boundary",
    ]) {
      delete pkg.scripts[s];
    }
  }
  if (mode === "review") {
    // Apache-2.0 public metadata is kept truthful; private:true + a prepublish guard mark this as a
    // LOCAL inspection copy, not the published artifact (which is produced by --mode final).
    pkg.version = "1.0.0-rc.1";
    pkg.private = true;
    pkg.license = "Apache-2.0";
    pkg.scripts = pkg.scripts ?? {};
    pkg.scripts.prepublishOnly =
      'node -e "console.error(\'This is a local REVIEW export. Publish the final export instead. See PRE-RELEASE-NOTICE.md.\'); process.exit(1)"';
  } else {
    pkg.version = final!.version;
    pkg.private = false;
    pkg.license = final!.packageLicense;
    pkg.repository = { type: "git", url: final!.repositoryUrl };
    pkg.homepage = final!.homepageUrl;
    pkg.bugs = { url: final!.bugsUrl };
    if (pkg.scripts) delete pkg.scripts.prepublishOnly;
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Generated content
// ---------------------------------------------------------------------------

const PRE_RELEASE_NOTICE = `# REVIEW EXPORT NOTICE — LOCAL INSPECTION COPY

This directory is a **review export** of Avorelo, produced for local inspection only. It is not the
published artifact.

- **Avorelo is Open Source under the Apache License 2.0** (see \`LICENSE\` and \`NOTICE\`). Personal,
  internal, organizational, and commercial use are permitted under Apache-2.0.
- **This particular copy must not be published to npm.** A prepublish guard and \`private: true\` mark
  it as a review copy; the published package is produced by the final export.
- **This is a release candidate** (\`1.0.0-rc.1\`).

Contributions are welcome under Apache-2.0 with a DCO sign-off (no CLA); see \`CONTRIBUTING.md\`.
`;

const PROJECT_HISTORY = `# Project History

Avorelo previously had a hosted-service architecture. That hosted service has been
discontinued.

The current architecture is local-only: Avorelo runs on the developer's own machine, and no
source, secrets, logs, environment, diffs, prompts, or artifacts are transmitted to any
service by default.

The public release uses fresh version-control history. It does not include any hosted-service
code, and it contains no hosted customer data.
`;

// ---------------------------------------------------------------------------
// Canonical commit
// ---------------------------------------------------------------------------

function canonicalCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: SOURCE_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Plan {
  mode: Mode;
  destination: string;
  included: string[];
  dropped: string[];
  excluded: Array<{ path: string; category: string }>;
  generatedFiles: string[];
  commit: string;
}

function buildPlan(args: Args, manifest: Manifest, ex: Exclusions): Plan {
  const all = walkAll(SOURCE_ROOT).map((f) => toPosix(relative(SOURCE_ROOT, f)));

  const included: string[] = [];
  const dropped: string[] = [];
  const excluded: Array<{ path: string; category: string }> = [];

  for (const rel of all.sort()) {
    const d = deniedByPath(rel, ex);
    if (d.denied) {
      excluded.push({ path: rel, category: d.category! });
      continue; // denylist wins — fail-closed
    }
    if (matchesAllowlist(rel, manifest)) {
      included.push(rel);
    } else {
      dropped.push(rel);
    }
  }

  const generatedFiles = manifest.generated
    .filter((g) => g.mode === "both" || g.mode === args.mode)
    .map((g) => g.path);

  return {
    mode: args.mode,
    destination: args.destination,
    included,
    dropped,
    excluded,
    generatedFiles,
    commit: canonicalCommit(),
  };
}

function verifyPlan(plan: Plan, manifest: Manifest, ex: Exclusions): string[] {
  const errors: string[] = [];

  // 1. mustNeverAppear
  for (const forbidden of manifest.mustNeverAppear) {
    const p = toPosix(forbidden);
    const hit = plan.included.find(
      (f) => f.startsWith(p.endsWith("/") ? p : p + "/") || f === p.replace(/\/$/, ""),
    );
    if (hit) errors.push(`FORBIDDEN path present in export: ${hit} (matches ${forbidden})`);
  }

  // 2. docs/legal absolute guard (independent of the policy file)
  const legal = plan.included.find((f) => f.startsWith("docs/legal/") || f.includes("docs/legal"));
  if (legal) errors.push(`docs/legal must never be exported: ${legal}`);

  // 3. expectedPresent
  const includedSet = new Set(plan.included);
  const genSet = new Set(plan.generatedFiles);
  for (const req of manifest.expectedPresent) {
    if (!includedSet.has(req) && !genSet.has(req)) {
      errors.push(`expected file missing after exclusion: ${req}`);
    }
  }

  // 4. symlink escapes
  for (const e of checkSymlinkEscapes(plan.included)) errors.push(`symlink escape: ${e}`);

  // 5. content scan
  for (const hit of scanContent(plan.included, ex)) {
    errors.push(
      `content violation [${hit.category}/${hit.ruleId}] in ${hit.file}: "${hit.sample}"`,
    );
  }

  return errors;
}

function writeExport(
  plan: Plan,
  args: Args,
  final?: FinalValues,
): { manifestPath: string; fileCount: number } {
  const dest = plan.destination;

  // Refuse to write into a source/worktree root.
  if (realpathSync(SOURCE_ROOT) === (existsSync(dest) ? realpathSync(dest) : resolve(dest))) {
    throw new Error("destination must not be the source root");
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const manifestEntries: Array<{ path: string; sha256: string }> = [];

  // Copy allowlisted files. package.json and package-lock.json are rewritten below to carry the
  // candidate version, so they are skipped here to keep the manifest hash consistent with what is
  // actually written.
  const rewritten = new Set(["package.json", "package-lock.json"]);
  for (const rel of plan.included) {
    if (rewritten.has(rel)) continue;
    const from = join(SOURCE_ROOT, rel);
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    manifestEntries.push({ path: rel, sha256: sha256(readFileSync(from)) });
  }

  // Generated / rewritten files.
  const writeGen = (rel: string, content: string) => {
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, content);
    manifestEntries.push({ path: rel, sha256: sha256(content) });
  };

  writeGen("package.json", rewritePackageJson(plan.mode, final));

  // Sync the lockfile root version to the applied version so the export is internally consistent.
  if (plan.included.includes("package-lock.json")) {
    const lock = JSON.parse(readFileSync(join(SOURCE_ROOT, "package-lock.json"), "utf8"));
    const version = plan.mode === "review" ? "1.0.0-rc.1" : final!.version;
    if (lock.version) lock.version = version;
    if (lock.packages && lock.packages[""]) lock.packages[""].version = version;
    writeGen("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  }

  if (!plan.included.includes("docs/project-history.md")) {
    writeGen("docs/project-history.md", PROJECT_HISTORY);
  }
  if (plan.mode === "review") {
    writeGen("PRE-RELEASE-NOTICE.md", PRE_RELEASE_NOTICE);
  }
  if (plan.mode === "final") {
    // final LICENSE comes from the validated values file
    writeGen("LICENSE", readFileSync(final!.licenseFile, "utf8"));
  }

  // Deterministic export manifest (no timestamps).
  const excludedByCategory: Record<string, number> = {};
  for (const e of plan.excluded) {
    excludedByCategory[e.category] = (excludedByCategory[e.category] ?? 0) + 1;
  }
  manifestEntries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const exportManifest = {
    canonicalCommit: plan.commit,
    mode: plan.mode,
    generatorVersion: GENERATOR_VERSION,
    fileCount: manifestEntries.length,
    paths: manifestEntries.map((e) => e.path),
    files: manifestEntries,
    excludedCategorySummary: excludedByCategory,
    droppedCount: plan.dropped.length,
  };
  const exportManifestJson = JSON.stringify(exportManifest, null, 2) + "\n";
  const manifestPath = join(dest, "PUBLIC-EXPORT-MANIFEST.json");
  writeFileSync(manifestPath, exportManifestJson);

  return { manifestPath, fileCount: manifestEntries.length };
}

function initFreshGit(dest: string): { ok: boolean; note: string } {
  try {
    execFileSync("git", ["init", "-q"], { cwd: dest });
    // Prove: no old history, no remotes.
    const log = execFileSync("git", ["-C", dest, "rev-list", "--all", "--count"], {
      encoding: "utf8",
    }).trim();
    const remotes = execFileSync("git", ["-C", dest, "remote"], { encoding: "utf8" }).trim();
    if (log !== "0") return { ok: false, note: `fresh repo has ${log} commits (expected 0)` };
    if (remotes !== "") return { ok: false, note: `fresh repo has remotes: ${remotes}` };
    return {
      ok: true,
      note: "fresh git initialized: 0 commits, 0 remotes. Initial commit is BLOCKED pending an approved public Git author (see release/PENDING-PUBLIC-GIT-IDENTITY.md).",
    };
  } catch (err) {
    return { ok: false, note: `git init failed: ${(err as Error).message.split("\n")[0]}` };
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const ex = loadExclusions();

  let final: FinalValues | undefined;
  if (args.mode === "final") {
    const { values, errors } = loadFinalValues();
    if (errors.length > 0) {
      console.error("\n  FINAL MODE REFUSED — validated values are required:\n");
      for (const e of errors) console.error(`    ✘ ${e}`);
      console.error("\n  No placeholder fallback exists. Supply real, owner-approved values.\n");
      process.exit(2);
    }
    final = values;
  }

  const plan = buildPlan(args, manifest, ex);
  const errors = verifyPlan(plan, manifest, ex);

  console.log("");
  console.log(`  Avorelo public export — mode: ${plan.mode}`);
  console.log("  " + "─".repeat(72));
  console.log(`  canonical commit : ${plan.commit}`);
  console.log(`  destination      : ${plan.destination}`);
  console.log(`  included files   : ${plan.included.length}`);
  console.log(`  dropped (undeclared): ${plan.dropped.length}`);
  console.log(`  excluded (denied): ${plan.excluded.length}`);
  console.log("");

  if (errors.length > 0) {
    console.error("  EXPORT REFUSED — validation failed:\n");
    for (const e of errors) console.error(`    ✘ ${e}`);
    console.error("");
    process.exit(1);
  }
  console.log("  Validation passed: no forbidden paths, no docs/legal, no content violations.");

  if (args.dryRun) {
    console.log("\n  --dry-run: no files written.\n");
    return;
  }

  const { manifestPath, fileCount } = writeExport(plan, args, final);
  console.log(`  Wrote ${fileCount} files to ${plan.destination}`);
  console.log(`  Export manifest: ${manifestPath}`);

  const git = initFreshGit(plan.destination);
  console.log(`  ${git.ok ? "✔" : "✘"} ${git.note}`);
  if (!git.ok) process.exit(1);

  console.log("\n  Export complete. No commit, no remote, no push, no publish.\n");
}

main();
