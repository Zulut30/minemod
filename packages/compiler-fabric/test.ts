import assert from "node:assert/strict";
import { containsForbiddenExecutionSurface, isBuildPlan } from "@mcdev/contracts";
import { fabricBasicContentFixture } from "../../fixtures/specs/fabric-basic-content.ts";
import { validFabricV1Fixture } from "../../fixtures/specs/validation.ts";
import {
  compileFabricPhase1,
  FabricCompilerError,
  type CompiledFabricProject,
} from "./index.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

function textOutput(result: CompiledFabricProject, path: string): string {
  const output = result.outputs.find(({ file }) => file.path === path);
  assert.ok(output !== undefined, `missing generated output ${path}`);
  return decoder.decode(output.file.bytes);
}

async function expectCompilerError(
  payload: string,
  code: FabricCompilerError["code"],
  path?: string,
): Promise<FabricCompilerError> {
  try {
    await compileFabricPhase1(payload);
  } catch (error) {
    assert.ok(error instanceof FabricCompilerError);
    assert.equal(error.code, code);
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
  "src/client/java/dev/mcdev/generated/m_infectedfrontier/client/GeneratedClient.java",
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedContent.java",
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java",
  "src/main/resources/assets/infectedfrontier/blockstates/blue_ore.json",
  "src/main/resources/assets/infectedfrontier/lang/en_us.json",
  "src/main/resources/assets/infectedfrontier/models/block/blue_ore.json",
  "src/main/resources/assets/infectedfrontier/models/item/blue_ingot.json",
  "src/main/resources/assets/infectedfrontier/models/item/blue_ore_item.json",
  "src/main/resources/assets/infectedfrontier/textures/mcdev/placeholder.png",
  "src/main/resources/data/infectedfrontier/loot_tables/blocks/blue_ore.json",
  "src/main/resources/data/infectedfrontier/recipes/blue_ingot_recycling.json",
  "src/main/resources/data/infectedfrontier/recipes/smelt_blue_ore.json",
  "src/main/resources/fabric.mod.json",
];

const fixture = fabricBasicContentFixture();
const compiled = await compileFabricPhase1(JSON.stringify(fixture));
assert.deepEqual(compiled.outputs.map(({ file }) => file.path), expectedPaths);
assert.equal(Object.isFrozen(compiled), true);
assert.equal(Object.isFrozen(compiled.outputs), true);
assert.equal(Object.isFrozen(compiled.plan), true);
assert.equal(isBuildPlan(compiled.plan), true);
assert.equal(containsForbiddenExecutionSurface(compiled.plan), false);
assert.equal(compiled.plan.pack.packId, "fabric-1.20.1-java-17");
assert.deepEqual(compiled.plan.nodes.map(({ nodeId }) => nodeId), [
  "apply-workspace",
  "generate-content",
  "generate-project",
  "gradle-clean-build",
  "index-artifacts",
]);
const buildNode = compiled.plan.nodes.find(({ kind }) => kind === "gradle-clean-build");
assert.ok(buildNode?.kind === "gradle-clean-build");
assert.equal(buildNode.policy, "fabric-1.20.1-phase1-v1");
assert.equal(compiled.plan.nodes.find(({ nodeId }) => nodeId === "generate-project")?.outputs.length, 10);
assert.equal(compiled.plan.nodes.find(({ nodeId }) => nodeId === "generate-content")?.outputs.length, 12);
assert.deepEqual(compiled.plan.warnings, ["PLACEHOLDER_ASSETS_USED"]);

const fabricMod = JSON.parse(textOutput(compiled, "src/main/resources/fabric.mod.json")) as {
  name: string;
  entrypoints: { main: string[]; client: string[] };
};
assert.equal(fabricMod.name, fixture.project.name);
assert.deepEqual(fabricMod.entrypoints, {
  main: ["dev.mcdev.generated.m_infectedfrontier.GeneratedMod"],
  client: ["dev.mcdev.generated.m_infectedfrontier.client.GeneratedClient"],
});
assert.equal(textOutput(compiled, "src/main/resources/fabric.mod.json").includes("@@MCDEV_"), false);
assert.match(
  textOutput(compiled, "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java"),
  /implements ModInitializer/u,
);
assert.match(
  textOutput(compiled, "src/client/java/dev/mcdev/generated/m_infectedfrontier/client/GeneratedClient.java"),
  /implements ClientModInitializer/u,
);
const generatedContent = textOutput(
  compiled,
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedContent.java",
);
assert.match(generatedContent, /Registry\.register\(BuiltInRegistries\.BLOCK/u);
assert.match(generatedContent, /BLOCK_BLUE_UORE/u);
assert.match(generatedContent, /Float\.intBitsToFloat\(0x40600000\)/u);
assert.match(generatedContent, /new Item\(new Item\.Properties\(\)\.stacksTo\(32\)\)/u);
assert.match(generatedContent, /new BlockItem\(BLOCK_BLUE_UORE, new Item\.Properties\(\)\.stacksTo\(64\)\)/u);
assert.match(generatedContent, /modifyEntriesEvent\(CreativeModeTabs\.INGREDIENTS\)/u);
assert.match(generatedContent, /modifyEntriesEvent\(CreativeModeTabs\.BUILDING_BLOCKS\)/u);
assert.match(
  textOutput(compiled, "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java"),
  /GeneratedContent\.register\(\)/u,
);
assert.equal(
  textOutput(compiled, "src/main/resources/assets/infectedfrontier/models/item/blue_ingot.json"),
  '{"parent":"minecraft:item/generated","textures":{"layer0":"infectedfrontier:mcdev/placeholder"}}\n',
);
assert.equal(
  textOutput(compiled, "src/main/resources/assets/infectedfrontier/models/item/blue_ore_item.json"),
  '{"parent":"infectedfrontier:block/blue_ore"}\n',
);
assert.deepEqual(
  JSON.parse(textOutput(compiled, "src/main/resources/assets/infectedfrontier/lang/en_us.json")),
  {
    "block.infectedfrontier.blue_ore": "Blue Ore",
    "item.infectedfrontier.blue_ingot": "Blue Ingot",
    "item.infectedfrontier.blue_ore_item": "Blue Ore Item",
  },
);
assert.deepEqual(
  JSON.parse(textOutput(compiled, "src/main/resources/data/infectedfrontier/loot_tables/blocks/blue_ore.json")),
  {
    pools: [{
      bonus_rolls: 0,
      conditions: [{ condition: "minecraft:survives_explosion" }],
      entries: [{ name: "infectedfrontier:blue_ore_item", type: "minecraft:item" }],
      rolls: 1,
    }],
    type: "minecraft:block",
  },
);
assert.deepEqual(
  JSON.parse(textOutput(compiled, "src/main/resources/data/infectedfrontier/recipes/blue_ingot_recycling.json")),
  {
    category: "misc",
    ingredients: [{ item: "infectedfrontier:blue_ore_item" }],
    result: { item: "infectedfrontier:blue_ingot" },
    type: "minecraft:crafting_shapeless",
  },
);
assert.deepEqual(
  JSON.parse(textOutput(compiled, "src/main/resources/data/infectedfrontier/recipes/smelt_blue_ore.json")),
  {
    category: "misc",
    cookingtime: 200,
    experience: 0,
    ingredient: { item: "infectedfrontier:blue_ore_item" },
    result: "infectedfrontier:blue_ingot",
    type: "minecraft:smelting",
  },
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
  (await compileFabricPhase1(JSON.stringify(reorderedRoot, null, 2))).plan.planId,
  compiled.plan.planId,
  "JSON whitespace and key order must not affect the Fabric plan",
);
const reorderedContent = fabricBasicContentFixture();
reorderedContent.gameplay.items.reverse();
reorderedContent.gameplay.recipes.reverse();
assert.equal(
  (await compileFabricPhase1(JSON.stringify(reorderedContent))).plan.planId,
  compiled.plan.planId,
  "item declaration order must not affect generated content",
);

await expectCompilerError(JSON.stringify(validFabricV1Fixture), "SPEC_UNSUPPORTED", "/gameplay/entities");
const hyphenated = fabricBasicContentFixture();
hyphenated.project.modId = "infected-frontier";
await expectCompilerError(JSON.stringify(hyphenated), "SPEC_UNSUPPORTED", "/project/modId");
const foreignNamespace = fabricBasicContentFixture();
foreignNamespace.gameplay.recipes = [];
foreignNamespace.gameplay.items[0]!.id = "othermod:blue_ingot";
await expectCompilerError(JSON.stringify(foreignNamespace), "SPEC_UNSUPPORTED", "/gameplay/items/0/id");
const referencedItem = fabricBasicContentFixture();
referencedItem.gameplay.items[0]!.references = ["infectedfrontier:blue_ore_item"];
await expectCompilerError(JSON.stringify(referencedItem), "SPEC_UNSUPPORTED", "/gameplay/items/0/references");
const shapedRecipe = fabricBasicContentFixture();
shapedRecipe.gameplay.recipes[0]!.type = "shaped";
await expectCompilerError(JSON.stringify(shapedRecipe), "SPEC_UNSUPPORTED", "/gameplay/recipes/0/type");
const customSerializer = fabricBasicContentFixture();
customSerializer.gameplay.recipes[0]!.serializer = "infectedfrontier:custom";
await expectCompilerError(JSON.stringify(customSerializer), "SPEC_UNSUPPORTED", "/gameplay/recipes/0/serializer");
const invalidSmelting = fabricBasicContentFixture();
invalidSmelting.gameplay.recipes[1]!.ingredients.push("infectedfrontier:blue_ingot");
await expectCompilerError(
  JSON.stringify(invalidSmelting),
  "SPEC_UNSUPPORTED",
  "/gameplay/recipes/1/ingredients",
);
const foreignRecipe = fabricBasicContentFixture();
foreignRecipe.gameplay.recipes[0]!.id = "othermod:blue_ingot_recycling";
await expectCompilerError(JSON.stringify(foreignRecipe), "SPEC_UNSUPPORTED", "/gameplay/recipes/0/id");
const blockRecipeResult = fabricBasicContentFixture();
blockRecipeResult.gameplay.recipes[0]!.result = "infectedfrontier:blue_ore";
await expectCompilerError(JSON.stringify(blockRecipeResult), "SPEC_UNSUPPORTED", "/gameplay/recipes/0/result");
const v0 = { ...fixture, schemaVersion: 0 };
await expectCompilerError(JSON.stringify(v0), "SPEC_INVALID", "/schemaVersion");
await expectCompilerError("{", "SPEC_INVALID");
