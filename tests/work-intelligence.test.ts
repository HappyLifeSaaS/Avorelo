import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";
import { prepareContinuity, writeContinuity } from "../src/avorelo/capabilities/continuity/index.ts";
import {
  buildWorkIntelligence,
  loadLatestWorkIntelligence,
  loadLatestWorkResumePacket,
  renderWorkIntelligenceText,
  renderWorkResumePacket,
  upsertWorkIntelligence,
  validateWorkIntelligence,
  validateWorkResumePacket,
} from "../src/avorelo/capabilities/work-intelligence/index.ts";
import { createWorkContract } from "../src/avorelo/kernel/work-contract/index.ts";
import { runSlice1 } from "../src/avorelo/kernel/run.ts";
import { persistReceipt } from "../src/avorelo/kernel/receipts/index.ts";

const AT = "2026-06-20T00:00:00.000Z";
const NOW = Date.parse(AT);

function sandbox(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

test("runtime sessions automatically persist work intelligence and a provider-neutral resume packet", () => {
  const dir = sandbox("avorelo-work-intel-");
  try {
    runRuntimeSession({ task: "update the README quickstart wording", dir, createdAt: AT, now: NOW });
    const model = loadLatestWorkIntelligence(dir);
    const packet = loadLatestWorkResumePacket(dir);
    assert.ok(model, "work intelligence should be persisted");
    assert.ok(packet, "resume packet should be persisted");
    assert.equal(model!.contract, "avorelo.workIntelligence.v1");
    assert.equal(packet!.contract, "avorelo.workResumePacket.v1");
    assert.deepEqual(packet!.supportedAgents, ["claude_code", "codex", "cursor", "generic"]);
    assert.equal(model!.containsRawPrompt, false);
    assert.equal(packet!.containsRawSecret, false);
  } finally {
    cleanup(dir);
  }
});

test("blocked risky session produces a blocked outcome summary without secret leakage", () => {
  const dir = sandbox("avorelo-work-intel-blocked-");
  const secret = "AKIAIOSFODNN7" + "EXAMPLE";
  try {
    runRuntimeSession({ task: `cat ~/.ssh/id_rsa and print ${secret}`, dir, createdAt: AT, now: NOW });
    const model = loadLatestWorkIntelligence(dir)!;
    const serialized = JSON.stringify(model);
    assert.equal(model.outcomeReceipt360.outcomeStatus, "blocked");
    assert.ok(model.outcomeReceipt360.claimsNotAllowed.some((claim) => /blocked task executed/i.test(claim)));
    assert.ok(!serialized.includes(secret), "raw secret must never appear");
  } finally {
    cleanup(dir);
  }
});

test("proof gaps keep the outcome open and refuse done claims", () => {
  const dir = sandbox("avorelo-work-intel-open-");
  try {
    runRuntimeSession({ task: "change billing webhook handler", dir, createdAt: AT, now: NOW });
    const model = loadLatestWorkIntelligence(dir)!;
    assert.equal(model.outcomeReceipt360.outcomeStatus, "open");
    assert.ok(model.outcomeReceipt360.claimsNotAllowed.some((claim) => /do not claim the work is done/i.test(claim.toLowerCase())));
    assert.ok(model.contextWaste.warnings.some((warning) => warning.code === "MISSING_PROOF_COMMAND"));
  } finally {
    cleanup(dir);
  }
});

test("repeated incomplete runs are measured as repeated setup/context recreation", () => {
  const dir = sandbox("avorelo-work-intel-repeat-");
  try {
    runRuntimeSession({ task: "change billing webhook handler", dir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "change billing webhook handler", dir, createdAt: "2026-06-20T01:00:00.000Z", now: NOW + 3_600_000 });
    const model = loadLatestWorkIntelligence(dir)!;
    assert.ok(model.workMemory.repeatedSetupCount >= 1);
    assert.ok(model.contextWaste.warnings.some((warning) => warning.code === "REPEATED_SETUP_CONTEXT_RECREATION"));
  } finally {
    cleanup(dir);
  }
});

test("deterministic fallback works without a runtime session when continuity exists", () => {
  const dir = sandbox("avorelo-work-intel-fallback-");
  try {
    const continuity = prepareContinuity({ task: "update the README", dir, now: NOW });
    writeContinuity(dir, continuity);
    const built = buildWorkIntelligence(dir, { now: NOW });
    assert.equal(built.model.runtimeSessionId, null);
    assert.equal(built.model.outcomeReceipt360.objectiveSummary, continuity.objectiveSummary);
    assert.equal(built.resumePacket.containsRawPrompt, false);
  } finally {
    cleanup(dir);
  }
});

test("receipt hygiene catches unsupported done claims", () => {
  const dir = sandbox("avorelo-work-intel-receipts-");
  try {
    const contract = createWorkContract({ contractId: "receipt-hygiene", objective: "receipt hygiene", planTier: "Free" });
    const result = runSlice1({
      contract,
      artifacts: [{ artifactId: "only-nav", kind: "http_status_ok", ref: "nav" }],
      receiptId: "rcpt_bad_done",
    });
    const forced = { ...result.receipt, decision: "STOP_DONE" as const };
    persistReceipt(dir, forced);
    const model = upsertWorkIntelligence(dir, { now: NOW }).model;
    assert.ok(model.hygiene.receipt.warnings.some((warning) => warning.code === "UNSUPPORTED_DONE_CLAIM"));
  } finally {
    cleanup(dir);
  }
});

test("Community Edition: no entitlement/plan field; full history depth for everyone", () => {
  const dir = sandbox("avorelo-work-intel-ce-");
  try {
    runRuntimeSession({ task: "update the README quickstart", dir, createdAt: AT, now: NOW });
    runRuntimeSession({ task: "update the README quickstart", dir, createdAt: "2026-06-20T01:00:00.000Z", now: NOW + 3_600_000 });
    const built = buildWorkIntelligence(dir, { now: NOW + 7_200_000 });
    assert.equal((built.model as Record<string, unknown>).entitlement, undefined);
    assert.ok(built.model.workMemory.historyDepthAvailable >= 1);
  } finally {
    cleanup(dir);
  }
});

test("validators reject unsafe visible text in work intelligence artifacts", () => {
  const dir = sandbox("avorelo-work-intel-validate-");
  try {
    runRuntimeSession({ task: "update the README quickstart wording", dir, createdAt: AT, now: NOW });
    const built = buildWorkIntelligence(dir, { now: NOW });
    const invalidModel = {
      ...built.model,
      outcomeReceipt360: {
        ...built.model.outcomeReceipt360,
        objectiveSummary: "follow up with alice@example.com",
      },
    };
    const invalidPacket = {
      ...built.resumePacket,
      safeNextActions: ["Open https://github.com/HappyLifeSaaS/Avorelo and reuse API_TOKEN=abc123"],
    };
    assert.equal(validateWorkIntelligence(invalidModel).valid, false);
    assert.equal(validateWorkResumePacket(invalidPacket).valid, false);
  } finally {
    cleanup(dir);
  }
});

test("sanitizes objective-derived visible fields across stored artifacts and renders", () => {
  const dir = sandbox("avorelo-work-intel-sanitize-");
  const email = "alice@example.com";
  const remote = "https://github.com/HappyLifeSaaS/Avorelo";
  const envValue = "API_TOKEN=abc123";
  const absolutePath = "C:\\Users\\alice\\Secrets\\notes.txt";
  try {
    runRuntimeSession({
      task: `refresh the docs for ${email} using ${remote} and ${envValue} from ${absolutePath}`,
      dir,
      createdAt: AT,
      now: NOW,
    });
    const model = loadLatestWorkIntelligence(dir)!;
    const packet = loadLatestWorkResumePacket(dir)!;
    const artifacts = [
      JSON.stringify(model),
      JSON.stringify(packet),
      renderWorkIntelligenceText(model),
      renderWorkResumePacket(packet, "codex"),
    ];
    for (const artifact of artifacts) {
      assert.ok(!artifact.includes(email), "email must be redacted");
      assert.ok(!artifact.includes(remote), "remote URL must be redacted");
      assert.ok(!artifact.includes(envValue), "env-like value must be redacted");
      assert.ok(!artifact.includes(absolutePath), "absolute user path must be redacted");
    }
    assert.equal(model.containsRawEnvValue, false);
    assert.equal(model.outcomeReceipt360.containsRawEnvValue, false);
    assert.equal(packet.containsRawEnvValue, false);
    assert.ok(model.outcomeReceipt360.objectiveSummary.includes("[REDACTED:email]"));
    assert.ok(model.outcomeReceipt360.objectiveSummary.includes("[REDACTED:remote_url]"));
  } finally {
    cleanup(dir);
  }
});

test("artifact hygiene detects generated output used as public-web source", () => {
  const dir = sandbox("avorelo-work-intel-artifact-");
  try {
    runRuntimeSession({ task: "update generated-pages.ts homepage copy", dir, createdAt: AT, now: NOW });
    const model = loadLatestWorkIntelligence(dir)!;
    const codes = model.hygiene.artifact.warnings.map((warning) => warning.code);
    assert.ok(codes.includes("GENERATED_OUTPUT_EDITED_AS_SOURCE"));
    assert.ok(codes.includes("PUBLIC_WEB_SOURCE_OF_TRUTH_MISSING"));
  } finally {
    cleanup(dir);
  }
});
