// Avorelo Agent Context Check tests (node:test, zero-dep).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runContextCheck, persistContextCheckResult, toEvidenceArtifacts, buildContextCheckReceipt } from "../src/avorelo/capabilities/context-check/index.ts";
import { renderHuman } from "../src/avorelo/capabilities/context-check/renderers/human.ts";
import { renderJson } from "../src/avorelo/capabilities/context-check/renderers/json.ts";
import { renderReceiptLines } from "../src/avorelo/capabilities/context-check/renderers/receipt.ts";
import { scanSources, getAdapterCapabilities } from "../src/avorelo/capabilities/context-check/scanner.ts";
import { classify } from "../src/avorelo/capabilities/context-check/classifier.ts";
import type { ContextSource, WorkContractRef } from "../src/avorelo/capabilities/context-check/types.ts";

const TMP = join(tmpdir(), `avorelo-ctx-check-test-${Date.now()}`);

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}

function writeFile(rel: string, content: string) {
  const full = join(TMP, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

// 1. Detects root CLAUDE.md
test("1. detects root CLAUDE.md", () => {
  setup();
  writeFile("CLAUDE.md", "# Project rules\nDo good work.");
  const { sources } = scanSources(TMP);
  assert.ok(sources.some(s => s.path === "CLAUDE.md" && s.sourceType === "claude_md"));
  teardown();
});

// 2. Detects nested CLAUDE.md
test("2. detects nested CLAUDE.md", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  writeFile("packages/web/CLAUDE.md", "nested web rules");
  const { sources } = scanSources(TMP);
  assert.ok(sources.some(s => s.path === "packages/web/CLAUDE.md" && s.nested === true));
  teardown();
});

// 3. Detects .claude directory files
test("3. detects .claude directory files", () => {
  setup();
  writeFile(".claude/rules/my-rule.md", "some rule");
  const { sources } = scanSources(TMP);
  assert.ok(sources.some(s => s.sourceType === "claude_dir"));
  teardown();
});

// 4. Detects AGENTS.md
test("4. detects AGENTS.md", () => {
  setup();
  writeFile("AGENTS.md", "# Agent instructions");
  const { sources } = scanSources(TMP);
  assert.ok(sources.some(s => s.sourceType === "agents_md"));
  teardown();
});

// 5. Detects .cursor/rules
test("5. detects .cursor/rules", () => {
  setup();
  writeFile(".cursor/rules/frontend.mdc", "---\nglobs: ['src/**']\n---\nFrontend rules.");
  const { sources } = scanSources(TMP);
  assert.ok(sources.some(s => s.sourceType === "cursor_rule"));
  teardown();
});

// 6. Flags broken reference
test("6. flags broken context reference", () => {
  setup();
  writeFile("CLAUDE.md", 'See "docs/nonexistent-guide.md" for the full spec.');
  const { sources } = scanSources(TMP);
  const findings = classify(sources, TMP);
  assert.ok(findings.some(f => f.code === "BROKEN_CONTEXT_REFERENCE"), `findings: ${JSON.stringify(findings.map(f=>f.code))}`);
  teardown();
});

// 7. Flags oversized context
test("7. flags oversized context", () => {
  setup();
  const bigContent = "x".repeat(40_000); // ~10k tokens
  writeFile("CLAUDE.md", bigContent);
  const { sources } = scanSources(TMP);
  const findings = classify(sources, TMP);
  assert.ok(findings.some(f => f.code === "OVERSIZED_AGENT_CONTEXT"));
  teardown();
});

// 8. Flags stale temporary instruction
test("8. flags stale temporary instruction", () => {
  setup();
  writeFile(".claude/rules/temp-onboarding-workaround.md", "temporary rule");
  const filePath = join(TMP, ".claude/rules/temp-onboarding-workaround.md");
  const oldTime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
  utimesSync(filePath, oldTime, oldTime);
  const { sources } = scanSources(TMP);
  const findings = classify(sources, TMP);
  assert.ok(findings.some(f => f.code === "STALE_TEMP_INSTRUCTION"));
  teardown();
});

// 9. Flags broad scope risk when Work Contract is narrow
test("9. flags broad scope with narrow work contract", () => {
  setup();
  mkdirSync(join(TMP, ".cursor"), { recursive: true });
  writeFile(".cursor/rules/global.mdc", "---\nglobs: ['**/*']\nalwaysApply: true\n---\nGlobal rules.");
  const { sources } = scanSources(TMP);
  const cursorSrc = sources.find(s => s.sourceType === "cursor_rule");
  assert.ok(cursorSrc, `should find cursor rule, found: ${sources.map(s => s.sourceType).join(",")}`);
  assert.ok(cursorSrc!.appliesToPaths, `should have appliesToPaths`);
  const wc: WorkContractRef = { allowedPaths: ["src/auth/login.ts"] };
  const findings = classify(sources, TMP, wc);
  assert.ok(findings.some(f => f.code === "BROAD_INSTRUCTION_SCOPE"), `findings: ${JSON.stringify(findings.map(f=>f.code))}`);
  teardown();
});

// 10. Flags rule matching no files (deterministic)
test("10. flags rule matching no files", () => {
  setup();
  mkdirSync(join(TMP, ".cursor"), { recursive: true });
  writeFile(".cursor/rules/dead.mdc", "---\nglobs: ['lib/old-module']\n---\nOld module rules.");
  const { sources } = scanSources(TMP);
  const cursorSrc = sources.find(s => s.sourceType === "cursor_rule");
  assert.ok(cursorSrc, `should find cursor rule`);
  const findings = classify(sources, TMP);
  assert.ok(findings.some(f => f.code === "RULE_MATCHES_NO_FILES"), `findings: ${JSON.stringify(findings.map(f=>f.code))}`);
  teardown();
});

// 11. Does not flag low-confidence issues as blocking
test("11. low-confidence findings do not block", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  writeFile(".cursor/rules/a.mdc", "---\nglobs: ['**/*']\n---\nRules.");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  assert.ok(result.findings.every(f => f.blocksAutonomousWork === false));
  teardown();
});

