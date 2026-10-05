import assert from "node:assert/strict";
import { fabricBasicContentFixture } from "../../fixtures/specs/fabric-basic-content.ts";
import { compileFabricPhase1, FabricCompilerError } from "./index.ts";

const fixture = fabricBasicContentFixture();
const cases: readonly { input: unknown; path: string }[] = [
  { input: { ...fixture, schemaVersion: 2 }, path: "/schemaVersion" },
  { input: { ...fixture, schemaVersion: 99, gameplay: "future-format" }, path: "/schemaVersion" },
  { input: { ...fixture, schemaVersion: 0 }, path: "/schemaVersion" },
  {
    input: { ...fixture, gameplay: { ...fixture.gameplay,
      items: [{ ...fixture.gameplay.items[0], kind: "arbitrary-mesh" }, fixture.gameplay.items[1]],
    } },
    path: "/gameplay/items/0",
  },
  {
    input: { ...fixture, gameplay: { ...fixture.gameplay,
      blocks: [{ ...fixture.gameplay.blocks[0], arbitraryJava: "throw new RuntimeException();" }],
    } },
    path: "/gameplay/blocks/0/arbitraryJava",
  },
  {
    input: { ...fixture, gameplay: { ...fixture.gameplay,
      recipes: [{ ...fixture.gameplay.recipes[0], type: "unknown-serializer" }],
    } },
    path: "/gameplay/recipes/0",
  },
];

for (const { input, path } of cases) {
  const payload = JSON.stringify(input);
  await assert.rejects(compileFabricPhase1(payload), (error: unknown) => {
    assert(error instanceof FabricCompilerError);
    assert.equal(error.code, "SPEC_INVALID", "Invalid input must fail before pack loading or emission.");
    assert(error.errors.some((entry) => entry.path === path || entry.path?.startsWith(`${path}/`)),
      `Expected diagnostic at ${path}`);
    assert.equal(error.errors.length <= 100, true);
    return true;
  });
  assert.equal(JSON.stringify(input), payload, "Rejection must preserve input.");
}
console.log(`Fabric spec preflight: ${cases.length} unknown versions/primitives rejected before pack loading PASS`);
