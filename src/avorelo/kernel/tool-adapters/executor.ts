// Tool adapter executor. Connects planning to actual execution.
// Generic delegated task execution for any CLI-based adapter.
// CI uses fake adapters. Risky tasks blocked or approval-gated.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ContextPack } from "../../shared/schemas/index.ts";
import type {
  ToolAdapterId, ToolExecutionPlan, ExecutionMode, FailureClass, DelegatedAdapterConfig, ProofExecutionMetadata,
} from "./types.ts";
import { createToolProofReceipt } from "./receipt.ts";
import { classifyTaskSafety, createSandboxDir, collectSandboxResults, cleanupSandbox, type DelegatedTaskResult } from "./sandbox.ts";

export type ExecutionContext = {
  dir: string;
  task: string;
  now: number;
  approved: boolean;
  useFakeAdapters: boolean;
  contextPack?: ContextPack | null;
};

export type AdapterExecutionResult = {
  adapterId: ToolAdapterId;
  executionMode: ExecutionMode;
  status: "executed" | "blocked" | "failed" | "approval_required" | "skipped";
  output: string | null;
  durationMs: number;
  proofCollected: boolean;
  receiptId: string;
  reasonCodes: string[];
  failureClass: FailureClass | null;
  delegatedTask: DelegatedTaskResult | null;
  proofMetadata?: ProofExecutionMetadata | null;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
};

const SAFE_DETERMINISTIC_COMMANDS: Record<string, string[]> = {
  readiness: ["node", "src/avorelo/surfaces/cli/avorelo.ts", "readiness", "--target", "."],
  status: ["node", "src/avorelo/surfaces/cli/avorelo.ts", "status"],
  build_check: ["npx", "esbuild", "--version"],
  node_version: ["node", "--version"],
  git_status: ["git", "status", "--porcelain"],
};

const SAFE_SCANNER_COMMANDS: Record<string, string[]> = {
  naming_check: ["node", "tools/naming-check.ts"],
  package_check: ["npm", "run", "package:check"],
};

function safeExec(args: string[], dir: string, timeoutMs = 15000): { ok: boolean; stdout: string; stderr: string; exitCode: number | null } {
  const [cmd, ...cmdArgs] = args;
  if (!cmd) return { ok: false, stdout: "", stderr: "UNSAFE_COMMAND_BLOCKED: empty command", exitCode: null };
  try {
    const stdout = execFileSync(cmd, cmdArgs, { cwd: dir, timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
    return { ok: true, stdout: stdout.slice(0, 2000), stderr: "", exitCode: 0 };
  } catch (e: any) {
    return { ok: false, stdout: String(e.stdout ?? "").slice(0, 500), stderr: String(e.message ?? e).slice(0, 500), exitCode: e.status ?? null };
  }
}

export function sanitizeOutput(raw: string): string {
  let s = raw;
  s = s.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED_KEY]");
  s = s.replace(/ANTHROPIC_API_KEY=[^\s]+/g, "ANTHROPIC_API_KEY=[REDACTED]");
  s = s.replace(/OPENAI_API_KEY=[^\s]+/g, "OPENAI_API_KEY=[REDACTED]");
  s = s.replace(/-----BEGIN[^-]*-----[\s\S]*?-----END[^-]*-----/g, "[REDACTED_CERT]");
  s = s.replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED_GH_TOKEN]");
  s = s.replace(/glpat-[a-zA-Z0-9_-]+/g, "[REDACTED_GL_TOKEN]");
  s = s.replace(/xoxb-[a-zA-Z0-9-]+/g, "[REDACTED_SLACK_TOKEN]");
  s = s.replace(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, "[REDACTED_JWT]");
  s = s.replace(/diff --git[\s\S]*?(?=\n(?:diff --git|$))/g, "[REDACTED_GIT_DIFF]");
  return s.slice(0, 2000);
}

function sanitizeTaskForPrompt(task: string): string {
  let s = task;
  s = s.replace(/sk-[a-zA-Z0-9_-]+/g, "[KEY]");
  s = s.replace(/ghp_[a-zA-Z0-9]+/g, "[TOKEN]");
  s = s.replace(/ANTHROPIC_API_KEY=[^\s]+/g, "[ENV]");
  s = s.replace(/OPENAI_API_KEY=[^\s]+/g, "[ENV]");
  return s.slice(0, 200);
}

const SEMGREP_RULES_PATH = join(import.meta.dirname, "fixtures", "semgrep-proof-rules.yml");
const PLAYWRIGHT_FIXTURE_PATH = join(import.meta.dirname, "fixtures", "playwright-proof-fixture.html");
const PLAYWRIGHT_RUNNER_PATH = join(import.meta.dirname, "playwright-proof-runner.mjs");

function hasFakeProofAdapterMode(): boolean {
  return process.env.AVORELO_FAKE_PROOF_ADAPTERS === "1" || process.env.CI === "1" || process.env.CI === "true";
}

function parseJsonOutput(raw: string): any | null {
  try { return JSON.parse(raw); } catch { return null; }
}

function summarizeSemgrepPayload(payload: any): { summary: string; findingCount: number } {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const files = new Set(results.map((r: any) => String(r?.path ?? "unknown")));
  return {
    summary: `semgrep summary: findings=${results.length} files=${files.size}`,
    findingCount: results.length,
  };
}

