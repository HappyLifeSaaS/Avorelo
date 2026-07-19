import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runBrowserVisualQa, readBrowserQaLatest } from "../src/avorelo/capabilities/browser-visual-qa/index.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "browser-visual-qa");

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-browser-qa-"));
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function withFakeBrowser<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.AVORELO_FAKE_BROWSER_QA;
  process.env.AVORELO_FAKE_BROWSER_QA = "1";
  return fn().finally(() => {
    if (previous === undefined) delete process.env.AVORELO_FAKE_BROWSER_QA;
    else process.env.AVORELO_FAKE_BROWSER_QA = previous;
  });
}

test("runner returns safe metadata for a reachable local fixture route", async () => {
  const dir = sandbox();
  try {
    const artifact = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "good"),
      routes: [{ route: "/" }],
    }));
    assert.equal(artifact.decision, "PASS");
    assert.equal(artifact.screenshotPolicy, "metadata_only");
    assert.equal(artifact.routesChecked, 1);
    assert.equal(artifact.containsRawHtml, false);
    assert.equal(artifact.containsRawDom, false);
    assert.equal(artifact.containsRawConsoleLog, false);
  } finally {
    cleanup(dir);
  }
});

test("missing route creates BROWSER_QA_ROUTE_UNREACHABLE", async () => {
  const dir = sandbox();
  try {
    const artifact = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "good"),
      routes: [{ route: "/missing" }],
    }));
    assert.equal(artifact.decision, "FAIL");
    assert.ok(artifact.findings.some((finding) => finding.reasonCode === "BROWSER_QA_ROUTE_UNREACHABLE"));
  } finally {
    cleanup(dir);
  }
});

test("console error is summarized without raw log persistence", async () => {
  const dir = sandbox();
  try {
    const artifact = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "console-error"),
      routes: [{ route: "/" }],
    }));
    assert.ok(artifact.findings.some((finding) => finding.reasonCode === "BROWSER_QA_CONSOLE_ERROR"));
    assert.equal(artifact.containsRawConsoleLog, false);
    assert.ok(!JSON.stringify(artifact).includes("boom happened"));
  } finally {
    cleanup(dir);
  }
});

test("missing favicon, overflow, placeholder, and disabled form findings work on fixtures", async () => {
  const dir = sandbox();
  try {
    const favicon = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "missing-favicon"),
      routes: [{ route: "/" }],
    }));
    assert.ok(favicon.findings.some((finding) => finding.reasonCode === "BROWSER_QA_MISSING_FAVICON"));

    const overflow = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "overflow"),
      routes: [{ route: "/" }],
    }));
    assert.ok(overflow.findings.some((finding) => finding.reasonCode === "BROWSER_QA_LAYOUT_OVERFLOW"));

    const placeholder = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "placeholder"),
      routes: [{ route: "/" }],
    }));
    assert.ok(placeholder.findings.some((finding) => finding.reasonCode === "BROWSER_QA_PLACEHOLDER_METRIC_VISIBLE"));

    const disabledForm = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "disabled-form"),
      routes: [{ route: "/" }],
    }));
    assert.ok(disabledForm.findings.some((finding) => finding.reasonCode === "BROWSER_QA_FORM_BROKEN"));
  } finally {
    cleanup(dir);
  }
});

test("safe capture is opt-in and blocked or redacted when unsafe content is detected", async () => {
  const dir = sandbox();
  try {
    const blocked = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "private"),
      routes: [{ route: "/" }],
      screenshotPolicy: "safe_capture",
    }));
    assert.ok(blocked.findings.some((finding) => finding.reasonCode === "BROWSER_QA_SCREENSHOT_BLOCKED_PRIVATE_DATA"));
    assert.equal(blocked.screenshotsPersisted, 0);

    const redacted = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "private"),
      routes: [{ route: "/" }],
      screenshotPolicy: "redacted",
    }));
    assert.ok(redacted.findings.some((finding) => finding.reasonCode === "BROWSER_QA_SCREENSHOT_REDACTED"));
    assert.equal(redacted.screenshotsPersisted, 1);
  } finally {
    cleanup(dir);
  }
});

test("latest reads persisted safe metadata", async () => {
  const dir = sandbox();
  try {
    const artifact = await withFakeBrowser(() => runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "good"),
      routes: [{ route: "/" }],
    }));
    const latest = readBrowserQaLatest(dir);
    assert.deepEqual(latest, artifact);
  } finally {
    cleanup(dir);
  }
});

test("production-looking URL is blocked by default", async () => {
  const dir = sandbox();
  try {
    const artifact = await runBrowserVisualQa({
      dir,
      target: "https://avorelo.com",
      routes: [{ route: "/" }],
    });
    assert.equal(artifact.decision, "BLOCKED");
    assert.ok(artifact.findings.some((finding) => finding.reasonCode === "BROWSER_QA_UNSAFE_PRODUCTION_TARGET"));
  } finally {
    cleanup(dir);
  }
});

test("browser dependency unavailable returns UNAVAILABLE instead of crashing", async () => {
  const dir = sandbox();
  try {
    const previous = process.env.AVORELO_FAKE_BROWSER_QA;
    delete process.env.AVORELO_FAKE_BROWSER_QA;
    const artifact = await runBrowserVisualQa({
      dir,
      target: join(FIXTURES, "good"),
      routes: [{ route: "/" }],
    });
    if (previous === undefined) delete process.env.AVORELO_FAKE_BROWSER_QA;
    else process.env.AVORELO_FAKE_BROWSER_QA = previous;
    assert.equal(artifact.decision, "UNAVAILABLE");
    assert.ok(artifact.findings.some((finding) => finding.reasonCode === "BROWSER_QA_BROWSER_DEPENDENCY_UNAVAILABLE"));
  } finally {
    cleanup(dir);
  }
});
