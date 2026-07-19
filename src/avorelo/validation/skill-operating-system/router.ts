// Avorelo Skill OS Router. Selects skills by task frame. No all-skills-always.
import { REGISTRY, type RegistryItem } from "./registry.ts";

export type TaskFrame = {
  taskType: string;
  changedFiles: string[];
  touchedLayers: string[];
  riskClass: "low" | "medium" | "high";
  browserAvailable: boolean;
  deepMode: boolean;
  paymentTouched: boolean;
  dashboardTouched: boolean;
  publicCopyTouched: boolean;
  mcpTouched: boolean;
  skillConfigTouched: boolean;
};

export type RouteResult = {
  selected: RegistryItem[];
  skipped: RegistryItem[];
  whySelected: Record<string, string>;
  whySkipped: Record<string, string>;
  estimatedLatencyMs: number;
  estimatedContextCost: string;
};

export function routeSkills(frame: TaskFrame): RouteResult {
  const active = REGISTRY.filter(i => i.currentStatus === "active");
  const selected: RegistryItem[] = [];
  const skipped: RegistryItem[] = [];
  const whySelected: Record<string, string> = {};
  const whySkipped: Record<string, string> = {};

  for (const item of active) {
    // Anti-trigger check first
    if (frame.riskClass === "low" && item.antiTriggers.includes("low_risk_docs_only") && frame.taskType === "docs") {
      skipped.push(item); whySkipped[item.id] = "anti-trigger: low_risk_docs_only"; continue;
    }
    if (!frame.browserAvailable && (item.adoptionDecision === "BACKLOG_REQUIRES_BROWSER" || item.activationTriggers.includes("ui_change_with_browser"))) {
      skipped.push(item); whySkipped[item.id] = "browser unavailable"; continue;
    }
    // High-cost on low-risk
    if (item.contextCost === "high" && frame.riskClass === "low" && !frame.deepMode) {
      skipped.push(item); whySkipped[item.id] = "high-cost on low-risk without deep mode"; continue;
    }

    // Trigger matching
    let triggered = false;
    if (item.activationTriggers.includes("always_on_lightweight")) triggered = true;
    if (frame.mcpTouched && item.activationTriggers.some(t => t.includes("mcp") || t.includes("tool_config"))) triggered = true;
    if (frame.skillConfigTouched && item.activationTriggers.some(t => t.includes("skill") || t.includes("agent"))) triggered = true;
    if (frame.paymentTouched && item.activationTriggers.some(t => t.includes("payment") || t.includes("security"))) triggered = true;
    if (frame.dashboardTouched && item.activationTriggers.some(t => t.includes("dashboard") || t.includes("receipt"))) triggered = true;
    if (frame.publicCopyTouched && item.activationTriggers.some(t => t.includes("public") || t.includes("value") || t.includes("claim"))) triggered = true;
    if (frame.touchedLayers.includes("Kernel") && item.activationTriggers.some(t => t.includes("architecture") || t.includes("capability"))) triggered = true;
    if (frame.riskClass === "high" && item.category.includes("security")) triggered = true;
    if (frame.deepMode) triggered = true; // deep mode selects all active

    if (triggered) {
      selected.push(item); whySelected[item.id] = "trigger matched";
    } else {
      skipped.push(item); whySkipped[item.id] = "no trigger matched";
    }
  }

  const totalLatency = selected.reduce((s, i) => s + i.latencyBudgetMs, 0);
  const highCost = selected.filter(i => i.contextCost === "high").length;

  return { selected, skipped, whySelected, whySkipped, estimatedLatencyMs: totalLatency, estimatedContextCost: highCost > 0 ? "high" : selected.length > 20 ? "medium" : "low" };
}
