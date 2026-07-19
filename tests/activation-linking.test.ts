// Avorelo activation linking tests: claim creation, linking, detection, security, dashboard states.
// Zero-dep, node:test. Tests the activation routes contract, CLI claim flag, detection output,
// dashboard HTML states, agent prompt content, and security boundaries.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFullDetection, detectAiTools, detectEnvironment, detectRepoIdentity } from "../src/avorelo/capabilities/activation/activation-detector.ts";

let target: string;

before(() => {
  target = mkdtempSync(join(tmpdir(), "avorelo-link-test-"));
  mkdirSync(join(target, "src"), { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: "test-proj", version: "1.0.0" }));
});

after(() => {
  if (existsSync(target) && target.includes("avorelo-link-test-")) {
    rmSync(target, { recursive: true, force: true });
  }
});

// ── Claim token generation ──────────────────────────────────────────
// ── Activation detection ────────────────────────────────────────────
describe("Activation detection", () => {
  it("runFullDetection returns expected structure", () => {
    const d = runFullDetection(target);
    assert.ok(d.repo, "repo missing");
    assert.ok(d.environment, "environment missing");
    assert.ok(d.aiTools, "aiTools missing");
    assert.ok(d.modelsAndTools, "modelsAndTools missing");
    assert.ok(d.summary, "summary missing");
    assert.ok(Array.isArray(d.summary.toolsDetected));
    assert.ok(Array.isArray(d.summary.modelsDetected));
    assert.ok(Array.isArray(d.summary.missingAdvisory));
  });

  it("detects package.json presence as npm", () => {
    const env = detectEnvironment(target);
    assert.equal(env.packageManager, "npm");
  });

  it("detects Claude Code when .claude dir exists", () => {
    const claudeDir = join(target, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const tools = detectAiTools(target);
    assert.ok(tools.claudeCodeDetected);
    rmSync(claudeDir, { recursive: true, force: true });
  });

  it("detects AGENTS.md when present", () => {
    writeFileSync(join(target, "AGENTS.md"), "# Agents");
    const tools = detectAiTools(target);
    assert.ok(tools.agentsMdDetected);
    rmSync(join(target, "AGENTS.md"));
  });

  it("detects CLAUDE.md when present", () => {
    writeFileSync(join(target, "CLAUDE.md"), "# Claude");
    const tools = detectAiTools(target);
    assert.ok(tools.claudeMdDetected);
    rmSync(join(target, "CLAUDE.md"));
  });

  it("does not capture env secrets in detection output", () => {
    const d = runFullDetection(target);
    const json = JSON.stringify(d);
    const envKeys = ["DATABASE_URL", "AUTH_SECRET", "LEMON_SQUEEZY_API_KEY", "JWT_SECRET"];
    for (const key of envKeys) {
      const val = process.env[key];
      if (val && val.length > 8) {
        assert.ok(!json.includes(val), `detection output leaks ${key}`);
      }
    }
  });

  it("Community Edition: detection performs no hosted billing/auth/cloud env detection", () => {
    const d = runFullDetection(target);
    // The hosted-env detection fields were removed — no billing/auth/cloud env is inspected.
    assert.ok(!("billingEnvDetected" in d.modelsAndTools), "no billing env detection");
    assert.ok(!("authEnvDetected" in d.modelsAndTools), "no auth env detection");
    assert.ok(!("cloudEnvDetected" in d.modelsAndTools), "no cloud env detection");
  });
});

// ── CLI activate --claim contract ───────────────────────────────────
describe("CLI activate --claim contract", () => {
  const cliSrc = readFileSync(
    join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts"),
    "utf8"
  );

  it("cmdActivate is async", () => {
    assert.ok(cliSrc.includes("async function cmdActivate"), "cmdActivate must be async for fetch");
  });

  it("Community Edition: activate does NOT link to a cloud account", () => {
    assert.ok(!cliSrc.includes('"--claim"'), "CLI must not parse --claim in CE");
    assert.ok(!cliSrc.includes("/api/activation/link"), "CLI activate must not POST to a cloud link endpoint");
  });

  it("parses --scope flag", () => {
    assert.ok(cliSrc.includes('"--scope"'), "CLI must parse --scope");
  });

  it("runs detection after activation", () => {
    assert.ok(cliSrc.includes("runFullDetection"), "CLI must run detection");
  });

});

// The "Dashboard activation HTML" (12 tests) and "Dashboard Teams gating" (4 tests) blocks
// asserted the hosted dashboard: claim polling against /api/me/activation, sign-in state,
// agent-prompt copy buttons, and Teams tier gating. Milestone E1B replaced dashboard.html
// with a static illustration of the local viewer that runs no JavaScript and contacts
// nothing, so every one of those assertions describes behaviour that no longer exists.
// The replacement guarantees live in tests/site-navigation-contract.test.ts, which asserts
// the dashboard carries no script, no fetch, no /api/ reference and no account state, and
// that it labels its example data as not live.

// The "Auth pages provider state" block (4 tests) asserted the OAuth provider buttons and
// pendingProviders logic of the hosted signup.html / login.html pages. Those pages were deleted
// in Milestone E1A (/login and /signup are now static 301s to /activate), so the block is
// removed rather than left to vanish silently. Their absence is asserted by
// tests/site-inclusion-boundary.test.ts.

// ── Landing page agent-first ────────────────────────────────────────
describe("Landing page activation model", () => {
  const indexSrc = readFileSync(
    join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "public-web", "static", "index.html"),
    "utf8"
  );

  it("primary CTA is the Community Edition CTA, not a hosted sign-up", () => {
    assert.ok(indexSrc.includes("Explore Community Edition"), "hero CTA should be the approved CE CTA");
    assert.ok(!indexSrc.includes("Start free"), "the hosted sign-up CTA must be gone");
  });

  it("explains activation model", () => {
    assert.ok(
      indexSrc.includes("Activate") || indexSrc.includes("activate"),
      "landing page should mention activation"
    );
  });

  it("trust line about not sending source code", () => {
    assert.ok(
      indexSrc.includes("does not send source code") || indexSrc.includes("does not send"),
      "trust line present"
    );
  });
});

// ── Security boundaries ─────────────────────────────────────────────
describe("Security boundaries", () => {
  it("Community Edition: detector reads no hosted billing/auth/cloud env at all", () => {
    const detectorSrc = readFileSync(
      join(import.meta.dirname, "..", "src", "avorelo", "capabilities", "activation", "activation-detector.ts"),
      "utf8"
    );
    // Hosted-env detection was removed entirely — the detector must not reference these vars.
    for (const v of ["LEMON_SQUEEZY", "AUTH_SECRET", "JWT_SECRET", "SESSION_SECRET", "DATABASE_URL", "CLOUD_SYNC_URL"]) {
      assert.ok(!detectorSrc.includes(v), `detector must not read ${v}`);
    }
  });
});
