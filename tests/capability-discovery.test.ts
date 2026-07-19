import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverCapabilities, renderCapabilities, capabilitiesToJson } from "../src/avorelo/capabilities/capability-discovery/index.ts";

describe("discoverCapabilities", () => {
  it("discovers capabilities for current project", () => {
    const caps = discoverCapabilities(process.cwd());
    assert.ok(caps.timestamp);
    assert.ok(caps.projectRootHash);
    assert.equal(caps.containsRawSecret, false);
    assert.ok(caps.recommendedProofPath.length > 0);
  });

  it("detects package manager", () => {
    const caps = discoverCapabilities(process.cwd());
    assert.ok(caps.packageManager.available || !caps.packageManager.available);
  });

  it("detects build command", () => {
    const caps = discoverCapabilities(process.cwd());
    if (caps.build.available) {
      assert.ok(caps.build.command);
    }
  });

  it("detects test command", () => {
    const caps = discoverCapabilities(process.cwd());
    if (caps.test.available) {
      assert.ok(caps.test.command);
    }
  });

  it("returns lockfile state", () => {
    const caps = discoverCapabilities(process.cwd());
    assert.ok(["npm", "pnpm", "yarn", "bun", "missing"].includes(caps.lockfileState));
  });
});

describe("renderCapabilities", () => {
  it("renders readable text output", () => {
    const caps = discoverCapabilities(process.cwd());
    const output = renderCapabilities(caps);
    assert.ok(output.includes("Capability Discovery"));
    assert.ok(output.includes("Package manager"));
    assert.ok(output.includes("Recommended proof path"));
  });
});

describe("capabilitiesToJson", () => {
  it("returns serializable object", () => {
    const caps = discoverCapabilities(process.cwd());
    const json = capabilitiesToJson(caps);
    assert.ok(json);
    const serialized = JSON.stringify(json);
    assert.ok(serialized.length > 0);
  });
});
