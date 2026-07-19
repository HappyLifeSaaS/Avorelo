// Local Control Center v1 (avorelo.controlCenter.v1) — local, zero-dep, node:test.
// Verifies the read-only operator surface composes local .avorelo/ artifacts truthfully: unavailable
// sections stay unavailable (token cost stays "unavailable", not "none"/"zero"), savings are never
// claimed, raw secrets never appear, and the model owns no truth (building it mutates no capability state).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { mkdirSync, writeFileSync } from "node:fs";
import { buildControlCenter, openControlCenter, renderText, renderHtml } from "../src/avorelo/capabilities/control-center/index.ts";
import { runRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";

const NOW = 1760000000000;
const sandbox = () => mkdtempSync(join(tmpdir(), "avorelo-cc-"));
const cleanup = (d: string) => { if (existsSync(d) && d.includes("avorelo-cc-")) rmSync(d, { recursive: true, force: true }); };

test("empty workspace: all capability sections unavailable, receipts zero, helpful notes", () => {
  const d = sandbox();
  try {
    const m = buildControlCenter(d, { now: NOW });
    assert.equal(m.contract, "avorelo.controlCenter.v1");
    assert.equal(m.sections.runtimeSession.status, "unavailable");
    assert.equal(m.sections.contextPack.status, "unavailable");
    assert.equal(m.sections.value.status, "unavailable");
    assert.equal(m.sections.costEvidence.status, "unavailable");
    assert.equal(m.sections.continuity.status, "unavailable");
    assert.equal(m.sections.efficiencySync.status, "unavailable");
    assert.equal(m.sections.contextCheck.status, "unavailable");
    assert.equal(m.sections.workIntelligence.status, "available");
    assert.equal(m.sections.receipts.total, 0);
    assert.ok(m.notes.length > 0, "guides the user to run a session");
    assert.equal(m.redaction, "applied");
  } finally { cleanup(d); }
});

test("after an allow run: every section is populated by reference", () => {
  const d = sandbox();
  try {
    runRuntimeSession({ task: "update the README quickstart wording", dir: d, createdAt: "2026-06-11T00:00:00.000Z", now: NOW });
    const m = buildControlCenter(d, { now: NOW });
    assert.equal(m.sections.runtimeSession.status, "available");
    assert.equal(m.sections.runtimeSession.sessionStatus, "ready");
    assert.equal(m.sections.contextPack.status, "available");
    assert.ok((m.sections.contextPack.allowedCount ?? 0) >= 1);
    assert.ok((m.sections.runtimeSession.layers ?? []).length === 9, "all 9 layers surfaced");
    assert.equal(m.sections.proof.status, "available");
    assert.ok(m.sections.value.status === "available" && (m.sections.value.cardCount ?? 0) > 0);
    assert.equal(m.sections.continuity.status, "available");
    assert.equal(m.sections.efficiencySync.status, "available");
    assert.equal(m.sections.efficiencySync.mode, "dry_run");
    assert.equal(m.sections.workIntelligence.status, "available");
    assert.equal(m.sections.workIntelligence.resumeReadiness, "ready");
    assert.ok((m.sections.workIntelligence.nextActionPreview ?? "").length > 0, "shows a compact next-action preview");
    assert.ok(m.sources.length > 0, "lists the files it read");
  } finally { cleanup(d); }
});

test("token cost is shown as UNAVAILABLE (not none/zero) when only prep evidence exists", () => {
  const d = sandbox();
  try {
    runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: "2026-06-11T00:00:00.000Z", now: NOW });
    const m = buildControlCenter(d, { now: NOW });
    assert.equal(m.sections.costEvidence.status, "available", "the prep evidence exists and is surfaced");
    assert.equal(m.sections.costEvidence.confidence, "unavailable", "its confidence is unavailable, not fabricated");
    assert.equal(m.sections.costEvidence.canShowCostSummary, false);
  } finally { cleanup(d); }
});

