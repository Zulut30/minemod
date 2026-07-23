import assert from "node:assert/strict";
import { z } from "zod";
import { validArtFixture, validFabricV1Fixture, validModFixture } from "../../fixtures/specs/validation.ts";
import {
  AnyModSpecSchema,
  ArtSpecJsonSchema,
  ArtSpecSchema,
  BMP_ONLY_STRING_PATTERN,
  ModSpecJsonSchema,
  ModSpecSchema,
  ModSpecV1JsonSchema,
  ModSpecV1Schema,
  RESOURCE_LOCATION_PATTERN,
  SAFE_ASSET_PATH_PATTERN,
} from "./index.ts";

function asJsonObject(value: unknown, label: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function jsonSchemaProperty(schema: unknown, property: string, label: string): Record<string, unknown> {
  const properties = asJsonObject(asJsonObject(schema, label).properties, `${label}.properties`);
  return asJsonObject(properties[property], `${label}.${property}`);
}

assert.equal(ModSpecJsonSchema.additionalProperties, false);
assert.equal(ArtSpecJsonSchema.additionalProperties, false);
const modProperties = ModSpecJsonSchema.properties as Record<string, Record<string, unknown>>;
const artProperties = ArtSpecJsonSchema.properties as Record<string, Record<string, unknown>>;
assert.equal(modProperties.project?.additionalProperties, false);
assert.equal(modProperties.target?.additionalProperties, false);
assert.equal(artProperties.style?.additionalProperties, false);
assert.equal(ModSpecSchema.safeParse({ schemaVersion: 0, kind: "mod", extra: true }).success, false);
assert.equal(ArtSpecSchema.safeParse({ schemaVersion: 0, kind: "art", extra: true }).success, false);
assert.equal(ModSpecSchema.safeParse(validModFixture).success, true);
assert.equal(ModSpecV1Schema.safeParse(validFabricV1Fixture).success, true);
assert.equal(AnyModSpecSchema.safeParse(validModFixture).success, true);
assert.equal(AnyModSpecSchema.safeParse(validFabricV1Fixture).success, true);
assert.equal(ArtSpecSchema.safeParse(validArtFixture).success, true);
assert.equal(modProperties.schemaVersion?.const, 0);
assert.equal(ModSpecV1JsonSchema.additionalProperties, false);
assert.equal((ModSpecV1JsonSchema.properties as Record<string, Record<string, unknown>>).schemaVersion?.const, 1);
assert.equal(artProperties.schemaVersion?.const, 0);

const configuredFabric = structuredClone(validFabricV1Fixture);
configuredFabric.integrations.yacl = {
  categories: [{
    id: "gameplay",
    name: "Gameplay",
    description: "Generated gameplay settings.",
    options: [
      {
        id: "enable_special_attacks",
        name: "Special attacks",
        type: "boolean",
        default: true,
        restartRequired: false,
      },
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
        default: "Stay alert",
        maxLength: 64,
        restartRequired: false,
      },
    ],
  }],
};
assert.equal(ModSpecV1Schema.safeParse(configuredFabric).success, true);
const invalidIntegerConfig = structuredClone(configuredFabric);
const invalidIntegerOption = invalidIntegerConfig.integrations.yacl!.categories[0]!.options
  .find((option) => option.type === "integer");
assert.ok(invalidIntegerOption?.type === "integer");
invalidIntegerOption.default = 33;
assert.equal(ModSpecV1Schema.safeParse(invalidIntegerConfig).success, false);
const emptyIntegerRange = structuredClone(configuredFabric);
const emptyIntegerRangeOption = emptyIntegerRange.integrations.yacl!.categories[0]!.options
  .find((option) => option.type === "integer");
assert.ok(emptyIntegerRangeOption?.type === "integer");
emptyIntegerRangeOption.minimum = emptyIntegerRangeOption.maximum;
assert.equal(ModSpecV1Schema.safeParse(emptyIntegerRange).success, false);
const overflowingInteger = structuredClone(configuredFabric);
const overflowingIntegerOption = overflowingInteger.integrations.yacl!.categories[0]!.options
  .find((option) => option.type === "integer");
assert.ok(overflowingIntegerOption?.type === "integer");
overflowingIntegerOption.maximum = 2_147_483_648;
assert.equal(ModSpecV1Schema.safeParse(overflowingInteger).success, false);
const duplicateConfigOption = structuredClone(configuredFabric);
duplicateConfigOption.integrations.yacl!.categories[0]!.options[2]!.id = "spawn_limit";
assert.equal(ModSpecV1Schema.safeParse(duplicateConfigOption).success, false);
const invalidStringConfig = structuredClone(configuredFabric);
const invalidStringOption = invalidStringConfig.integrations.yacl!.categories[0]!.options
  .find((option) => option.type === "string");
