import type { WorkMode, ModeDetectionResult, ContextItemType } from "./types.ts";

interface ModeSignals {
  branchName?: string;
  changedFiles?: string[];
  taskText?: string;
  commands?: string[];
  hasReleaseReceipt?: boolean;
  hasProductionApproval?: boolean;
  packageVersionChanged?: boolean;
  hasTestFailures?: boolean;
  hasSecurityFindings?: boolean;
  hasActivationState?: boolean;
}

const MODE_CONTEXT_CLASSES: Record<WorkMode, { required: ContextItemType[]; blocked: string[] }> = {
  feature_development: {
    required: ["policy", "constraint", "workstream_state", "known_issue", "proof"],
    blocked: ["stale_handoff", "unverified_ready_claim"],
  },
  bugfix: {
    required: ["policy", "constraint", "known_issue", "proof", "risk_signal"],
    blocked: ["stale_handoff"],
  },
  release_verification: {
    required: ["policy", "constraint", "proof", "release_state", "workstream_state"],
    blocked: ["unverified_ready_claim"],
  },
  production_release: {
    required: ["policy", "constraint", "proof", "release_state"],
    blocked: ["unverified_ready_claim", "stale_handoff"],
  },
  qa_proof: {
    required: ["policy", "constraint", "proof", "known_issue"],
    blocked: [],
  },
  security_guard: {
    required: ["policy", "constraint", "risk_signal", "proof"],
    blocked: [],
  },
  activation_support: {
    required: ["policy", "workstream_state", "proof"],
    blocked: [],
  },
  docs_product: {
    required: ["policy", "instruction"],
    blocked: [],
  },
  unknown: {
    required: ["policy", "constraint"],
    blocked: ["stale_handoff", "unverified_ready_claim"],
  },
};

const MODE_SAFETY: Record<WorkMode, { constraints: string[]; proof: string[] }> = {
  feature_development: {
    constraints: ["production actions blocked", "npm publish blocked"],
    proof: ["targeted tests", "receipt generated", "context conflicts checked"],
  },
  bugfix: {
    constraints: ["production actions blocked", "npm publish blocked"],
    proof: ["regression tests", "root cause evidence", "receipt generated"],
  },
  release_verification: {
    constraints: ["npm publish blocked without owner approval"],
    proof: ["full test suite", "verification receipt", "release readiness check"],
  },
  production_release: {
    constraints: ["owner approval required", "all tests must pass"],
    proof: ["production verification receipt", "owner approval receipt", "full test suite"],
  },
  qa_proof: {
    constraints: ["production actions blocked"],
    proof: ["test evidence", "proof receipt"],
  },
  security_guard: {
    constraints: ["production actions blocked", "secret exposure blocked"],
    proof: ["security scan receipt", "no secret findings"],
  },
  activation_support: {
    constraints: ["production actions blocked"],
    proof: ["activation receipt"],
  },
  docs_product: {
    constraints: [],
    proof: ["docs reviewed"],
  },
  unknown: {
    constraints: ["production actions blocked", "npm publish blocked", "deploy blocked"],
    proof: ["targeted tests", "receipt generated"],
  },
};

export function detectWorkMode(signals: ModeSignals): ModeDetectionResult {
  const scores: Array<{ mode: WorkMode; score: number; reasons: string[] }> = [];

  scores.push(scoreFeatureDev(signals));
  scores.push(scoreBugfix(signals));
  scores.push(scoreReleaseVerification(signals));
  scores.push(scoreProductionRelease(signals));
  scores.push(scoreQaProof(signals));
  scores.push(scoreSecurityGuard(signals));
  scores.push(scoreActivationSupport(signals));
  scores.push(scoreDocsProduct(signals));

  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  if (best.score < 0.3) {
    return buildResult("unknown", 0.2, ["No strong mode signals detected"], signals);
  }

  if (best.mode === "production_release" && !signals.hasProductionApproval) {
    return buildResult(
      "release_verification",
      best.score * 0.8,
      [...best.reasons, "production_release requires explicit owner approval — downgraded to release_verification"],
      signals,
    );
  }

  return buildResult(best.mode, best.score, best.reasons, signals);
}

