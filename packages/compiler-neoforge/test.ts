import assert from "node:assert/strict";
import { containsForbiddenExecutionSurface, isBuildPlan } from "@mcdev/contracts";
import type { ModSpec } from "@mcdev/modspec";
import {
  BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  loadBuiltinCompatibilityPack,
  type VerifiedCompatibilityPack,
} from "@mcdev/compatibility-packs";
import {
  CompilerError,
  compileNeoForgePhase1,
  type CompiledNeoForgeProject,
} from "./index.ts";
import { compileVerifiedNeoForgePhase1 } from "./compiler.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });
const provenance = Object.freeze({
  kind: "generated" as const,
  source: "https://example.invalid/mcdev/compiler-test",
  license: "CC0-1.0",
  sha256: "a".repeat(64),
});

function specFixture(): ModSpec {
  return {
    schemaVersion: 0,
    kind: "mod",
    project: {
      modId: "testmod",
      name: "Test Mod",
      version: "1.2.3",
      license: "MIT",
      provenance: [provenance],
    },
    target: { minecraft: "26.1.2", loader: "neoforge", java: 25 },
    gameplay: {
      items: [
        { id: "testmod:gem", references: [], maxStackSize: 16 },
        { id: "testmod:ore_item", references: [], maxStackSize: 64 },
      ],
      blocks: [{
        id: "testmod:ore",
        references: [],
        item: "testmod:ore_item",
        hardness: 3.5,
      }],
      entities: [],
      recipes: [],
      summoning: [],
      screens: [],
    },
    assets: {
      artSpec: "art-spec.yaml",
      models: [],
      textures: [],
      animations: [],
      budgets: {
        maxTextureBytes: 1_048_576,
        maxCubes: 128,
        maxBones: 32,
        maxTriangles: 2_048,
        maxKeyframes: 1_024,
      },
    },
    dependencies: { required: [], optional: [] },
    integrations: { jei: "off", jade: "off" },
    tests: { gameTests: [] },
    packaging: { includeSources: false, publish: false },
  };
}

function output(result: CompiledNeoForgeProject, path: string): Uint8Array {
  const match = result.outputs.find(({ file }) => file.path === path);
  assert.ok(match, `missing generated output ${path}`);
  return match.file.bytes;
}

function textOutput(result: CompiledNeoForgeProject, path: string): string {
  return decoder.decode(output(result, path));
}

async function expectCompilerError(
  payload: string,
  code: CompilerError["code"],
  path?: string,
): Promise<CompilerError> {
  try {
    await compileNeoForgePhase1(payload);
  } catch (error) {
    assert.ok(error instanceof CompilerError);
    assert.equal(error.code, code, path);
    assert.equal(Object.isFrozen(error.errors), true);
    if (path !== undefined) {
      assert.ok(error.errors.some((entry) => entry.path === path), `missing compiler error path ${path}`);
    }
    return error;
  }
  assert.fail(`expected ${code}`);
}

const expectedPaths = [
  ".gitignore",
  "build.gradle",
  "gradle.properties",
  "gradle/verification-metadata.xml",
  "gradle/wrapper/gradle-wrapper.jar",
  "gradle/wrapper/gradle-wrapper.properties",
  "gradlew",
  "gradlew.bat",
  "settings.gradle",
  "src/main/java/dev/mcdev/generated/m_testmod/GeneratedContent.java",
  "src/main/java/dev/mcdev/generated/m_testmod/GeneratedMod.java",
  "src/main/resources/META-INF/neoforge.mods.toml",
  "src/main/resources/assets/testmod/blockstates/ore.json",
  "src/main/resources/assets/testmod/items/gem.json",
  "src/main/resources/assets/testmod/items/ore_item.json",
  "src/main/resources/assets/testmod/lang/en_us.json",
  "src/main/resources/assets/testmod/models/block/ore.json",
  "src/main/resources/assets/testmod/models/item/gem.json",
  "src/main/resources/assets/testmod/textures/mcdev/placeholder.png",
  "src/main/resources/data/testmod/loot_table/blocks/ore.json",
];

