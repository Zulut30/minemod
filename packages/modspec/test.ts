import assert from "node:assert/strict";
import { z } from "zod";
import { validArtFixture, validModFixture } from "../../fixtures/specs/validation.ts";
import {
  ArtSpecJsonSchema,
  ArtSpecSchema,
  BMP_ONLY_STRING_PATTERN,
  ModSpecJsonSchema,
  ModSpecSchema,
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
assert.equal(ArtSpecSchema.safeParse(validArtFixture).success, true);
assert.equal(modProperties.schemaVersion?.const, 0);
assert.equal(artProperties.schemaVersion?.const, 0);

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
