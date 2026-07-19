import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runBrowserVisualQa, readBrowserQaLatest } from "../capabilities/browser-visual-qa/index.ts";
import { buildControlCenter } from "../capabilities/control-center/index.ts";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];

function record(gate: string, pass: boolean, detail: string): void {
  gates.push({ gate, pass, detail });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-browser-qa-dogfood-"));
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

const fixtureRoot = join(import.meta.dirname, "..", "..", "..", "fixtures", "browser-visual-qa");
const goodFixture = join(fixtureRoot, "good");
const privateFixture = join(fixtureRoot, "private");

const previousFake = process.env.AVORELO_FAKE_BROWSER_QA;
process.env.AVORELO_FAKE_BROWSER_QA = "1";

const fakeRunDir = sandbox();
try {
  const artifact = await runBrowserVisualQa({
    dir: fakeRunDir,
    target: goodFixture,
  });
  assert(artifact.decision === "PASS", `decision=${artifact.decision}`);
  assert(artifact.screenshotPolicy === "metadata_only", `policy=${artifact.screenshotPolicy}`);
  assert(artifact.routesChecked >= 4, `routes=${artifact.routesChecked}`);
  assert(artifact.containsRawHtml === false && artifact.containsRawDom === false && artifact.containsRawConsoleLog === false, "raw flags");
  record("fake_fixture_pass", true, `decision=${artifact.decision} routes=${artifact.routesChecked}`);

  const latest = readBrowserQaLatest(fakeRunDir);
  assert(!!latest, "latest artifact persisted");
  record("latest_artifact_persisted", true, latest?.generatedAt ?? "missing");

  const redactedCapture = await runBrowserVisualQa({
    dir: fakeRunDir,
    target: privateFixture,
    routes: [{ route: "/" }],
    screenshotPolicy: "redacted",
  });
  assert(redactedCapture.findings.some((finding) => finding.reasonCode === "BROWSER_QA_SCREENSHOT_REDACTED"), "redacted capture finding");
  assert(redactedCapture.screenshotsPersisted === 1, `persisted=${redactedCapture.screenshotsPersisted}`);
  record("unsafe_capture_redacted", true, `persisted=${redactedCapture.screenshotsPersisted}`);

  const controlCenter = buildControlCenter(fakeRunDir, { now: Date.now() });
  assert(controlCenter.sections.browserVisualQa.status === "available", "browser qa section available");
  record("control_center_projection", true, `decision=${controlCenter.sections.browserVisualQa.decision}`);
} catch (error: any) {
  record("fake_browser_qa_path", false, error.message);
} finally {
  cleanup(fakeRunDir);
}

if (previousFake === undefined) delete process.env.AVORELO_FAKE_BROWSER_QA;
else process.env.AVORELO_FAKE_BROWSER_QA = previousFake;

const realRunDir = sandbox();
try {
  const artifact = await runBrowserVisualQa({
    dir: realRunDir,
    target: goodFixture,
    routes: [{ route: "/" }],
  });
  assert(artifact.decision === "UNAVAILABLE", `decision=${artifact.decision}`);
  assert(artifact.findings.some((finding) => finding.reasonCode === "BROWSER_QA_BROWSER_DEPENDENCY_UNAVAILABLE"), "unavailable reason");
  record("real_browser_dependency_honesty", true, artifact.nextSafeAction);
} catch (error: any) {
  record("real_browser_dependency_honesty", false, error.message);
} finally {
  cleanup(realRunDir);
}

const blockedRunDir = sandbox();
try {
  const artifact = await runBrowserVisualQa({
    dir: blockedRunDir,
    target: "https://avorelo.com",
    routes: [{ route: "/" }],
  });
  assert(artifact.decision === "BLOCKED", `decision=${artifact.decision}`);
  record("production_target_blocked", true, artifact.nextSafeAction);
} catch (error: any) {
  record("production_target_blocked", false, error.message);
} finally {
  cleanup(blockedRunDir);
}

const failed = gates.filter((gate) => !gate.pass);
console.log("AVORELO BROWSER VISUAL QA DOGFOOD");
console.log(JSON.stringify({
  ok: failed.length === 0,
  gates: {
    total: gates.length,
    passed: gates.length - failed.length,
    failed: failed.map((gate) => gate.gate),
  },
  detail: { gates },
}, null, 2));
if (failed.length > 0) process.exit(1);
