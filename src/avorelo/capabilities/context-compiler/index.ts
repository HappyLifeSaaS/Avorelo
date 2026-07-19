// Avorelo Context Compiler Lite v1 (Phase 4, Layer 3). Deterministic, local, bounded, secret-safe.
// Replaces "give the AI the whole repo" with a bounded `avorelo.contextPacket.v1`. Consumes Phase 3
// (EnrichedWorkContract + routing) and Phase 2 (Secret Boundary). NO token/cost savings claims (Phase 6).
// Hard rule: context optimization can never override the Safety Boundary or lower the proof tier.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decideRouting } from "../../kernel/work-contract/routing.ts";
import { scanContent } from "../secret-boundary/index.ts";
import { classifySource } from "../secret-boundary/source-trust.ts";
import { scanInstructionRisk } from "../secret-boundary/instruction-risk.ts";
import { extractPaths, classifyTask } from "../../kernel/work-contract/task-parser.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import type {
  ContextPacket,
  ContextPack,
  ContextPackAllowedItem,
  ContextPackConsumer,
  ContextPackSyncMetadata,
  ContextPacketSyncMetadata,
  SelectedRef,
  ExcludedRef,
  ContextBudgetV1,
  ContextTargetSize,
  RefKind,
  RefIncludeMode,
  ProofTier,
  SafeReference,
} from "../../shared/schemas/index.ts";

// A source the caller wants considered for context (e.g. fetched/tool-returned content). Optional.
export type CandidateSource = { label: string; origin?: string; content?: string };

export type CompileInput = {
  task: string;
  dir: string;
  sources?: CandidateSource[]; // untrusted/external candidates classified as data-only
  createdAt?: string; // injectable ISO for deterministic tests
};

export type BuildContextPackInput = {
  packet: ContextPacket;
  selectedAdapter: string;
  consumer?: ContextPackConsumer;
  reviewerOfAdapter?: string | null;
  relevantReceipts?: string[];
  sanitizedDiffSummary?: string | null;
};

const SENSITIVE = /\b(auth|login|signup|session|billing|payment|invoice|subscription|webhook|security|permission|drizzle|migration|deploy|production)\b/i;
const EXCLUDE_PATH = /(^|\/)\.env(\.|$)|\/\.ssh\/|\.pem$|id_rsa|\.aws\/credentials|secrets?\.(json|ya?ml|txt)/i;

