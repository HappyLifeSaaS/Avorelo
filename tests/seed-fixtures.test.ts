import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inferWorkType, generateProofContract } from "../src/avorelo/kernel/proof-contract/index.ts";
import { discoverCapabilities } from "../src/avorelo/capabilities/capability-discovery/index.ts";

interface SeedFixture {
  description: string;
  changedFiles: string[];
  expectedWorkType: string;
  expectedCriticalProof: string[];
  expectedSafeToClose: boolean;
  expectedBlockingReason?: string;
}

const fixtureDir = join(process.cwd(), "fixtures", "verification");

describe("proof seed fixtures", () => {
  const files = readdirSync(fixtureDir).filter(f => f.startsWith("seed-") && f.endsWith(".json"));

  for (const file of files) {
    const fixture: SeedFixture = JSON.parse(readFileSync(join(fixtureDir, file), "utf-8"));

    it(`${file}: infers correct work type (${fixture.expectedWorkType})`, () => {
      const { workType } = inferWorkType(fixture.changedFiles);
      assert.equal(workType, fixture.expectedWorkType, `Expected ${fixture.expectedWorkType} but got ${workType}`);
    });

    it(`${file}: generates proof contract with expected critical proof`, () => {
      const caps = discoverCapabilities(process.cwd());
      const contract = generateProofContract(fixture.changedFiles, caps);

      for (const expectedId of fixture.expectedCriticalProof) {
        const found = contract.requiredProof.some(r => r.id === expectedId);
        assert.ok(found, `Expected critical proof requirement "${expectedId}" not found in contract for ${file}`);
      }
    });

    it(`${file}: privacy invariant holds`, () => {
      const caps = discoverCapabilities(process.cwd());
      const contract = generateProofContract(fixture.changedFiles, caps);
      assert.equal(contract.containsRawSecret, false);
    });
  }
});