assert.ok(invalidStringOption?.type === "string");
invalidStringOption.maxLength = 4;
assert.equal(ModSpecV1Schema.safeParse(invalidStringConfig).success, false);
const boundServerConfig = structuredClone(configuredFabric);
const boundServerOption = boundServerConfig.integrations.yacl!.categories[0]!.options
  .find((option) => option.type === "string");
assert.ok(boundServerOption?.type === "string");
boundServerOption.binding = "player_join_message";
boundServerOption.restartRequired = true;
assert.equal(ModSpecV1Schema.safeParse(boundServerConfig).success, true);
const unsafeLiveServerConfig = structuredClone(boundServerConfig);
const unsafeLiveServerOption = unsafeLiveServerConfig.integrations.yacl!.categories[0]!.options
  .find((option) => option.type === "string");
assert.ok(unsafeLiveServerOption?.type === "string");
unsafeLiveServerOption.restartRequired = false;
assert.equal(ModSpecV1Schema.safeParse(unsafeLiveServerConfig).success, false);
const duplicateBinding = structuredClone(boundServerConfig);
duplicateBinding.integrations.yacl!.categories[0]!.options.push({
  id: "second_join_message",
  name: "Second join message",
  type: "string",
  default: "Welcome",
  maxLength: 64,
  binding: "player_join_message",
  restartRequired: true,
});
assert.equal(ModSpecV1Schema.safeParse(duplicateBinding).success, false);
const v1Integrations = jsonSchemaProperty(ModSpecV1JsonSchema, "integrations", "ModSpecV1");
assert.ok(Object.hasOwn(asJsonObject(v1Integrations.properties, "ModSpecV1.integrations.properties"), "yacl"));

const invalidStateMachine = structuredClone(validFabricV1Fixture);
invalidStateMachine.gameplay.entities[0]!.behavior.stateMachine.states = [];
assert.equal(ModSpecV1Schema.safeParse(invalidStateMachine).success, false);
const unsafeAction = structuredClone(validFabricV1Fixture) as unknown as {
  gameplay: { screens: Array<{ actions: Array<{ validation: { requireOpenMenu: boolean } }> }> };
};
unsafeAction.gameplay.screens[0]!.actions[0]!.validation.requireOpenMenu = false;
assert.equal(ModSpecV1Schema.safeParse(unsafeAction).success, false);

const shapedRecipe = structuredClone(validFabricV1Fixture);
shapedRecipe.gameplay.recipes = [{
  id: "infectedfrontier:blue_steel_sword",
  references: [],
  type: "shaped",
  ingredients: [],
  pattern: ["X", "X", "S"],
  key: [
    { symbol: "X", item: "infectedfrontier:blue_ingot" },
    { symbol: "S", item: "minecraft:stick" },
  ],
  result: "infectedfrontier:blue_steel_sword",
  resultCount: 1,
}];
assert.equal(ModSpecV1Schema.safeParse(shapedRecipe).success, true);
const unevenPattern = structuredClone(shapedRecipe);
unevenPattern.gameplay.recipes[0]!.pattern = ["XX", "S"];
assert.equal(ModSpecV1Schema.safeParse(unevenPattern).success, false);
const missingPatternKey = structuredClone(shapedRecipe);
missingPatternKey.gameplay.recipes[0]!.key = [
  { symbol: "X", item: "infectedfrontier:blue_ingot" },
];
assert.equal(ModSpecV1Schema.safeParse(missingPatternKey).success, false);
const duplicatePatternKey = structuredClone(shapedRecipe);
duplicatePatternKey.gameplay.recipes[0]!.key!.push({
  symbol: "X",
  item: "infectedfrontier:blue_ingot",
});
assert.equal(ModSpecV1Schema.safeParse(duplicatePatternKey).success, false);
const paddedPattern = structuredClone(shapedRecipe);
paddedPattern.gameplay.recipes[0]!.pattern = [" X", " X", " S"];
assert.equal(ModSpecV1Schema.safeParse(paddedPattern).success, false);