function refKind(label: string): RefKind {
  if (/\/$/.test(label) || /^(src|lib|app|docs|tests?|config)$/i.test(label)) return "directory";
  if (/\.(md|mdx|txt)$/i.test(label) || /readme|changelog/i.test(label)) return "doc";
  if (/\.test\.|\.spec\.|(^|\/)tests?\//i.test(label)) return "test";
  if (/\.(json|ya?ml|toml|config\.\w+)$/i.test(label) || /(^|\/)config(\/|$)/i.test(label)) return "config";
  if (/\.\w+$/.test(label)) return "file";
  return "unknown";
}

function proofNeededFor(tier: ProofTier): string[] {
  switch (tier) {
    case "production": return ["production verification (manual)", "tests pass", "browser proof"];
    case "browser": return ["browser proof", "tests pass"];
    case "tests": return ["tests pass"];
    case "local": return ["local check (build/lint)"];
    default: return [];
  }
}

function budgetFor(route: string, risk: string): ContextBudgetV1 {
  if (route === "blocked") return { targetSize: "tiny", estimatedContextCost: "low", reason: "blocked task — safe summary only" };
  if (route === "needs_decision") return { targetSize: "tiny", estimatedContextCost: "low", reason: "needs decision — no context expansion before scope is confirmed" };
  if (risk === "high" || risk === "critical") return { targetSize: "small", estimatedContextCost: "medium", reason: "sensitive task — bounded, sanitized refs only" };
  const size: ContextTargetSize = "small";
  return { targetSize: size, estimatedContextCost: "low", reason: "scoped task — compact targeted packet" };
}

/** Compile a bounded, secret-safe context packet for a task. Deterministic; never includes raw secrets. */
export function compileContext(input: CompileInput): ContextPacket {
  const routing = decideRouting({ task: input.task, dir: input.dir });
  const c = routing.contract;
  const createdAt = input.createdAt ?? new Date().toISOString();

  // SafeReferences for any secret found in the task (raw value never stored).
  const taskScan = scanContent({ content: input.task, sourceKind: "instruction" });
  const safeReferences: SafeReference[] = taskScan.safeReferences;

  const riskFlags = [
    ...c.safetyBoundary.secretRiskCodes,
    ...c.safetyBoundary.instructionRisk,
    c.safetyBoundary.sourceTrustRisk !== "trusted" ? `source_trust:${c.safetyBoundary.sourceTrustRisk}` : "",
  ].filter(Boolean);

  const selectedRefs: SelectedRef[] = [];
  const excludedRefs: ExcludedRef[] = [];

  const highRisk = c.riskClass === "high" || c.riskClass === "critical";
  const sensitiveMode: RefIncludeMode = highRisk ? "path_only" : "summary";

  // Blocked / needs_decision: no execution packet. Return a safe, minimal packet.
  const expand = c.route !== "blocked" && c.route !== "needs_decision";

  if (expand) {
    // 0) Secret/credential FILE mentions in the task text are excluded up front. extractPaths does not
    // surface dotfiles like ".env", so scan the task directly. Labels are categorized, never echoed raw.
    const EXCLUDE_MENTION = /(?:^|\s)(\.env(?:\.\w+)?|[\w./-]*id_rsa[\w./-]*|[\w./-]+\.pem|[\w./-]*\.ssh\/[\w./-]*|[\w./-]*\.aws\/credentials)/gi;
    const excludedSeen = new Set<string>();
    for (const m of input.task.matchAll(EXCLUDE_MENTION)) {
      const label = classifyExcludedLabel(m[1]);
      if (excludedSeen.has(label)) continue;
      excludedSeen.add(label);
      excludedRefs.push({ label, reason: "credential/secret file named in task", safetyReasonCode: "secret_file_excluded", canReconsiderWithApproval: false });
    }

    // 1) Explicit paths named in the task are the primary candidates.
    for (const p of extractPaths(input.task)) {
      if (EXCLUDE_PATH.test(p)) {
        excludedRefs.push({ label: classifyExcludedLabel(p), reason: "credential/secret file", safetyReasonCode: "secret_file_excluded", canReconsiderWithApproval: false });
        continue;
      }
      const sensitive = SENSITIVE.test(p);
      selectedRefs.push({
        kind: refKind(p),
        label: p,
        reason: "named in task",
        authority: sensitive ? "supporting" : "source_of_truth",
        freshness: "unknown",
        includeMode: sensitive ? sensitiveMode : highRisk ? "summary" : "excerpt",
        safety: sensitive ? "sensitive" : "safe",
      });
    }

    // 2) Task-type defaults (bounded — a couple of directory refs, path_only).
    const t = classifyTask(input.task);
    const add = (label: string, kind: RefKind, reason: string, sensitive = false) =>
      selectedRefs.push({ kind, label, reason, authority: "supporting", freshness: "unknown", includeMode: sensitive ? sensitiveMode : "path_only", safety: sensitive ? "sensitive" : "safe" });
    if (t === "testing") add("tests/**", "directory", "test task → test refs");
    if (t === "docs") { add("docs/**", "directory", "docs task → docs refs"); add("README.md", "doc", "docs entry point"); }
    if (t === "deployment") add(".github/**", "directory", "deploy task → CI config", true);
    if (SENSITIVE.test(input.task) && selectedRefs.length === 0) add("(sensitive scope)", "unknown", "sensitive keyword in task", true);
  }

  // 3) Classify any external/tool-returned candidate sources as data-only or exclude injection.
  for (const src of input.sources ?? []) {
    const trust = classifySource({ origin: src.origin ?? "external" });
    const instr = src.content ? scanInstructionRisk(src.content, { sourceClass: "external_content" }) : null;
    if (instr && (instr.action === "block" || instr.action === "quarantine_source" || instr.codes.includes("PROMPT_INJECTION") || instr.codes.includes("HIDDEN_INSTRUCTIONS"))) {
      excludedRefs.push({ label: src.label, reason: "prompt-injection / hidden instruction in untrusted source", safetyReasonCode: "instruction_risk_excluded", canReconsiderWithApproval: false });
      continue;
    }
    selectedRefs.push({ kind: "unknown", label: src.label, reason: `untrusted source (${trust.sourceClass}) — treat as data only`, authority: "unknown", freshness: "unknown", includeMode: "summary", safety: "sensitive" });
  }

  const contextBudget = budgetFor(c.route, c.riskClass);
  const proofNeeded = proofNeededFor(c.proofTier);

  const packet: ContextPacket = {
    contract: "avorelo.contextPacket.v1",
    schemaVersion: 1,
    createdAt,
    workContractId: c.contractId,
    objective: c.objective, // already redacted by routing
    route: c.route,
    riskClass: c.riskClass,
    proofTier: c.proofTier,
    approvalPolicy: c.approvalPolicy,
    selectedRefs,
    excludedRefs,
    safeReferences,
    riskFlags,
    proofNeeded,
    contextBudget,
    redacted: true,
    containsRawSecret: false,
    containsRawPrompt: false,
    containsRawSourceDump: false,
    cloudEligible: false,
  };

  // `cloudEligible` is the eligibility of the SANITIZED PROJECTION only — the full packet is local-only and
  // is never synced. We check the projection (counts/codes/status) through the Phase-1 allowlist policy.
  const elig = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: buildContextPacketSyncMetadata(packet), reasonCodes: ["REDACTED"] });
  packet.cloudEligible = elig.eligible;

  return packet;
}