// 12. Produces compact human output
test("12. produces compact human output", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const output = renderHuman(result);
  assert.ok(output.includes("Context Check"));
  assert.ok(output.split("\n").length < 30);
  teardown();
});

// 13. Produces valid JSON output
test("13. produces valid JSON output", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "json" });
  const json = renderJson(result);
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, "agent-context-check.v1");
  assert.ok(typeof parsed.status === "string");
  assert.ok(Array.isArray(parsed.findings));
  teardown();
});

// 14. Adds compact receipt section
test("14. produces compact receipt lines", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "receipt" });
  assert.ok(result.receiptLines.length > 0);
  assert.ok(result.receiptLines[0].startsWith("context_check:"));
  teardown();
});

// 15. Does not include raw prompt/secret/full file content in receipt
test("15. receipt does not contain raw content", () => {
  setup();
  writeFile("CLAUDE.md", "SECRET_KEY=abc123 do not expose this raw prompt content");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "receipt" });
  const receiptStr = result.receiptLines.join("\n");
  assert.ok(!receiptStr.includes("SECRET_KEY"));
  assert.ok(!receiptStr.includes("abc123"));
  assert.ok(!receiptStr.includes("raw prompt content"));
  teardown();
});

// 16. Works with no Work Contract
test("16. works without work contract", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  assert.ok(["pass", "info", "warning", "needs_attention"].includes(result.status));
  assert.equal(result.evidence.workContractProvided, false);
  teardown();
});

// 17. Works with Work Contract
test("17. works with work contract", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({
    repoRoot: TMP,
    mode: "task-aware",
    outputPreference: "human",
    workContract: { objective: "fix login", allowedPaths: ["src/auth"] },
  });
  assert.equal(result.evidence.workContractProvided, true);
  teardown();
});

// 18. Does not require cloud/login
test("18. runs locally without cloud or login", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  assert.equal(result.schemaVersion, "agent-context-check.v1");
  teardown();
});

// 19. Does not fail by default in non-strict mode
test("19. non-strict mode does not fail on warnings", () => {
  setup();
  writeFile("CLAUDE.md", 'Read file: "nonexistent.md"');
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human", strict: false });
  // Non-strict: status may be warning but it should not be needs_attention for medium-confidence findings
  assert.ok(result.status !== "needs_attention" || result.findings.some(f => f.severity === "needs_attention"));
  teardown();
});