const fixture = specFixture();
const compiled = await compileNeoForgePhase1(JSON.stringify(fixture));
assert.deepEqual(compiled.outputs.map(({ file }) => file.path), expectedPaths);
assert.equal(Object.isFrozen(compiled), true);
assert.equal(Object.isFrozen(compiled.outputs), true);
assert.equal(Object.isFrozen(compiled.plan), true);
assert.equal(Object.isFrozen(compiled.plan.nodes), true);
for (const node of compiled.plan.nodes) {
  assert.equal(Object.isFrozen(node), true);
  assert.equal(Object.isFrozen(node.dependsOn), true);
  assert.equal(Object.isFrozen(node.outputs), true);
  assert.ok(node.outputs.every((entry) => Object.isFrozen(entry)));
}
assert.equal(isBuildPlan(compiled.plan), true);
assert.deepEqual(compiled.plan.warnings, ["PLACEHOLDER_ASSETS_USED"]);
assert.deepEqual(compiled.plan.nodes.map(({ nodeId }) => nodeId), [
  "apply-workspace",
  "generate-content",
  "generate-project",
  "gradle-clean-build",
  "index-artifacts",
]);
assert.equal(compiled.plan.nodes.find(({ nodeId }) => nodeId === "generate-project")?.outputs.length, 10);
assert.equal(compiled.plan.nodes.find(({ nodeId }) => nodeId === "generate-content")?.outputs.length, 10);
assert.equal(compiled.plan.nodes.find(({ nodeId }) => nodeId === "apply-workspace")?.outputs.length, 0);
assert.equal(containsForbiddenExecutionSurface(compiled.plan), false);
assert.equal(JSON.stringify(compiled.plan).includes("templates/"), false);
assert.equal(JSON.stringify(compiled.plan).includes("manifest.json"), false);
assert.equal(JSON.stringify(compiled.plan).includes("versions.lock"), false);
assert.deepEqual(
  compiled.outputs.find(({ file }) => file.path === "gradlew"),
  {
    file: compiled.outputs.find(({ file }) => file.path === "gradlew")?.file,
    nodeId: "generate-project",
    artifactKind: "template",
  },
);
assert.equal(compiled.outputs.find(({ file }) => file.path === "gradlew")?.file.mode, 493);
assert.equal(compiled.outputs.find(({ file }) => file.path === "gradlew")?.file.origin, "pack");
assert.equal(compiled.outputs.find(({ file }) => file.path === "build.gradle")?.file.origin, "compiler");
assert.equal(compiled.outputs.find(({ file }) => file.path.endsWith("GeneratedMod.java"))?.artifactKind, "source");
assert.equal(compiled.outputs.find(({ file }) => file.path.endsWith("en_us.json"))?.artifactKind, "resource");

const generatedContent = textOutput(
  compiled,
  "src/main/java/dev/mcdev/generated/m_testmod/GeneratedContent.java",
);
assert.match(generatedContent, /DeferredRegister\.Blocks BLOCKS = DeferredRegister\.createBlocks\(GeneratedMod\.MOD_ID\)/u);
assert.match(generatedContent, /DeferredRegister\.Items ITEMS = DeferredRegister\.createItems\(GeneratedMod\.MOD_ID\)/u);
assert.match(generatedContent, /BLOCKS\.registerSimpleBlock\("ore", props -> props\.destroyTime\(Float\.intBitsToFloat\(0x40600000\)\)\)/u);
assert.match(generatedContent, /ITEMS\.registerSimpleItem\("gem", props -> props\.stacksTo\(16\)\)/u);
assert.match(generatedContent, /ITEMS\.registerSimpleBlockItem\("ore_item", BLOCK_ORE, props -> props\.stacksTo\(64\)\)/u);
assert.ok(generatedContent.indexOf("ITEMS.register(modBus)") < generatedContent.indexOf("BLOCKS.register(modBus)"));
assert.equal(textOutput(compiled, "src/main/resources/assets/testmod/items/gem.json"),
  '{"model":{"model":"testmod:item/gem","type":"minecraft:model"}}\n');
