/**
 * apply-release-values — apply release metadata to a staging/export destination's package.json.
 *
 * Complements create-public-export: that tool produces the tree and does the baseline review
 * rewrite; this tool is the dedicated, strict applicator for release metadata, used to stage
 * candidate values (review) or to apply owner-approved final values (final) to an already-created
 * export.
 *
 * It updates ONLY the destination unless explicitly pointed at the canonical repo with an explicit
 * --allow-canonical flag (which this tool never sets on its own). By default it refuses to touch
 * the canonical package.json.
 *
 * Review mode may apply: candidate version, PRE-RELEASE status, no active repository/bugs link, no
 * active licensing contact, no grant of rights.
 *
 * Final mode requires validated real values for version, license file, package license, licensor,
 * repository, homepage, bugs, commercial contact, and contribution policy. It FAILS on any
 * placeholder / pending / TBD / UNLICENSED / proprietary old LICENSE / private repository / missing
 * owner-approval marker. No placeholder fallback.
 *
 * Flags:
 *   --mode review|final       (default review)
 *   --destination <path>      export/staging directory whose package.json is updated (required)
 *   --manifest <path>         release manifest (default release/source-available-release-manifest.json)
 *   --dry-run                 print what would change, write nothing
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SOURCE_ROOT = resolve(import.meta.dirname, "..");

type Mode = "review" | "final";

interface Args {
  mode: Mode;
  destination: string;
  manifest: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let mode: Mode = "review";
  let destination = "";
  let manifest = join(SOURCE_ROOT, "release", "source-available-release-manifest.json");
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") {
      const v = argv[++i];
      if (v !== "review" && v !== "final") throw new Error(`--mode must be review|final, got ${v}`);
      mode = v;
    } else if (a === "--destination") destination = argv[++i];
    else if (a === "--manifest") manifest = resolve(argv[++i]);
    else if (a === "--dry-run") dryRun = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!destination) throw new Error("--destination is required");
  return { mode, destination: resolve(destination), manifest, dryRun };
}

const PLACEHOLDER_MARKERS = [
  "TBD",
  "PENDING",
  "OWNER/COUNSEL TO CONFIRM",
  "OWNER/COUNSEL DECISION",
  "UNLICENSED",
  "[LEGAL LICENSOR",
  "[GOVERNING LAW",
  "INTENDED",
  "pending",
];

function isPlaceholder(value: string): string | null {
  for (const m of PLACEHOLDER_MARKERS) {
    if (value.toUpperCase().includes(m.toUpperCase())) return m;
  }
  return null;
}

interface FinalValues {
  version: string;
  licenseFile: string;
  packageLicense: string;
  licensor: string;
  repositoryUrl: string;
  homepageUrl: string;
  bugsUrl: string;
  commercialContact: string;
  contributionPolicy: string;
  ownerApprovalMarker: string;
}

function loadFinalValues(): { values?: FinalValues; errors: string[] } {
  const path = process.env.AVORELO_FINAL_VALUES;
  const errors: string[] = [];
  if (!path || !existsSync(path)) {
    errors.push(
      "final mode requires AVORELO_FINAL_VALUES pointing to a JSON file with validated real " +
        "values: version, licenseFile, packageLicense, licensor, repositoryUrl, homepageUrl, " +
        "bugsUrl, commercialContact, contributionPolicy, ownerApprovalMarker.",
    );
    return { errors };
  }
  const v = JSON.parse(readFileSync(path, "utf8")) as Partial<FinalValues>;
  const required: (keyof FinalValues)[] = [
    "version",
    "licenseFile",
    "packageLicense",
    "licensor",
    "repositoryUrl",
    "homepageUrl",
    "bugsUrl",
    "commercialContact",
    "contributionPolicy",
    "ownerApprovalMarker",
  ];
  for (const k of required) {
    const val = (v[k] ?? "").toString().trim();
    if (!val) {
      errors.push(`missing final value: ${k}`);
      continue;
    }
    const marker = isPlaceholder(val);
    if (marker) errors.push(`final value ${k} contains placeholder "${marker}": ${val}`);
  }
  // Specific hard rules.
  if (v.packageLicense && /unlicensed/i.test(v.packageLicense)) {
    errors.push("final packageLicense must not be UNLICENSED");
  }
  if (v.repositoryUrl && !/^https:\/\//.test(v.repositoryUrl)) {
    errors.push("final repositoryUrl must be a public https URL");
  }
  if (v.licenseFile) {
    const lf = resolve(v.licenseFile);
    if (!existsSync(lf)) {
      errors.push(`final licenseFile does not exist: ${v.licenseFile}`);
    } else {
      const body = readFileSync(lf, "utf8");
      if (/DRAFT FOR LEGAL REVIEW/.test(body)) {
        errors.push("final licenseFile is a DRAFT — an approved license is required");
      }
      if (/Proprietary Software License/i.test(body)) {
        errors.push("final licenseFile is the old proprietary LICENSE — an approved license is required");
      }
    }
  }
  if (v.ownerApprovalMarker && !/APPROVED/i.test(v.ownerApprovalMarker)) {
    errors.push('final ownerApprovalMarker must contain "APPROVED"');
  }
  if (errors.length > 0) return { errors };
  return { values: v as FinalValues, errors: [] };
}

function refuseCanonical(dest: string): void {
  const destPkg = resolve(join(dest, "package.json"));
  const canonicalPkg = resolve(join(SOURCE_ROOT, "package.json"));
  if (destPkg === canonicalPkg) {
    throw new Error(
      "refusing to modify the canonical package.json. apply-release-values only updates an " +
        "export/staging destination.",
    );
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  refuseCanonical(args.destination);

  const destPkgPath = join(args.destination, "package.json");
  if (!existsSync(destPkgPath)) {
    console.error(`\n  No package.json at destination: ${destPkgPath}`);
    console.error("  Create the export first (npm run export:public:review).\n");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  const pkg = JSON.parse(readFileSync(destPkgPath, "utf8"));

  const changes: string[] = [];

  if (args.mode === "review") {
    const candidate = manifest.package.reviewCandidateVersion;
    changes.push(`version -> ${candidate} (candidate; canonical stays ${manifest.package.canonicalVersion})`);
    changes.push("private -> true");
    changes.push("license -> UNLICENSED (unchanged; no grant)");
    changes.push("repository -> (omitted; not an active public claim)");
    changes.push("bugs -> (omitted; pending public repository)");
    changes.push("prepublishOnly guard -> present (publication refused)");
    pkg.version = candidate;
    pkg.private = true;
    pkg.license = "UNLICENSED";
    delete pkg.repository;
    delete pkg.bugs;
    pkg.scripts = pkg.scripts ?? {};
    pkg.scripts.prepublishOnly =
      'node -e "console.error(\'PRE-RELEASE review export must not be published. See PRE-RELEASE-NOTICE.md.\'); process.exit(1)"';
  } else {
    const { values, errors } = loadFinalValues();
    if (errors.length > 0) {
      console.error("\n  FINAL MODE REFUSED — validated values required:\n");
      for (const e of errors) console.error(`    ✘ ${e}`);
      console.error("\n  No placeholder fallback. Supply owner-approved values.\n");
      process.exit(2);
    }
    const v = values!;
    changes.push(`version -> ${v.version}`);
    changes.push("private -> false");
    changes.push(`license -> ${v.packageLicense}`);
    changes.push(`repository -> ${v.repositoryUrl}`);
    changes.push(`homepage -> ${v.homepageUrl}`);
    changes.push(`bugs -> ${v.bugsUrl}`);
    changes.push("prepublishOnly guard -> removed");
    changes.push(`LICENSE -> copied from ${v.licenseFile}`);
    pkg.version = v.version;
    pkg.private = false;
    pkg.license = v.packageLicense;
    pkg.repository = { type: "git", url: v.repositoryUrl };
    pkg.homepage = v.homepageUrl;
    pkg.bugs = { url: v.bugsUrl };
    if (pkg.scripts) delete pkg.scripts.prepublishOnly;
    if (!args.dryRun) {
      writeFileSync(join(args.destination, "LICENSE"), readFileSync(v.licenseFile, "utf8"));
    }
  }

  console.log("");
  console.log(`  apply-release-values — mode: ${args.mode}`);
  console.log(`  destination: ${args.destination}`);
  console.log("  " + "─".repeat(60));
  for (const c of changes) console.log(`    • ${c}`);
  console.log("");

  if (args.dryRun) {
    console.log("  --dry-run: no files written.\n");
    return;
  }
  writeFileSync(destPkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  Updated ${destPkgPath}\n`);
}

try {
  main();
} catch (err) {
  console.error(`\n  apply-release-values refused: ${(err as Error).message}\n`);
  process.exit(1);
}
