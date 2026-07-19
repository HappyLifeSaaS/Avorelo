import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ContextMemoryItem,
  ContextItemType,
  DiscoveredSource,
  TrustLevel,
  FreshnessStatus,
  ContextSourceKind,
} from "./types.ts";
import { containsSecret, redactText, isSensitivePath } from "./redaction.ts";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function classifyItemType(
  sourceKind: ContextSourceKind,
  path: string,
  content: string,
): ContextItemType {
  const lower = path.toLowerCase();
  const contentLower = content.toLowerCase();

  if (sourceKind === "receipt") return "proof";
  if (sourceKind === "policy") return "policy";
  if (sourceKind === "dashboard_state") return "workstream_state";

  if (lower.includes("agents.md") || lower.includes("claude.md") || lower.includes("cursorrules") || lower.includes("cursor/rules")) {
    return "instruction";
  }
  if (lower.includes("policy") || lower.includes("policies")) return "policy";
  if (lower.includes("pending-features")) return "release_state";
  if (lower.includes("handoff") || lower.includes("release")) return "handoff";
  if (lower.includes("activation")) return "workstream_state";
  if (lower.includes("run-entry")) return "workstream_state";
  if (lower === "package.json") return "dependency";
  if (lower.includes("readme")) return "instruction";
  if (contentLower.includes("constraint") || contentLower.includes("must not") || contentLower.includes("do not")) return "constraint";
  if (contentLower.includes("decision") || contentLower.includes("adr")) return "decision";
  if (contentLower.includes("risk") || contentLower.includes("vulnerability")) return "risk_signal";

  return "artifact";
}

function inferTrust(sourceKind: ContextSourceKind, hasSecret: boolean): { level: TrustLevel; confidence: number; reason: string } {
  if (hasSecret) return { level: "unsafe", confidence: 1.0, reason: "Secret content detected" };
  if (sourceKind === "receipt") return { level: "verified", confidence: 0.95, reason: "Backed by receipt" };
  if (sourceKind === "dashboard_state") return { level: "confirmed", confidence: 0.8, reason: "Dashboard/activation state" };
  if (sourceKind === "policy") return { level: "confirmed", confidence: 0.9, reason: "Explicit policy file" };
  if (sourceKind === "git") return { level: "verified", confidence: 0.9, reason: "Git-backed state" };
  if (sourceKind === "file") return { level: "inferred", confidence: 0.7, reason: "Local file content" };
  if (sourceKind === "external") return { level: "unverified", confidence: 0.3, reason: "External source, not verified" };
  return { level: "inferred", confidence: 0.5, reason: "Default inference" };
}

function inferFreshness(lastModifiedAt: string | null): { status: FreshnessStatus; reason: string } {
  if (!lastModifiedAt) return { status: "unknown", reason: "No modification timestamp" };

  const modified = new Date(lastModifiedAt).getTime();
  const now = Date.now();
  const ageMs = now - modified;
  const oneHour = 3_600_000;
  const oneDay = 86_400_000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;

  if (ageMs < oneHour) return { status: "current", reason: "Modified within the last hour" };
  if (ageMs < oneDay) return { status: "current", reason: "Modified today" };
  if (ageMs < oneWeek) return { status: "recent", reason: "Modified within the last week" };
  if (ageMs < oneMonth) return { status: "stale", reason: "Modified over a week ago" };
  return { status: "expired", reason: "Modified over a month ago" };
}

function checkSafety(content: string, path: string): {
  containsSecret: boolean;
  containsSensitiveData: boolean;
  productionImpact: boolean;
  ownerOnly: boolean;
  agentVisible: boolean;
  redactionRequired: boolean;
  reason: string;
} {
  const hasSecret = containsSecret(content);
  const sensitiveFile = isSensitivePath(path);
  const lower = content.toLowerCase();
  const productionImpact = /production|deploy|publish|release/i.test(lower) && /live|prod|ship/i.test(lower);
  const ownerOnly = /owner[- ]?only|npm publish|netlify deploy --prod/i.test(lower);

  if (hasSecret || sensitiveFile) {
    return {
      containsSecret: hasSecret,
      containsSensitiveData: sensitiveFile,
      productionImpact,
      ownerOnly,
      agentVisible: false,
      redactionRequired: true,
      reason: hasSecret ? "Secret pattern detected" : "Sensitive file path",
    };
  }

  return {
    containsSecret: false,
    containsSensitiveData: false,
    productionImpact,
    ownerOnly,
    agentVisible: true,
    redactionRequired: false,
    reason: "Safe for agent visibility",
  };
}

