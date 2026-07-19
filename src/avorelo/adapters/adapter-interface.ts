// Avorelo universal adapter contract. Each AI tool adapter implements this interface.
// Adapters are compatibility layers — Avorelo's product logic lives in Avorelo code.

export type ControlTier = "lifecycle-hooks" | "instruction-only" | "prompt-only" | "post-session-only";

// Tier A: lifecycle-hooks — observe events, block actions, inject live corrections, accumulate evidence
// Tier B: near-live watcher — observe files/git/session state, detect drift, run safe proof (future)
// Tier C: instruction-only — prepare durable guidance in instruction files, cannot block live
// Tier D: prompt-only / post-session — copy-ready prompts, post-session git-diff comparison
export type ControlTierLabel = "A" | "B" | "C" | "D";

export type AdapterDetection = {
  detected: boolean;
  signals: string[];
  instructionSurface: string | null;
};

export type AdapterInstallResult = {
  installed: boolean;
  surfaces: string[];
  warnings: string[];
};

export type AdapterUninstallResult = {
  removed: string[];
  preserved: string[];
};

export type AdapterValidation = {
  valid: boolean;
  issues: string[];
};

export type AgentAdapter = {
  id: string;
  displayName: string;
  controlTier: ControlTier;
  canInjectCorrection: boolean;
  canBlockAction: boolean;

  detect(dir: string): AdapterDetection;
  install(dir: string, guidance?: string): AdapterInstallResult;
  uninstall(dir: string): AdapterUninstallResult;
  validate(dir: string): AdapterValidation;
  getInstructionSurface(dir: string): string | null;
};
