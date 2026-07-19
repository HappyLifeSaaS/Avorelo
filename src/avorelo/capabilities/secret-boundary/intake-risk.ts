// Avorelo Secret Boundary — Intake risk scanner (Phase 2). Local, deterministic. No registry/network lookups.
// Adapted from old PR #109/#126. Scans package scripts / MCP descriptors / skill packs / agent guidance for
// risk SIGNALS. It does NOT claim malware scanning, registry validation, or universal install protection.

export type IntakeRiskCode =
  | "SECRET_EXFIL_SCRIPT"
  | "NETWORK_SCRIPT_PRESENT"
  | "DESTRUCTIVE_SCRIPT_PRESENT"
  | "DEPLOY_SCRIPT_PRESENT"
  | "UNKNOWN_MCP_SOURCE"
  | "WRITE_CAPABLE_MCP"
  | "NETWORK_CAPABLE_MCP"
  | "COMMAND_CAPABLE_MCP"
  | "GUIDANCE_POLICY_BYPASS"
  | "GUIDANCE_AUTO_EXECUTION";

export type IntakeKind = "package_scripts" | "mcp_descriptor" | "skill_pack" | "agent_guidance";

export type IntakeRisk = {
  kind: IntakeKind;
  codes: IntakeRiskCode[];
  severity: "none" | "low" | "medium" | "high";
  reasonCodes: string[];
  redacted: true;
};

const SCRIPT_RULES: { code: IntakeRiskCode; re: RegExp }[] = [
  { code: "SECRET_EXFIL_SCRIPT", re: /(printenv|cat\s+[^\n]*\.env|env\s*\|\s*(curl|wget|nc)|process\.env[\s\S]{0,40}(fetch|curl|http))/i },
  { code: "NETWORK_SCRIPT_PRESENT", re: /\b(curl|wget|nc|netcat|Invoke-WebRequest|fetch\(|https?:\/\/)/i },
  { code: "DESTRUCTIVE_SCRIPT_PRESENT", re: /(rm\s+-rf\s+[\/~]|rmdir\s+\/s|del\s+\/f|mkfs|dd\s+if=|:\(\)\{:\|:&\};:)/i },
  { code: "DEPLOY_SCRIPT_PRESENT", re: /\b(deploy|publish|npm\s+publish|railway\s+up|netlify\s+deploy|vercel\s+--prod|git\s+push\s+.*--force)\b/i },
];

const GUIDANCE_RULES: { code: IntakeRiskCode; re: RegExp }[] = [
  { code: "GUIDANCE_POLICY_BYPASS", re: /\b(bypass|disable|ignore|skip|turn off)\b[^.\n]{0,30}\b(policy|policies|guardrail|safety|security|approval|redaction)\b/i },
  { code: "GUIDANCE_AUTO_EXECUTION", re: /\b(auto[-\s]?(run|execute|deploy)|run automatically|without (asking|approval|confirmation)|silently execute)\b/i },
];

const KNOWN_MCP_HOSTS = /^(localhost|127\.0\.0\.1|stdio|file:)/i;

function sev(codes: IntakeRiskCode[]): IntakeRisk["severity"] {
  if (codes.some((c) => c === "SECRET_EXFIL_SCRIPT" || c === "DESTRUCTIVE_SCRIPT_PRESENT")) return "high";
  if (codes.length >= 2) return "medium";
  if (codes.length === 1) return "low";
  return "none";
}

/** Scan package.json-style scripts (a map of name -> command). */
export function scanPackageScripts(scripts: Record<string, string>): IntakeRisk {
  const codes = new Set<IntakeRiskCode>();
  const reasonCodes: string[] = [];
  for (const [name, cmd] of Object.entries(scripts || {})) {
    for (const { code, re } of SCRIPT_RULES) if (re.test(String(cmd))) { codes.add(code); reasonCodes.push(`${name}:${code}`); }
  }
  const list = Array.from(codes);
  return { kind: "package_scripts", codes: list, severity: sev(list), reasonCodes, redacted: true };
}

/** Scan an MCP server descriptor: { name, source/url, capabilities: string[] }. */
export function scanMcpDescriptor(desc: { name?: string; source?: string; url?: string; capabilities?: string[] }): IntakeRisk {
  const codes = new Set<IntakeRiskCode>();
  const reasonCodes: string[] = [];
  const origin = String(desc.source ?? desc.url ?? "");
  if (!origin || !KNOWN_MCP_HOSTS.test(origin)) { codes.add("UNKNOWN_MCP_SOURCE"); reasonCodes.push(`source:${origin ? "external" : "missing"}`); }
  for (const cap of desc.capabilities ?? []) {
    const c = cap.toLowerCase();
    if (/write|fs|file|edit/.test(c)) codes.add("WRITE_CAPABLE_MCP");
    if (/net|http|fetch|url|web/.test(c)) codes.add("NETWORK_CAPABLE_MCP");
    if (/exec|command|shell|bash|run/.test(c)) codes.add("COMMAND_CAPABLE_MCP");
  }
  const list = Array.from(codes);
  return { kind: "mcp_descriptor", codes: list, severity: sev(list), reasonCodes, redacted: true };
}

/** Scan agent guidance / skill text for policy bypass / auto-execution direction. */
export function scanGuidance(text: string, kind: IntakeKind = "agent_guidance"): IntakeRisk {
  const codes = new Set<IntakeRiskCode>();
  const reasonCodes: string[] = [];
  const t = typeof text === "string" ? text : "";
  for (const { code, re } of [...GUIDANCE_RULES, ...SCRIPT_RULES]) if (re.test(t)) { codes.add(code); reasonCodes.push(code); }
  const list = Array.from(codes);
  return { kind, codes: list, severity: sev(list), reasonCodes, redacted: true };
}
