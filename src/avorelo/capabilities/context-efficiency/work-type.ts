import { classifyTask } from "../../kernel/work-contract/task-parser.ts";

import type { ContextEfficiencyWorkType } from "./types.ts";

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function inferContextEfficiencyWorkType(task: string, refs: string[] = []): ContextEfficiencyWorkType {
  const normalizedTask = task.toLowerCase();
  const normalizedRefs = refs.join(" ").toLowerCase();
  const corpus = `${normalizedTask} ${normalizedRefs}`;
  const classified = classifyTask(task);

  if (has(corpus, /\b(dashboard|ux|ui|settings|sidebar|layout|visual)\b/)) return "dashboard_ux";
  if (has(corpus, /\b(public web|public-web|landing|pricing|signup\.html|login\.html|article|seo|copy)\b/) || has(corpus, /surfaces\/public-web\/static\//)) {
    return "public_site";
  }
  if (has(corpus, /\b(billing|payment|invoice|subscription|checkout|entitlement|webhook)\b/)) return "billing_or_entitlement";
  if (has(corpus, /\b(secret|credential|security|privacy|auth|session|token)\b/)) return "security_review";
  if (has(corpus, /\b(release|publish|deploy|production|go live|dist-tag|tag)\b/)) return "release_preparation";
  if (has(corpus, /\b(readme|docs?|documentation|copy edit|changelog|markdown)\b/) || classified === "docs") return "documentation";
  if (has(corpus, /\b(bug|fix|broken|repair|regression)\b/)) return "bug_fix";
  if (has(corpus, /\b(test|spec|flake|failing test|ci)\b/) || classified === "testing") return "test_repair";
  if (has(corpus, /\b(feature|implement|build|add|create|support)\b/)) return "feature_development";
  return "unknown";
}