assert.equal(textOutput(compiled, "src/main/resources/assets/testmod/items/ore_item.json"),
  '{"model":{"model":"testmod:block/ore","type":"minecraft:model"}}\n');
assert.equal(textOutput(compiled, "src/main/resources/assets/testmod/models/item/gem.json"),
  '{"parent":"minecraft:item/generated","textures":{"layer0":"testmod:mcdev/placeholder"}}\n');
assert.equal(textOutput(compiled, "src/main/resources/assets/testmod/models/block/ore.json"),
  '{"parent":"minecraft:block/cube_all","textures":{"all":"testmod:mcdev/placeholder"}}\n');
assert.equal(textOutput(compiled, "src/main/resources/assets/testmod/blockstates/ore.json"),
  '{"variants":{"":{"model":"testmod:block/ore"}}}\n');
assert.equal(textOutput(compiled, "src/main/resources/data/testmod/loot_table/blocks/ore.json"),
  '{"pools":[{"bonus_rolls":0,"conditions":[{"condition":"minecraft:survives_explosion"}],"entries":[{"name":"testmod:ore_item","type":"minecraft:item"}],"rolls":1}],"random_sequence":"testmod:blocks/ore","type":"minecraft:block"}\n');

const png = output(compiled, "src/main/resources/assets/testmod/textures/mcdev/placeholder.png");
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(new DataView(png.buffer, png.byteOffset + 16, 8).getUint32(0), 16);
assert.equal(new DataView(png.buffer, png.byteOffset + 16, 8).getUint32(4), 16);
assert.equal(compiled.outputs.find(({ file }) => file.path.endsWith("placeholder.png"))?.file.sha256,
  "918a4d7a554bfec52db1649d1aa5d6db74d220d698c69d6724ce6bc12ecf6971");
png.fill(0);
assert.equal(output(compiled, "src/main/resources/assets/testmod/textures/mcdev/placeholder.png")[0], 137);

const reverseOrder = specFixture();
reverseOrder.gameplay.items.reverse();
const reordered = await compileNeoForgePhase1(JSON.stringify(reverseOrder));
assert.equal(reordered.plan.planId, compiled.plan.planId);
assert.deepEqual(
  reordered.outputs.map(({ file }) => [file.path, file.sha256]),
  compiled.outputs.map(({ file }) => [file.path, file.sha256]),
);
const reorderedRoot = {
  packaging: fixture.packaging,
  tests: fixture.tests,
  integrations: fixture.integrations,
  dependencies: fixture.dependencies,
  assets: fixture.assets,
  gameplay: fixture.gameplay,
  target: fixture.target,
  project: fixture.project,
  kind: fixture.kind,
  schemaVersion: fixture.schemaVersion,
};
assert.equal(
  (await compileNeoForgePhase1(JSON.stringify(reorderedRoot, null, 2))).plan.planId,
  compiled.plan.planId,
  "JSON whitespace and object-key order must not affect the plan",
);
const multipleBlocks = specFixture();
multipleBlocks.gameplay.items.push({ id: "testmod:alpha_item", references: [], maxStackSize: 7 });
multipleBlocks.gameplay.blocks.push({
  id: "testmod:alpha",
  references: [],
  item: "testmod:alpha_item",
  hardness: 0.1,
});
const multipleBlocksCompiled = await compileNeoForgePhase1(JSON.stringify(multipleBlocks));
multipleBlocks.gameplay.items.reverse();
multipleBlocks.gameplay.blocks.reverse();
const reversedBlocksCompiled = await compileNeoForgePhase1(JSON.stringify(multipleBlocks));
assert.equal(reversedBlocksCompiled.plan.planId, multipleBlocksCompiled.plan.planId);
assert.match(
  textOutput(multipleBlocksCompiled, "src/main/java/dev/mcdev/generated/m_testmod/GeneratedContent.java"),
  /Float\.intBitsToFloat\(0x3DCCCCCD\)/u,
);