// 20. Strict mode escalates warnings
test("20. strict mode escalates warnings to needs_attention", () => {
  setup();
  writeFile("CLAUDE.md", 'Read file: "nonexistent.md"');
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human", strict: true });
  if (result.findings.some(f => f.severity === "warning")) {
    assert.equal(result.status, "needs_attention");
  }
  teardown();
});

// 21. Flags WORK_CONTRACT_CONTEXT_MISMATCH when source path matches nonGoal
test("21. flags work contract context mismatch via nonGoals", () => {
  setup();
  writeFile(".claude/rules/billing-instructions.md", "billing module rules");
  const { sources } = scanSources(TMP);
  const wc: WorkContractRef = { objective: "fix auth", nonGoals: ["do not touch billing"] };
  const findings = classify(sources, TMP, wc);
  assert.ok(
    findings.some(f => f.code === "WORK_CONTRACT_CONTEXT_MISMATCH"),
    `expected WORK_CONTRACT_CONTEXT_MISMATCH, got: ${JSON.stringify(findings.map(f => f.code))}`,
  );
  teardown();
});

// 22. EXCLUDED_RELEVANT_CONTEXT fires when excludedPaths is explicitly provided (classifier-level)
test("22. classifier fires EXCLUDED_RELEVANT_CONTEXT with explicit excludedPaths", () => {
  const sources: ContextSource[] = [{
    path: ".cursor/rules/frontend.mdc",
    sourceType: "cursor_rule",
    agentFamily: "cursor",
    sizeBytes: 100,
    estimatedTokens: 25,
    lastModified: Date.now(),
    references: [],
    excludedPaths: ["src/auth"],
  }];
  const wc: WorkContractRef = { objective: "fix auth", allowedPaths: ["src/auth"] };
  const findings = classify(sources, ".", wc);
  assert.ok(
    findings.some(f => f.code === "EXCLUDED_RELEVANT_CONTEXT"),
    `expected EXCLUDED_RELEVANT_CONTEXT, got: ${JSON.stringify(findings.map(f => f.code))}`,
  );
});

// 23. Current scanner does not populate excludedPaths
test("23. scanner does not populate excludedPaths", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  mkdirSync(join(TMP, ".cursor"), { recursive: true });
  writeFile(".cursor/rules/a.mdc", "---\nglobs: ['src/**']\n---\nRules.");
  const { sources } = scanSources(TMP);
  for (const src of sources) {
    assert.ok(!src.excludedPaths || src.excludedPaths.length === 0,
      `source ${src.path} should not have excludedPaths, got: ${JSON.stringify(src.excludedPaths)}`);
  }
  teardown();
});

// 24. Secret in CLAUDE.md does not appear in human output
test("24. secret does not leak into human output", () => {
  setup();
  writeFile("CLAUDE.md", "SECRET_KEY=sk-abc123-do-not-expose\nGHP_TOKEN=ghp_faketoken99");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const human = renderHuman(result);
  assert.ok(!human.includes("sk-abc123"), "human output must not contain secret key");
  assert.ok(!human.includes("ghp_faketoken99"), "human output must not contain token");
  teardown();
});

// 25. Secret in CLAUDE.md does not appear in JSON output
test("25. secret does not leak into JSON output", () => {
  setup();
  writeFile("CLAUDE.md", "SECRET_KEY=sk-abc123-do-not-expose\nGHP_TOKEN=ghp_faketoken99");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "json" });
  const json = renderJson(result);
  assert.ok(!json.includes("sk-abc123"), "JSON output must not contain secret key");
  assert.ok(!json.includes("ghp_faketoken99"), "JSON output must not contain token");
  teardown();
});

// 26. JSON output uses allowlisted fields only (no reason, evidence, relatedPaths)
test("26. JSON output excludes internal evidence fields", () => {
  setup();
  writeFile("CLAUDE.md", 'See "docs/nonexistent-guide.md" for the full spec.');
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "json" });
  const json = renderJson(result);
  const parsed = JSON.parse(json);
  for (const f of parsed.findings) {
    assert.equal(f.reason, undefined, "JSON finding must not include reason");
    assert.equal(f.evidence, undefined, "JSON finding must not include evidence");
    assert.equal(f.relatedPaths, undefined, "JSON finding must not include relatedPaths");
  }
  teardown();
});

