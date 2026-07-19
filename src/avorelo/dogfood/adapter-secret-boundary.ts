// Avorelo Adapter Secret Boundary Dogfood. Proves the direct handleLifecycleHook PostToolUse path
// returns redacted mutation fields and never leaks raw secrets. Local-only, synthetic fixtures only.

import { handleLifecycleHook } from "../adapters/claude-code/index.ts";
import { createWorkContract } from "../kernel/work-contract/index.ts";

const FX = {
  gh: "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789",
  aws: "AKIA1234567" + "890ABCD99",
  privKey: "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEowIBAAKCAQEAfake\n-----END RSA PRIVATE KEY-----",
  stripe: "sk_live_ABCDEF" + "GHIJKLMNOPQRSTUVWX",
  dbUrl: "postgres://admin:hun" + "ter2pwd@db.internal:5432/app",
};

function hasRaw(secret: string, blob: unknown): boolean {
  try { return JSON.stringify(blob).includes(secret); } catch { return false; }
}

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });

  const contract = createWorkContract({ contractId: "test", objective: "test", allowedPaths: ["src/"], planTier: "Free" });

  // 1. PostToolUse with GitHub token returns updatedToolOutput redacted
  const r1 = handleLifecycleHook("PostToolUse", { tool_output: `leaked ${FX.gh}` }, { contract });
  g("posttooluse_returns_updatedToolOutput", r1.updatedToolOutput !== undefined);
  g("posttooluse_updatedToolOutput_redacted", !hasRaw(FX.gh, r1.updatedToolOutput));
  g("posttooluse_returns_updatedMcpToolOutput", r1.updatedMcpToolOutput !== undefined);

  // 2. PostToolUse with nested MCP private-key fixture returns updatedMcpToolOutput redacted
  const r2 = handleLifecycleHook("PostToolUse", { tool_response: { content: [{ type: "text", text: `key: ${FX.privKey}` }] } }, { contract });
  g("posttooluse_mcp_nested_redacted", !hasRaw("MIIEowIBAAKCAQEAfake", r2.updatedMcpToolOutput));
  g("posttooluse_mcp_updatedToolOutput_redacted", !hasRaw("MIIEowIBAAKCAQEAfake", r2.updatedToolOutput));

  // 3. Serialized result contains no raw synthetic value
  const r3 = handleLifecycleHook("PostToolUse", { tool_output: `${FX.gh} ${FX.aws} ${FX.stripe} ${FX.dbUrl}` }, { contract });
  const serialized = JSON.stringify(r3);
  g("serialized_no_raw_gh", !serialized.includes(FX.gh));
  g("serialized_no_raw_aws", !serialized.includes(FX.aws));
  g("serialized_no_raw_stripe", !serialized.includes(FX.stripe));
  g("serialized_no_raw_dburl", !serialized.includes("hunter2pwd"));

  // 4. Receipt/evidence metadata contains only redacted summaries/reason codes
  g("posttooluse_reason_codes_present", r1.reasonCodes.length > 0 && r1.reasonCodes.some(c => c.startsWith("SEC_")));
  g("posttooluse_redaction_classes_present", r1.redactionClasses.length > 0);
  g("posttooluse_verdict_is_allow", r1.verdict === "allow");
  g("posttooluse_exit_code_zero", r1.exitCode === 0);

  // 5. Clean output remains unchanged
  const r4 = handleLifecycleHook("PostToolUse", { tool_output: "all tests passed, no issues" }, { contract });
  g("clean_output_unchanged", r4.updatedToolOutput === "all tests passed, no issues");
  g("clean_output_no_reason_codes", r4.reasonCodes.length === 0);
  g("clean_output_no_redaction_classes", r4.redactionClasses.length === 0);

  // 6. PreToolUse behavior preserved (not broken by PostToolUse wiring)
  // PreToolUse gate blocks destructive/external/secret-carrying commands; env-read intent blocking is routing-layer.
  const r5 = handleLifecycleHook("PreToolUse", { tool: "bash", content: "rm -rf /", workingDir: "/tmp" }, { contract });
  g("pretooluse_still_blocks_destructive", r5.verdict !== "allow");
  g("pretooluse_no_mutation_fields", r5.updatedToolOutput === undefined && r5.updatedMcpToolOutput === undefined);

  // 7. Recursion guard still works
  process.env.AVORELO_HOOK_ACTIVE = "1";
  const r6 = handleLifecycleHook("PostToolUse", { tool_output: FX.gh }, { contract });
  delete process.env.AVORELO_HOOK_ACTIVE;
  g("recursion_guard_skips_posttooluse", r6.recursionSkipped === true);

  // 8. Multiple secrets in one output all redacted
  const multi = `token=${FX.gh} key=${FX.aws} pk=${FX.privKey}`;
  const r7 = handleLifecycleHook("PostToolUse", { tool_output: multi }, { contract });
  g("multi_secret_all_redacted", !hasRaw(FX.gh, r7.updatedToolOutput) && !hasRaw(FX.aws, r7.updatedToolOutput) && !hasRaw("MIIEowIBAAKCAQEAfake", r7.updatedToolOutput));
  g("multi_secret_reason_codes", r7.reasonCodes.filter(c => c.startsWith("SEC_")).length >= 3);

  const failedGates = gates.filter(x => !x.pass);
  const ok = failedGates.length === 0;
  const summary = {
    ok,
    gates: { total: gates.length, passed: gates.length - failedGates.length, failed: failedGates.map(x => x.gate) },
    detail: { gates },
  };
  process.stdout.write("AVORELO ADAPTER-SECRET-BOUNDARY DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