const punctuationPath = specFixture();
punctuationPath.gameplay.items[0] = {
  id: "testmod:parts/a.b-c_d",
  references: [],
  maxStackSize: 16,
};
const punctuationCompiled = await compileNeoForgePhase1(JSON.stringify(punctuationPath));
assert.ok(punctuationCompiled.outputs.some(({ file }) =>
  file.path === "src/main/resources/assets/testmod/items/parts/a.b-c_d.json"));
assert.match(
  textOutput(punctuationCompiled, "src/main/java/dev/mcdev/generated/m_testmod/GeneratedContent.java"),
  /ITEM_PARTS_SA_DB_HC_UD/u,
);

const hostileName = specFixture();
hostileName.project.name = "Quote \\\" slash \\\\ line\n tab\t ctrl\u0001 @@MCDEV_MOD_ID@@";
const escaped = await compileNeoForgePhase1(JSON.stringify(hostileName));
const toml = textOutput(escaped, "src/main/resources/META-INF/neoforge.mods.toml");
assert.ok(toml.includes(String.raw`displayName = "Quote \\\" slash \\\\ line\n tab\t ctrl\u0001 @@MCDEV_MOD_ID@@"`));
assert.doesNotMatch(textOutput(escaped, "build.gradle"), /@@MCDEV_/u);

const unsupportedCases: readonly [string, (spec: ModSpec) => void][] = [
  ["/gameplay/entities", (spec) => {
    spec.gameplay.entities.push({
      id: "testmod:entity",
      references: [],
      attributes: { maxHealth: 20, movementSpeed: 0.2 },
      renderer: "testmod:entity_model",
      dimensions: { width: 1, height: 1 },
    });
    spec.assets.models.push({
      id: "testmod:entity_model",
      path: "testmod/models/entity/model.bbmodel",
      license: "CC0-1.0",
      provenance: [provenance],
      metrics: { textureBytes: 0, cubes: 1, bones: 0, triangles: 12, keyframes: 0 },
    });
  }],
  ["/gameplay/recipes", (spec) => spec.gameplay.recipes.push({
    id: "testmod:gem_recipe",
    references: [],
    type: "shapeless",
    ingredients: [],
    result: "testmod:gem",
  })],
  ["/gameplay/summoning", (spec) => {
    spec.gameplay.entities.push({
      id: "testmod:entity",
      references: [],
      attributes: { maxHealth: 20, movementSpeed: 0.2 },
      renderer: "testmod:entity_model",
      dimensions: { width: 1, height: 1 },
    });
    spec.assets.models.push({
      id: "testmod:entity_model",
      path: "testmod/models/entity/model.bbmodel",
      license: "CC0-1.0",
      provenance: [provenance],
      metrics: { textureBytes: 0, cubes: 1, bones: 0, triangles: 12, keyframes: 0 },
    });
    spec.gameplay.summoning.push({
      id: "testmod:summon_entity",
      references: [],
      entity: "testmod:entity",
      ingredients: ["testmod:gem"],
    });
  }],
  ["/gameplay/screens", (spec) => spec.gameplay.screens.push({
    id: "testmod:screen",
    references: [],
    menuId: "testmod:gem",
    serverValidation: true,
  })],
  ["/assets/models", (spec) => spec.assets.models.push({
    id: "testmod:model",
    path: "testmod/models/item/model.bbmodel",
    license: "CC0-1.0",
    provenance: [provenance],
    metrics: { textureBytes: 0, cubes: 1, bones: 0, triangles: 12, keyframes: 0 },
  })],
  ["/assets/textures", (spec) => spec.assets.textures.push({
    id: "testmod:texture",
    path: "testmod/textures/item/texture.png",
    license: "CC0-1.0",
    provenance: [provenance],
    metrics: { textureBytes: 16, cubes: 0, bones: 0, triangles: 0, keyframes: 0 },
  })],
  ["/assets/animations", (spec) => {
    spec.assets.animations.push({
      id: "testmod:animation",
      path: "testmod/animations/item/animation.json",
      license: "CC0-1.0",
      provenance: [provenance],
      metrics: { textureBytes: 0, cubes: 0, bones: 0, triangles: 0, keyframes: 1 },
    });
    spec.dependencies.required.push("geckolib");
  }],
  ["/dependencies/required", (spec) => spec.dependencies.required.push("geckolib")],
  ["/dependencies/optional", (spec) => spec.dependencies.optional.push("othermod")],
  ["/integrations/jei", (spec) => {
    spec.integrations.jei = "auto";
    spec.dependencies.optional.push("jei");
  }],
  ["/integrations/jade", (spec) => {
    spec.integrations.jade = "auto";
    spec.dependencies.optional.push("jade");
  }],
  ["/tests/gameTests", (spec) => spec.tests.gameTests.push({ id: "testmod:test", references: [] })],
  ["/packaging/includeSources", (spec) => { spec.packaging.includeSources = true; }],
  ["/gameplay/items/0/references", (spec) => { spec.gameplay.items[0]!.references = ["testmod:ore"]; }],
  ["/gameplay/blocks/0/references", (spec) => { spec.gameplay.blocks[0]!.references = ["testmod:gem"]; }],
];
for (const [path, mutate] of unsupportedCases) {
  const candidate = specFixture();
  mutate(candidate);
  await expectCompilerError(JSON.stringify(candidate), "SPEC_UNSUPPORTED", path);
}