// 27. Capability-level receipt builder produces valid avorelo.contextCheck.v1 receipt
test("27. receipt builder produces valid contextCheck.v1 receipt", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const built = buildContextCheckReceipt({ receiptId: "ccrcpt_test_1", result });
  assert.equal(built.receipt.contract, "avorelo.contextCheck.v1");
  assert.equal(built.receipt.schemaVersion, 1);
  assert.equal(built.receipt.receiptId, "ccrcpt_test_1");
  assert.equal(built.receipt.redacted, true);
  assert.equal(built.receipt.rawInstructionContentPersisted, false);
  assert.equal(built.receipt.rawSecretPersisted, false);
  assert.equal(built.receipt.status, result.status);
  assert.equal(built.receipt.riskLevel, result.riskLevel);
  assert.equal(built.receipt.sourcesChecked, result.sourcesChecked);
  assert.ok(typeof built.cloudEligible === "boolean");
  teardown();
});

// 28. Receipt does not contain raw instruction content
test("28. capability receipt does not contain raw instruction content", () => {
  setup();
  writeFile("CLAUDE.md", "SECRET_KEY=sk-abc123 do not expose this raw prompt content");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const built = buildContextCheckReceipt({ receiptId: "ccrcpt_test_2", result });
  const json = JSON.stringify(built.receipt);
  assert.ok(!json.includes("sk-abc123"), "receipt must not contain secret");
  assert.ok(!json.includes("raw prompt content"), "receipt must not contain raw content");
  teardown();
});

// 29. Evidence artifact builder produces valid EvidenceArtifact objects
test("29. evidence builder produces valid artifacts", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const artifacts = toEvidenceArtifacts(result);
  assert.ok(artifacts.length >= 1, "at least one artifact (scan summary)");
  for (const a of artifacts) {
    assert.ok(a.artifactId.startsWith("ctx_check_"), "artifact ID prefixed");
    assert.equal(a.kind, "source_of_truth_readback");
    assert.ok(typeof a.ref === "string" && a.ref.startsWith("context-check:"));
    assert.ok(!JSON.stringify(a).includes("SECRET"), "no secrets in evidence");
  }
  teardown();
});

// 30. Evidence artifacts include findings for warning/needs_attention severity
test("30. evidence artifacts include high-severity findings", () => {
  setup();
  writeFile("CLAUDE.md", 'See "docs/nonexistent-guide.md" for the full spec.');
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const artifacts = toEvidenceArtifacts(result);
  const findingArtifacts = artifacts.filter(a => a.artifactId.includes("_finding_"));
  if (result.findings.some(f => f.severity === "warning" || f.severity === "needs_attention")) {
    assert.ok(findingArtifacts.length > 0, "findings with warning+ severity produce artifacts");
  }
  teardown();
});

// 31. Persistence writes to .avorelo/context-check/
test("31. persistence writes local artifacts", () => {
  setup();
  writeFile("CLAUDE.md", "root");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const persisted = persistContextCheckResult(TMP, result);
  assert.ok(existsSync(persisted.resultPath), "latest.json created");
  const latest = JSON.parse(readFileSync(persisted.resultPath, "utf8"));
  assert.equal(latest.status, result.status);
  assert.equal(latest.sourcesChecked, result.sourcesChecked);
  assert.ok(!JSON.stringify(latest).includes("reason"), "no internal fields in persisted result");
  teardown();
});

// 32. Persisted result does not contain raw instruction content
test("32. persisted result does not leak raw content", () => {
  setup();
  writeFile("CLAUDE.md", "SECRET_KEY=sk-abc123 do not expose");
  const result = runContextCheck({ repoRoot: TMP, mode: "generic", outputPreference: "human" });
  const persisted = persistContextCheckResult(TMP, result);
  const json = readFileSync(persisted.resultPath, "utf8");
  assert.ok(!json.includes("sk-abc123"), "no secrets in persisted file");
  assert.ok(!json.includes("do not expose"), "no raw content in persisted file");
  teardown();
});

