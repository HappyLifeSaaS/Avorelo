// Avorelo Apache-2.0 licensing-truth + contribution-truth gate.
//
// Asserts the repository consistently presents Apache-2.0 Open Source with open, DCO-gated
// contributions (no CLA). Replaces the earlier source-available truth gate.
//
// Exposes pure predicates for adversarial tests; when run, checks the real repository.
//
// Usage: node tools/check-license-truth.ts   (exit 0 = consistent, 1 = violations)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// SHA-256 of the official Apache License 2.0 text (apache.org/licenses/LICENSE-2.0.txt).
export const OFFICIAL_APACHE_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";

export type Finding = { where: string; rule: string; detail: string };

// Superseded restrictive-model phrasing that must not appear in active root docs.
const SUPERSEDED_RE = /\bsource[- ]available\b|\bpersonal use licen[cs]e\b|\bnon-commercial[- ]only\b|\bcommercial use requires\b|\bUNLICENSED\b|\bproprietary (?:licen[cs]e|software)\b/i;

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Licensing checks over provided file contents (pure; for tests and the runner). */
export function checkLicensing(files: {
  licenseText: string; packageLicense: string; readme: string; noticeExists: boolean;
  rootDocs: Array<{ path: string; content: string }>;
}): Finding[] {
  const f: Finding[] = [];
  if (sha256(files.licenseText) !== OFFICIAL_APACHE_SHA256) {
    // Fall back to a structural check so trivial newline normalization does not falsely fail.
    if (!(/Apache License\s+Version 2\.0, January 2004/.test(files.licenseText) &&
          /Licensed under the Apache License, Version 2\.0/.test(files.licenseText))) {
      f.push({ where: "LICENSE", rule: "not-official-apache", detail: "LICENSE is not the official Apache-2.0 text" });
    }
  }
  if (files.packageLicense !== "Apache-2.0") {
    f.push({ where: "package.json", rule: "license-not-apache", detail: `license is "${files.packageLicense}"` });
  }
  if (!/Apache[- ]?2\.0|Apache License/.test(files.readme)) {
    f.push({ where: "README.md", rule: "readme-no-apache", detail: "README does not name Apache-2.0" });
  }
  if (!files.noticeExists) f.push({ where: "NOTICE", rule: "notice-missing", detail: "NOTICE file is required" });
  for (const d of files.rootDocs) {
    const m = d.content.match(SUPERSEDED_RE);
    if (m) f.push({ where: d.path, rule: "superseded-license-claim", detail: m[0] });
  }
  return f;
}

/** Contribution checks over provided facts (pure). */
export function checkContribution(c: {
  dcoText: string; dcoGuideExists: boolean; checkDcoScript: boolean; dcoTestExists: boolean;
  workflow: string | null; prTemplateExists: boolean; issueTemplateExists: boolean; codeownersExists: boolean;
  contributing: string; claAssistant: boolean;
}): Finding[] {
  const f: Finding[] = [];
  if (!/Developer Certificate of Origin\s+Version 1\.1/.test(c.dcoText)) {
    f.push({ where: "DCO", rule: "dco-missing-or-modified", detail: "DCO 1.1 text absent or altered" });
  }
  if (!c.dcoGuideExists) f.push({ where: "docs/contributing/dco-guide.md", rule: "dco-guide-missing", detail: "" });
  if (!c.checkDcoScript) f.push({ where: "package.json", rule: "check-dco-script-missing", detail: "" });
  if (!c.dcoTestExists) f.push({ where: "tests/dco.test.ts", rule: "dco-test-missing", detail: "" });
  if (!c.workflow) {
    f.push({ where: ".github/workflows/dco.yml", rule: "dco-workflow-missing", detail: "" });
  } else {
    if (/^\s*pull_request_target\s*:/m.test(c.workflow)) f.push({ where: "dco.yml", rule: "pull-request-target", detail: "must not use pull_request_target" });
    if (!/on:\s*[\s\S]*pull_request\b/.test(c.workflow)) f.push({ where: "dco.yml", rule: "no-pull-request-trigger", detail: "" });
    if (!/permissions:\s*[\s\S]*contents:\s*read/.test(c.workflow)) f.push({ where: "dco.yml", rule: "permissions-not-read-only", detail: "" });
  }
  if (!c.prTemplateExists) f.push({ where: ".github/pull_request_template.md", rule: "pr-template-missing", detail: "" });
  if (!c.issueTemplateExists) f.push({ where: ".github/ISSUE_TEMPLATE", rule: "issue-template-missing", detail: "" });
  if (!c.codeownersExists) f.push({ where: ".github/CODEOWNERS", rule: "codeowners-missing", detail: "" });
  if (c.claAssistant) f.push({ where: ".github", rule: "cla-assistant-present", detail: "no CLA is required for ordinary contributions" });
  if (/contributions are (?:closed|not currently accepted|not accepted)/i.test(c.contributing)) {
    f.push({ where: "CONTRIBUTING.md", rule: "contributions-closed", detail: "contributions must be open" });
  }
  if (!/welcome/i.test(c.contributing)) f.push({ where: "CONTRIBUTING.md", rule: "contributions-not-welcomed", detail: "" });
  return f;
}

const invokedDirectly = process.argv[1] && /check-license-truth\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  const root = process.cwd();
  const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");
  const pkg = JSON.parse(read("package.json") || "{}");
  const wfPath = join(root, ".github/workflows/dco.yml");
  const licensing = checkLicensing({
    licenseText: read("LICENSE"),
    packageLicense: pkg.license ?? "",
    readme: read("README.md"),
    noticeExists: existsSync(join(root, "NOTICE")),
    rootDocs: ["README.md", "SUPPORT.md", "COMMERCIAL-SERVICES.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "GOVERNANCE.md"]
      .filter((p) => existsSync(join(root, p))).map((p) => ({ path: p, content: read(p) })),
  });
  const contribution = checkContribution({
    dcoText: read("DCO"),
    dcoGuideExists: existsSync(join(root, "docs/contributing/dco-guide.md")),
    checkDcoScript: !!pkg.scripts?.["check:dco"],
    dcoTestExists: existsSync(join(root, "tests/dco.test.ts")),
    workflow: existsSync(wfPath) ? readFileSync(wfPath, "utf8") : null,
    prTemplateExists: existsSync(join(root, ".github/pull_request_template.md")),
    issueTemplateExists: existsSync(join(root, ".github/ISSUE_TEMPLATE")),
    codeownersExists: existsSync(join(root, ".github/CODEOWNERS")),
    contributing: read("CONTRIBUTING.md"),
    claAssistant: /cla-assistant|cla\.yml|cla-bot/i.test(read(".github/workflows/dco.yml") + read(".github/workflows/ci.yml")),
  });
  const all = [...licensing, ...contribution];
  for (const x of all) process.stderr.write(`FAIL  ${x.where}  [${x.rule}]  ${x.detail}\n`);
  process.stdout.write(`\n[license-truth] ${licensing.length} licensing + ${contribution.length} contribution violation(s)\n`);
  if (all.length > 0) {
    process.stderr.write("LICENSE_TRUTH_FAILED — Apache-2.0 / contribution story is inconsistent.\n");
    process.exit(1);
  }
  process.stdout.write("LICENSE_TRUTH_OK — Apache-2.0 Open Source; open contributions under DCO (no CLA).\n");
}