// A sensitive path is never echoed verbatim into an excluded-ref label — use a category.
function classifyExcludedLabel(path: string): string {
  if (/\.env/i.test(path)) return "env file (excluded)";
  if (/\.pem$|id_rsa|\.ssh/i.test(path)) return "private key file (excluded)";
  return "credential file (excluded)";
}

/**
 * Build the ONLY sync-safe projection of a ContextPacket: metadata only (counts/status/risk/proof + codes).
 * The full ContextPacket (objective, selectedRefs, excludedRefs, ref labels, paths) is LOCAL-ONLY and must
 * NEVER be synced. This projection carries no objective, no ref arrays, no labels, no paths, no task text.
 */
export function buildContextPacketSyncMetadata(p: ContextPacket): ContextPacketSyncMetadata {
  return {
    contract: "avorelo.contextPacket.sync.v1",
    workContractId: p.workContractId,
    route: p.route,
    riskClass: p.riskClass,
    proofTier: p.proofTier,
    approvalPolicy: p.approvalPolicy,
    selectedCount: p.selectedRefs.length,
    excludedCount: p.excludedRefs.length,
    safeReferenceCount: p.safeReferences.length,
    riskFlags: p.riskFlags, // codes only
    contextBudget: p.contextBudget.targetSize,
    redacted: true,
    timestamp: p.createdAt,
  };
}