const foreignNamespace = specFixture();
foreignNamespace.gameplay.items[0] = { ...foreignNamespace.gameplay.items[0]!, id: "other:gem" };
await expectCompilerError(JSON.stringify(foreignNamespace), "SPEC_UNSUPPORTED", "/gameplay/items/0/id");

const hyphenModId = specFixture();
hyphenModId.project.modId = "test-mod";
hyphenModId.gameplay.items = [];
hyphenModId.gameplay.blocks = [];
await expectCompilerError(JSON.stringify(hyphenModId), "SPEC_UNSUPPORTED", "/project/modId");

const invalidBlockItem = specFixture();
invalidBlockItem.gameplay.blocks.push({
  id: "testmod:ore_two",
  references: [],
  item: "testmod:ore_item",
  hardness: 1,
});
await expectCompilerError(JSON.stringify(invalidBlockItem), "SPEC_UNSUPPORTED", "/gameplay/blocks/1/item");

const tooManyItems = specFixture();
tooManyItems.gameplay.items = Array.from({ length: 65 }, (_unused, index) => ({
  id: `testmod:item_${index}`,
  references: [],
  maxStackSize: 1,
}));
tooManyItems.gameplay.blocks = [];
await expectCompilerError(JSON.stringify(tooManyItems), "SPEC_INVALID");
const duplicateItems = specFixture();
duplicateItems.gameplay.items.push({ ...duplicateItems.gameplay.items[0]! });
await expectCompilerError(JSON.stringify(duplicateItems), "SPEC_INVALID", "/gameplay/items/2/id");

const maximumItems = specFixture();
maximumItems.gameplay.items = Array.from({ length: 64 }, (_unused, index) => ({
  id: `testmod:item_${index}`,
  references: [],
  maxStackSize: 99,
}));
maximumItems.gameplay.blocks = [];
assert.equal((await compileNeoForgePhase1(JSON.stringify(maximumItems))).outputs.length, 142);
const maximumBlocks = specFixture();
maximumBlocks.gameplay.items = Array.from({ length: 32 }, (_unused, index) => ({
  id: `testmod:block_item_${index}`,
  references: [],
  maxStackSize: 99,
}));
maximumBlocks.gameplay.blocks = Array.from({ length: 32 }, (_unused, index) => ({
  id: `testmod:block_${index}`,
  references: [],
  item: `testmod:block_item_${index}`,
  hardness: index / 2,
}));
assert.equal((await compileNeoForgePhase1(JSON.stringify(maximumBlocks))).outputs.length, 142);
maximumBlocks.gameplay.items.push({ id: "testmod:block_item_32", references: [], maxStackSize: 1 });
maximumBlocks.gameplay.blocks.push({
  id: "testmod:block_32",
  references: [],
  item: "testmod:block_item_32",
  hardness: 16,
});
await expectCompilerError(JSON.stringify(maximumBlocks), "SPEC_INVALID");