function extractSummary(content: string, maxLen: number = 200): string {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  const heading = lines.find((l) => /^#{1,3}\s/.test(l));
  if (heading) {
    const desc = lines.find((l) => !l.startsWith("#") && l.trim().length > 10);
    const summary = heading.replace(/^#+\s*/, "") + (desc ? ` — ${desc.trim()}` : "");
    return summary.slice(0, maxLen);
  }

  const first = lines.slice(0, 3).join(" ").trim();
  return first.slice(0, maxLen);
}

export function normalizeSource(
  repoRoot: string,
  source: DiscoveredSource,
  branch?: string,
): ContextMemoryItem[] {
  if (!source.safeToRead) {
    return [{
      id: `ctx_${randomUUID().slice(0, 8)}`,
      schemaVersion: "1.0.0",
      type: "risk_signal",
      summary: `Unsafe content excluded: ${source.path}`,
      textHash: source.hash,
      source: { kind: source.kind, path: source.path, timestamp: source.lastModifiedAt ?? undefined },
      trust: { level: "unsafe", confidence: 1.0, evidenceIds: [], reason: "Unsafe content" },
      freshness: { status: "unknown", reason: "Content not read" },
      scope: { repo: repoRoot, branch },
      safety: {
        containsSecret: true,
        containsSensitiveData: true,
        productionImpact: false,
        ownerOnly: false,
        agentVisible: false,
        redactionRequired: true,
        reason: "Source marked unsafe",
      },
      lifecycle: { status: "candidate" },
    }];
  }

  let content: string;
  try {
    content = readFileSync(join(repoRoot, source.path), "utf-8");
  } catch {
    return [];
  }

  const safety = checkSafety(content, source.path);
  const safeContent = safety.redactionRequired ? redactText(content) : content;
  const type = classifyItemType(source.kind, source.path, content);
  const trust = inferTrust(source.kind, safety.containsSecret);
  const freshness = inferFreshness(source.lastModifiedAt);

  if (source.kind === "receipt" && source.path.endsWith(".json")) {
    return [{
      id: `ctx_${randomUUID().slice(0, 8)}`,
      schemaVersion: "1.0.0",
      type,
      summary: extractSummary(safeContent),
      textHash: hashText(content),
      source: { kind: source.kind, path: source.path, timestamp: source.lastModifiedAt ?? undefined },
      trust: { level: trust.level, confidence: trust.confidence, evidenceIds: [source.id], reason: trust.reason },
      freshness: { status: freshness.status, lastVerifiedAt: source.lastModifiedAt ?? undefined, reason: freshness.reason },
      scope: { repo: repoRoot, branch },
      safety,
      lifecycle: { status: "candidate" },
    }];
  }

  const items: ContextMemoryItem[] = [];
  const sections = splitIntoSections(safeContent);

  for (const section of sections) {
    if (section.trim().length < 5) continue;
    items.push({
      id: `ctx_${randomUUID().slice(0, 8)}`,
      schemaVersion: "1.0.0",
      type,
      summary: extractSummary(section),
      textHash: hashText(section),
      source: { kind: source.kind, path: source.path, timestamp: source.lastModifiedAt ?? undefined },
      trust: { level: trust.level, confidence: trust.confidence, evidenceIds: [], reason: trust.reason },
      freshness: { status: freshness.status, lastVerifiedAt: source.lastModifiedAt ?? undefined, reason: freshness.reason },
      scope: { repo: repoRoot, branch },
      safety,
      lifecycle: { status: "candidate" },
    });
  }

  return items.length > 0 ? items : [{
    id: `ctx_${randomUUID().slice(0, 8)}`,
    schemaVersion: "1.0.0",
    type,
    summary: extractSummary(safeContent),
    textHash: hashText(content),
    source: { kind: source.kind, path: source.path, timestamp: source.lastModifiedAt ?? undefined },
    trust: { level: trust.level, confidence: trust.confidence, evidenceIds: [], reason: trust.reason },
    freshness: { status: freshness.status, lastVerifiedAt: source.lastModifiedAt ?? undefined, reason: freshness.reason },
    scope: { repo: repoRoot, branch },
    safety,
    lifecycle: { status: "candidate" },
  }];
}

function splitIntoSections(content: string): string[] {
  const parts = content.split(/^(?=#{1,3}\s)/m);
  if (parts.length > 1) return parts.filter((p) => p.trim().length > 0);

  if (content.length < 500) return [content];

  const paragraphs = content.split(/\n\n+/);
  if (paragraphs.length > 1) {
    const merged: string[] = [];
    let current = "";
    for (const p of paragraphs) {
      if (current.length + p.length > 500 && current.length > 0) {
        merged.push(current);
        current = p;
      } else {
        current = current ? `${current}\n\n${p}` : p;
      }
    }
    if (current) merged.push(current);
    return merged;
  }

  return [content];
}
