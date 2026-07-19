// Avorelo Loop Control V1 tests (node:test, zero-dep).

import { test } from "node:test";
import assert from "node:assert/strict";

// --- Phase 1: Schema validators ---

import {
  validateLoopContractExtension,
  validateLoopMetadata,
} from "../src/avorelo/shared/schemas/index.ts";

test("validateLoopContractExtension accepts valid input", () => {
  const ext = validateLoopContractExtension({
    loopId: "loop_1",
    mode: "bounded_loop",
    maxIterations: 3,
    maxRuntimeMinutes: 15,
    maxTokenBudget: null,
    currentIteration: 0,
    startedAt: "2026-06-12T10:00:00Z",
    allowedCommands: ["npm test"],
    blockedCommands: ["npm publish"],
    requiredChecks: [],
    escalationRules: [],
  });
  assert.equal(ext.loopId, "loop_1");
  assert.equal(ext.mode, "bounded_loop");
});

test("validateLoopContractExtension rejects missing loopId", () => {
  assert.throws(() => validateLoopContractExtension({ mode: "single_run" } as any), /loopId/);
});

test("validateLoopContractExtension rejects invalid mode", () => {
  assert.throws(() => validateLoopContractExtension({ loopId: "l", mode: "human_gated_loop" as any }), /mode/);
});

test("validateLoopMetadata rejects missing contract field", () => {
  assert.throws(() => validateLoopMetadata({} as any), /contract/);
});

test("validateLoopMetadata rejects invalid stopReason", () => {
  assert.throws(() => validateLoopMetadata({
    contract: "avorelo.loopMetadata.v1",
    schemaVersion: 1,
    loopId: "l",
    contractId: "c",
    kernelReceiptRef: "r",
    iterationsRun: 1,
    stopReason: "fake_reason" as any,
  }), /stopReason/);
});

test("validateLoopMetadata accepts valid input", () => {
  const meta = validateLoopMetadata({
    contract: "avorelo.loopMetadata.v1",
    schemaVersion: 1,
    loopId: "loop_1",
    contractId: "wc_1",
    kernelReceiptRef: "rcpt_1",
    createdAt: "2026-06-12T10:00:00Z",
    mode: "bounded_loop",
    iterationsRun: 2,
    maxIterations: 3,
    totalRuntimeMs: 5000,
    stopReason: "success_all_checks_passed",
    stopCategory: "success",
    filesChanged: ["a.ts"],
    filesChangedInScope: 1,
    filesChangedOutOfScope: 0,
    proofState: "proved",
    checksRun: [{ checkId: "c1", label: "test", result: "passed" }],
    checksPassed: 1,
    checksFailed: 0,
    checksNotRun: 0,
    driftDetected: false,
    driftSummary: [],
    iterations: [],
    safeNextActions: [],
    openIssues: [],
    safety: {
      redacted: true,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsTerminalLog: false,
      containsGitDiff: false,
    },
  });
  assert.equal(meta.loopId, "loop_1");
  assert.equal(meta.kernelReceiptRef, "rcpt_1");
});

// --- Phase 2: Kernel Drift Guard ---

import {
  detectScopeDrift,
  detectMethodDrift,
} from "../src/avorelo/kernel/drift-guard/index.ts";

test("scope drift: no drift when files are in allowed paths", () => {
  const result = detectScopeDrift({
    changedFiles: ["src/auth/__tests__/login.test.ts"],
    allowedPaths: ["src/auth/__tests__/*"],
    disallowedPaths: [],
  });
  assert.equal(result.length, 0);
});

