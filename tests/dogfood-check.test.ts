// dogfood-check (avorelo.dogfoodCheck.v1) — local, zero-dep, node:test.
// Verifies the read-only tester readiness summary: reflects init/run/report/value state, guides a safe next
// step, stays local-only, collects/uploads nothing, and never carries raw secret/source/env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildDogfoodCheck, renderDogfoodCheck, DOGFOOD_CHECK_CONTRACT, buildDogfoodSummary, renderDogfoodSummary, DOGFOOD_SUMMARY_CONTRACT } from "../src/avorelo/capabilities/activation/dogfood-check.ts";
import { initWorkspace } from "../src/avorelo/capabilities/activation/init.ts";
import { runRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";

const NOW = 1760000000000;
const AT = "2026-06-11T00:00:00.000Z";
const sandbox = () => mkdtempSync(join(tmpdir(), "avorelo-dfc-"));
const cleanup = (d: string) => { if (existsSync(d) && d.includes("avorelo-dfc-")) rmSync(d, { recursive: true, force: true }); };

test("uninitialized repo: not ready, next step is init", () => {
  const d = sandbox();
  try {
    const r = buildDogfoodCheck(d, { now: NOW });
    assert.equal(r.contract, DOGFOOD_CHECK_CONTRACT);
    assert.equal(r.initialized, false);
    assert.equal(r.latestRuntimeSession, false);
    assert.equal(r.ready, false);
    assert.match(r.safeNextStep.command, /avorelo init/);
  } finally { cleanup(d); }
});

test("initialized but no run: next step is run", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: NOW });
    const r = buildDogfoodCheck(d, { now: NOW });
    assert.equal(r.initialized, true);
    assert.equal(r.latestRuntimeSession, false);
    assert.equal(r.ready, false);
    assert.match(r.safeNextStep.command, /avorelo run/);
  } finally { cleanup(d); }
});

test("after init + run: ready, report + value + control-center available, next is control-center", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: NOW });
    runRuntimeSession({ task: "run tests", dir: d, createdAt: AT, now: NOW });
    const r = buildDogfoodCheck(d, { now: NOW });
    assert.equal(r.initialized, true);
    assert.equal(r.latestRuntimeSession, true);
    assert.equal(r.controlCenterData, true);
    assert.equal(r.reportAvailable, true);
    assert.equal(r.valueCardsAvailable, true);
    assert.equal(r.ready, true);
    assert.match(r.safeNextStep.command, /avorelo control-center/);
  } finally { cleanup(d); }
});

test("always local-only; cloud never claimed", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: NOW });
    const r = buildDogfoodCheck(d, { now: NOW });
    assert.equal(r.localOnly, true);
    assert.equal(r.cloudClaimed, false);
  } finally { cleanup(d); }
});

test("read-only: building the check writes nothing new", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: NOW });
    runRuntimeSession({ task: "run tests", dir: d, createdAt: AT, now: NOW });
    const before = readdirSync(join(d, ".avorelo")).sort().join(",");
    buildDogfoodCheck(d, { now: NOW });
    const after = readdirSync(join(d, ".avorelo")).sort().join(",");
    assert.equal(before, after, "dogfood-check is pure read");
  } finally { cleanup(d); }
});

test("never carries raw secret/source/env, even when a run included a secret-like task", () => {
  const d = sandbox();
  try {
    const secret = "AKIAIOSFODNN7" + "EXAMPLE";
    writeFileSync(join(d, "leak.ts"), `export const K = "${secret}";`);
    initWorkspace(d, { now: NOW });
    runRuntimeSession({ task: `store ${secret} in config`, dir: d, createdAt: AT, now: NOW });
    const r = buildDogfoodCheck(d, { now: NOW });
    const s = JSON.stringify(r) + renderDogfoodCheck(r);
    assert.ok(!s.includes(secret), "no raw secret");
    assert.ok(!s.includes("export const K"), "no source line");
    assert.equal(r.safety.containsRawSecret, false);
    assert.equal(r.safety.containsRawSource, false);
    assert.equal(r.safety.containsEnvValue, false);
  } finally { cleanup(d); }
});

test("renderer is a string with the safety footer and no collection language", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: NOW });
    const text = renderDogfoodCheck(buildDogfoodCheck(d, { now: NOW }));
    assert.ok(text.includes("dogfood-check"));
    assert.ok(text.includes("collects nothing"));
    assert.ok(text.includes("no network"));
  } finally { cleanup(d); }
});

// --- dogfood-summary ---

test("dogfood-summary reflects run state with safe enums only, local-only", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: NOW });
    runRuntimeSession({ task: "run tests", dir: d, createdAt: AT, now: NOW });
    const s = buildDogfoodSummary(d, { now: NOW });
    assert.equal(s.contract, DOGFOOD_SUMMARY_CONTRACT);
    assert.equal(s.initialized, true);
    assert.equal(s.lastRuntimeStatus, "ready");
    assert.ok(typeof s.route === "string" && s.route.length > 0);
    assert.equal(s.localOnly, true);
    assert.equal(s.cloudClaimed, false);
    assert.ok(s.suggestedFeedbackFields.length > 0);
  } finally { cleanup(d); }
});

test("dogfood-summary never carries raw secret/source/env", () => {
  const d = sandbox();
  try {
    const secret = "AKIAIOSFODNN7" + "EXAMPLE";
    writeFileSync(join(d, ".env"), `AWS_SECRET_ACCESS_KEY=${secret}`);
    initWorkspace(d, { now: NOW });
    runRuntimeSession({ task: `store ${secret} in config`, dir: d, createdAt: AT, now: NOW });
    const s = buildDogfoodSummary(d, { now: NOW });
    const out = JSON.stringify(s) + renderDogfoodSummary(s);
    assert.ok(!out.includes(secret), "no raw secret");
    assert.equal(s.safety.containsRawSecret, false);
    assert.equal(s.safety.containsEnvValue, false);
  } finally { cleanup(d); }
});

test("dogfood-summary is read-only (writes nothing new)", () => {
  const d = sandbox();
  try {
    initWorkspace(d, { now: NOW });
    runRuntimeSession({ task: "run tests", dir: d, createdAt: AT, now: NOW });
    const before = readdirSync(join(d, ".avorelo")).sort().join(",");
    buildDogfoodSummary(d, { now: NOW });
    const after = readdirSync(join(d, ".avorelo")).sort().join(",");
    assert.equal(before, after);
  } finally { cleanup(d); }
});