const equipmentSpec = structuredClone(validFabricV1Fixture);
equipmentSpec.gameplay.materials = [{
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
  palette: {
    base: "#477aa5",
    shadow: "#1b3347",
    highlight: "#bad9ef",
    accent: "#d4a72c",
    handle: "#60401f",
  },
}];
equipmentSpec.gameplay.items = [
  { id: "infectedfrontier:blue_ingot", references: [], maxStackSize: 64 },
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
    id: "infectedfrontier:blue_steel_chestplate",
    references: [],
    maxStackSize: 1,
    kind: "armor",
    material: "infectedfrontier:blue_steel",
    armorSlot: "chestplate",
  },
];
assert.equal(ModSpecV1Schema.safeParse(equipmentSpec).success, true);
const stackableSword = structuredClone(equipmentSpec);
stackableSword.gameplay.items[1]!.maxStackSize = 2;
assert.equal(ModSpecV1Schema.safeParse(stackableSword).success, false);
const invalidMiningLevel = structuredClone(equipmentSpec);
invalidMiningLevel.gameplay.materials[0]!.miningLevel = 5;
assert.equal(ModSpecV1Schema.safeParse(invalidMiningLevel).success, false);
const invalidArmorResistance = structuredClone(equipmentSpec);
invalidArmorResistance.gameplay.materials[0]!.armor!.knockbackResistance = 1.1;
assert.equal(ModSpecV1Schema.safeParse(invalidArmorResistance).success, false);
const flatEquipmentPalette = structuredClone(equipmentSpec);
flatEquipmentPalette.gameplay.materials[0]!.palette!.highlight = "#527fa7";
assert.equal(ModSpecV1Schema.safeParse(flatEquipmentPalette).success, false);
const duplicateEquipmentPalette = structuredClone(equipmentSpec);
duplicateEquipmentPalette.gameplay.materials[0]!.palette!.accent =
  duplicateEquipmentPalette.gameplay.materials[0]!.palette!.base;
assert.equal(ModSpecV1Schema.safeParse(duplicateEquipmentPalette).success, false);
const uppercaseEquipmentPalette = structuredClone(equipmentSpec);
uppercaseEquipmentPalette.gameplay.materials[0]!.palette!.base = "#477AA5";
assert.equal(ModSpecV1Schema.safeParse(uppercaseEquipmentPalette).success, false);

const resourceLocationPattern = new RegExp(RESOURCE_LOCATION_PATTERN);
assert.equal(resourceLocationPattern.test("tidecaller:a/b.c"), true);
for (const invalid of [
  "tidecaller:a//b",
  "tidecaller:a/./b",
  "tidecaller:a/../b",
  "tidecaller:a/",
  ".:a",
  "..:a",
]) {
  assert.equal(resourceLocationPattern.test(invalid), false, invalid);
}
const safeAssetPathPattern = new RegExp(SAFE_ASSET_PATH_PATTERN);
assert.equal(safeAssetPathPattern.test("tidecaller/textures/entity/crab.png"), true);
for (const supported of [
  "tidecaller/structures/altar.nbt",
  "tidecaller/structures/altar.snbt",
  "tidecaller/structures/altar.schem",
  "tidecaller/structures/altar.schematic",
  "tidecaller/models/decorative.blend",
]) {
  assert.equal(safeAssetPathPattern.test(supported), true, supported);
}
for (const invalid of [
  "tidecaller/textures//entity/crab.png",
  "tidecaller/textures/./entity/crab.png",
  "tidecaller/textures/../entity/crab.png",
  "tidecaller/textures/entity/crab.png/",
  "Tidecaller/textures/entity/crab.png",
]) {
  assert.equal(safeAssetPathPattern.test(invalid), false, invalid);
}

const projectNameContract = ModSpecSchema.shape.project.shape.name;
assert.equal(projectNameContract.safeParse("Ж".repeat(80)).success, true, "v0 is Unicode BMP, not ASCII-only");
assert.equal(projectNameContract.safeParse("Ж".repeat(81)).success, false);
assert.equal(projectNameContract.safeParse("😀").success, false, "supplementary pairs are outside the v0 BMP policy");
assert.equal(projectNameContract.safeParse("😀".repeat(81)).success, false, "supplementary pairs stay rejected over maxLength");
assert.equal(projectNameContract.safeParse("\uD83D").success, false, "lone high surrogate must be rejected");
assert.equal(projectNameContract.safeParse("\uDC00").success, false, "lone low surrogate must be rejected");
const bmpJsonSchema = z.toJSONSchema(projectNameContract);
assert.equal(bmpJsonSchema.minLength, 1);
assert.equal(bmpJsonSchema.maxLength, 80);
assert.equal(bmpJsonSchema.pattern, BMP_ONLY_STRING_PATTERN);
const emittedBmpPattern = new RegExp(String(bmpJsonSchema.pattern), "u");
assert.equal(emittedBmpPattern.test("Ж".repeat(80)), true);
assert.equal(emittedBmpPattern.test("😀"), false);
assert.equal(emittedBmpPattern.test("\uD83D"), false);
assert.equal(emittedBmpPattern.test("\uDC00"), false);

