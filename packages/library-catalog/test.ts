import assert from "node:assert/strict";
import {
  FABRIC_1_20_1_ALLOWED_GRADLE_LIBRARY_BLOCKS,
  listFabric1201Libraries,
  renderFabric1201GradleLibraries,
  resolveFabric1201Libraries,
} from "./index.ts";

const catalog = listFabric1201Libraries();
assert.deepEqual(catalog.map(({ id }) => id), ["modmenu", "yet_another_config_lib_v3"]);
assert.equal(Object.isFrozen(catalog), true);
assert.equal(Object.isFrozen(catalog[0]), true);
assert.equal(Object.isFrozen(catalog[0]?.repositories), true);
assert.equal(Object.isFrozen(catalog[0]?.repositories[0]), true);

const resolved = resolveFabric1201Libraries(
  ["yet_another_config_lib_v3"],
  ["modmenu"],
);
assert.equal(resolved.valid, true);
if (resolved.valid) {
  assert.deepEqual(resolved.libraries.map(({ id, relation }) => ({ id, relation })), [
    { id: "modmenu", relation: "optional" },
    { id: "yet_another_config_lib_v3", relation: "required" },
  ]);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.libraries), true);
  assert.equal(Object.isFrozen(resolved.libraries[0]), true);
}

const empty = resolveFabric1201Libraries([], []);
assert.equal(empty.valid, true);
if (empty.valid) assert.deepEqual(empty.libraries, []);

for (const [required, optional, code, path] of [
  [["unknown"], [], "UNSUPPORTED_LIBRARY", "/dependencies/required/0"],
  [["modmenu"], [], "UNSUPPORTED_RELATION", "/dependencies/required/0"],
  [[], ["yet_another_config_lib_v3"], "UNSUPPORTED_RELATION", "/dependencies/optional/0"],
  [["yet_another_config_lib_v3"], ["yet_another_config_lib_v3"], "DUPLICATE_LIBRARY", "/dependencies/optional/0"],
] as const) {
  const result = resolveFabric1201Libraries(required, optional);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.diagnostics[0]?.code, code);
    assert.equal(result.diagnostics[0]?.path, path);
    assert.equal(Object.isFrozen(result.diagnostics), true);
  }
}

const sparse: string[] = [];
sparse.length = 1;
const sparseResult = resolveFabric1201Libraries(sparse, []);
assert.equal(sparseResult.valid, false);
if (!sparseResult.valid) assert.equal(sparseResult.diagnostics[0]?.code, "INVALID_LIBRARY_ID");

const gradle = renderFabric1201GradleLibraries(["yet_another_config_lib_v3"], ["modmenu"]);
assert.match(gradle, /content \{ includeGroup 'org\.quiltmc\.parsers' \}/u);
assert.match(gradle, /modImplementation "com\.terraformersmc:modmenu:7\.2\.2"/u);
assert.match(gradle, /modImplementation "dev\.isxander:yet-another-config-lib:3\.5\.0\+1\.20\.1-fabric"/u);
assert.equal(FABRIC_1_20_1_ALLOWED_GRADLE_LIBRARY_BLOCKS.length, 4);
assert.equal(new Set(FABRIC_1_20_1_ALLOWED_GRADLE_LIBRARY_BLOCKS).size, 4);
assert.throws(() => renderFabric1201GradleLibraries(["unknown"], []), TypeError);
