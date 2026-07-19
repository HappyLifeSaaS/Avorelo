// Tests for the LIVE activation dogfood runner's pure logic (no auth / no spawn required).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeAuth, summarizeFireLog, containsRawPlantedSecret } from "../tools/live-activation-dogfood-runner.ts";

test("parseClaudeAuth — detects not-logged-in from claude JSON", () => {
  const notLoggedIn = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" });
  assert.equal(parseClaudeAuth(notLoggedIn).loggedIn, false);
  assert.equal(parseClaudeAuth(notLoggedIn).reason, "NOT_LOGGED_IN");
});

test("parseClaudeAuth — detects a usable authenticated result", () => {
  const ok = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "pong" });
  assert.equal(parseClaudeAuth(ok).loggedIn, true);
});

test("parseClaudeAuth — empty / garbage output is treated as not usable (fail-closed)", () => {
  assert.equal(parseClaudeAuth("").loggedIn, false);
  assert.equal(parseClaudeAuth("not json at all").loggedIn, false);
});

test("parseClaudeAuth — tolerates leading non-JSON lines before the result object", () => {
  const out = "warning: something\n" + JSON.stringify({ type: "result", is_error: false, result: "pong" });
  assert.equal(parseClaudeAuth(out).loggedIn, true);
});

test("summarizeFireLog — counts events/verdicts and flags NO raw secret leak for redacted entries", () => {
  const lines = [
    JSON.stringify({ event: "PreToolUse", tool: "edit", verdict: "allow", reasonCodes: ["BENIGN_ALLOW"], redactionClasses: [] }),
    JSON.stringify({ event: "PreToolUse", tool: "bash", verdict: "block", reasonCodes: ["SECRET_DETECTED"], redactionClasses: ["aws_access_key"] }),
    JSON.stringify({ event: "SessionStart", verdict: "allow", reasonCodes: ["RECORDED"] }),
    "", // blank lines tolerated
  ];
  const s = summarizeFireLog(lines);
  assert.equal(s.total, 3);
  assert.equal(s.preToolUse, 2);
  assert.equal(s.verdicts.allow, 2);
  assert.equal(s.verdicts.block, 1);
  // redactionClasses is a CLASS label, not a raw value -> NOT a leak
  assert.equal(s.rawSecretLeak, false);
});

test("summarizeFireLog — flags a RAW secret value that survived into a log line (hard failure)", () => {
  const leaky = [JSON.stringify({ event: "PreToolUse", tool: "bash", verdict: "block", note: "echo AKIA1234567" + "890ABCD99" })];
  const s = summarizeFireLog(leaky);
  assert.equal(s.rawSecretLeak, true);
  assert.ok(s.leakClasses.includes("aws_access_key"));
});

test("containsRawPlantedSecret — literal detection", () => {
  assert.equal(containsRawPlantedSecret("foo AKIA1234567" + "890ABCD99 bar"), true);
  assert.equal(containsRawPlantedSecret("nothing here"), false);
});
