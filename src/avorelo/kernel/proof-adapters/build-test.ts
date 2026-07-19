import { execSync } from "node:child_process";
import { discoverCapabilities } from "../../capabilities/capability-discovery/index.ts";
import type { ProofAdapter, AdapterResult, AdapterEvidence } from "./types.ts";

function runCommand(cmd: string, dir: string): { success: boolean; output: string; duration: number } {
  const start = Date.now();
  try {
    const output = execSync(cmd, {
      cwd: dir,
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output: output.slice(0, 2000), duration: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.slice(0, 2000) : "unknown error";
    return { success: false, output: msg, duration: Date.now() - start };
  }
}

export const buildTestAdapter: ProofAdapter = {
  id: "build-test",
  name: "Build & Test",
  description: "Runs build and test commands detected in the project",

  detect(dir: string): boolean {
    const caps = discoverCapabilities(dir);
    return caps.build.available || caps.test.available;
  },

  canRunAutomatically(): boolean {
    return true;
  },

  async execute(dir: string): Promise<AdapterResult> {
    const start = Date.now();
    const caps = discoverCapabilities(dir);
    const evidence: AdapterEvidence[] = [];
    let overallPass = true;

    if (caps.build.available && caps.build.command) {
      const result = runCommand(caps.build.command, dir);
      evidence.push({
        type: "build_passed",
        summary: result.success ? "Build passed" : "Build failed",
        passed: result.success,
        detail: result.output.slice(0, 500),
      });
      if (!result.success) overallPass = false;
    }

    if (caps.test.available && caps.test.command) {
      const result = runCommand(caps.test.command, dir);
      evidence.push({
        type: "tests_passed",
        summary: result.success ? "Tests passed" : "Tests failed",
        passed: result.success,
        detail: result.output.slice(0, 500),
      });
      if (!result.success) overallPass = false;
    }

    if (caps.typecheck?.available && caps.typecheck.command) {
      const result = runCommand(caps.typecheck.command, dir);
      evidence.push({
        type: "typecheck_passed",
        summary: result.success ? "Typecheck passed" : "Typecheck failed",
        passed: result.success,
        detail: result.output.slice(0, 500),
      });
      if (!result.success) overallPass = false;
    }

    if (caps.lint?.available && caps.lint.command) {
      const result = runCommand(caps.lint.command, dir);
      evidence.push({
        type: "lint_passed",
        summary: result.success ? "Lint passed" : "Lint failed",
        passed: result.success,
        detail: result.output.slice(0, 500),
      });
    }

    if (evidence.length === 0) {
      return {
        adapterId: "build-test",
        status: "skip",
        evidence: [],
        duration: Date.now() - start,
        skipReason: "No build or test commands detected",
        containsRawSecret: false,
      };
    }

    return {
      adapterId: "build-test",
      status: overallPass ? "pass" : "fail",
      evidence,
      duration: Date.now() - start,
      containsRawSecret: false,
    };
  },
};
