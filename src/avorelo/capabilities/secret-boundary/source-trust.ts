// Avorelo Secret Boundary — Source Trust classifier (Phase 2). Deterministic, local. No LLM/network.
// Adapted from old PR #78 (Agent Security source trust). Classifies where content came from so the
// instruction-risk scanner and runtime gate can decide how much to trust embedded instructions.

export type SourceClass =
  | "local_project"
  | "user_supplied"
  | "external_content"
  | "tool_returned"
  | "generated_by_agent"
  | "unknown";

export type TrustLevel = "trusted" | "limited" | "untrusted";

export type SourceTrust = {
  sourceClass: SourceClass;
  trustLevel: TrustLevel;
  reasonCodes: string[];
  recommendedHandling: "use_normally" | "treat_as_data_only" | "sanitize_before_use" | "require_caution";
};

const TRUST_BY_CLASS: Record<SourceClass, TrustLevel> = {
  local_project: "trusted",
  user_supplied: "limited",
  generated_by_agent: "limited",
  tool_returned: "untrusted",
  external_content: "untrusted",
  unknown: "untrusted",
};

const HANDLING_BY_TRUST: Record<TrustLevel, SourceTrust["recommendedHandling"]> = {
  trusted: "use_normally",
  limited: "treat_as_data_only",
  untrusted: "sanitize_before_use",
};

export type ClassifySourceInput = {
  sourceClass?: SourceClass; // explicit when the caller knows (e.g. a tool adapter)
  origin?: string; // hint string (path, url, "tool:Read", "user", "agent")
};

/** Deterministically classify a content source and derive trust + recommended handling. */
export function classifySource(input: ClassifySourceInput): SourceTrust {
  const reasonCodes: string[] = [];
  let cls: SourceClass = input.sourceClass ?? "unknown";

  if (!input.sourceClass && input.origin) {
    const o = input.origin.toLowerCase();
    if (/^https?:\/\/|external|web|fetched|downloaded/.test(o)) cls = "external_content";
    else if (/^tool:|tool_output|mcp|stdout|stderr/.test(o)) cls = "tool_returned";
    else if (/^user|prompt|chat|message/.test(o)) cls = "user_supplied";
    else if (/^agent|generated|model_output/.test(o)) cls = "generated_by_agent";
    else if (/^(\.\/|src\/|\/|[a-z]:\\)|local|project|repo|readme/.test(o)) cls = "local_project";
    else cls = "unknown";
    reasonCodes.push(`classified_from_origin:${cls}`);
  } else if (input.sourceClass) {
    reasonCodes.push(`explicit_source:${cls}`);
  } else {
    reasonCodes.push("no_origin_unknown");
  }

  const trustLevel = TRUST_BY_CLASS[cls];
  if (trustLevel === "untrusted") reasonCodes.push("instructions_in_source_must_not_be_obeyed");
  return { sourceClass: cls, trustLevel, reasonCodes, recommendedHandling: HANDLING_BY_TRUST[trustLevel] };
}
