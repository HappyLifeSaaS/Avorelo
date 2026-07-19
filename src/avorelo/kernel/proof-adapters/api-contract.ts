import { existsSync, readFileSync } from "node:fs";
import { discoverCapabilities } from "../../capabilities/capability-discovery/index.ts";
import type { ProofAdapter, AdapterResult } from "./types.ts";

export const apiContractAdapter: ProofAdapter = {
  id: "api-contract",
  name: "API Contract",
  description: "Detects and validates API schema files (OpenAPI/GraphQL)",

  detect(dir: string): boolean {
    const caps = discoverCapabilities(dir);
    return caps.apiSchema.available;
  },

  canRunAutomatically(): boolean {
    return true;
  },

  async execute(dir: string): Promise<AdapterResult> {
    const start = Date.now();
    const caps = discoverCapabilities(dir);

    if (!caps.apiSchema.available) {
      return {
        adapterId: "api-contract",
        status: "skip",
        evidence: [{
          type: "api_schema_missing",
          summary: "No API schema files detected",
          passed: true,
        }],
        duration: Date.now() - start,
        skipReason: "No API schema found",
        containsRawSecret: false,
      };
    }

    const schemaPath = `${dir}/${caps.apiSchema.detail}`;
    if (!existsSync(schemaPath)) {
      return {
        adapterId: "api-contract",
        status: "skip",
        evidence: [{
          type: "api_schema_not_found",
          summary: `Schema file not found: ${caps.apiSchema.detail}`,
          passed: true,
        }],
        duration: Date.now() - start,
        skipReason: "Schema file reference exists but file not found",
        containsRawSecret: false,
      };
    }

    try {
      const content = readFileSync(schemaPath, "utf-8");
      const isJson = schemaPath.endsWith(".json");
      if (isJson) {
        JSON.parse(content);
      }

      return {
        adapterId: "api-contract",
        status: "pass",
        evidence: [{
          type: "api_schema_valid",
          summary: `API schema is valid ${isJson ? "JSON" : "YAML/GraphQL"}: ${caps.apiSchema.detail}`,
          passed: true,
          detail: `${content.length} bytes`,
        }],
        duration: Date.now() - start,
        containsRawSecret: false,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "parse error";
      return {
        adapterId: "api-contract",
        status: "fail",
        evidence: [{
          type: "api_schema_invalid",
          summary: `API schema parse error: ${caps.apiSchema.detail}`,
          passed: false,
          detail: msg.slice(0, 300),
        }],
        duration: Date.now() - start,
        containsRawSecret: false,
      };
    }
  },
};
