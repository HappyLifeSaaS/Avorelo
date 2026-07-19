// Avorelo Apache-2.0 licensing-truth + contribution-truth tests (node:test, zero-dep).
// Adversarial coverage of the license/contribution gate, plus a real-repo consistency assertion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLicensing, checkContribution, sha256, OFFICIAL_APACHE_SHA256 } from "../tools/check-license-truth.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const apache = readFileSync(join(ROOT, "LICENSE"), "utf8");

function goodLicensing() {
  return {
    licenseText: apache,
    packageLicense: "Apache-2.0",
    readme: "Avorelo is Open Source under the Apache License 2.0.",
    noticeExists: true,
    rootDocs: [{ path: "README.md", content: "Apache-2.0 permits commercial use." }],
  };
}
function goodContribution() {
  return {
    dcoText: "Developer Certificate of Origin\nVersion 1.1\n",
    dcoGuideExists: true, checkDcoScript: true, dcoTestExists: true,
    workflow: "on:\n  pull_request:\npermissions:\n  contents: read\n",
    prTemplateExists: true, issueTemplateExists: true, codeownersExists: true,
    contributing: "Contributions are welcome under Apache-2.0 with DCO sign-off.",
    claAssistant: false,
  };
}

test("real LICENSE is the official Apache-2.0 (byte hash)", () => {
  assert.equal(sha256(apache), OFFICIAL_APACHE_SHA256);
});

test("clean licensing + contribution pass", () => {
  assert.deepEqual(checkLicensing(goodLicensing()), []);
  assert.deepEqual(checkContribution(goodContribution()), []);
});

const licenseCases: Array<{ name: string; rule: string; mut: (g: ReturnType<typeof goodLicensing>) => void }> = [
  { name: "modified Apache text", rule: "not-official-apache", mut: (g) => { g.licenseText = "Apache License with an extra restriction"; } },
  { name: "package not Apache", rule: "license-not-apache", mut: (g) => { g.packageLicense = "UNLICENSED"; } },
  { name: "readme omits Apache", rule: "readme-no-apache", mut: (g) => { g.readme = "A local-first CLI."; } },
  { name: "NOTICE missing", rule: "notice-missing", mut: (g) => { g.noticeExists = false; } },
  { name: "Personal Use License claim", rule: "superseded-license-claim", mut: (g) => { g.rootDocs = [{ path: "README.md", content: "governed by the Personal Use License" }]; } },
  { name: "source-available claim", rule: "superseded-license-claim", mut: (g) => { g.rootDocs = [{ path: "README.md", content: "Avorelo is source-available." }]; } },
  { name: "commercial-use-requires claim", rule: "superseded-license-claim", mut: (g) => { g.rootDocs = [{ path: "README.md", content: "commercial use requires a license" }]; } },
];
for (const c of licenseCases) {
  test(`licensing rejects: ${c.name} → ${c.rule}`, () => {
    const g = goodLicensing(); c.mut(g);
    assert.ok(checkLicensing(g).some((x) => x.rule === c.rule), `expected ${c.rule}`);
  });
}

const contribCases: Array<{ name: string; rule: string; mut: (g: ReturnType<typeof goodContribution>) => void }> = [
  { name: "DCO modified", rule: "dco-missing-or-modified", mut: (g) => { g.dcoText = "DCO but altered"; } },
  { name: "check:dco missing", rule: "check-dco-script-missing", mut: (g) => { g.checkDcoScript = false; } },
  { name: "DCO test missing", rule: "dco-test-missing", mut: (g) => { g.dcoTestExists = false; } },
  { name: "workflow uses pull_request_target", rule: "pull-request-target", mut: (g) => { g.workflow = "on:\n  pull_request_target:\npermissions:\n  contents: read\n"; } },
  { name: "workflow not read-only", rule: "permissions-not-read-only", mut: (g) => { g.workflow = "on:\n  pull_request:\npermissions:\n  contents: write\n"; } },
  { name: "CLA assistant present", rule: "cla-assistant-present", mut: (g) => { g.claAssistant = true; } },
  { name: "contributions closed", rule: "contributions-closed", mut: (g) => { g.contributing = "Contributions are closed."; } },
  { name: "PR template missing", rule: "pr-template-missing", mut: (g) => { g.prTemplateExists = false; } },
  { name: "CODEOWNERS missing", rule: "codeowners-missing", mut: (g) => { g.codeownersExists = false; } },
];
for (const c of contribCases) {
  test(`contribution rejects: ${c.name} → ${c.rule}`, () => {
    const g = goodContribution(); c.mut(g);
    assert.ok(checkContribution(g).some((x) => x.rule === c.rule), `expected ${c.rule}`);
  });
}

test("the real repository passes both gates", () => {
  const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
  const pkg = JSON.parse(read("package.json"));
  const lic = checkLicensing({
    licenseText: read("LICENSE"), packageLicense: pkg.license, readme: read("README.md"),
    noticeExists: existsSync(join(ROOT, "NOTICE")),
    rootDocs: ["README.md", "SUPPORT.md", "COMMERCIAL-SERVICES.md", "CONTRIBUTING.md", "SECURITY.md"].map((p) => ({ path: p, content: read(p) })),
  });
  const con = checkContribution({
    dcoText: read("DCO"), dcoGuideExists: existsSync(join(ROOT, "docs/contributing/dco-guide.md")),
    checkDcoScript: !!pkg.scripts?.["check:dco"], dcoTestExists: existsSync(join(ROOT, "tests/dco.test.ts")),
    workflow: read(".github/workflows/dco.yml"), prTemplateExists: existsSync(join(ROOT, ".github/pull_request_template.md")),
    issueTemplateExists: existsSync(join(ROOT, ".github/ISSUE_TEMPLATE")), codeownersExists: existsSync(join(ROOT, ".github/CODEOWNERS")),
    contributing: read("CONTRIBUTING.md"), claAssistant: false,
  });
  assert.deepEqual([...lic, ...con], []);
});
