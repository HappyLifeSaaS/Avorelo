import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { planToolExecution, runToolExecution, type ExecutionContext, type ToolExecutionPlan } from "../src/avorelo/kernel/tool-adapters/index.ts";
import { runRuntimeSession, validateRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";

const NOW = 1718500000000;

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function makePlan(selectedAdapter: ToolExecutionPlan["selectedAdapter"], executionMode: ToolExecutionPlan["executionMode"] = "proof"): ToolExecutionPlan {
  const plan = planToolExecution({
    taskType: "code_generation",
    riskClass: "low",
    paymentTouched: false,
    authTouched: false,
    productionImpactPossible: false,
    deterministicEvidenceAvailable: false,
    deepMode: false,
    secretsPossible: false,
    browserProofRequested: false,
    ciVerificationRequested: false,
    dir: tmpdir(),
    now: NOW,
  });
  plan.selectedAdapter = selectedAdapter;
  plan.executionMode = executionMode;
  return plan;
}

function makeCtx(task: string): ExecutionContext {
  return { dir: tmpdir(), task, now: NOW, approved: true, useFakeAdapters: false };
}

test("semgrep fake findings are summarized and sanitized", () => {
  withEnv("AVORELO_FAKE_PROOF_ADAPTERS", "1", () => {
    const plan = makePlan("semgrep");
    const result = runToolExecution(plan, makeCtx("review auth secret handling"));
    assert.equal(result.status, "executed");
    assert.equal(result.proofMetadata?.adapterClass, "security_scan");
    assert.ok((result.proofMetadata?.findingCount ?? 0) >= 1);
    assert.ok(result.reasonCodes.includes("FAKE_CI_PROOF_MODE"));
    assert.ok(!String(result.output).includes("function "));
    assert.equal(result.containsRawOutput, false);
  });
});

test("semgrep missing tool skips gracefully", () => {
  const prevPath = process.env.PATH;
  const prevCI = process.env.CI;
  const prevFake = process.env.AVORELO_FAKE_PROOF_ADAPTERS;
  process.env.PATH = "";
  delete process.env.CI;
  delete process.env.AVORELO_FAKE_PROOF_ADAPTERS;
  try {
    const plan = makePlan("semgrep");
    const result = runToolExecution(plan, makeCtx("review security posture"));
    assert.equal(result.status, "skipped");
    assert.equal(result.failureClass, "not_installed");
  } finally {
    process.env.PATH = prevPath;
    if (prevCI !== undefined) process.env.CI = prevCI; else delete process.env.CI;
    if (prevFake !== undefined) process.env.AVORELO_FAKE_PROOF_ADAPTERS = prevFake; else delete process.env.AVORELO_FAKE_PROOF_ADAPTERS;
  }
});

test("playwright fake proof stays fixture-only and redacted", () => {
  withEnv("AVORELO_FAKE_PROOF_ADAPTERS", "1", () => {
    const plan = makePlan("playwright-proof");
    const result = runToolExecution(plan, makeCtx("verify the signup flow in browser"));
    assert.equal(result.status, "executed");
    assert.equal(result.proofMetadata?.adapterClass, "browser_proof");
    assert.equal(result.proofMetadata?.findingCount, 0);
    assert.ok(!String(result.output).includes("<html"));
  });
});

test("github actions fake fixture summarizes failures without raw logs", () => {
  withEnv("AVORELO_FAKE_PROOF_ADAPTERS", "1", () => {
    const plan = makePlan("github-actions");
    const result = runToolExecution(plan, makeCtx("check github actions workflow status"));
    assert.equal(result.status, "executed");
    assert.equal(result.proofMetadata?.adapterClass, "ci_readonly");
    assert.ok((result.proofMetadata?.artifactCount ?? 0) >= 0);
    assert.ok(result.reasonCodes.includes("FAKE_CI_PROOF_MODE"));
    assert.ok(!String(result.output).includes("raw"));
  });
});

test("github actions blocks trigger-like requests", () => {
  const plan = makePlan("github-actions");
  const result = runToolExecution(plan, makeCtx("trigger deploy workflow for production"));
  assert.equal(result.status, "blocked");
  assert.ok(result.reasonCodes.includes("GITHUB_ACTIONS_TRIGGER_BLOCKED"));
});

test("runtime session preserves sanitized proof metadata", () => {
  withEnv("AVORELO_FAKE_PROOF_ADAPTERS", "1", () => {
    const dir = join(tmpdir(), `avorelo-proof-pack-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const { record } = runRuntimeSession({ task: "check github actions workflow status", dir, now: NOW });
      assert.equal(record.toolExecution.containsRawSecret, false);
      assert.equal(record.toolExecution.proofMetadata?.sanitized, true);
      const validation = validateRuntimeSession(record);
      assert.ok(validation.valid, validation.reasons.join(","));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
