import { readFileSync, existsSync } from "node:fs";
import type { ProofAdapter, AdapterResult, AdapterEvidence } from "./types.ts";

const PLACEHOLDER_PATTERNS = [
  { pattern: /lorem ipsum/i, label: "lorem_ipsum" },
  { pattern: /\bTODO\b.*\b(copy|text|content|placeholder)\b/i, label: "todo_copy" },
  { pattern: /\bFIXME\b.*\b(copy|text|content)\b/i, label: "fixme_copy" },
  { pattern: /\[insert\s/i, label: "insert_placeholder" },
  { pattern: /xxx+|yyy+|zzz+/i, label: "placeholder_chars" },
  { pattern: /example\.com/i, label: "example_domain" },
  { pattern: /john\.?doe|jane\.?doe/i, label: "placeholder_name" },
];

const FAKE_METRICS_PATTERNS = [
  { pattern: /\b\d{1,3}%\s*(?:reduction|improvement|faster|savings?)\b/i, label: "unsubstantiated_metric" },
  { pattern: /\bsaves?\s+\$[\d,]+/i, label: "unsubstantiated_cost" },
  { pattern: /\b(?:10x|100x|1000x)\s+(?:faster|better|cheaper)/i, label: "multiplier_claim" },
  { pattern: /\b(?:enterprise|unlimited|guaranteed)\b/i, label: "overclaim_word" },
];

const NOISY_UI_PATTERNS = [
  { pattern: /console\.log\(/g, label: "console_log" },
  { pattern: /debugger;/g, label: "debugger_statement" },
  { pattern: /alert\(/g, label: "alert_call" },
];

const WUZ_PATTERNS = [
  { pattern: /\bWuz\b/g, label: "wuz_branding" },
  { pattern: /\bWUZ\b/g, label: "wuz_branding_upper" },
];

function scanProductSurface(filePath: string): AdapterEvidence[] {
  const findings: AdapterEvidence[] = [];
  if (!existsSync(filePath)) return findings;

  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const surfaceExts = ["tsx", "jsx", "vue", "svelte", "html", "css", "scss", "md", "txt", "astro"];
  if (!surfaceExts.includes(ext) && !filePath.includes("site/")) return findings;

  try {
    const content = readFileSync(filePath, "utf-8");

    for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({
          type: "placeholder_copy",
          summary: `Placeholder content: ${label} in ${filePath}`,
          passed: false,
          detail: label,
        });
      }
    }

    for (const { pattern, label } of FAKE_METRICS_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({
          type: "fake_metric",
          summary: `Potential fake metric: ${label} in ${filePath}`,
          passed: false,
          detail: label,
        });
      }
    }

    for (const { pattern, label } of NOISY_UI_PATTERNS) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        findings.push({
          type: "noisy_ui",
          summary: `Noisy UI pattern: ${label} in ${filePath} (${matches.length} occurrence(s))`,
          passed: false,
          detail: `${matches.length} ${label}`,
        });
      }
    }

    for (const { pattern, label } of WUZ_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({
          type: "forbidden_branding",
          summary: `Forbidden branding: ${label} in ${filePath}`,
          passed: false,
          detail: label,
        });
      }
    }
  } catch {
    // skip unreadable
  }

  return findings;
}

export const productSurfaceAdapter: ProofAdapter = {
  id: "product-surface",
  name: "Product Surface",
  description: "Scans for placeholder copy, fake metrics, noisy UI, and forbidden branding",

  detect(): boolean {
    return true;
  },

  canRunAutomatically(): boolean {
    return true;
  },

  async execute(dir: string, changedFiles?: string[]): Promise<AdapterResult> {
    const start = Date.now();
    const evidence: AdapterEvidence[] = [];

    const filesToScan = changedFiles?.slice(0, 100) ?? [];
    for (const f of filesToScan) {
      evidence.push(...scanProductSurface(f));
    }

    const failures = evidence.filter(e => !e.passed);
    if (failures.length === 0) {
      evidence.push({
        type: "product_surface_clean",
        summary: `Product surface clean: ${filesToScan.length} file(s) scanned`,
        passed: true,
      });
    }

    return {
      adapterId: "product-surface",
      status: failures.length > 0 ? "fail" : "pass",
      evidence,
      duration: Date.now() - start,
      containsRawSecret: false,
    };
  },
};