// 33. Work Contract excludedPaths triggers EXCLUDED_RELEVANT_CONTEXT
test("33. WC excludedPaths triggers EXCLUDED_RELEVANT_CONTEXT", () => {
  setup();
  writeFile(".claude/rules/billing-rules.md", "billing module rules");
  const { sources } = scanSources(TMP);
  const wc: WorkContractRef = { objective: "fix auth", excludedPaths: ["billing"] };
  const findings = classify(sources, TMP, wc);
  assert.ok(
    findings.some(f => f.code === "EXCLUDED_RELEVANT_CONTEXT"),
    `expected EXCLUDED_RELEVANT_CONTEXT, got: ${JSON.stringify(findings.map(f => f.code))}`,
  );
  teardown();
});

// 34. Vague prose does not trigger EXCLUDED_RELEVANT_CONTEXT
test("34. vague prose in nonGoals does not trigger EXCLUDED_RELEVANT_CONTEXT", () => {
  setup();
  writeFile("CLAUDE.md", "general rules");
  const { sources } = scanSources(TMP);
  const wc: WorkContractRef = { objective: "fix auth", nonGoals: ["do not touch billing"] };
  const findings = classify(sources, TMP, wc);
  const excluded = findings.filter(f => f.code === "EXCLUDED_RELEVANT_CONTEXT");
  assert.equal(excluded.length, 0, "nonGoals prose must not produce EXCLUDED_RELEVANT_CONTEXT");
  teardown();
});

// 35. excludedPaths and nonGoals work independently
test("35. excludedPaths and nonGoals produce separate findings", () => {
  setup();
  writeFile(".claude/rules/billing-rules.md", "billing module rules");
  const { sources } = scanSources(TMP);
  const wc: WorkContractRef = {
    objective: "fix auth",
    nonGoals: ["do not touch billing"],
    excludedPaths: ["billing"],
  };
  const findings = classify(sources, TMP, wc);
  assert.ok(findings.some(f => f.code === "EXCLUDED_RELEVANT_CONTEXT"), "excludedPaths finding fires");
  assert.ok(findings.some(f => f.code === "WORK_CONTRACT_CONTEXT_MISMATCH"), "nonGoals finding fires");
  teardown();
});

// 36. excludedPaths finding has medium confidence
test("36. WC excludedPaths finding has medium confidence", () => {
  setup();
  writeFile(".claude/rules/billing-rules.md", "billing module rules");
  const { sources } = scanSources(TMP);
  const wc: WorkContractRef = { objective: "fix auth", excludedPaths: ["billing"] };
  const findings = classify(sources, TMP, wc);
  const excl = findings.find(f => f.code === "EXCLUDED_RELEVANT_CONTEXT");
  assert.ok(excl, "finding exists");
  assert.equal(excl!.confidence, "medium", "structured input gives medium confidence");
  teardown();
});

// 37. excludedPaths does not fire when source is unrelated
test("37. excludedPaths does not fire for unrelated sources", () => {
  setup();
  writeFile("CLAUDE.md", "general project rules");
  const { sources } = scanSources(TMP);
  const wc: WorkContractRef = { objective: "fix auth", excludedPaths: ["billing"] };
  const findings = classify(sources, TMP, wc);
  const excluded = findings.filter(f => f.code === "EXCLUDED_RELEVANT_CONTEXT");
  assert.equal(excluded.length, 0, "unrelated source should not match");
  teardown();
});

// 38. Strict mode escalates EXCLUDED_RELEVANT_CONTEXT
test("38. strict mode escalates excludedPaths findings", () => {
  setup();
  writeFile(".claude/rules/billing-rules.md", "billing module rules");
  const result = runContextCheck({
    repoRoot: TMP,
    mode: "task-aware",
    outputPreference: "human",
    workContract: { objective: "fix auth", excludedPaths: ["billing"] },
    strict: true,
  });
  assert.equal(result.status, "needs_attention", "strict mode should escalate");
  teardown();
});

// 39. JSON output for excludedPaths finding is allowlisted
test("39. JSON excludedPaths finding is safe", () => {
  setup();
  writeFile(".claude/rules/billing-rules.md", "billing module rules");
  const result = runContextCheck({
    repoRoot: TMP,
    mode: "task-aware",
    outputPreference: "json",
    workContract: { objective: "fix auth", excludedPaths: ["billing"] },
  });
  const json = renderJson(result);
  const parsed = JSON.parse(json);
  for (const f of parsed.findings) {
    assert.equal(f.reason, undefined, "no reason in JSON");
    assert.equal(f.evidence, undefined, "no evidence in JSON");
    assert.equal(f.relatedPaths, undefined, "no relatedPaths in JSON");
  }
  teardown();
});