test("savings are never claimed in the proof section", () => {
  const d = sandbox();
  try {
    runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: "2026-06-11T00:00:00.000Z", now: NOW });
    const m = buildControlCenter(d, { now: NOW });
    assert.equal(m.sections.proof.canShowSavings, false);
    assert.ok(m.sections.proof.savingsRefusalReason, "records why savings are refused");
  } finally { cleanup(d); }
});

test("raw secret never appears in the model or rendered HTML", () => {
  const d = sandbox();
  try {
    const secret = "AKIAIOSFODNN7" + "EXAMPLE";
    runRuntimeSession({ task: `fix the deploy, key is ${secret}`, dir: d, createdAt: "2026-06-11T00:00:00.000Z", now: NOW });
    const m = buildControlCenter(d, { now: NOW });
    assert.ok(!JSON.stringify(m).includes(secret), "model is clean");
    assert.ok(!renderHtml(m).includes(secret), "rendered HTML is clean");
    assert.ok(!renderText(m).includes(secret), "rendered text is clean");
  } finally { cleanup(d); }
});

test("work intelligence preview stays redacted in control center model and renders", () => {
  const d = sandbox();
  try {
    const email = "alice@example.com";
    const remote = "https://github.com/HappyLifeSaaS/Avorelo";
    const envValue = "API_TOKEN=abc123";
    const absolutePath = "C:\\Users\\alice\\Secrets\\notes.txt";
    runRuntimeSession({
      task: `refresh docs for ${email} using ${remote} and ${envValue} from ${absolutePath}`,
      dir: d,
      createdAt: "2026-06-11T00:00:00.000Z",
      now: NOW,
    });
    const m = buildControlCenter(d, { now: NOW });
    const artifacts = [JSON.stringify(m), renderHtml(m), renderText(m)];
    for (const artifact of artifacts) {
      assert.ok(!artifact.includes(email));
      assert.ok(!artifact.includes(remote));
      assert.ok(!artifact.includes(envValue));
      assert.ok(!artifact.includes(absolutePath));
    }
  } finally { cleanup(d); }
});

test("renderers produce strings and escape HTML; openControlCenter writes a local file", () => {
  const d = sandbox();
  try {
    runRuntimeSession({ task: "update the README quickstart wording", dir: d, createdAt: "2026-06-11T00:00:00.000Z", now: NOW });
    const m = buildControlCenter(d, { now: NOW });
    const html = renderHtml(m);
    const text = renderText(m);
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("Local Control Center"));
    assert.ok(html.includes("Ctx pack"));
    assert.ok(html.includes("Work intel"));
    assert.ok(text.includes("read-only"));
    assert.ok(text.includes("Ctx pack:"));
    assert.ok(text.includes("Work intel:"));
    const res = openControlCenter(d, { now: NOW });
    assert.ok(res.ok && existsSync(res.htmlPath), "writes .avorelo/control-center/index.html");
    assert.ok(readFileSync(res.htmlPath, "utf8").includes("Control Center"));
  } finally { cleanup(d); }
});

test("Community Edition: no entitlement gate, plan, or upgrade surface", () => {
  const d = sandbox();
  try {
    const m = buildControlCenter(d, { now: NOW });
    // No entitlement section exists in the open-capability model.
    assert.equal((m.sections as Record<string, unknown>).entitlementGate, undefined);

    const text = renderText(m);
    const html = renderHtml(m);
    for (const banned of ["Plan:", "Upgrade to Pro", "requires pro", "waitlist", "Join Waitlist", "View Plans", "effectivePlan"]) {
      assert.ok(!text.includes(banned), `text leaks plan/upgrade language: ${banned}`);
      assert.ok(!html.includes(banned), `html leaks plan/upgrade language: ${banned}`);
    }
  } finally { cleanup(d); }
});

