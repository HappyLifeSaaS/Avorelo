import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferWorkType, generateProofContract, renderProofContract } from "../src/avorelo/kernel/proof-contract/index.ts";
import { discoverCapabilities } from "../src/avorelo/capabilities/capability-discovery/index.ts";

describe("inferWorkType", () => {
  it("returns unknown_mixed for no files", () => {
    const result = inferWorkType([]);
    assert.equal(result.workType, "unknown_mixed");
  });

  it("detects ui_product_surface from tsx files", () => {
    const result = inferWorkType(["src/components/Header.tsx", "src/pages/Home.tsx"]);
    assert.equal(result.workType, "ui_product_surface");
  });

  it("detects api_backend from route files", () => {
    const result = inferWorkType(["src/api/users.ts", "src/routes/health.ts"]);
    assert.equal(result.workType, "api_backend");
  });

  it("detects security_sensitive from auth files", () => {
    const result = inferWorkType(["src/auth/login.ts", "src/security/tokens.ts"]);
    assert.equal(result.workType, "security_sensitive");
  });

  it("detects dependency_package from package.json", () => {
    const result = inferWorkType(["package.json"]);
    assert.equal(result.workType, "dependency_package");
  });

  it("detects docs_marketing from markdown", () => {
    const result = inferWorkType(["docs/guide.md", "README.md"]);
    assert.equal(result.workType, "docs_marketing");
  });

  it("security outscores other types due to higher weight", () => {
    const result = inferWorkType(["src/auth/login.ts", "src/components/Form.tsx"]);
    assert.equal(result.workType, "security_sensitive");
  });

  it("returns quick_code_fix for small unmatched changes", () => {
    const result = inferWorkType(["src/utils/helpers.ts"]);
    assert.equal(result.workType, "quick_code_fix");
  });
});

describe("generateProofContract", () => {
  it("generates contract with required proof", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/components/Header.tsx"], caps);
    assert.equal(contract.workType, "ui_product_surface");
    assert.ok(contract.requiredProof.length > 0);
    assert.equal(contract.containsRawSecret, false);
  });

  it("includes build proof if build available", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/index.ts"], caps);
    if (caps.build.available) {
      assert.ok(contract.requiredProof.some(r => r.id === "build_pass"));
    }
  });

  it("always includes artifact guard", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["anything.ts"], caps);
    assert.ok(contract.requiredProof.some(r => r.id === "artifact_guard"));
  });

  it("includes blocked actions", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/auth/login.ts"], caps);
    assert.ok(contract.blockedActions.includes("npm publish"));
  });

  it("includes closure rules", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/auth/login.ts"], caps);
    assert.ok(contract.closureRules.some(r => r.includes("Agent text is never proof")));
  });
});

describe("renderProofContract", () => {
  it("renders readable output", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/components/Header.tsx"], caps);
    const output = renderProofContract(contract);
    assert.ok(output.includes("Proof Contract"));
    assert.ok(output.includes("Required proof"));
    assert.ok(output.includes("Closure rules"));
  });
});