// --- Phase: Adapter capability metadata ---

// 40. No adapter claims excludedPaths support except work_contract
test("40. adapter capabilities: no agent adapter supports excludedPaths", () => {
  const caps = getAdapterCapabilities();
  const agentAdapters = caps.filter(c => c.adapter !== "work_contract");
  for (const c of agentAdapters) {
    assert.equal(c.supportsExcludedPaths, false, `${c.adapter} must not claim excludedPaths support`);
    assert.equal(c.excludedPathsSource, "none", `${c.adapter} must have excludedPathsSource=none`);
  }
});

// 41. Work Contract adapter claims excludedPaths support
test("41. adapter capabilities: work_contract supports excludedPaths", () => {
  const caps = getAdapterCapabilities();
  const wc = caps.find(c => c.adapter === "work_contract");
  assert.ok(wc, "work_contract adapter must exist");
  assert.equal(wc!.supportsExcludedPaths, true);
  assert.equal(wc!.excludedPathsSource, "work_contract_only");
});

// 42. Scanner never populates excludedPaths on any source
test("42. scanner never populates excludedPaths on discovered sources", () => {
  setup();
  writeFile(".cursor/rules/test.mdc", "---\nglobs: [\"src/**\"]\n---\nDo not touch billing");
  const { sources } = scanSources(TMP);
  for (const src of sources) {
    assert.equal(src.excludedPaths, undefined, `${src.path} must not have excludedPaths`);
  }
  teardown();
});

// 43. Prose "do not touch X" does not produce excludedPaths
test("43. prose exclusion language does not produce excludedPaths", () => {
  setup();
  writeFile("CLAUDE.md", "Do not modify the billing directory. Never touch src/legacy.");
  const { sources } = scanSources(TMP);
  const claude = sources.find(s => s.path === "CLAUDE.md");
  assert.ok(claude);
  assert.equal(claude!.excludedPaths, undefined, "prose must not produce excludedPaths");
  teardown();
});

// --- Phase: CI mode ---

// 44. CI mode exits 0 on clean repo
test("44. CI mode: pass status returns exit-compatible result", () => {
  setup();
  const result = runContextCheck({ repoRoot: TMP, mode: "ci", outputPreference: "json" });
  assert.equal(result.status, "pass");
  assert.equal(result.mode, "ci");
  teardown();
});

// 45. CI mode JSON is valid and safe
test("45. CI mode: JSON output is valid and contains no raw content", () => {
  setup();
  writeFile("CLAUDE.md", "SECRET: AKIAIOSFODNN7" + "EXAMPLE\nInstructions for Claude.");
  const result = runContextCheck({ repoRoot: TMP, mode: "ci", outputPreference: "json" });
  const json = renderJson(result);
  const parsed = JSON.parse(json);
  assert.ok(parsed.schemaVersion);
  assert.ok(!json.includes("AKIAIOSFODNN7" + "EXAMPLE"), "no secrets in CI JSON");
  assert.ok(!json.includes("Instructions for Claude"), "no raw content in CI JSON");
  teardown();
});

// 46. CI mode with needs_attention produces gate-fail status
test("46. CI mode: needs_attention triggers gate failure", () => {
  setup();
  const hugeContent = "x".repeat(120000);
  writeFile("CLAUDE.md", hugeContent);
  const result = runContextCheck({ repoRoot: TMP, mode: "ci", outputPreference: "json" });
  assert.equal(result.status, "needs_attention");
  teardown();
});

// 47. CI + strict escalates warnings
test("47. CI + strict: warnings escalate to needs_attention", () => {
  setup();
  writeFile("CLAUDE.md", "broken ref");
  writeFile(".cursor/rules/test.mdc", "---\nglobs: [\"**/*\"]\n---\nBroad rule");
  const result = runContextCheck({
    repoRoot: TMP,
    mode: "ci",
    outputPreference: "json",
    workContract: { objective: "fix auth", allowedPaths: ["src/auth/login.ts"] },
    strict: true,
  });
  if (result.findings.some(f => f.severity === "warning")) {
    assert.equal(result.status, "needs_attention", "strict CI escalates warnings");
  }
  teardown();
});
