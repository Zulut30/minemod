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

function fabricEquipmentFixture() {
  const equipment = fabricBasicContentFixture();
  equipment.gameplay.materials = [{
    id: "infectedfrontier:blue_steel",
    repairIngredient: "infectedfrontier:blue_ingot",
    durability: 1_024,
    miningSpeed: 9,
    attackDamageBonus: 4,
    miningLevel: 3,
    enchantmentValue: 18,
    armor: {
      durabilityMultiplier: 32,
      defense: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
      toughness: 2,
      knockbackResistance: 0.1,
    },
  }];
  equipment.gameplay.items.push(
    {
      id: "infectedfrontier:blue_steel_sword",
      references: [],
      maxStackSize: 1,
      kind: "sword",
      material: "infectedfrontier:blue_steel",
      attackDamage: 4,
      attackSpeed: -2.4,
    },
    {
      id: "infectedfrontier:blue_steel_pickaxe",
      references: [],
      maxStackSize: 1,
      kind: "pickaxe",
      material: "infectedfrontier:blue_steel",
      attackDamage: 1,
      attackSpeed: -2.8,
    },
    {
      id: "infectedfrontier:blue_steel_axe",
      references: [],
      maxStackSize: 1,
      kind: "axe",
      material: "infectedfrontier:blue_steel",
      attackDamage: 6,
      attackSpeed: -3,
    },
    {
      id: "infectedfrontier:blue_steel_shovel",
      references: [],
      maxStackSize: 1,
      kind: "shovel",
      material: "infectedfrontier:blue_steel",
      attackDamage: 2,
      attackSpeed: -3,
    },
    {
      id: "infectedfrontier:blue_steel_hoe",
      references: [],
      maxStackSize: 1,
      kind: "hoe",
      material: "infectedfrontier:blue_steel",
      attackDamage: 0,
      attackSpeed: 0,
    },
    {
      id: "infectedfrontier:blue_steel_chestplate",
      references: [],
      maxStackSize: 1,
      kind: "armor",
      material: "infectedfrontier:blue_steel",
      armorSlot: "chestplate",
    },
  );
  return equipment;
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

const shapedRecipe = fabricBasicContentFixture();
shapedRecipe.gameplay.recipes = [{
  id: "infectedfrontier:blue_ingot_pattern",
  references: [],
  type: "shaped",
  ingredients: [],
  pattern: ["XX", " S"],
  key: [
    { symbol: "X", item: "infectedfrontier:blue_ore_item" },
    { symbol: "S", item: "minecraft:stick" },
  ],
  result: "infectedfrontier:blue_ingot",
  resultCount: 2,
}];
const compiledShapedRecipe = await compileFabricPhase1(JSON.stringify(shapedRecipe));
assert.deepEqual(
  JSON.parse(textOutput(
    compiledShapedRecipe,
    "src/main/resources/data/infectedfrontier/recipes/blue_ingot_pattern.json",
  )),
  {
    category: "misc",
    key: {
      S: { item: "minecraft:stick" },
      X: { item: "infectedfrontier:blue_ore_item" },
    },
    pattern: ["XX", " S"],
    result: { count: 2, item: "infectedfrontier:blue_ingot" },
    show_notification: true,
    type: "minecraft:crafting_shaped",
  },
);
const reorderedShapedKey = structuredClone(shapedRecipe);
reorderedShapedKey.gameplay.recipes[0]!.key?.reverse();
assert.equal(
  (await compileFabricPhase1(JSON.stringify(reorderedShapedKey))).plan.planId,
  compiledShapedRecipe.plan.planId,
  "shaped recipe key declaration order must not affect generated content",
);

const equipment = fabricEquipmentFixture();
const compiledEquipment = await compileFabricPhase1(JSON.stringify(equipment));
const equipmentSource = textOutput(
  compiledEquipment,
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedContent.java",
);
assert.match(equipmentSource, /private static final Tier MATERIAL_BLUE_USTEEL = new Tier\(\)/u);
assert.match(equipmentSource, /getUses\(\) \{ return 1024; \}/u);
assert.match(equipmentSource, /getLevel\(\) \{ return 3; \}/u);
assert.match(equipmentSource, /private static final ArmorMaterial ARMOR_MATERIAL_BLUE_USTEEL/u);
assert.match(equipmentSource, /case CHESTPLATE -> 512;/u);
assert.match(equipmentSource, /case CHESTPLATE -> 8;/u);
assert.match(equipmentSource, /new SwordItem\(MATERIAL_BLUE_USTEEL, 4,/u);
assert.match(equipmentSource, /new PickaxeItem\(MATERIAL_BLUE_USTEEL, 1,[\s\S]*\) \{\}/u);
assert.match(equipmentSource, /new AxeItem\(MATERIAL_BLUE_USTEEL, 6,[\s\S]*\) \{\}/u);
assert.match(equipmentSource, /new ShovelItem\(MATERIAL_BLUE_USTEEL, 2,/u);
assert.match(equipmentSource, /new HoeItem\(MATERIAL_BLUE_USTEEL, 0,[\s\S]*\) \{\}/u);
assert.match(
  equipmentSource,
  /new ArmorItem\(ARMOR_MATERIAL_BLUE_USTEEL, ArmorItem\.Type\.CHESTPLATE, new Item\.Properties\(\)\)/u,
);
assert.match(equipmentSource, /CreativeModeTabs\.TOOLS_AND_UTILITIES/u);
assert.match(equipmentSource, /CreativeModeTabs\.COMBAT/u);
assert.equal(
  JSON.parse(textOutput(
    compiledEquipment,
    "src/main/resources/assets/infectedfrontier/models/item/blue_steel_sword.json",
  )).parent,
  "minecraft:item/handheld",
);
assert.equal(
  JSON.parse(textOutput(
    compiledEquipment,
    "src/main/resources/assets/infectedfrontier/models/item/blue_steel_chestplate.json",
  )).parent,
  "minecraft:item/generated",
);
for (const layer of [1, 2]) {
  assert.ok(compiledEquipment.outputs.some(({ file }) =>
    file.path === `src/main/resources/assets/infectedfrontier/textures/models/armor/blue_steel_layer_${layer}.png`));
}
assert.deepEqual(
  JSON.parse(textOutput(compiledEquipment, "src/main/resources/data/minecraft/tags/items/swords.json")),
  { values: ["infectedfrontier:blue_steel_sword"] },
);
assert.deepEqual(
  JSON.parse(textOutput(compiledEquipment, "src/main/resources/data/minecraft/tags/items/trimmable_armor.json")),
  { values: ["infectedfrontier:blue_steel_chestplate"] },
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
const libraries = fabricBasicContentFixture();
libraries.dependencies.required = ["yet_another_config_lib_v3"];
libraries.dependencies.optional = ["modmenu"];
const compiledLibraries = await compileFabricPhase1(JSON.stringify(libraries));
const libraryBuild = textOutput(compiledLibraries, "build.gradle");
assert.match(libraryBuild, /https:\/\/maven\.isxander\.dev\/releases\//u);
assert.match(libraryBuild, /https:\/\/maven\.quiltmc\.org\/repository\/release\//u);
assert.match(libraryBuild, /https:\/\/maven\.terraformersmc\.com\/releases\//u);
assert.match(libraryBuild, /com\.terraformersmc:modmenu:7\.2\.2/u);
assert.match(libraryBuild, /dev\.isxander:yet-another-config-lib:3\.5\.0\+1\.20\.1-fabric/u);
const libraryMetadata = JSON.parse(textOutput(
  compiledLibraries,
  "src/main/resources/fabric.mod.json",
)) as {
  depends: Record<string, string>;
  suggests: Record<string, string>;
  entrypoints: Record<string, string[]>;
};
assert.equal(libraryMetadata.depends.yet_another_config_lib_v3, ">=3.5.0+1.20.1-fabric");
assert.equal(libraryMetadata.suggests.modmenu, "*");
assert.deepEqual(libraryMetadata.entrypoints.modmenu, [
  "dev.mcdev.generated.m_infectedfrontier.client.GeneratedModMenuIntegration",
]);
const generatedConfig = textOutput(
  compiledLibraries,
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedConfig.java",
);
assert.match(generatedConfig, /ConfigClassHandler\.createBuilder\(GeneratedConfig\.class\)/u);
assert.match(generatedConfig, /resolve\(GeneratedMod\.MOD_ID \+ "\.json5"\)/u);
assert.match(generatedConfig, /showGeneratedContentInCreativeTabs = true/u);
assert.match(
  textOutput(compiledLibraries, "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java"),
  /GeneratedConfig\.HANDLER\.load\(\);[\s\S]*GeneratedContent\.register\(\s*GeneratedConfig\.HANDLER\.instance\(\)\.showGeneratedContentInCreativeTabs\);/u,
);
assert.match(
  textOutput(compiledLibraries, "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedContent.java"),
  /register\(boolean showGeneratedContentInCreativeTabs\)[\s\S]*if \(!showGeneratedContentInCreativeTabs\) return;/u,
);
const generatedModMenu = textOutput(
  compiledLibraries,
  "src/client/java/dev/mcdev/generated/m_infectedfrontier/client/GeneratedModMenuIntegration.java",
);
assert.match(generatedModMenu, /implements ModMenuApi/u);
assert.match(generatedModMenu, /YetAnotherConfigLib\.create\(GeneratedConfig\.HANDLER/u);
assert.match(generatedModMenu, /BooleanControllerBuilder::create/u);
assert.match(generatedModMenu, /OptionFlag\.GAME_RESTART/u);
assert.equal(
  compiledLibraries.outputs.some(({ file }) => file.path.endsWith("/GeneratedConfiguredBehavior.java")),
  false,
);
assert.deepEqual(
  JSON.parse(textOutput(compiledLibraries, "src/main/resources/assets/infectedfrontier/lang/en_us.json")),
  {
    "block.infectedfrontier.blue_ore": "Blue Ore",
    "config.infectedfrontier.category.general": "General",
    "config.infectedfrontier.show_generated_content": "Show Generated Content",
    "config.infectedfrontier.show_generated_content.description":
      "Show generated items and blocks in their default creative tabs after restarting the game.",
    "config.infectedfrontier.title": "Infected \"Frontier\" Configuration",
    "item.infectedfrontier.blue_ingot": "Blue Ingot",
    "item.infectedfrontier.blue_ore_item": "Blue Ore Item",
  },
);
const yaclOnly = fabricBasicContentFixture();
yaclOnly.dependencies.required = ["yet_another_config_lib_v3"];
const compiledYaclOnly = await compileFabricPhase1(JSON.stringify(yaclOnly));
assert.ok(compiledYaclOnly.outputs.some(({ file }) => file.path.endsWith("/GeneratedConfig.java")));
assert.equal(
  (JSON.parse(textOutput(compiledYaclOnly, "src/main/resources/fabric.mod.json")) as {
    entrypoints: Record<string, string[]>;
  }).entrypoints.modmenu,
  undefined,
);
const modMenuOnly = fabricBasicContentFixture();
modMenuOnly.dependencies.optional = ["modmenu"];
const compiledModMenuOnly = await compileFabricPhase1(JSON.stringify(modMenuOnly));
assert.equal(
  compiledModMenuOnly.outputs.some(({ file }) => file.path.endsWith("/GeneratedConfig.java")),
  false,
);
assert.equal(
  (JSON.parse(textOutput(compiledModMenuOnly, "src/main/resources/fabric.mod.json")) as {
    entrypoints: Record<string, string[]>;
  }).entrypoints.modmenu,
  undefined,
);
const configuredWithoutLibraries = fabricBasicContentFixture();
configuredWithoutLibraries.integrations.yacl = {
  categories: [{
    id: "gameplay",
    name: "Gameplay",
    description: "Gameplay tuning.",
    options: [{
      id: "enable_special_attacks",
      name: "Special attacks",
      description: "Allow special attacks.",
      type: "boolean",
      default: true,
      restartRequired: false,
    }],
  }],
};
await expectCompilerError(
  JSON.stringify(configuredWithoutLibraries),
  "SPEC_UNSUPPORTED",
  "/integrations/yacl",
);
const configuredWithoutModMenu = structuredClone(configuredWithoutLibraries);
configuredWithoutModMenu.dependencies.required = ["yet_another_config_lib_v3"];
await expectCompilerError(
  JSON.stringify(configuredWithoutModMenu),
  "SPEC_UNSUPPORTED",
  "/integrations/yacl",
);
const configuredLibraries = structuredClone(configuredWithoutLibraries);
configuredLibraries.dependencies.required = ["yet_another_config_lib_v3"];
configuredLibraries.dependencies.optional = ["modmenu"];
configuredLibraries.integrations.yacl!.categories[0]!.options.push(
  {
    id: "spawn_limit",
    name: "Spawn limit",
    type: "integer",
    default: 8,
    minimum: 1,
    maximum: 32,
    step: 1,
    restartRequired: true,
  },
  {
    id: "welcome_message",
    name: "Welcome message",
    type: "string",
    default: "Stay\u2028alert",
    maxLength: 64,
    binding: "player_join_message",
    restartRequired: true,
  },
);
const compiledConfiguredLibraries = await compileFabricPhase1(JSON.stringify(configuredLibraries));
const configuredSource = textOutput(
  compiledConfiguredLibraries,
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedConfig.java",
);
assert.match(configuredSource, /public boolean option_enable_special_attacks = true;/u);
assert.match(configuredSource, /public int option_spawn_limit = 8;/u);
assert.match(configuredSource, /public String option_welcome_message = "Stay\\u2028alert";/u);
assert.match(
  configuredSource,
  /config\.option_spawn_limit = Math\.max\(1, Math\.min\(32, config\.option_spawn_limit\)\);/u,
);
assert.match(configuredSource, /config\.option_welcome_message = limitString\(config\.option_welcome_message, 64\);/u);
assert.match(
  textOutput(
    compiledConfiguredLibraries,
    "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java",
  ),
  /GeneratedConfig\.normalize\(\);/u,
);
const configuredScreen = textOutput(
  compiledConfiguredLibraries,
  "src/client/java/dev/mcdev/generated/m_infectedfrontier/client/GeneratedModMenuIntegration.java",
);
assert.match(configuredScreen, /category\.custom\.gameplay/u);
assert.match(configuredScreen, /Option\.<Boolean>createBuilder\(\)/u);
assert.match(configuredScreen, /Option\.<Integer>createBuilder\(\)/u);
assert.match(configuredScreen, /IntegerSliderControllerBuilder[\s\S]*\.range\(1, 32\)[\s\S]*\.step\(1\)/u);
assert.match(configuredScreen, /Option\.<String>createBuilder\(\)/u);
assert.match(configuredScreen, /StringControllerBuilder::create/u);
assert.match(configuredScreen, /GeneratedConfig\.limitString\([\s\S]*value, 64\)/u);
const configuredLanguage = JSON.parse(textOutput(
  compiledConfiguredLibraries,
  "src/main/resources/assets/infectedfrontier/lang/en_us.json",
)) as Record<string, string>;
assert.equal(configuredLanguage["config.infectedfrontier.category.custom.gameplay"], "Gameplay");
assert.equal(
  configuredLanguage["config.infectedfrontier.category.custom.gameplay.description"],
  "Gameplay tuning.",
);
assert.equal(
  configuredLanguage["config.infectedfrontier.option.custom.enable_special_attacks.description"],
  "Allow special attacks.",
);
assert.equal(configuredLanguage["config.infectedfrontier.option.custom.spawn_limit"], "Spawn limit");
assert.equal(configuredLanguage["config.infectedfrontier.option.custom.welcome_message"], "Welcome message");
const configuredBehavior = textOutput(
  compiledConfiguredLibraries,
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedConfiguredBehavior.java",
);
assert.match(configuredBehavior, /ServerPlayConnectionEvents\.JOIN\.register/u);
assert.match(configuredBehavior, /GeneratedConfig\.HANDLER\.instance\(\)\.option_welcome_message/u);
assert.match(configuredBehavior, /handler\.player\.sendSystemMessage\(Component\.literal\(message\)\)/u);
assert.match(
  textOutput(
    compiledConfiguredLibraries,
    "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java",
  ),
  /GeneratedConfiguredBehavior\.register\(\);/u,
);
const unknownLibrary = fabricBasicContentFixture();
unknownLibrary.dependencies.required = ["unknown_library"];
await expectCompilerError(JSON.stringify(unknownLibrary), "SPEC_UNSUPPORTED", "/dependencies/required/0");
const requiredModMenu = fabricBasicContentFixture();
requiredModMenu.dependencies.required = ["modmenu"];
await expectCompilerError(JSON.stringify(requiredModMenu), "SPEC_UNSUPPORTED", "/dependencies/required/0");
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
const unknownShapedIngredient = structuredClone(shapedRecipe);
unknownShapedIngredient.gameplay.recipes[0]!.key![0]!.item = "othermod:blue_ore";
await expectCompilerError(
  JSON.stringify(unknownShapedIngredient),
  "SPEC_UNSUPPORTED",
  "/gameplay/recipes/0/key/0/item",
);
const missingEquipmentMaterial = fabricEquipmentFixture();
const equipmentSword = missingEquipmentMaterial.gameplay.items.find(({ id }) => id.endsWith("_sword"));
assert.ok(equipmentSword !== undefined && "material" in equipmentSword);
equipmentSword.material = "infectedfrontier:missing_material";
await expectCompilerError(
  JSON.stringify(missingEquipmentMaterial),
  "SPEC_UNSUPPORTED",
  `/gameplay/items/${missingEquipmentMaterial.gameplay.items.indexOf(equipmentSword)}/material`,
);
const armorWithoutProperties = fabricEquipmentFixture();
armorWithoutProperties.gameplay.materials[0]!.armor = undefined;
const armorIndex = armorWithoutProperties.gameplay.items.findIndex(({ kind }) => kind === "armor");
await expectCompilerError(
  JSON.stringify(armorWithoutProperties),
  "SPEC_UNSUPPORTED",
  `/gameplay/items/${armorIndex}/material`,
);
const unknownRepairIngredient = fabricEquipmentFixture();
unknownRepairIngredient.gameplay.materials[0]!.repairIngredient = "othermod:blue_ingot";
await expectCompilerError(
  JSON.stringify(unknownRepairIngredient),
  "SPEC_UNSUPPORTED",
  "/gameplay/materials/0/repairIngredient",
);
const foreignMaterial = fabricEquipmentFixture();
foreignMaterial.gameplay.materials[0]!.id = "othermod:blue_steel";
await expectCompilerError(JSON.stringify(foreignMaterial), "SPEC_UNSUPPORTED", "/gameplay/materials/0/id");
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