const boundaryHardness = specFixture();
boundaryHardness.gameplay.items = [
  { id: "testmod:zero_item", references: [], maxStackSize: 1 },
  { id: "testmod:max_item", references: [], maxStackSize: 99 },
];
boundaryHardness.gameplay.blocks = [
  { id: "testmod:zero", references: [], item: "testmod:zero_item", hardness: -0 },
  { id: "testmod:max", references: [], item: "testmod:max_item", hardness: 100 },
];
const boundaryPayload = JSON.stringify(boundaryHardness).replace('"hardness":0', '"hardness":-0');
const boundaryJava = textOutput(
  await compileNeoForgePhase1(boundaryPayload),
  "src/main/java/dev/mcdev/generated/m_testmod/GeneratedContent.java",
);
assert.match(boundaryJava, /Float\.intBitsToFloat\(0x00000000\)/u);
assert.match(boundaryJava, /Float\.intBitsToFloat\(0x42C80000\)/u);

await expectCompilerError("{}", "SPEC_INVALID");
await expectCompilerError({ payload: "{}" } as unknown as string, "INVALID_REQUEST");
await expectCompilerError(JSON.stringify({ ...specFixture(), target: { minecraft: "26.2", loader: "neoforge", java: 25 } }), "SPEC_INVALID");
const invalidWithLongKey = { ...specFixture(), ["x".repeat(241)]: true };
const longKeyError = await expectCompilerError(JSON.stringify(invalidWithLongKey), "SPEC_INVALID");
assert.equal(longKeyError.errors[0]?.path, undefined, "overlong RFC 6901 pointers must be omitted, not truncated");

let hostileErrorListTrapCalls = 0;
const hostileErrorList = new Proxy([], {
  getPrototypeOf(): never {
    hostileErrorListTrapCalls += 1;
    throw new Error("hostile error list trap executed");
  },
});
const hardenedError = new CompilerError("SPEC_INVALID", hostileErrorList);
assert.equal(hardenedError.code, "INTERNAL_ERROR");
assert.equal(Object.isFrozen(hardenedError), true);
assert.equal(hostileErrorListTrapCalls, 0);

const pack = await loadBuiltinCompatibilityPack(BUILTIN_NEOFORGE_26_1_2_SELECTOR);
const wrongPack: VerifiedCompatibilityPack = {
  ref: { ...pack.ref, treeSha256: "0".repeat(64) },
  manifest: pack.manifest,
  listFiles: () => pack.listFiles(),
  readFile: (path) => pack.readFile(path),
};
assert.throws(
  () => compileVerifiedNeoForgePhase1(specFixture(), wrongPack),
  (error: unknown) => error instanceof CompilerError && error.code === "PACK_INTEGRITY_FAILED",
);
const wrongPackTarget: VerifiedCompatibilityPack = {
  ref: pack.ref,
  manifest: {
    ...pack.manifest,
    target: { ...pack.manifest.target, neoForge: "26.1.2.81" },
  },
  listFiles: () => pack.listFiles(),
  readFile: (path) => pack.readFile(path),
};
assert.throws(
  () => compileVerifiedNeoForgePhase1(specFixture(), wrongPackTarget),
  (error: unknown) => error instanceof CompilerError && error.code === "PACK_INTEGRITY_FAILED",
);
const gitignoreBytes = pack.readFile("templates/.gitignore");
const sharedPackBytes = new Uint8Array(new SharedArrayBuffer(gitignoreBytes.byteLength));
sharedPackBytes.set(gitignoreBytes);
const hostilePackBytes: VerifiedCompatibilityPack = {
  ref: pack.ref,
  manifest: pack.manifest,
  listFiles: () => pack.listFiles(),
  readFile: (path) => path === "templates/.gitignore" ? sharedPackBytes : pack.readFile(path),
};
assert.throws(
  () => compileVerifiedNeoForgePhase1(specFixture(), hostilePackBytes),
  (error: unknown) => error instanceof CompilerError && error.code === "PACK_INTEGRITY_FAILED",
);

