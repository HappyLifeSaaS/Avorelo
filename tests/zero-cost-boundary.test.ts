// Avorelo zero-cost boundary tests (node:test, zero-dep, no network).
//
// Proves the zero-cost gate rejects every cost-adding infrastructure change and does NOT false-flag the
// retained product's detection heuristics (which legitimately name these providers in src/).

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scanZeroCost, collectInputs, type ZeroCostInputs } from "../tools/check-zero-cost.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function clean(): ZeroCostInputs {
  return {
    packageJson: { dependencies: {}, devDependencies: { esbuild: "*", tsx: "*" } },
    netlifyToml: `[build]\n  command = "npm run build:site"\n  publish = "dist/site"\n`,
    workflows: [{ name: "ci.yml", content: "on:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: ubuntu-latest\n" }],
    presentConfigFiles: [],
  };
}

test("clean infrastructure config passes with zero findings", () => {
  assert.deepEqual(scanZeroCost(clean()), []);
});

const cases: Array<{ name: string; rule: string; mut: (i: ZeroCostInputs) => ZeroCostInputs }> = [
  { name: "postgres client dependency", rule: "banned-dependency",
    mut: (i) => ({ ...i, packageJson: { dependencies: { pg: "^8" } } }) },
  { name: "stripe dependency", rule: "banned-dependency",
    mut: (i) => ({ ...i, packageJson: { dependencies: { stripe: "^14" } } }) },
  { name: "aws sdk scope dependency", rule: "banned-dependency",
    mut: (i) => ({ ...i, packageJson: { devDependencies: { "@aws-sdk/client-s3": "^3" } } }) },
  { name: "nodemailer email sender", rule: "banned-dependency",
    mut: (i) => ({ ...i, packageJson: { dependencies: { nodemailer: "^6" } } }) },
  { name: "netlify functions config", rule: "netlify-functions-or-plugins",
    mut: (i) => ({ ...i, netlifyToml: i.netlifyToml + `\n[functions]\n  directory = "netlify/functions"\n` }) },
  { name: "netlify plugins config", rule: "netlify-functions-or-plugins",
    mut: (i) => ({ ...i, netlifyToml: i.netlifyToml + `\n[[plugins]]\n  package = "@netlify/plugin-x"\n` }) },
  { name: "netlify identity/forms", rule: "netlify-identity-or-forms",
    mut: (i) => ({ ...i, netlifyToml: i.netlifyToml + `\n[forms]\n` }) },
  { name: "railway config file", rule: "deploy-or-db-config-file",
    mut: (i) => ({ ...i, presentConfigFiles: ["railway.json"] }) },
  { name: "prisma schema present", rule: "deploy-or-db-config-file",
    mut: (i) => ({ ...i, presentConfigFiles: ["prisma/schema.prisma"] }) },
  { name: "devcontainer present", rule: "deploy-or-db-config-file",
    mut: (i) => ({ ...i, presentConfigFiles: [".devcontainer/devcontainer.json"] }) },
  { name: "large paid runner", rule: "non-standard-runner",
    mut: (i) => ({ ...i, workflows: [{ name: "ci.yml", content: "jobs:\n  a:\n    runs-on: ubuntu-latest-16core\n" }] }) },
  { name: "self-hosted runner", rule: "non-standard-runner",
    mut: (i) => ({ ...i, workflows: [{ name: "ci.yml", content: "jobs:\n  a:\n    runs-on: self-hosted\n" }] }) },
  { name: "scheduled cron workflow", rule: "scheduled-workflow",
    mut: (i) => ({ ...i, workflows: [{ name: "cron.yml", content: "on:\n  schedule:\n    - cron: '0 * * * *'\n" }] }) },
  { name: "cloud deploy secret", rule: "cloud-deploy-secret",
    mut: (i) => ({ ...i, workflows: [{ name: "deploy.yml", content: "jobs:\n  a:\n    steps:\n      - run: deploy\n        env:\n          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}\n" }] }) },
  { name: "database url secret", rule: "cloud-deploy-secret",
    mut: (i) => ({ ...i, workflows: [{ name: "deploy.yml", content: "env:\n  DATABASE_URL: ${{ secrets.DATABASE_URL }}\n" }] }) },
  { name: "billing checkout url in netlify", rule: "billing-url",
    mut: (i) => ({ ...i, netlifyToml: i.netlifyToml + `\n# see checkout.stripe.com/pay\n` }) },
];

for (const c of cases) {
  test(`rejects: ${c.name} → ${c.rule}`, () => {
    const findings = scanZeroCost(c.mut(clean()));
    assert.ok(findings.some((x) => x.rule === c.rule),
      `expected ${c.rule}; got ${JSON.stringify(findings.map((x) => x.rule))}`);
  });
}

test("standard runners and empty deps are not flagged", () => {
  for (const label of ["ubuntu-latest", "windows-latest", "macos-latest", "ubuntu-24.04"]) {
    const i = { ...clean(), workflows: [{ name: "ci.yml", content: `jobs:\n  a:\n    runs-on: ${label}\n` }] };
    assert.deepEqual(scanZeroCost(i), [], `${label} should be free-tier standard`);
  }
});

test("the real repository infrastructure config is at zero cost (0 findings)", () => {
  const findings = scanZeroCost(collectInputs(REPO_ROOT));
  assert.deepEqual(findings, [], `real infra config has cost-adding surfaces: ${JSON.stringify(findings, null, 2)}`);
});

test("generic user-project detection heuristics in src/ are not scanned (no false flag)", () => {
  // The gate scans infra config only. Even though src/ names providers (pg, stripe, railway) as detection
  // targets, the real-repo scan above passes — proving detection code is not rejected.
  const inputs = collectInputs(REPO_ROOT);
  assert.equal(inputs.workflows.length >= 1, true, "expected at least the ci workflow");
  assert.deepEqual(scanZeroCost(inputs), []);
});