function summarizeGitHubActionsPayload(payload: any): { summary: string; findingCount: number; artifactCount: number } {
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : Array.isArray(payload?.runs) ? payload.runs : [];
  const failedRuns = runs.filter((r: any) => ["failure", "timed_out", "cancelled", "action_required"].includes(String(r?.conclusion ?? "")));
  const artifactCount = Number(payload?.artifactCount ?? payload?.total_count ?? 0) || 0;
  return {
    summary: `github-actions summary: runs=${runs.length} failed=${failedRuns.length} artifacts=${artifactCount}`,
    findingCount: failedRuns.length,
    artifactCount,
  };
}

function parseGitHubRepoSlug(remote: string): string | null {
  const trimmed = String(remote ?? "").trim();
  const httpsMatch = trimmed.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
  const sshMatch = trimmed.match(/git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
  return null;
}

function buildProofMetadata(
  adapterClass: ProofExecutionMetadata["adapterClass"],
  summary: string,
  findingCount: number,
  artifactCount: number,
  fake: boolean,
  localOnly: boolean,
): ProofExecutionMetadata {
  return {
    adapterClass,
    summary: sanitizeOutput(summary).slice(0, 240),
    findingCount,
    artifactCount,
    fake,
    localOnly,
    sanitized: true,
  };
}

// --- Delegated adapter configs for CLI-based agent executors ---

const DELEGATED_ADAPTER_CONFIGS: Record<string, DelegatedAdapterConfig> = {
  "claude-code": {
    id: "claude-code",
    binaryName: "claude",
    versionFlag: "--version",
    execArgs: (task) => ["-p", task, "--output-format", "json", "--max-turns", "1"],
    outputFormat: "json",
    authDetectionPatterns: ["Not logged in"],
    notInstalledReason: "claude_code_not_installed",
    executionReasonCode: "CLAUDE_CODE_EXECUTION",
    notInstalledReasonCode: "CLAUDE_CODE_NOT_INSTALLED",
    authRequiredReasonCode: "CLAUDE_CODE_AUTH_REQUIRED",
    taskFailedReasonCode: "CLAUDE_CODE_TASK_FAILED",
    taskExecutedReasonCode: "CLAUDE_CODE_TASK_EXECUTED",
  },
  "codex": {
    id: "codex",
    binaryName: "codex",
    versionFlag: "--version",
    execArgs: (task) => ["-q", task],
    outputFormat: "text",
    authDetectionPatterns: ["not authenticated", "Not logged in", "API key"],
    notInstalledReason: "codex_not_installed",
    executionReasonCode: "CODEX_EXECUTION",
    notInstalledReasonCode: "CODEX_NOT_INSTALLED",
    authRequiredReasonCode: "CODEX_AUTH_REQUIRED",
    taskFailedReasonCode: "CODEX_TASK_FAILED",
    taskExecutedReasonCode: "CODEX_TASK_EXECUTED",
  },
  "gemini-cli": {
    id: "gemini-cli",
    binaryName: "gemini",
    versionFlag: "--version",
    execArgs: (task) => ["-p", task],
    outputFormat: "text",
    authDetectionPatterns: ["not authenticated", "Not logged in", "credentials"],
    notInstalledReason: "gemini_cli_not_installed",
    executionReasonCode: "GEMINI_CLI_EXECUTION",
    notInstalledReasonCode: "GEMINI_CLI_NOT_INSTALLED",
    authRequiredReasonCode: "GEMINI_CLI_AUTH_REQUIRED",
    taskFailedReasonCode: "GEMINI_CLI_TASK_FAILED",
    taskExecutedReasonCode: "GEMINI_CLI_TASK_EXECUTED",
  },
  "aider": {
    id: "aider",
    binaryName: "aider",
    versionFlag: "--version",
    execArgs: (task) => ["--message", task, "--yes"],
    outputFormat: "text",
    authDetectionPatterns: ["API key", "api_key", "No model"],
    notInstalledReason: "aider_not_installed",
    executionReasonCode: "AIDER_EXECUTION",
    notInstalledReasonCode: "AIDER_NOT_INSTALLED",
    authRequiredReasonCode: "AIDER_AUTH_REQUIRED",
    taskFailedReasonCode: "AIDER_TASK_FAILED",
    taskExecutedReasonCode: "AIDER_TASK_EXECUTED",
  },
};

export function getDelegatedAdapterConfig(adapterId: ToolAdapterId): DelegatedAdapterConfig | null {
  return DELEGATED_ADAPTER_CONFIGS[adapterId] ?? null;
}

export function registerDelegatedAdapterConfig(config: DelegatedAdapterConfig): void {
  DELEGATED_ADAPTER_CONFIGS[config.id] = config;
}

// --- Command safety validation ---

const SHELL_METACHAR_RE = /[;|&`$(){}[\]<>!\n\r\\]/;

export function validateCommandSafety(binary: string, args: string[]): { safe: boolean; reasonCode: string } {
  if (SHELL_METACHAR_RE.test(binary)) {
    return { safe: false, reasonCode: "UNSAFE_COMMAND_BLOCKED" };
  }
  for (const arg of args) {
    if (SHELL_METACHAR_RE.test(arg)) {
      return { safe: false, reasonCode: "UNSAFE_SHELL_INTERPOLATION_BLOCKED" };
    }
  }
  return { safe: true, reasonCode: "ARGV_SAFE_EXECUTION" };
}

// --- Generic delegated execution (replaces per-adapter functions) ---

function buildDelegatedTaskInput(task: string, contextPack?: ContextPack | null): string {
  const sanitizedTask = sanitizeTaskForPrompt(task);
  if (!contextPack) return sanitizedTask;
  const allowed = contextPack.allowedContext
    .slice(0, 6)
    .map((ref) => `${ref.label} [${ref.includeMode}]`)
    .join("; ");
  const forbidden = contextPack.forbiddenContext
    .slice(0, 4)
    .map((ref) => `${ref.label} (${ref.reasonCode})`)
    .join("; ");
  const instructions = contextPack.toolInstructions.map((line) => `- ${line}`).join("\n");
  return [
    `Task summary: ${contextPack.taskSummary}`,
    `Context consumer: ${contextPack.consumer}`,
    `Selected adapter: ${contextPack.selectedAdapter}`,
    `Proof tier: ${contextPack.proofTier}`,
    allowed ? `Allowed context: ${allowed}` : "",
    forbidden ? `Forbidden context: ${forbidden}` : "",
    instructions ? `Tool instructions:\n${instructions}` : "",
    `User task: ${sanitizedTask}`,
  ].filter(Boolean).join("\n");
}

function runDelegatedExecution(config: DelegatedAdapterConfig, task: string, workDir: string, timeoutMs = 30000, contextPack?: ContextPack | null): DelegatedTaskResult {
  const start = Date.now();
  const sanitizedTask = buildDelegatedTaskInput(task, contextPack);

  const versionResult = safeExec([config.binaryName, config.versionFlag], workDir, 10000);
  if (!versionResult.ok) {
    return {
      success: false, exitCode: null, sanitizedOutput: "", patchSummary: null,
      filesChanged: [], durationMs: Date.now() - start, authRequired: false,
      toolVersion: null, failureReason: config.notInstalledReason,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
    };
  }
  const toolVersion = sanitizeOutput(versionResult.stdout.trim());

  const taskArgs = config.execArgs(sanitizedTask);
  const cmdSafety = validateCommandSafety(config.binaryName, taskArgs);
  if (!cmdSafety.safe) {
    return {
      success: false, exitCode: null, sanitizedOutput: `${cmdSafety.reasonCode}: command blocked`,
      patchSummary: null, filesChanged: [], durationMs: Date.now() - start,
      authRequired: false, toolVersion: null, failureReason: cmdSafety.reasonCode,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
    };
  }

  const execArgs = [config.binaryName, ...taskArgs];
  const execResult = safeExec(execArgs, workDir, timeoutMs);
  const rawOutput = execResult.stdout || execResult.stderr;

  for (const pattern of config.authDetectionPatterns) {
    if (rawOutput.includes(pattern)) {
      return {
        success: false, exitCode: execResult.exitCode,
        sanitizedOutput: `${config.binaryName}: authentication required`,
        patchSummary: null, filesChanged: [], durationMs: Date.now() - start,
        authRequired: true, toolVersion, failureReason: "auth_required",
        containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
      };
    }
  }

  if (config.outputFormat === "json") {
    let parsedResult: any = null;
    try { parsedResult = JSON.parse(rawOutput); } catch { /* not json */ }

    if (!execResult.ok && !parsedResult) {
      return {
        success: false, exitCode: execResult.exitCode,
        sanitizedOutput: sanitizeOutput(rawOutput).slice(0, 500),
        patchSummary: null, filesChanged: [], durationMs: Date.now() - start,
        authRequired: false, toolVersion, failureReason: "execution_failed",
        containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
      };
    }

    const resultText = parsedResult?.result ?? rawOutput;
    const sanitizedSummary = sanitizeOutput(
      typeof resultText === "string" ? resultText : JSON.stringify(resultText),
    ).slice(0, 1000);

    return {
      success: !parsedResult?.is_error,
      exitCode: execResult.exitCode,
      sanitizedOutput: sanitizedSummary,
      patchSummary: parsedResult?.is_error ? null : `${config.binaryName} completed task in ${parsedResult?.num_turns ?? 1} turn(s)`,
      filesChanged: [],
      durationMs: Date.now() - start,
      authRequired: false,
      toolVersion,
      failureReason: parsedResult?.is_error ? "task_error" : null,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
    };
  }

  // Text output format
  if (!execResult.ok) {
    return {
      success: false, exitCode: execResult.exitCode,
      sanitizedOutput: sanitizeOutput(rawOutput).slice(0, 500),
      patchSummary: null, filesChanged: [], durationMs: Date.now() - start,
      authRequired: false, toolVersion, failureReason: "execution_failed",
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
    };
  }

  return {
    success: true, exitCode: 0,
    sanitizedOutput: sanitizeOutput(rawOutput).slice(0, 1000),
    patchSummary: `${config.binaryName} completed task`,
    filesChanged: [], durationMs: Date.now() - start,
    authRequired: false, toolVersion, failureReason: null,
    containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
  };
}

// --- Adapter execution handlers ---

export function executeAdapter(plan: ToolExecutionPlan, ctx: ExecutionContext): AdapterExecutionResult {
  const start = Date.now();
  const adapter = plan.selectedAdapter;

  if (plan.approvalRequired && !ctx.approved) {
    const receipt = createToolProofReceipt(adapter, plan.executionMode, "approval_required", ["APPROVAL_REQUIRED", ...plan.reasonCodes], ctx.now);
    return {
      adapterId: adapter, executionMode: plan.executionMode, status: "approval_required",
      output: null, durationMs: Date.now() - start, proofCollected: false,
      receiptId: receipt.receiptId, reasonCodes: ["APPROVAL_REQUIRED", ...plan.reasonCodes],
      failureClass: null, delegatedTask: null,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  // Delegated adapters (any adapter with a config entry) — fake or real
  const delegatedConfig = getDelegatedAdapterConfig(adapter);
  if (delegatedConfig) {
    if (ctx.useFakeAdapters) {
      return executeFake(adapter, delegatedConfig, plan, ctx, start);
    }
    return executeDelegatedAdapter(delegatedConfig, plan, ctx, start);
  }

  // Built-in adapters
  switch (adapter) {
    case "deterministic-local": return executeDeterministicLocal(plan, ctx, start);
    case "manual-gate": return executeManualGate(plan, ctx, start);
    case "scanner": return executeScanner(plan, ctx, start);
    case "semgrep": return executeSemgrep(plan, ctx, start);
    case "playwright-proof": return executePlaywrightProof(plan, ctx, start);
    case "github-actions": return executeGitHubActionsProof(plan, ctx, start);
    default: {
      // Unknown adapter with no delegated config — block as manual gate
      const reasonCodes = [...plan.reasonCodes, "UNKNOWN_ADAPTER_NO_CONFIG", `ADAPTER:${adapter}`];
      const receipt = createToolProofReceipt(adapter, "manual_gate", "blocked", reasonCodes, ctx.now);
      return {
        adapterId: adapter, executionMode: "manual_gate", status: "blocked",
        output: null, durationMs: Date.now() - start, proofCollected: true,
        receiptId: receipt.receiptId, reasonCodes,
        failureClass: null, delegatedTask: null,
        containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
      };
    }
  }
}

function executeSemgrep(plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const reasonCodes = [...plan.reasonCodes, "SEMGREP_PROOF_EXECUTION"];

  if (ctx.useFakeAdapters || hasFakeProofAdapterMode()) {
    const findingCount = /auth|login|session|secret|security/i.test(ctx.task) ? 2 : 0;
    const proofMetadata = buildProofMetadata("security_scan", `fake semgrep summary: findings=${findingCount}`, findingCount, 0, true, true);
    const receipt = createToolProofReceipt("semgrep", "proof", "executed", [...reasonCodes, "FAKE_CI_PROOF_MODE"], ctx.now);
    return {
      adapterId: "semgrep",
      executionMode: "proof",
      status: "executed",
      output: proofMetadata.summary,
      durationMs: Date.now() - start,
      proofCollected: true,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "FAKE_CI_PROOF_MODE", findingCount > 0 ? "SEMGREP_FINDINGS" : "SEMGREP_CLEAN"],
      failureClass: null,
      delegatedTask: null,
      proofMetadata,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const version = safeExec(["semgrep", "--version"], ctx.dir, 10000);
  if (!version.ok) {
    const receipt = createToolProofReceipt("semgrep", "proof", "planned", [...reasonCodes, "SEMGREP_NOT_INSTALLED"], ctx.now);
    return {
      adapterId: "semgrep",
      executionMode: "proof",
      status: "skipped",
      output: null,
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "SEMGREP_NOT_INSTALLED"],
      failureClass: "not_installed",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const result = safeExec(["semgrep", "--config", SEMGREP_RULES_PATH, "--json", "."], ctx.dir, 30000);
  const payload = parseJsonOutput(result.stdout || result.stderr);
  if (!payload) {
    const receipt = createToolProofReceipt("semgrep", "proof", "failed", [...reasonCodes, "SEMGREP_EXECUTION_FAILED"], ctx.now);
    return {
      adapterId: "semgrep",
      executionMode: "proof",
      status: "failed",
      output: sanitizeOutput(result.stderr || result.stdout),
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "SEMGREP_EXECUTION_FAILED"],
      failureClass: "unknown",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const summary = summarizeSemgrepPayload(payload);
  const proofMetadata = buildProofMetadata("security_scan", summary.summary, summary.findingCount, 0, false, true);
  const receipt = createToolProofReceipt("semgrep", "proof", "executed", [...reasonCodes, summary.findingCount > 0 ? "SEMGREP_FINDINGS" : "SEMGREP_CLEAN"], ctx.now);
  return {
    adapterId: "semgrep",
    executionMode: "proof",
    status: "executed",
    output: proofMetadata.summary,
    durationMs: Date.now() - start,
    proofCollected: true,
    receiptId: receipt.receiptId,
    reasonCodes: [...reasonCodes, summary.findingCount > 0 ? "SEMGREP_FINDINGS" : "SEMGREP_CLEAN"],
    failureClass: null,
    delegatedTask: null,
    proofMetadata,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
  };
}

function executePlaywrightProof(plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const reasonCodes = [...plan.reasonCodes, "PLAYWRIGHT_PROOF_EXECUTION"];

  if (ctx.useFakeAdapters || hasFakeProofAdapterMode()) {
    const proofMetadata = buildProofMetadata("browser_proof", "fake playwright proof: fixture heading visible", 0, 0, true, true);
    const receipt = createToolProofReceipt("playwright-proof", "proof", "executed", [...reasonCodes, "FAKE_CI_PROOF_MODE"], ctx.now);
    return {
      adapterId: "playwright-proof",
      executionMode: "proof",
      status: "executed",
      output: proofMetadata.summary,
      durationMs: Date.now() - start,
      proofCollected: true,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "FAKE_CI_PROOF_MODE", "PLAYWRIGHT_FIXTURE_VERIFIED"],
      failureClass: null,
      delegatedTask: null,
      proofMetadata,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const result = safeExec(["node", PLAYWRIGHT_RUNNER_PATH, PLAYWRIGHT_FIXTURE_PATH], ctx.dir, 30000);
  const payload = parseJsonOutput(result.stdout || result.stderr);
  if (payload?.code === "PLAYWRIGHT_MODULE_NOT_FOUND") {
    const receipt = createToolProofReceipt("playwright-proof", "proof", "planned", [...reasonCodes, "PLAYWRIGHT_NOT_INSTALLED"], ctx.now);
    return {
      adapterId: "playwright-proof",
      executionMode: "proof",
      status: "skipped",
      output: null,
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "PLAYWRIGHT_NOT_INSTALLED"],
      failureClass: "not_installed",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  if (!payload?.ok) {
    const receipt = createToolProofReceipt("playwright-proof", "proof", "failed", [...reasonCodes, "PLAYWRIGHT_PROOF_FAILED"], ctx.now);
    return {
      adapterId: "playwright-proof",
      executionMode: "proof",
      status: "failed",
      output: sanitizeOutput(result.stderr || result.stdout),
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "PLAYWRIGHT_PROOF_FAILED"],
      failureClass: "unknown",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const proofMetadata = buildProofMetadata("browser_proof", `playwright fixture proof: title=${payload.title ?? "n/a"} ctaVisible=${payload.ctaVisible === true}`, 0, 0, false, true);
  const receipt = createToolProofReceipt("playwright-proof", "proof", "executed", [...reasonCodes, "PLAYWRIGHT_FIXTURE_VERIFIED"], ctx.now);
  return {
    adapterId: "playwright-proof",
    executionMode: "proof",
    status: "executed",
    output: proofMetadata.summary,
    durationMs: Date.now() - start,
    proofCollected: true,
    receiptId: receipt.receiptId,
    reasonCodes: [...reasonCodes, "PLAYWRIGHT_FIXTURE_VERIFIED"],
    failureClass: null,
    delegatedTask: null,
    proofMetadata,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
  };
}

function executeGitHubActionsProof(plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const reasonCodes = [...plan.reasonCodes, "GITHUB_ACTIONS_PROOF_EXECUTION"];

  if (/trigger|dispatch|rerun|deploy workflow|release workflow|npm workflow/i.test(ctx.task)) {
    const receipt = createToolProofReceipt("github-actions", "proof", "blocked", [...reasonCodes, "GITHUB_ACTIONS_TRIGGER_BLOCKED"], ctx.now);
    return {
      adapterId: "github-actions",
      executionMode: "proof",
      status: "blocked",
      output: null,
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "GITHUB_ACTIONS_TRIGGER_BLOCKED"],
      failureClass: null,
      delegatedTask: null,
      proofMetadata: buildProofMetadata("ci_readonly", "github-actions proof blocked: read-only adapter", 0, 0, false, false),
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  if (ctx.useFakeAdapters || hasFakeProofAdapterMode()) {
    const summary = summarizeGitHubActionsPayload({
      workflow_runs: [
        { conclusion: "success" },
        { conclusion: "failure" },
        { conclusion: "success" },
      ],
      artifactCount: 2,
    });
    const proofMetadata = buildProofMetadata("ci_readonly", summary.summary, summary.findingCount, summary.artifactCount, true, false);
    const receipt = createToolProofReceipt("github-actions", "proof", "executed", [...reasonCodes, "FAKE_CI_PROOF_MODE"], ctx.now);
    return {
      adapterId: "github-actions",
      executionMode: "proof",
      status: "executed",
      output: proofMetadata.summary,
      durationMs: Date.now() - start,
      proofCollected: true,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "FAKE_CI_PROOF_MODE", summary.findingCount > 0 ? "GITHUB_ACTIONS_FAILURES_FOUND" : "GITHUB_ACTIONS_CLEAN"],
      failureClass: null,
      delegatedTask: null,
      proofMetadata,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const ghVersion = safeExec(["gh", "--version"], ctx.dir, 10000);
  if (!ghVersion.ok) {
    const receipt = createToolProofReceipt("github-actions", "proof", "planned", [...reasonCodes, "GITHUB_ACTIONS_CLI_MISSING"], ctx.now);
    return {
      adapterId: "github-actions",
      executionMode: "proof",
      status: "skipped",
      output: null,
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "GITHUB_ACTIONS_CLI_MISSING"],
      failureClass: "not_installed",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const auth = safeExec(["gh", "auth", "status"], ctx.dir, 10000);
  if (!auth.ok) {
    const receipt = createToolProofReceipt("github-actions", "proof", "planned", [...reasonCodes, "GITHUB_ACTIONS_AUTH_REQUIRED"], ctx.now);
    return {
      adapterId: "github-actions",
      executionMode: "proof",
      status: "skipped",
      output: null,
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "GITHUB_ACTIONS_AUTH_REQUIRED"],
      failureClass: "permission_denied",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const remote = safeExec(["git", "config", "--get", "remote.origin.url"], ctx.dir, 10000);
  const repoSlug = parseGitHubRepoSlug(remote.stdout);
  if (!repoSlug) {
    const receipt = createToolProofReceipt("github-actions", "proof", "failed", [...reasonCodes, "GITHUB_ACTIONS_REMOTE_NOT_FOUND"], ctx.now);
    return {
      adapterId: "github-actions",
      executionMode: "proof",
      status: "failed",
      output: null,
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "GITHUB_ACTIONS_REMOTE_NOT_FOUND"],
      failureClass: "unknown",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const runs = safeExec(["gh", "api", `repos/${repoSlug}/actions/runs?per_page=5`], ctx.dir, 20000);
  const runPayload = parseJsonOutput(runs.stdout || runs.stderr);
  if (!runPayload) {
    const receipt = createToolProofReceipt("github-actions", "proof", "failed", [...reasonCodes, "GITHUB_ACTIONS_READ_FAILED"], ctx.now);
    return {
      adapterId: "github-actions",
      executionMode: "proof",
      status: "failed",
      output: sanitizeOutput(runs.stderr || runs.stdout),
      durationMs: Date.now() - start,
      proofCollected: false,
      receiptId: receipt.receiptId,
      reasonCodes: [...reasonCodes, "GITHUB_ACTIONS_READ_FAILED"],
      failureClass: "unknown",
      delegatedTask: null,
      proofMetadata: null,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };
  }

  const firstRunId = Array.isArray(runPayload.workflow_runs) && runPayload.workflow_runs[0]?.id ? String(runPayload.workflow_runs[0].id) : null;
  let artifactCount = 0;
  if (firstRunId) {
    const artifacts = safeExec(["gh", "api", `repos/${repoSlug}/actions/runs/${firstRunId}/artifacts`], ctx.dir, 20000);
    const artifactPayload = parseJsonOutput(artifacts.stdout || artifacts.stderr);
    artifactCount = Number(artifactPayload?.total_count ?? 0) || 0;
  }

  const summary = summarizeGitHubActionsPayload({ workflow_runs: runPayload.workflow_runs ?? [], artifactCount });
  const proofMetadata = buildProofMetadata("ci_readonly", summary.summary, summary.findingCount, summary.artifactCount, false, false);
  const receipt = createToolProofReceipt("github-actions", "proof", "executed", [...reasonCodes, summary.findingCount > 0 ? "GITHUB_ACTIONS_FAILURES_FOUND" : "GITHUB_ACTIONS_CLEAN"], ctx.now);
  return {
    adapterId: "github-actions",
    executionMode: "proof",
    status: "executed",
    output: proofMetadata.summary,
    durationMs: Date.now() - start,
    proofCollected: true,
    receiptId: receipt.receiptId,
    reasonCodes: [...reasonCodes, summary.findingCount > 0 ? "GITHUB_ACTIONS_FAILURES_FOUND" : "GITHUB_ACTIONS_CLEAN"],
    failureClass: null,
    delegatedTask: null,
    proofMetadata,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
  };
}

function executeDeterministicLocal(plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const reasonCodes = [...plan.reasonCodes, "DETERMINISTIC_LOCAL_EXECUTION"];
  const taskLower = ctx.task.toLowerCase();

  let commandKey = "node_version";
  if (taskLower.includes("readiness") || taskLower.includes("ready")) commandKey = "readiness";
  else if (taskLower.includes("status")) commandKey = "status";
  else if (taskLower.includes("build")) commandKey = "build_check";
  else if (taskLower.includes("git")) commandKey = "git_status";

  const args = SAFE_DETERMINISTIC_COMMANDS[commandKey];
  if (!args) {
    const receipt = createToolProofReceipt("deterministic-local", "deterministic", "failed", ["NO_SAFE_COMMAND_MATCHED"], ctx.now);
    return {
      adapterId: "deterministic-local", executionMode: "deterministic", status: "failed",
      output: null, durationMs: Date.now() - start, proofCollected: false,
      receiptId: receipt.receiptId, reasonCodes: ["NO_SAFE_COMMAND_MATCHED"],
      failureClass: "unknown", delegatedTask: null,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  const result = safeExec(args, ctx.dir);
  reasonCodes.push(`COMMAND:${commandKey}`, result.ok ? "EXECUTION_SUCCESS" : "EXECUTION_FAILED");

  const receipt = createToolProofReceipt("deterministic-local", "deterministic", result.ok ? "executed" : "failed", reasonCodes, ctx.now);
  return {
    adapterId: "deterministic-local", executionMode: "deterministic",
    status: result.ok ? "executed" : "failed",
    output: sanitizeOutput(result.stdout || result.stderr),
    durationMs: Date.now() - start, proofCollected: result.ok,
    receiptId: receipt.receiptId, reasonCodes,
    failureClass: result.ok ? null : "unknown", delegatedTask: null,
    containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
  };
}

function executeManualGate(plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const reasonCodes = [...plan.reasonCodes, "MANUAL_GATE_BLOCKED", "REQUIRES_HUMAN_APPROVAL"];
  const receipt = createToolProofReceipt("manual-gate", "manual_gate", "blocked", reasonCodes, ctx.now);
  return {
    adapterId: "manual-gate", executionMode: "manual_gate", status: "blocked",
    output: null, durationMs: Date.now() - start, proofCollected: true,
    receiptId: receipt.receiptId, reasonCodes,
    failureClass: null, delegatedTask: null,
    containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
  };
}

function executeScanner(plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const reasonCodes = [...plan.reasonCodes, "SCANNER_EXECUTION"];
  const taskLower = ctx.task.toLowerCase();

  let commandKey = "naming_check";
  if (taskLower.includes("package") || taskLower.includes("safety")) commandKey = "package_check";

  const args = SAFE_SCANNER_COMMANDS[commandKey];
  if (!args) {
    const receipt = createToolProofReceipt("scanner", "scanner", "failed", ["NO_SCANNER_COMMAND"], ctx.now);
    return {
      adapterId: "scanner", executionMode: "scanner", status: "failed",
      output: null, durationMs: Date.now() - start, proofCollected: false,
      receiptId: receipt.receiptId, reasonCodes: ["NO_SCANNER_COMMAND"],
      failureClass: "unknown", delegatedTask: null,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  const result = safeExec(args, ctx.dir);
  reasonCodes.push(`SCAN:${commandKey}`, result.ok ? "SCAN_PASS" : "SCAN_FAIL");

  const receipt = createToolProofReceipt("scanner", "scanner", result.ok ? "executed" : "failed", reasonCodes, ctx.now);
  return {
    adapterId: "scanner", executionMode: "scanner",
    status: result.ok ? "executed" : "failed",
    output: sanitizeOutput(result.stdout || result.stderr),
    durationMs: Date.now() - start, proofCollected: result.ok,
    receiptId: receipt.receiptId, reasonCodes,
    failureClass: result.ok ? null : "unknown", delegatedTask: null,
    containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
  };
}

// --- Generic delegated adapter execution (replaces per-adapter executeClaudeCode/executeCodex) ---

function executeDelegatedAdapter(config: DelegatedAdapterConfig, plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const reasonCodes = [...plan.reasonCodes, config.executionReasonCode];
  const taskSafety = classifyTaskSafety(ctx.task);

  if (taskSafety === "forbidden") {
    reasonCodes.push("TASK_FORBIDDEN_FOR_DELEGATED_EXECUTION", "ROUTED_TO_MANUAL_GATE");
    const receipt = createToolProofReceipt(config.id, "manual_gate", "blocked", reasonCodes, ctx.now);
    return {
      adapterId: config.id, executionMode: "manual_gate", status: "blocked",
      output: null, durationMs: Date.now() - start, proofCollected: true,
      receiptId: receipt.receiptId, reasonCodes,
      failureClass: null, delegatedTask: null,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  if (taskSafety === "needs_approval" && !ctx.approved) {
    reasonCodes.push("TASK_NEEDS_APPROVAL_FOR_DELEGATED_EXECUTION");
    const receipt = createToolProofReceipt(config.id, plan.executionMode, "approval_required", reasonCodes, ctx.now);
    return {
      adapterId: config.id, executionMode: plan.executionMode, status: "approval_required",
      output: null, durationMs: Date.now() - start, proofCollected: false,
      receiptId: receipt.receiptId, reasonCodes,
      failureClass: null, delegatedTask: null,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  reasonCodes.push(`TASK_SAFETY:${taskSafety}`);

  const sandbox = taskSafety === "sandbox_safe" ? createSandboxDir(ctx.dir) : null;
  const workDir = sandbox?.sandboxDir ?? ctx.dir;

  const delegated = runDelegatedExecution(config, ctx.task, workDir, 30000, ctx.contextPack ?? null);

  if (sandbox) {
    const results = collectSandboxResults(sandbox.sandboxDir);
    delegated.filesChanged = results.files;
    if (results.files.length > 0) {
      delegated.patchSummary = `sandbox: ${results.summary}`;
    }
    cleanupSandbox(sandbox.sandboxDir);
  }

  if (delegated.failureReason === config.notInstalledReason) {
    reasonCodes.push(config.notInstalledReasonCode, "DELEGATED_EXECUTION_SKIPPED");
    const receipt = createToolProofReceipt(config.id, "dry_run", "planned", reasonCodes, ctx.now);
    return {
      adapterId: config.id, executionMode: "dry_run", status: "skipped",
      output: null, durationMs: Date.now() - start, proofCollected: false,
      receiptId: receipt.receiptId, reasonCodes,
      failureClass: "not_installed", delegatedTask: delegated,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  if (delegated.authRequired) {
    reasonCodes.push(config.authRequiredReasonCode, "DELEGATED_EXECUTION_AUTH_BLOCKED");
    const receipt = createToolProofReceipt(config.id, "real", "blocked", reasonCodes, ctx.now);
    return {
      adapterId: config.id, executionMode: "real", status: "blocked",
      output: delegated.sanitizedOutput, durationMs: Date.now() - start, proofCollected: true,
      receiptId: receipt.receiptId, reasonCodes,
      failureClass: "permission_denied", delegatedTask: delegated,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  if (!delegated.success) {
    reasonCodes.push(config.taskFailedReasonCode, `EXIT_CODE:${delegated.exitCode ?? "null"}`);
    const receipt = createToolProofReceipt(config.id, "real", "failed", reasonCodes, ctx.now);
    return {
      adapterId: config.id, executionMode: "real", status: "failed",
      output: delegated.sanitizedOutput, durationMs: Date.now() - start, proofCollected: false,
      receiptId: receipt.receiptId, reasonCodes,
      failureClass: "unknown", delegatedTask: delegated,
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  reasonCodes.push(config.taskExecutedReasonCode, "REAL_DELEGATED_EXECUTION");
  if (delegated.toolVersion) reasonCodes.push(`TOOL_VERSION:${delegated.toolVersion.slice(0, 30)}`);
  const receipt = createToolProofReceipt(config.id, "real", "executed", reasonCodes, ctx.now);
  return {
    adapterId: config.id, executionMode: "real", status: "executed",
    output: delegated.sanitizedOutput, durationMs: Date.now() - start, proofCollected: true,
    receiptId: receipt.receiptId, reasonCodes,
    failureClass: null, delegatedTask: delegated,
    containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
  };
}

// --- Fake execution for any delegated adapter ---

function executeFake(adapterId: ToolAdapterId, config: DelegatedAdapterConfig, plan: ToolExecutionPlan, ctx: ExecutionContext, start: number): AdapterExecutionResult {
  const adapterLabel = adapterId.toUpperCase().replace(/-/g, "_");
  const reasonCodes = [...plan.reasonCodes, `FAKE_${adapterLabel}_EXECUTION`, "CI_FAKE_ADAPTER"];
  const taskSafety = classifyTaskSafety(ctx.task);
  reasonCodes.push(`TASK_SAFETY:${taskSafety}`);

  if (taskSafety === "forbidden") {
    reasonCodes.push("TASK_FORBIDDEN_EVEN_IN_FAKE_MODE");
    const receipt = createToolProofReceipt(adapterId, "manual_gate", "blocked", reasonCodes, ctx.now);
    return {
      adapterId, executionMode: "manual_gate", status: "blocked",
      output: null, durationMs: Date.now() - start, proofCollected: true,
      receiptId: receipt.receiptId, reasonCodes,
      failureClass: null,
      delegatedTask: {
        success: false, exitCode: null, sanitizedOutput: `[fake] ${adapterId}: task forbidden`,
        patchSummary: null, filesChanged: [], durationMs: Date.now() - start,
        authRequired: false, toolVersion: `fake-${adapterId}-1.0.0`, failureReason: "forbidden",
        containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawModelOutput: false,
      },
      containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
    };
  }

  const fakeTaskResult: DelegatedTaskResult = {
    success: true,
    exitCode: 0,
    sanitizedOutput: `[fake] ${adapterId} executed: ${sanitizeTaskForPrompt(ctx.task)}`,
    patchSummary: `[fake] ${adapterId} completed task: created 1 file, modified 0 files`,
    filesChanged: ["fixture.txt"],
    durationMs: Date.now() - start,
    authRequired: false,
    toolVersion: `fake-${adapterId}-1.0.0`,
    failureReason: null,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawModelOutput: false,
  };

  reasonCodes.push("FAKE_DELEGATED_EXECUTION_COMPLETED");
  const receipt = createToolProofReceipt(adapterId, "real", "executed", reasonCodes, ctx.now);
  return {
    adapterId, executionMode: "real", status: "executed",
    output: fakeTaskResult.sanitizedOutput,
    durationMs: Date.now() - start, proofCollected: true,
    receiptId: receipt.receiptId, reasonCodes,
    failureClass: null, delegatedTask: fakeTaskResult,
    containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
  };
}

// --- Fallback execution ---

export function runToolExecution(plan: ToolExecutionPlan, ctx: ExecutionContext): AdapterExecutionResult {
  const result = executeAdapter(plan, ctx);

  if (result.status === "failed" && plan.fallbackAdapters.length > 0) {
    for (const fallbackId of plan.fallbackAdapters) {
      const fallbackPlan: ToolExecutionPlan = { ...plan, selectedAdapter: fallbackId };
      const fallbackResult = executeAdapter(fallbackPlan, ctx);
      if (fallbackResult.status === "executed" || fallbackResult.status === "blocked") {
        fallbackResult.reasonCodes.push(`FALLBACK_FROM:${plan.selectedAdapter}`, `FALLBACK_TO:${fallbackId}`);
        return fallbackResult;
      }
    }
  }

  return result;
}