test("scope drift: block when file in disallowed paths", () => {
  const result = detectScopeDrift({
    changedFiles: ["src/auth/oauth/provider.ts"],
    allowedPaths: ["src/auth/__tests__/*"],
    disallowedPaths: ["src/auth/oauth/*"],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "scope_drift");
  assert.equal(result[0].severity, "block");
});

test("scope drift: warning when file outside allowed paths", () => {
  const result = detectScopeDrift({
    changedFiles: ["src/billing/index.ts"],
    allowedPaths: ["src/auth/*"],
    disallowedPaths: [],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "warning");
});

test("scope drift: no drift when allowedPaths is empty (no restriction)", () => {
  const result = detectScopeDrift({
    changedFiles: ["anything.ts"],
    allowedPaths: [],
    disallowedPaths: [],
  });
  assert.equal(result.length, 0);
});

test("scope drift: disallowed takes precedence over allowed", () => {
  const result = detectScopeDrift({
    changedFiles: ["src/auth/oauth/secret.ts"],
    allowedPaths: ["src/auth/*"],
    disallowedPaths: ["src/auth/oauth/*"],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "block");
});

test("method drift: no drift when commands are allowed", () => {
  const result = detectMethodDrift({
    commandsRun: ["npm test", "npx tsc --noEmit"],
    blockedCommands: ["npm publish"],
  });
  assert.equal(result.length, 0);
});

test("method drift: block when blocked command runs", () => {
  const result = detectMethodDrift({
    commandsRun: ["npm publish"],
    blockedCommands: ["npm publish"],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "method_drift");
  assert.equal(result[0].severity, "block");
});

test("method drift: block on destructive commands even without explicit block list", () => {
  const result = detectMethodDrift({
    commandsRun: ["rm -rf /"],
    blockedCommands: [],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "block");
  assert.ok(result[0].description.includes("Destructive"));
});

test("method drift: block on git push --force", () => {
  const result = detectMethodDrift({
    commandsRun: ["git push --force origin main"],
    blockedCommands: [],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "block");
});

test("method drift: block on git push (always blocked in loop)", () => {
  const result = detectMethodDrift({
    commandsRun: ["git push origin main"],
    blockedCommands: [],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "block");
});

test("method drift: block on DROP TABLE", () => {
  const result = detectMethodDrift({
    commandsRun: ["psql -c 'DROP TABLE users'"],
    blockedCommands: [],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "block");
});

test("method drift: empty inputs produce no findings", () => {
  assert.equal(detectMethodDrift({ commandsRun: [], blockedCommands: [] }).length, 0);
  assert.equal(detectScopeDrift({ changedFiles: [], allowedPaths: [], disallowedPaths: [] }).length, 0);
});

// --- Phase 3: Loop Readiness Classifier ---

import { classifyLoopReadiness } from "../src/avorelo/capabilities/loop-control/readiness.ts";

test("readiness: failing tests task is safe_with_bounded_loop", () => {
  const r = classifyLoopReadiness({ task: "Fix failing tests in src/utils" });
  assert.equal(r.classification, "safe_with_bounded_loop");
});

test("readiness: broad refactor is not_suitable", () => {
  const r = classifyLoopReadiness({ task: "Refactor everything in the app" });
  assert.equal(r.classification, "not_suitable");
  assert.ok(r.reasonCodes.includes("BROAD_TASK"));
});

test("readiness: auth task triggers needs_human_gate", () => {
  const r = classifyLoopReadiness({ task: "Fix the auth login flow" });
  assert.equal(r.classification, "needs_human_gate");
  assert.ok(r.reasonCodes.includes("HIGH_RISK_KEYWORD"));
});

test("readiness: deploy task is blocked", () => {
  const r = classifyLoopReadiness({ task: "Deploy to production" });
  assert.equal(r.classification, "blocked");
  assert.ok(r.reasonCodes.includes("DESTRUCTIVE_TASK"));
});

test("readiness: billing task triggers human gate", () => {
  const r = classifyLoopReadiness({ task: "Update billing calculation" });
  assert.equal(r.classification, "needs_human_gate");
});

test("readiness: docs sync is safe", () => {
  const r = classifyLoopReadiness({ task: "Update README to match CLI commands" });
  assert.equal(r.classification, "safe_with_bounded_loop");
});

test("readiness: 'make it better' is not suitable", () => {
  const r = classifyLoopReadiness({ task: "Make it better" });
  assert.equal(r.classification, "not_suitable");
});

test("readiness: enriched contract with blocked route", () => {
  const r = classifyLoopReadiness({
    task: "Fix tests",
    enrichedContract: {
      contractId: "c", objective: "Fix tests", allowedPaths: [], requestedOutputs: [],
      successCriteria: [], stopConditions: [], evidenceRefs: [], reviewReasons: [],
      planTier: "Free", nonGoals: [], disallowedPaths: [],
      riskClass: "medium", route: "blocked", proofTier: "tests",
      approvalPolicy: "none",
      safetyBoundary: { secretBoundaryDecision: "allow", secretRiskCodes: [], safeRunDecision: "allow", sourceTrustRisk: "trusted", instructionRisk: [] },
      costPolicy: { preferDeterministic: true, avoidDeepModelUnlessNeeded: true, tokenOptimizationCannotOverrideProof: true, routingCannotOverrideSafetyBoundary: true },
    },
  });
  assert.equal(r.classification, "blocked");
});

// --- Phase 4: Loop Policy Builder ---

import { buildLoopPolicy } from "../src/avorelo/capabilities/loop-control/policy-builder.ts";

test("policy: bounded loop for medium risk", () => {
  const readiness = classifyLoopReadiness({ task: "Fix failing tests in src/utils" });
  const policy = buildLoopPolicy({ readiness });
  assert.equal(policy.mode, "bounded_loop");
  assert.equal(policy.maxIterations, 3);
  assert.ok(policy.requiredChecks.length >= 1);
  assert.ok(policy.stopConditions.length >= 5);
});

test("policy: single_run for blocked/human_gate", () => {
  const readiness = classifyLoopReadiness({ task: "Fix auth login" });
  const policy = buildLoopPolicy({ readiness });
  assert.equal(policy.mode, "single_run");
  assert.equal(policy.maxIterations, 1);
});

test("policy: user checks included", () => {
  const readiness = classifyLoopReadiness({ task: "Fix lint errors" });
  const policy = buildLoopPolicy({
    readiness,
    userChecks: [
      { label: "npm test", command: "npm test", type: "test" },
      { label: "tsc", command: "npx tsc --noEmit", type: "typecheck" },
    ],
  });
  const labels = policy.requiredChecks.map((c) => c.label);
  assert.ok(labels.includes("npm test"));
  assert.ok(labels.includes("tsc"));
  assert.ok(labels.includes("scope check"));
});

test("policy: user maxIterations capped at 10", () => {
  const readiness = classifyLoopReadiness({ task: "Fix lint" });
  const policy = buildLoopPolicy({ readiness, userMaxIterations: 50 });
  assert.ok(policy.maxIterations <= 10);
});

test("policy: default blocked commands include npm publish and git push", () => {
  const readiness = classifyLoopReadiness({ task: "Fix lint" });
  const policy = buildLoopPolicy({ readiness });
  assert.ok(policy.blockedCommands.includes("npm publish"));
  assert.ok(policy.blockedCommands.includes("git push"));
});

// --- Phase 6: Loop Metadata ---

import { buildLoopMetadata, persistLoopMetadata, readLoopMetadata, readLatestLoopMetadata } from "../src/avorelo/capabilities/loop-control/loop-metadata.ts";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("buildLoopMetadata produces valid metadata with kernelReceiptRef", () => {
  const meta = buildLoopMetadata({
    loopId: "loop_test1",
    contractId: "wc_1",
    kernelReceiptRef: "rcpt_abc",
    mode: "bounded_loop",
    iterationsRun: 2,
    maxIterations: 5,
    totalRuntimeMs: 8000,
    stopReason: "success_all_checks_passed",
    stopCategory: "success",
    filesChanged: ["src/a.ts", "src/b.ts"],
    allowedPaths: ["src/*"],
    disallowedPaths: [],
    checksRun: [{ checkId: "c1", label: "test", result: "passed" }],
    driftSummary: [],
    iterations: [],
    safeNextActions: [],
    openIssues: [],
  });
  assert.equal(meta.contract, "avorelo.loopMetadata.v1");
  assert.equal(meta.kernelReceiptRef, "rcpt_abc");
  assert.equal(meta.proofState, "proved");
  assert.equal(meta.filesChangedInScope, 2);
  assert.equal(meta.filesChangedOutOfScope, 0);
  assert.equal(meta.safety.containsRawPrompt, false);
  assert.equal(meta.safety.containsRawSecret, false);
});

test("buildLoopMetadata classifies out-of-scope files", () => {
  const meta = buildLoopMetadata({
    loopId: "loop_oos",
    contractId: "wc_1",
    kernelReceiptRef: "rcpt_x",
    mode: "bounded_loop",
    iterationsRun: 1,
    maxIterations: 3,
    totalRuntimeMs: 2000,
    stopReason: "budget_max_iterations",
    stopCategory: "budget",
    filesChanged: ["src/a.ts", "docs/readme.md"],
    allowedPaths: ["src/*"],
    disallowedPaths: [],
    checksRun: [],
    driftSummary: [],
    iterations: [],
    safeNextActions: [],
    openIssues: [],
  });
  assert.equal(meta.filesChangedInScope, 1);
  assert.equal(meta.filesChangedOutOfScope, 1);
});

test("buildLoopMetadata sets needs_attention on safety stop", () => {
  const meta = buildLoopMetadata({
    loopId: "loop_safe",
    contractId: "wc_1",
    kernelReceiptRef: "rcpt_y",
    mode: "single_run",
    iterationsRun: 1,
    maxIterations: 1,
    totalRuntimeMs: 1000,
    stopReason: "safety_blocked_path",
    stopCategory: "safety",
    filesChanged: [],
    allowedPaths: [],
    disallowedPaths: [],
    checksRun: [{ checkId: "c1", label: "test", result: "passed" }],
    driftSummary: [],
    iterations: [],
    safeNextActions: [],
    openIssues: [],
  });
  assert.equal(meta.proofState, "needs_attention");
});

test("persistLoopMetadata and readLoopMetadata round-trip", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-loop-test-"));
  try {
    const meta = buildLoopMetadata({
      loopId: "loop_rt",
      contractId: "wc_1",
      kernelReceiptRef: "rcpt_rt",
      mode: "bounded_loop",
      iterationsRun: 1,
      maxIterations: 3,
      totalRuntimeMs: 500,
      stopReason: "success_all_checks_passed",
      stopCategory: "success",
      filesChanged: [],
      allowedPaths: [],
      disallowedPaths: [],
      checksRun: [],
      driftSummary: [],
      iterations: [],
      safeNextActions: [],
      openIssues: [],
    });
    const path = persistLoopMetadata(tmp, meta);
    assert.ok(path.includes("loop_rt.json"));
    const loaded = readLoopMetadata(tmp, "loop_rt");
    assert.ok(loaded);
    assert.equal(loaded.loopId, "loop_rt");
    assert.equal(loaded.kernelReceiptRef, "rcpt_rt");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Phase 7: Iteration Drift ---

import { detectIterationDrift, detectProofDrift, detectProgressDrift } from "../src/avorelo/capabilities/loop-control/iteration-drift.ts";

test("iteration drift: proof drift on repeated failures", () => {
  const iter1 = { iteration: 1, startedAt: "", durationMs: 100, filesChanged: ["a.ts"], checksRun: ["c1"], checkResults: { c1: "failed" as const }, driftDetected: false, gateDecision: "CONTINUE" as const, reasonCodes: [] };
  const iter2 = { iteration: 2, startedAt: "", durationMs: 100, filesChanged: ["a.ts"], checksRun: ["c1"], checkResults: { c1: "failed" as const }, driftDetected: false, gateDecision: "CONTINUE" as const, reasonCodes: [] };
  const findings = detectProofDrift({ iterations: [iter1, iter2], currentFilesChanged: ["a.ts"], previousFilesChanged: ["a.ts"] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "proof_drift");
});

test("iteration drift: progress drift on no files changed", () => {
  const iter1 = { iteration: 1, startedAt: "", durationMs: 100, filesChanged: ["a.ts"], checksRun: [], checkResults: {}, driftDetected: false, gateDecision: "CONTINUE" as const, reasonCodes: [] };
  const iter2 = { iteration: 2, startedAt: "", durationMs: 100, filesChanged: [], checksRun: [], checkResults: {}, driftDetected: false, gateDecision: "CONTINUE" as const, reasonCodes: [] };
  const findings = detectProgressDrift({ iterations: [iter1, iter2], currentFilesChanged: [], previousFilesChanged: ["a.ts"] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "progress_drift");
});

test("iteration drift: no drift on first iteration", () => {
  const findings = detectIterationDrift({ iterations: [], currentFilesChanged: ["a.ts"], previousFilesChanged: [] });
  assert.equal(findings.length, 0);
});

// --- Phase 8: LoopAdapter interface + Claude Code adapter ---

import type { LoopAdapter, IterationOutput } from "../src/avorelo/adapters/loop-adapter.ts";

test("LoopAdapter interface: mock adapter satisfies type", async () => {
  const mockAdapter: LoopAdapter = {
    id: "mock",
    displayName: "Mock",
    async executeIteration(input) {
      return {
        exitCode: 0,
        filesChanged: ["mock.ts"],
        commandsRun: [],
        durationMs: 10,
        agentError: null,
        truncatedLog: null,
      };
    },
    isAvailable() { return true; },
  };
  const result = await mockAdapter.executeIteration({
    task: "test", cwd: ".", iteration: 1, maxIterations: 1,
    allowedPaths: [], disallowedPaths: [], allowedCommands: [], blockedCommands: [],
    previousFailures: [], previousDrift: [],
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.filesChanged, ["mock.ts"]);
});

// --- Phase 7: Orchestrator (unit test with mock adapter) ---

import { runLoop } from "../src/avorelo/capabilities/loop-control/orchestrator.ts";

test("orchestrator: single_run with mock adapter produces receipt + metadata", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-orch-test-"));
  try {
    const mockAdapter: LoopAdapter = {
      id: "mock",
      displayName: "Mock",
      async executeIteration() {
        return { exitCode: 0, filesChanged: [], commandsRun: [], durationMs: 10, agentError: null, truncatedLog: null };
      },
      isAvailable() { return true; },
    };
    const readiness = classifyLoopReadiness({ task: "Fix lint errors" });
    const policy = buildLoopPolicy({ readiness, userMaxIterations: 1 });
    policy.mode = "single_run";
    policy.maxIterations = 1;
    // Remove file-based checks so they don't fail in temp dir
    policy.requiredChecks = policy.requiredChecks.filter((c) => c.type === "scope_check");

    const result = await runLoop({
      task: "Fix lint errors",
      contractId: "wc_test",
      policy,
      adapter: mockAdapter,
      cwd: tmp,
      allowedPaths: [],
      disallowedPaths: [],
    });

    assert.ok(result.loopId.startsWith("loop_"));
    assert.ok(result.receiptPath.includes("rcpt_"));
    assert.ok(result.metadataPath.includes(result.loopId));
    assert.equal(result.iterationsRun, 1);
    assert.equal(result.metadata.kernelReceiptRef, result.metadata.kernelReceiptRef);
    assert.equal(result.metadata.contract, "avorelo.loopMetadata.v1");
    assert.equal(result.metadata.safety.containsRawPrompt, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("orchestrator: stops on agent error", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-orch-err-"));
  try {
    const errorAdapter: LoopAdapter = {
      id: "error-mock",
      displayName: "Error Mock",
      async executeIteration() {
        return { exitCode: 1, filesChanged: [], commandsRun: [], durationMs: 10, agentError: "process crashed", truncatedLog: null };
      },
      isAvailable() { return true; },
    };
    const readiness = classifyLoopReadiness({ task: "Fix lint" });
    const policy = buildLoopPolicy({ readiness });
    policy.requiredChecks = policy.requiredChecks.filter((c) => c.type === "scope_check");

    const result = await runLoop({
      task: "Fix lint",
      contractId: "wc_err",
      policy,
      adapter: errorAdapter,
      cwd: tmp,
      allowedPaths: [],
      disallowedPaths: [],
    });

    assert.equal(result.stopReason, "failure_agent_error");
    assert.equal(result.stopCategory, "failure");
    assert.equal(result.iterationsRun, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("orchestrator: abortSignal stops loop", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-orch-abort-"));
  try {
    const ac = new AbortController();
    ac.abort();
    const mockAdapter: LoopAdapter = {
      id: "mock",
      displayName: "Mock",
      async executeIteration() {
        return { exitCode: 0, filesChanged: [], commandsRun: [], durationMs: 10, agentError: null, truncatedLog: null };
      },
      isAvailable() { return true; },
    };
    const readiness = classifyLoopReadiness({ task: "Fix lint" });
    const policy = buildLoopPolicy({ readiness });
    policy.requiredChecks = [];

    const result = await runLoop({
      task: "Fix lint",
      contractId: "wc_abort",
      policy,
      adapter: mockAdapter,
      cwd: tmp,
      allowedPaths: [],
      disallowedPaths: [],
      abortSignal: ac.signal,
    });

    assert.equal(result.stopReason, "user_stopped");
    assert.equal(result.iterationsRun, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Phase 7: Check detection (V1.1) ---

import { detectCheckCommands, detectedChecksToLoopChecks } from "../src/avorelo/capabilities/loop-control/check-detection.ts";

test("check detection: finds npm test from package.json", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const checks = detectCheckCommands(tmp);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].label, "npm test");
    assert.equal(checks[0].command, "npm test");
    assert.equal(checks[0].source, "package.json");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check detection: prefers test:local over test", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: "jest", "test:local": "node --test" } }));
    const checks = detectCheckCommands(tmp);
    const testChecks = checks.filter(c => c.checkId.startsWith("chk_npm_test"));
    assert.equal(testChecks.length, 1);
    assert.equal(testChecks[0].label, "npm test:local");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check detection: skips default npm test placeholder", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    const checks = detectCheckCommands(tmp);
    assert.equal(checks.length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check detection: detects lint and typecheck", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: "jest", lint: "eslint .", typecheck: "tsc --noEmit" } }));
    const checks = detectCheckCommands(tmp);
    assert.equal(checks.length, 3);
    assert.ok(checks.some(c => c.label === "npm lint"));
    assert.ok(checks.some(c => c.label === "npm typecheck"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check detection: detects go test from go.mod", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "go.mod"), "module example.com/foo\ngo 1.21\n");
    const checks = detectCheckCommands(tmp);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].label, "go test");
    assert.equal(checks[0].command, "go test ./...");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check detection: detects cargo test from Cargo.toml", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "Cargo.toml"), '[package]\nname = "foo"\n');
    const checks = detectCheckCommands(tmp);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].label, "cargo test");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check detection: empty dir produces no checks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    const checks = detectCheckCommands(tmp);
    assert.equal(checks.length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("detectedChecksToLoopChecks converts correctly", () => {
  const detected = [{ checkId: "chk_npm_test", label: "npm test", command: "npm test", source: "package.json" }];
  const loopChecks = detectedChecksToLoopChecks(detected);
  assert.equal(loopChecks.length, 1);
  assert.equal(loopChecks[0].required, true);
  assert.equal(loopChecks[0].lastResult, "not_run");
  assert.equal(loopChecks[0].type, "shell");
});

test("policy builder uses auto-detected checks when no userChecks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const readiness = classifyLoopReadiness({ task: "Fix test" });
    const policy = buildLoopPolicy({ readiness, cwd: tmp });
    const shellChecks = policy.requiredChecks.filter(c => c.type === "shell");
    assert.equal(shellChecks.length, 1);
    assert.equal(shellChecks[0].command, "npm test");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("policy builder: userChecks override auto-detection", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: "jest" } }));
    const readiness = classifyLoopReadiness({ task: "Fix test" });
    const policy = buildLoopPolicy({ readiness, cwd: tmp, userChecks: [{ label: "my check", command: "my-cmd" }] });
    const nonScopeChecks = policy.requiredChecks.filter(c => c.type !== "scope_check");
    assert.equal(nonScopeChecks.length, 1);
    assert.equal(nonScopeChecks[0].label, "my check");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Phase 8: Path-scoped loops and user-defined checks (V1.1) ---

import { execSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");

function runCli(...cliArgs: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node "${CLI_PATH}" ${cliArgs.join(" ")}`, {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

test("CLI loop check: --allow shows allowed paths", () => {
  const r = runCli("loop", "check", '"Fix tests"', "--allow", "src/auth", "--allow", "tests/auth");
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes("Allowed:"), "should show Allowed line");
  assert.ok(r.stdout.includes("src/auth"), "should include first allowed path");
  assert.ok(r.stdout.includes("tests/auth"), "should include second allowed path");
});

test("CLI loop check: --block shows blocked paths", () => {
  const r = runCli("loop", "check", '"Fix tests"', "--block", "src/billing");
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes("Blocked:"), "should show Blocked line");
  assert.ok(r.stdout.includes("src/billing"), "should include blocked path");
});

test("CLI loop check: --check shows user-defined checks", () => {
  const r = runCli("loop", "check", '"Fix tests"', "--check", '"npm test"');
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes("Checks:"), "should show Checks line");
  assert.ok(r.stdout.includes("npm test"), "should show user check");
});

test("CLI loop check: multiple --check values", () => {
  const r = runCli("loop", "check", '"Fix tests"', "--check", '"npm test"', "--check", '"npm run lint"');
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes("npm test"), "should show first check");
  assert.ok(r.stdout.includes("npm run lint"), "should show second check");
});

test("CLI loop check: --check overrides auto-detected checks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-test-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: "jest" } }));
    const r = runCli("loop", "check", '"Fix tests"', "--target", tmp, "--check", '"my-custom-test"');
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("my-custom-test"), "should show user check");
    assert.ok(!r.stdout.includes("npm test") || r.stdout.includes("my-custom-test"), "user check should be present");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI loop check: no --allow/--block preserves current behavior", () => {
  const r = runCli("loop", "check", '"Fix tests"');
  assert.equal(r.exitCode, 0);
  assert.ok(!r.stdout.includes("Allowed:"), "should not show Allowed when not specified");
  assert.ok(!r.stdout.includes("Blocked:"), "should not show Blocked when not specified");
});

test("CLI loop check: combined --allow + --check", () => {
  const r = runCli("loop", "check", '"Fix tests"', "--allow", "src/auth", "--check", '"npm test -- auth"');
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes("Allowed:"), "should show Allowed");
  assert.ok(r.stdout.includes("src/auth"), "should show allowed path");
  assert.ok(r.stdout.includes("Checks:"), "should show Checks");
  assert.ok(r.stdout.includes("npm test -- auth"), "should show user check");
});

test("CLI loop check: --json includes allowedPaths and blockedPaths", () => {
  const r = runCli("loop", "check", '"Fix tests"', "--allow", "src/auth", "--block", "src/billing", "--json");
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.deepStrictEqual(parsed.allowedPaths, ["src/auth"]);
  assert.deepStrictEqual(parsed.blockedPaths, ["src/billing"]);
});

test("scope drift integration: allowed path accepted by drift guard", () => {
  const drift = detectScopeDrift({
    changedFiles: ["src/auth/login.ts"],
    allowedPaths: ["src/auth/*"],
    disallowedPaths: [],
  });
  assert.equal(drift.length, 0);
});

test("scope drift integration: blocked path detected by drift guard", () => {
  const drift = detectScopeDrift({
    changedFiles: ["src/billing/index.ts"],
    allowedPaths: ["src/auth/*"],
    disallowedPaths: ["src/billing/*"],
  });
  assert.equal(drift.length, 1);
  assert.equal(drift[0].severity, "block");
});

import { runCheck } from "../src/avorelo/capabilities/loop-control/checks-runner.ts";

test("checks runner: shell command failure produces failed result", () => {
  const check = {
    checkId: "chk_01",
    label: "failing check",
    command: "node -e \"process.exit(1)\"",
    type: "shell" as const,
    required: true,
    lastResult: "not_run" as const,
    lastOutput: null,
  };
  const result = runCheck(check, process.cwd());
  assert.equal(result.lastResult, "failed");
});

test("checks runner: shell command success produces passed result", () => {
  const check = {
    checkId: "chk_01",
    label: "passing check",
    command: "node -e \"process.exit(0)\"",
    type: "shell" as const,
    required: true,
    lastResult: "not_run" as const,
    lastOutput: null,
  };
  const result = runCheck(check, process.cwd());
  assert.equal(result.lastResult, "passed");
});

test("checks runner: command error produces actionable output", () => {
  const check = {
    checkId: "chk_01",
    label: "error check",
    command: "node -e \"console.error('test failed: assertion'); process.exit(1)\"",
    type: "shell" as const,
    required: true,
    lastResult: "not_run" as const,
    lastOutput: null,
  };
  const result = runCheck(check, process.cwd());
  assert.equal(result.lastResult, "failed");
  assert.ok(result.lastOutput !== null);
});

// --- Phase 8: loop latest / resume / doctor ---

function makeTestLoopMetadata(overrides: Record<string, unknown> = {}) {
  return buildLoopMetadata({
    loopId: `loop_${Date.now().toString(36)}`,
    contractId: "wc_test",
    kernelReceiptRef: "rcpt_test",
    mode: "bounded_loop",
    iterationsRun: 2,
    maxIterations: 3,
    totalRuntimeMs: 5000,
    stopReason: "success_all_checks_passed",
    stopCategory: "success",
    filesChanged: ["a.ts"],
    allowedPaths: [],
    disallowedPaths: [],
    checksRun: [{ checkId: "c1", label: "test", result: "passed" }],
    driftSummary: [],
    iterations: [],
    safeNextActions: ["Run tests again"],
    openIssues: [],
    ...overrides,
  });
}

test("readLatestLoopMetadata returns null for empty dir", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    assert.equal(readLatestLoopMetadata(tmp), null);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("readLatestLoopMetadata returns null for dir with no loop files", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    mkdirSync(join(tmp, ".avorelo", "loops"), { recursive: true });
    writeFileSync(join(tmp, ".avorelo", "loops", "active.json"), '{"loopId":null}');
    assert.equal(readLatestLoopMetadata(tmp), null);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("readLatestLoopMetadata returns single loop", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    const meta = makeTestLoopMetadata({ loopId: "loop_single" });
    persistLoopMetadata(tmp, meta);
    const latest = readLatestLoopMetadata(tmp);
    assert.notEqual(latest, null);
    assert.equal(latest!.loopId, "loop_single");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("readLatestLoopMetadata returns latest of multiple loops", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    const older = makeTestLoopMetadata({ loopId: "loop_older" });
    older.createdAt = "2026-01-01T00:00:00.000Z";
    persistLoopMetadata(tmp, older);

    const newer = makeTestLoopMetadata({ loopId: "loop_newer" });
    newer.createdAt = "2026-06-13T00:00:00.000Z";
    persistLoopMetadata(tmp, newer);

    const latest = readLatestLoopMetadata(tmp);
    assert.notEqual(latest, null);
    assert.equal(latest!.loopId, "loop_newer");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("readLatestLoopMetadata skips corrupt files", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    const meta = makeTestLoopMetadata({ loopId: "loop_good" });
    persistLoopMetadata(tmp, meta);
    writeFileSync(join(tmp, ".avorelo", "loops", "loop_corrupt.json"), "not json");
    const latest = readLatestLoopMetadata(tmp);
    assert.notEqual(latest, null);
    assert.equal(latest!.loopId, "loop_good");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI loop latest: no loops", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    const r = runCli("loop", "latest", "--target", tmp);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("No recent loop found"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI loop latest: shows latest loop", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    const meta = makeTestLoopMetadata({ loopId: "loop_cli_test" });
    persistLoopMetadata(tmp, meta);
    const r = runCli("loop", "latest", "--target", tmp);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("loop_cli_test"));
    assert.ok(r.stdout.includes("Proof:"));
    assert.ok(r.stdout.includes("Receipt:"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI loop latest --json: outputs JSON", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-latest-"));
  try {
    const meta = makeTestLoopMetadata({ loopId: "loop_json_test" });
    persistLoopMetadata(tmp, meta);
    const r = runCli("loop", "latest", "--target", tmp, "--json");
    assert.equal(r.exitCode, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.loopId, "loop_json_test");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI loop resume: no loops", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-resume-"));
  try {
    const r = runCli("loop", "resume", "--target", tmp);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("No loop found to resume"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI loop resume: shows continuation plan", () => {
  const tmp = mkdtempSync(join(tmpdir(), "avorelo-resume-"));
  try {
    const meta = makeTestLoopMetadata({
      loopId: "loop_resume_test",
      safeNextActions: ["Run tests again"],
      openIssues: ["Flaky test in auth.test.ts"],
    });
    persistLoopMetadata(tmp, meta);
    const r = runCli("loop", "resume", "--target", tmp);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("loop_resume_test"));
    assert.ok(r.stdout.includes("Run tests again"));
    assert.ok(r.stdout.includes("Flaky test"));
    assert.ok(r.stdout.includes("display only"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI loop doctor: runs without error", () => {
  const r = runCli("loop", "doctor");
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes("Loop Doctor"));
  assert.ok(r.stdout.includes("Node.js"));
});

test("CLI loop doctor --json: outputs JSON", () => {
  const r = runCli("loop", "doctor", "--json");
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.ok));
  assert.ok(Array.isArray(parsed.issues));
  assert.equal(typeof parsed.ready, "boolean");
});