const empty = specFixture();
empty.gameplay.items = [];
empty.gameplay.blocks = [];
const emptyCompiled = await compileNeoForgePhase1(JSON.stringify(empty));
assert.deepEqual(emptyCompiled.plan.warnings, []);
assert.equal(emptyCompiled.outputs.some(({ file }) => file.path.endsWith("placeholder.png")), false);

// Golden digests make accidental template, JSON, source, ordering, or domain changes explicit.
assert.equal(compiled.plan.specDigest, "377f453cb4d47c6065ec0ce0dd0d76edd01264d4eaed700e49ece3f54e89ee4b");
assert.equal(compiled.plan.planId, "f475faa14e521d7fba1d3c15d31d9e528ffd3f5adfab39d555e99ae064195294");
assert.equal(
  compiled.outputs.map(({ file }) => `${file.path} ${file.sha256}`).join("\n"),
  `.gitignore 051e6c3ddf8a190757b91799bf9b92df2df3a6648fdf6640ee2e616a59767462
build.gradle 85b833efd336bd7250923648c7724997aac0a1f932dda0ce9f0e0634f659089c
gradle.properties 3908d038981a3f37d48ab5d75c654771c9f272708092d9de5e14bc19396c895c
gradle/verification-metadata.xml 7b3509232632738740c7ee9bef04669e50311986f42ddd59fcfc8114aebb036b
gradle/wrapper/gradle-wrapper.jar 423cb469ccc0ecc31f0e4e1c309976198ccb734cdcbb7029d4bda0f18f57e8d9
gradle/wrapper/gradle-wrapper.properties ae9287ed83e55d3a7e1fc1475faaf03fe6cb6e216a976d64852b1c4312ae3559
gradlew 80754763ee2382237c72a002d8b0a6fc48055b8a9f2c72a5bbf35f9ad4a51b23
gradlew.bat 21ccfc105c584c3b3aaa53cf3f6d04f9ab33982e5ad736cf3a83adcc45817b6e
settings.gradle 322de9e57a7304c0e9da69736326ec8d7fec5c3ed17c720159a653180737b082
src/main/java/dev/mcdev/generated/m_testmod/GeneratedContent.java e70fb9eef8c8e7d4092bdd721c908c5d80408b6b0f913c5bbe099f5d808be547
src/main/java/dev/mcdev/generated/m_testmod/GeneratedMod.java d28355d07796a64eb0bd1048a9b95fe02eb838fb7298544aff3a43fbdcab0a9d
src/main/resources/META-INF/neoforge.mods.toml 94c5ab378f58d40a48fd6daeca8210ba062a78f3d829aa19129751d29a996338
src/main/resources/assets/testmod/blockstates/ore.json dfbdcd96a344093c4ead91dbf182c21bc70394f3187a1b9e2623e07043f56820
src/main/resources/assets/testmod/items/gem.json c1654824445863f38d003367056c642d59b439d9d9674795dd7d2bc9db1f10a9
src/main/resources/assets/testmod/items/ore_item.json cb27b24c28556f5f94e99a52627ad9cc1b69f83c0d99b61cfd2bd970d794f067
src/main/resources/assets/testmod/lang/en_us.json 05b8b22c0f20d7121efe7426eeb2a7571d3af2c7466af3062aec6a56d30d8a05
src/main/resources/assets/testmod/models/block/ore.json 8879fea62e1d3c390b85a54522ae9ee97a4b3892b05563038167137deed21feb
src/main/resources/assets/testmod/models/item/gem.json 0c7e75dc384eea2f22d226c610ffb0152f4f3caade10b0310bf0f6b7871b0f16
src/main/resources/assets/testmod/textures/mcdev/placeholder.png 918a4d7a554bfec52db1649d1aa5d6db74d220d698c69d6724ce6bc12ecf6971
src/main/resources/data/testmod/loot_table/blocks/ore.json 0bd05fc590bbb4212198c00c52a7546032d8f15280163cbc057c6f1a0bed6c8d`,
);