function buildResult(mode: WorkMode, confidence: number, signals: string[], _input: ModeSignals): ModeDetectionResult {
  const classes = MODE_CONTEXT_CLASSES[mode];
  const safety = MODE_SAFETY[mode];

  return {
    schemaVersion: "1.0.0",
    detectedMode: mode,
    confidence: Math.min(confidence, 1.0),
    signals,
    requiredContextClasses: classes.required,
    blockedContextClasses: classes.blocked,
    safetyConstraints: safety.constraints,
    requiredProofBeforeCompletion: safety.proof,
  };
}

function scoreFeatureDev(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.branchName && /^feature[/_-]/i.test(s.branchName)) { score += 0.4; reasons.push("branch starts with feature/"); }
  if (s.changedFiles?.some((f) => /^src\//.test(f))) { score += 0.2; reasons.push("changed files under src/"); }
  if (s.taskText && /add|implement|create|build|feature/i.test(s.taskText)) { score += 0.2; reasons.push("task text suggests feature work"); }
  if (!s.hasReleaseReceipt) { score += 0.1; reasons.push("no release approval receipt found"); }

  return { mode: "feature_development", score, reasons };
}

function scoreBugfix(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.branchName && /^(?:fix|bug|hotfix)[/_-]/i.test(s.branchName)) { score += 0.4; reasons.push("branch suggests bugfix"); }
  if (s.taskText && /fix|bug|issue|broken|regression|error/i.test(s.taskText)) { score += 0.3; reasons.push("task text suggests bugfix"); }
  if (s.hasTestFailures) { score += 0.2; reasons.push("test failures detected"); }

  return { mode: "bugfix", score, reasons };
}

function scoreReleaseVerification(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.branchName && /^release[/_-]/i.test(s.branchName)) { score += 0.4; reasons.push("release branch"); }
  if (s.packageVersionChanged) { score += 0.3; reasons.push("package version changed"); }
  if (s.taskText && /release|version|changelog/i.test(s.taskText)) { score += 0.2; reasons.push("task text suggests release"); }

  return { mode: "release_verification", score, reasons };
}

function scoreProductionRelease(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.hasProductionApproval) { score += 0.5; reasons.push("production approval receipt exists"); }
  if (s.taskText && /deploy|production|ship|publish/i.test(s.taskText)) { score += 0.2; reasons.push("task mentions production deploy"); }
  if (s.commands?.some((c) => /deploy|publish/i.test(c))) { score += 0.2; reasons.push("deploy/publish commands detected"); }

  return { mode: "production_release", score, reasons };
}

function scoreQaProof(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.taskText && /qa|quality|test|proof|verify|validate/i.test(s.taskText)) { score += 0.3; reasons.push("task mentions QA/testing"); }
  if (s.commands?.some((c) => /test|prove|verify/i.test(c))) { score += 0.2; reasons.push("test/verify commands detected"); }
  if (s.changedFiles?.every((f) => /test/i.test(f))) { score += 0.3; reasons.push("all changed files are tests"); }

  return { mode: "qa_proof", score, reasons };
}

function scoreSecurityGuard(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.hasSecurityFindings) { score += 0.4; reasons.push("security findings detected"); }
  if (s.taskText && /security|vuln|cve|audit|guard/i.test(s.taskText)) { score += 0.3; reasons.push("task mentions security"); }
  if (s.branchName && /security|audit/i.test(s.branchName)) { score += 0.2; reasons.push("security branch"); }

  return { mode: "security_guard", score, reasons };
}

function scoreActivationSupport(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.hasActivationState) { score += 0.1; reasons.push("activation state exists"); }
  if (s.taskText && /activat|onboard|setup|claim/i.test(s.taskText)) { score += 0.3; reasons.push("task mentions activation"); }
  if (s.changedFiles?.some((f) => /activation/i.test(f))) { score += 0.3; reasons.push("activation files changed"); }

  return { mode: "activation_support", score, reasons };
}

function scoreDocsProduct(s: ModeSignals): { mode: WorkMode; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (s.changedFiles?.every((f) => /\.(md|txt|html|css)$/i.test(f))) { score += 0.4; reasons.push("all changed files are docs/content"); }
  if (s.taskText && /doc|readme|guide|tutorial|article/i.test(s.taskText)) { score += 0.3; reasons.push("task mentions documentation"); }
  if (s.branchName && /docs?[/_-]/i.test(s.branchName)) { score += 0.2; reasons.push("docs branch"); }

  return { mode: "docs_product", score, reasons };
}