const projectSchema = jsonSchemaProperty(ModSpecJsonSchema, "project", "ModSpec");
const projectNameSchema = jsonSchemaProperty(projectSchema, "name", "ModSpec.project");
assert.equal(projectNameSchema.maxLength, 80);
assert.equal(projectNameSchema.pattern, BMP_ONLY_STRING_PATTERN);
const projectProvenanceSchema = asJsonObject(
  jsonSchemaProperty(projectSchema, "provenance", "ModSpec.project").items,
  "ModSpec.project.provenance.items",
);
const provenanceSourceSchema = jsonSchemaProperty(
  projectProvenanceSchema,
  "source",
  "ModSpec.project.provenance.items",
);
assert.equal(provenanceSourceSchema.maxLength, 2048);
assert.equal(provenanceSourceSchema.pattern, BMP_ONLY_STRING_PATTERN);
const targetSchema = jsonSchemaProperty(ModSpecJsonSchema, "target", "ModSpec");
const minecraftSchema = jsonSchemaProperty(targetSchema, "minecraft", "ModSpec.target");
assert.equal(minecraftSchema.maxLength, 32);
assert.equal(minecraftSchema.pattern, BMP_ONLY_STRING_PATTERN);
const styleSchema = jsonSchemaProperty(ArtSpecJsonSchema, "style", "ArtSpec");
const familySchema = jsonSchemaProperty(styleSchema, "family", "ArtSpec.style");
assert.equal(familySchema.maxLength, 64);
assert.equal(familySchema.pattern, BMP_ONLY_STRING_PATTERN);

const gameplaySchema = jsonSchemaProperty(ModSpecJsonSchema, "gameplay", "ModSpec");
assert.equal(gameplaySchema.additionalProperties, false);
for (const section of ["items", "blocks", "entities", "recipes", "summoning", "screens"]) {
  assert.ok(Object.hasOwn(asJsonObject(gameplaySchema.properties, "ModSpec.gameplay.properties"), section));
}
const resourcesSchema = jsonSchemaProperty(gameplaySchema, "items", "ModSpec.gameplay");
const resourceItemSchema = asJsonObject(resourcesSchema.items, "ModSpec.gameplay.items.items");
assert.equal(
  new RegExp(String(jsonSchemaProperty(resourceItemSchema, "id", "ModSpec.gameplay.items.items").pattern)).source,
  new RegExp(RESOURCE_LOCATION_PATTERN).source,
);
const assetsSchema = jsonSchemaProperty(ModSpecJsonSchema, "assets", "ModSpec");
for (const section of ["models", "textures", "animations"]) {
  assert.ok(Object.hasOwn(asJsonObject(assetsSchema.properties, "ModSpec.assets.properties"), section));
}
const assetEntriesSchema = jsonSchemaProperty(assetsSchema, "models", "ModSpec.assets");
const assetItemSchema = asJsonObject(assetEntriesSchema.items, "ModSpec.assets.models.items");
assert.equal(
  new RegExp(String(jsonSchemaProperty(assetItemSchema, "path", "ModSpec.assets.models.items").pattern)).source,
  new RegExp(SAFE_ASSET_PATH_PATTERN).source,
);

const artTargetMatrix = jsonSchemaProperty(ArtSpecJsonSchema, "targetMatrix", "ArtSpec");
assert.equal(artTargetMatrix.minItems, 1);
const artTargetTuple = asJsonObject(artTargetMatrix.items, "ArtSpec.targetMatrix.items");
assert.equal(artTargetTuple.additionalProperties, false);
for (const key of ["minecraft", "loader", "java", "loaderVersion", "runtime", "renderer"]) {
  assert.ok(Object.hasOwn(asJsonObject(artTargetTuple.properties, "ArtSpec.targetMatrix.items.properties"), key));
}
for (const requiredField of [
  "assetClass",
  "targetMatrix",
  "targetContexts",
  "provenancePolicy",
  "references",
  "budgets",
]) {
  const candidate = structuredClone(validArtFixture) as Record<string, unknown>;
  delete candidate[requiredField];
  assert.equal(ArtSpecSchema.safeParse(candidate).success, false, `${requiredField} is required`);
}
for (const requiredStyleField of [
  "palette",
  "targetPaletteColors",
  "hueValueHierarchy",
  "lighting",
  "outline",
  "saturation",
  "detail",
  "materialRecipes",
  "silhouetteLanguage",
  "forbiddenReferences",
  "textureResolution",
  "texelDensity",
]) {
  const candidate = structuredClone(validArtFixture) as unknown as { style: Record<string, unknown> };
  delete candidate.style[requiredStyleField];
  assert.equal(ArtSpecSchema.safeParse(candidate).success, false, `style.${requiredStyleField} is required`);
}
