export interface AdapterEvidence {
  type: string;
  summary: string;
  passed: boolean;
  detail?: string;
  artifacts?: string[];
}

export interface AdapterResult {
  adapterId: string;
  status: "pass" | "fail" | "skip" | "error";
  evidence: AdapterEvidence[];
  duration: number;
  skipReason?: string;
  errorMessage?: string;
  containsRawSecret: false;
}

export interface ProofAdapter {
  id: string;
  name: string;
  description: string;
  detect: (dir: string) => boolean;
  canRunAutomatically: () => boolean;
  execute: (dir: string, changedFiles?: string[]) => Promise<AdapterResult>;
}
