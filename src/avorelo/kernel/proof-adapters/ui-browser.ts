import { discoverCapabilities } from "../../capabilities/capability-discovery/index.ts";
import type { ProofAdapter, AdapterResult } from "./types.ts";

export const uiBrowserAdapter: ProofAdapter = {
  id: "ui-browser",
  name: "UI Browser Proof",
  description: "Detects browser tooling (Playwright/Puppeteer) and reports availability for UI proof",

  detect(dir: string): boolean {
    const caps = discoverCapabilities(dir);
    return caps.browserTooling.available;
  },

  canRunAutomatically(): boolean {
    return false;
  },

  async execute(dir: string): Promise<AdapterResult> {
    const start = Date.now();
    const caps = discoverCapabilities(dir);

    if (!caps.browserTooling.available) {
      return {
        adapterId: "ui-browser",
        status: "skip",
        evidence: [{
          type: "browser_tooling_missing",
          summary: "No browser tooling (Playwright/Puppeteer) detected",
          passed: true,
          detail: "Install Playwright or Puppeteer to enable UI proof",
        }],
        duration: Date.now() - start,
        skipReason: "No browser tooling detected in project",
        containsRawSecret: false,
      };
    }

    return {
      adapterId: "ui-browser",
      status: "skip",
      evidence: [{
        type: "browser_tooling_detected",
        summary: `Browser tooling detected: ${caps.browserTooling.detail}`,
        passed: true,
        detail: "Browser proof available but requires manual execution or E2E test runner",
      }],
      duration: Date.now() - start,
      skipReason: "Browser proof requires explicit E2E test execution",
      containsRawSecret: false,
    };
  },
};
