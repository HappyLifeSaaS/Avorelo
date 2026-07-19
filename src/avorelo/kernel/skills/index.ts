// Avorelo-native skills layer. Reusable task workflows that map to adapter execution.
// Skills are selected implicitly — user describes intent, Avorelo picks the skill.
// Skills are hidden by default; details in --verbose/control-center only.

import type { ToolAdapterId } from "../tool-adapters/types.ts";
import { createHash } from "node:crypto";

export type SkillSafetyClass = "safe" | "needs_approval" | "forbidden";

export type SkillDefinition = {
  id: string;
  name: string;
  triggerPatterns: RegExp[];
  preferredAdapter: ToolAdapterId;
  fallbackAdapter: ToolAdapterId;
  safetyClass: SkillSafetyClass;
  taskTemplate: (userIntent: string) => string;
  hidden: true;
};

export type SkillExecutionReceipt = {
  contract: "avorelo.skillReceipt.v1";
  receiptId: string;
  skillId: string;
  skillName: string;
  selectedAdapter: ToolAdapterId;
  safetyClass: SkillSafetyClass;
  executed: boolean;
  reasonCodes: string[];
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
  createdAt: number;
};

export type SkillSelectionResult = {
  matched: SkillDefinition | null;
  allSkipped: string[];
  reasonCodes: string[];
};

const SKILL_REGISTRY: SkillDefinition[] = [
  {
    id: "skill-format",
    name: "Format Code",
    triggerPatterns: [/\b(format|prettier|fmt)\b/i],
    preferredAdapter: "deterministic-local",
    fallbackAdapter: "deterministic-local",
    safetyClass: "safe",
    taskTemplate: (intent) => `format code: ${intent}`,
    hidden: true,
  },
  {
    id: "skill-lint",
    name: "Lint Check",
    triggerPatterns: [/\b(lint|eslint|check\s+style)\b/i],
    preferredAdapter: "scanner",
    fallbackAdapter: "deterministic-local",
    safetyClass: "safe",
    taskTemplate: (intent) => `lint: ${intent}`,
    hidden: true,
  },
  {
    id: "skill-test",
    name: "Run Tests",
    triggerPatterns: [/\b(run\s+test|test\s+suite|npm\s+test)\b/i],
    preferredAdapter: "deterministic-local",
    fallbackAdapter: "deterministic-local",
    safetyClass: "safe",
    taskTemplate: (intent) => `test: ${intent}`,
    hidden: true,
  },
  {
    id: "skill-scaffold",
    name: "Scaffold File",
    triggerPatterns: [/\b(scaffold|create\s+file|generate\s+file|stub|boilerplate)\b/i],
    preferredAdapter: "claude-code",
    fallbackAdapter: "codex",
    safetyClass: "safe",
    taskTemplate: (intent) => `scaffold: ${intent}`,
    hidden: true,
  },
  {
    id: "skill-status",
    name: "Check Status",
    triggerPatterns: [/\b(status|readiness|check\s+health|doctor)\b/i],
    preferredAdapter: "deterministic-local",
    fallbackAdapter: "deterministic-local",
    safetyClass: "safe",
    taskTemplate: (intent) => `status: ${intent}`,
    hidden: true,
  },
];

export function selectSkill(userIntent: string): SkillSelectionResult {
  const reasonCodes: string[] = [];
  const allSkipped: string[] = [];
  const intentLower = userIntent.toLowerCase();

  for (const skill of SKILL_REGISTRY) {
    const matched = skill.triggerPatterns.some(p => p.test(intentLower));
    if (matched) {
      reasonCodes.push(`SKILL_MATCHED:${skill.id}`);
      return { matched: skill, allSkipped, reasonCodes };
    }
    allSkipped.push(skill.id);
  }

  reasonCodes.push("NO_SKILL_MATCHED");
  return { matched: null, allSkipped, reasonCodes };
}

export function getSkillRegistry(): SkillDefinition[] {
  return [...SKILL_REGISTRY];
}

export function createSkillReceipt(
  skill: SkillDefinition,
  selectedAdapter: ToolAdapterId,
  executed: boolean,
  reasonCodes: string[],
  now: number,
): SkillExecutionReceipt {
  const receiptId = "skr_" + createHash("sha256")
    .update(`${skill.id}:${selectedAdapter}:${executed}:${now}`)
    .digest("hex").slice(0, 12);

  return {
    contract: "avorelo.skillReceipt.v1",
    receiptId,
    skillId: skill.id,
    skillName: skill.name,
    selectedAdapter,
    safetyClass: skill.safetyClass,
    executed,
    reasonCodes,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
    createdAt: now,
  };
}
