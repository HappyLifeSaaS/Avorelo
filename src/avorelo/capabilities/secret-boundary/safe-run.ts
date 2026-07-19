// Avorelo Secret Boundary — Safe Run controller (Phase 2). Deterministic, local. Adapted from old PR #139
// (avorelo.safeRun.v1). Classifies a command/task string and decides allow / require_approval / block BEFORE
// it runs. Blocks secret-exfiltration and unsafe deploy/destructive flows; allows safe local proof + safe
// remediation. No command is ever executed here — this only decides.

import { detectInString } from "./detector.ts";

export type SafeRunDecision = "allow" | "require_approval" | "block";

export type SafeRunResult = {
  decision: SafeRunDecision;
  category: "safe_local" | "secret_exfiltration" | "deploy_or_publish" | "destructive" | "remediation" | "secret_material" | "unknown";
  reasonCodes: string[];
  safeAlternative: string | null; // a safe next step when blocked (never a raw value)
};

// Secret-exfiltration intents (block / approval, never raw output).
const EXFIL = [
  /\bprint(env| my? env| environment)/i,
  /\bcat\b[^\n]*\.env/i,
  /\b(echo|printf)\b[^\n]*\$(\{)?[A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD)/i,
  /\b(show|reveal|dump|print|leak|exfiltrate|display)\b[^.\n]{0,40}\b(secret|secrets|token|api[_\s-]?key|credential|password|env(?:ironment)? var)/i,
  /\b(read|cat|type)\b[^\n]{0,30}(id_rsa|\.pem|private key|\.ssh\/)/i,
  /\bprintenv\b/i,
  /\benv\s*$/i,
];

// Deploy/publish intents (require approval; may carry secret material).
const DEPLOY = [/\b(deploy|publish|release|ship)\b/i, /\bnpm\s+publish\b/i, /\b(railway|vercel|netlify|fly)\b[^\n]*\b(up|deploy|--prod)/i, /\bgit\s+push\b.*--force/i];

// Destructive intents (require approval / block).
const DESTRUCTIVE = [/\brm\s+-rf\s+[\/~]/i, /\bmkfs\b/i, /\bdd\s+if=/i, /\b(drop|truncate)\s+(database|table)\b/i, /:\(\)\{:\|:&\};:/];

// Safe local proof intents (allow).
const SAFE_LOCAL = [/\b(run|npm run)?\s*tests?\b/i, /\bnpm (run )?(test|build|lint|typecheck)\b/i, /\b(build|lint|typecheck|compile)\b/i, /\bnode --test\b/i, /\bdogfood\b/i];

// Safe remediation intents (allow as a PLAN; no raw value exposure).
const REMEDIATION = [/\b(fix|remediate|remove|rotate|clean up|scrub)\b[^.\n]{0,40}\b(leaked|exposed|hardcoded)?\s*(secret|token|key|credential|password)\b/i, /\bgitignore\b/i, /\b\.env\.example\b/i];

function matches(rules: RegExp[], s: string): boolean {
  return rules.some((r) => r.test(s));
}

/** Decide whether a task/command may run. Deterministic; never executes anything. */
export function evaluateSafeRun(taskOrCommand: string): SafeRunResult {
  const s = typeof taskOrCommand === "string" ? taskOrCommand : "";
  const reasonCodes: string[] = [];

  // Remediation is checked before exfiltration: "fix leaked secret" is allowed as a safe PLAN.
  if (matches(REMEDIATION, s) && !matches(EXFIL, s)) {
    return { decision: "allow", category: "remediation", reasonCodes: ["safe_remediation_plan_only", "no_raw_value_exposure"], safeAlternative: null };
  }

  if (matches(EXFIL, s)) {
    return {
      decision: "block",
      category: "secret_exfiltration",
      reasonCodes: ["secret_exfiltration_blocked", "fail_closed"],
      safeAlternative: "Use a SafeReference to the value (avorelo secret-boundary scan); never print raw secrets.",
    };
  }

  if (matches(DESTRUCTIVE, s)) {
    return { decision: "require_approval", category: "destructive", reasonCodes: ["destructive_command_requires_approval"], safeAlternative: "Confirm scope explicitly before running destructive commands." };
  }

  // A deploy with embedded secret material is more sensitive.
  const carriesSecret = detectInString(s).length > 0;
  if (matches(DEPLOY, s)) {
    return {
      decision: "require_approval",
      category: carriesSecret ? "secret_material" : "deploy_or_publish",
      reasonCodes: carriesSecret ? ["deploy_with_secret_material_requires_approval"] : ["deploy_or_publish_requires_approval"],
      safeAlternative: "Run local proof first; supply secrets via environment, not inline.",
    };
  }

  if (carriesSecret) {
    return { decision: "require_approval", category: "secret_material", reasonCodes: ["command_carries_secret_material"], safeAlternative: "Reference the secret via env placeholder; do not inline it." };
  }

  if (matches(SAFE_LOCAL, s)) {
    return { decision: "allow", category: "safe_local", reasonCodes: ["safe_local_proof_command"], safeAlternative: null };
  }

  return { decision: "allow", category: "unknown", reasonCodes: ["no_secret_risk_detected"], safeAlternative: null };
}