function contextPackId(seed: string): string {
  return "ctp_" + createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

function buildProvenanceTags(selectedAdapter: string, consumer: ContextPackConsumer, refs: ContextPackAllowedItem[]): string[] {
  const tags = new Set<string>([
    `adapter:${selectedAdapter}`,
    `consumer:${consumer}`,
  ]);
  for (const ref of refs) {
    tags.add(`kind:${ref.kind}`);
    tags.add(`authority:${ref.authority}`);
    tags.add(`freshness:${ref.freshness}`);
    tags.add(`mode:${ref.includeMode}`);
    tags.add(`safety:${ref.safety}`);
  }
  return [...tags];
}

function buildToolInstructions(selectedAdapter: string, consumer: ContextPackConsumer): string[] {
  const shared = [
    "Use only the allowed context in this pack.",
    "Do not persist raw prompt, source, diff, DOM, terminal output, or secrets.",
  ];
  if (consumer === "reviewer") {
    return [
      ...shared,
      "Review proof and patch summaries only; do not request the full executor prompt or full repo dump.",
      "Consensus is signal, not proof; verifier or manual gate wins when evidence is incomplete.",
    ];
  }
  if (selectedAdapter === "semgrep") {
    return [...shared, "Summarize findings only; do not persist raw source in receipts."];
  }
  if (selectedAdapter === "playwright-proof") {
    return [...shared, "Use local fixture or local page only; do not persist screenshots or raw DOM."];
  }
  if (selectedAdapter === "github-actions") {
    return [...shared, "Read-only CI status and artifact summaries only; do not trigger workflows."];
  }
  if (selectedAdapter === "deterministic-local" || selectedAdapter === "scanner") {
    return [...shared, "Prefer deterministic local checks before heavy agents."];
  }
  return [...shared, "Use bounded task context only; request manual gate if the pack is insufficient."];
}

function mapAllowedContext(refs: SelectedRef[], consumer: ContextPackConsumer): ContextPackAllowedItem[] {
  return refs.map((ref) => ({
    kind: ref.kind,
    label: ref.label,
    includeMode: consumer === "reviewer" && ref.includeMode === "excerpt" ? "summary" : ref.includeMode,
    authority: ref.authority,
    freshness: ref.freshness,
    safety: ref.safety,
  }));
}

export function buildContextPack(input: BuildContextPackInput): ContextPack {
  const consumer = input.consumer ?? "executor";
  const allowedContext = mapAllowedContext(input.packet.selectedRefs, consumer);
  const provenanceTags = buildProvenanceTags(input.selectedAdapter, consumer, allowedContext);
  const contextReasonCodes = [
    `CONSUMER:${consumer}`,
    `ADAPTER:${input.selectedAdapter}`,
    `BUDGET:${input.packet.contextBudget.targetSize}`,
    `ROUTE:${input.packet.route}`,
    `RISK:${input.packet.riskClass}`,
    ...input.packet.riskFlags.map((f) => `RISK_FLAG:${f}`),
    ...input.packet.excludedRefs.map((r) => `EXCLUDED:${r.safetyReasonCode}`),
  ];

  return {
    contract: "avorelo.contextPack.v1",
    schemaVersion: 1,
    contextPackId: contextPackId(`${input.packet.workContractId}:${consumer}:${input.selectedAdapter}:${input.packet.createdAt}`),
    createdAt: input.packet.createdAt,
    workContractId: input.packet.workContractId,
    consumer,
    selectedAdapter: input.selectedAdapter,
    reviewerOfAdapter: input.reviewerOfAdapter ?? null,
    taskSummary: input.packet.objective,
    riskClass: input.packet.riskClass,
    proofTier: input.packet.proofTier,
    approvalPolicy: input.packet.approvalPolicy,
    allowedContext,
    forbiddenContext: input.packet.excludedRefs.map((ref) => ({
      label: ref.label,
      reasonCode: ref.safetyReasonCode,
      canReconsiderWithApproval: ref.canReconsiderWithApproval,
    })),
    redactionPolicy: {
      noRawSecrets: true,
      noRawPromptHistory: true,
      noRawSourcePersistence: true,
      noRawDiffPersistence: true,
      noRawDomPersistence: true,
      summarizedSensitiveContextOnly: true,
    },
    provenanceTags,
    maxContextBudget: input.packet.contextBudget.targetSize,
    contextSizeEstimate: input.packet.contextBudget.estimatedContextCost,
    contextBudgetUsed: allowedContext.length + input.packet.safeReferences.length,
    contextReasonCodes,
    safeForModel: true,
    safeForPersistence: true,
    relevantReceipts: [...(input.relevantReceipts ?? [])],
    sanitizedDiffSummary: input.sanitizedDiffSummary ?? null,
    toolInstructions: buildToolInstructions(input.selectedAdapter, consumer),
    redacted: true,
    containsRawSecret: false,
    containsRawPrompt: false,
    containsRawSourceDump: false,
  };
}

export function buildContextPackSyncMetadata(p: ContextPack): ContextPackSyncMetadata {
  return {
    contract: "avorelo.contextPack.sync.v1",
    contextPackId: p.contextPackId,
    workContractId: p.workContractId,
    consumer: p.consumer,
    selectedAdapter: p.selectedAdapter,
    reviewerOfAdapter: p.reviewerOfAdapter,
    riskClass: p.riskClass,
    proofTier: p.proofTier,
    approvalPolicy: p.approvalPolicy,
    allowedCount: p.allowedContext.length,
    forbiddenCount: p.forbiddenContext.length,
    provenanceTagCount: p.provenanceTags.length,
    maxContextBudget: p.maxContextBudget,
    contextBudgetUsed: p.contextBudgetUsed,
    contextReasonCodes: p.contextReasonCodes,
    safeForModel: p.safeForModel,
    safeForPersistence: p.safeForPersistence,
    redacted: true,
    timestamp: p.createdAt,
  };
}

function contextPackDir(dir: string): string {
  return join(dir, ".avorelo", "context");
}

export function writeContextPacket(dir: string, packet: ContextPacket): { path: string; cloudEligible: boolean } {
  const d = contextPackDir(dir);
  mkdirSync(d, { recursive: true });
  const path = join(d, "context.latest.json");
  writeFileSync(path, JSON.stringify(packet, null, 2));
  appendFileSync(join(d, "context.history.jsonl"), JSON.stringify(buildContextPacketSyncMetadata(packet)) + "\n");
  return { path, cloudEligible: packet.cloudEligible };
}

export function loadLatestContextPacket(dir: string): ContextPacket | null {
  const path = join(contextPackDir(dir), "context.latest.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as ContextPacket; } catch { return null; }
}

export function writeContextPack(dir: string, pack: ContextPack): { path: string } {
  const d = contextPackDir(dir);
  mkdirSync(d, { recursive: true });
  const path = join(d, "context-pack.latest.json");
  writeFileSync(path, JSON.stringify(pack, null, 2));
  appendFileSync(join(d, "context-pack.history.jsonl"), JSON.stringify(buildContextPackSyncMetadata(pack)) + "\n");
  return { path };
}

export function loadLatestContextPack(dir: string): ContextPack | null {
  const path = join(contextPackDir(dir), "context-pack.latest.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as ContextPack; } catch { return null; }
}