test("contextCheck section loads from latest.json when present", () => {
  const d = sandbox();
  try {
    const ccDir = join(d, ".avorelo", "context-check");
    mkdirSync(ccDir, { recursive: true });
    writeFileSync(join(ccDir, "latest.json"), JSON.stringify({
      status: "warning",
      riskLevel: "low",
      sourcesChecked: 3,
      findingCount: 2,
      workContractProvided: true,
    }));
    const m = buildControlCenter(d, { now: NOW });
    assert.equal(m.sections.contextCheck.status, "available");
    assert.equal(m.sections.contextCheck.checkStatus, "warning");
    assert.equal(m.sections.contextCheck.riskLevel, "low");
    assert.equal(m.sections.contextCheck.inputsChecked, 3);
    assert.equal(m.sections.contextCheck.findingCount, 2);
    assert.equal(m.sections.contextCheck.policyPresent, true);
    const text = renderText(m);
    assert.ok(text.includes("Context:"), "renderText shows context check section");
    const html = renderHtml(m);
    assert.ok(html.includes("Context"), "renderHtml shows context check section");
  } finally { cleanup(d); }
});

test("browser visual qa section loads safe latest metadata when present", () => {
  const d = sandbox();
  try {
    const browserQaDir = join(d, ".avorelo", "browser-qa");
    mkdirSync(browserQaDir, { recursive: true });
    writeFileSync(join(browserQaDir, "latest.json"), JSON.stringify({
      contract: "avorelo.browserVisualQa.v1",
      schemaVersion: 1,
      generatedAt: "2026-06-21T00:00:00.000Z",
      target: "local_static_preview",
      decision: "PASS_WITH_WARNINGS",
      riskLevel: "medium",
      routesChecked: 2,
      failedRoutes: 0,
      warningCount: 1,
      screenshotPolicy: "metadata_only",
      screenshotsPersisted: 0,
      unsafeCapturesBlocked: 0,
      topFindings: [
        {
          route: "/pricing",
          selector: "head > link[rel*=icon]",
          severity: "warning",
          reasonCode: "BROWSER_QA_MISSING_FAVICON",
          safeSummary: "Page is missing a favicon reference.",
          evidenceRef: "browser-qa:route:/pricing:finding:1",
          screenshotPolicyResult: "metadata_only",
          consoleCategory: null,
          recommendedNextAction: "Add a favicon link so the route presents a complete browser surface.",
        },
      ],
      findings: [],
      routeSummaries: [],
      nextSafeAction: "Triage the warnings and rerun Browser QA after the next UI change.",
      containsRawScreenshot: false,
      containsRawHtml: false,
      containsRawDom: false,
      containsRawConsoleLog: false,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawDiff: false,
      containsRawSecret: false,
      containsRawEnvValue: false,
      containsRawTerminalOutput: false,
      contentStorageClass: "safe_metadata_only",
    }));
    const m = buildControlCenter(d, { now: NOW });
    assert.equal(m.sections.browserVisualQa.status, "available");
    assert.equal(m.sections.browserVisualQa.decision, "PASS_WITH_WARNINGS");
    assert.equal(m.sections.browserVisualQa.routesChecked, 2);
    const text = renderText(m);
    assert.ok(text.includes("Browser QA:"), "renderText shows browser qa section");
    const html = renderHtml(m);
    assert.ok(html.includes("Browser QA"), "renderHtml shows browser qa section");
  } finally { cleanup(d); }
});

test("read-only: buildControlCenter creates no capability artifacts of its own", () => {
  const d = sandbox();
  try {
    runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: "2026-06-11T00:00:00.000Z", now: NOW });
    const before = readdirSync(join(d, ".avorelo")).sort();
    buildControlCenter(d, { now: NOW });
    const after = readdirSync(join(d, ".avorelo")).sort();
    assert.deepEqual(after, before, "building the model writes nothing (openControlCenter is the only writer)");
  } finally { cleanup(d); }
});
