import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AnyArtSpecSchema, ArtSpecJsonSchema, ArtSpecSchema, ArtSpecV1JsonSchema, MODEL_CLASSES, type ArtSpecV1 } from "@mcdev/modspec";
import { validArtFixture } from "../../fixtures/specs/validation.ts";
import { createArtPlan, MAX_ART_PLAN_BYTES, MAX_DIAGNOSTICS, validateInlineSpec, validateSpec } from "./index.ts";

export const ART_FIXTURE_NAMES = ["polar-cleaver", "polar-armor", "copper-masonry", "tide-altar", "tidecaller-crab", "leaf-sword"] as const;
const readFixture = (name: string) => readFileSync(new URL(`../../fixtures/art/${name}.artspec-v1.json`, import.meta.url), "utf8");
const weapon = JSON.parse(readFixture("polar-cleaver")) as ArtSpecV1;
const original = JSON.stringify(weapon);
const classes = new Set<string>();
for (const name of ART_FIXTURE_NAMES) {
  const payload = readFixture(name);
  const result = validateInlineSpec(payload, "art", { profile: "fabric-1.20.1-java-17" });
  assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.diagnostics)}`);
  const plan = createArtPlan(payload).plan;
  assert(plan);
  assert.equal(plan.sourceSha256, createHash("sha256").update(payload).digest("hex"));
  const source = JSON.parse(payload) as ArtSpecV1;
  assert.deepEqual(plan.modelIntent, source.modelIntent);
  assert.deepEqual(plan.style, source.style);
  assert.deepEqual(plan.budgets, source.budgets);
  assert.deepEqual(plan.textureLayout, source.textureLayout);
  assert.deepEqual(plan.requiredCaptures, source.targetContexts);
  assert.deepEqual(plan.status, { specification: "validated", generation: "not-run", runtimeCapability: "not-verified", artistic: "requires-human-review", game: "not-run", integration: "not-run" });
  assert.equal(source.assets.length, 0, "Pre-generation fixtures must not invent exported assets.");
  assert(Buffer.byteLength(JSON.stringify(plan)) < MAX_ART_PLAN_BYTES);
  classes.add(source.modelIntent.modelClass);
}
assert.deepEqual([...classes].sort(), [...MODEL_CLASSES].sort());
assert(ArtSpecSchema.safeParse(validArtFixture).success);
assert(AnyArtSpecSchema.safeParse(validArtFixture).success);
assert.equal(validateSpec(validArtFixture).valid, true, "v0 retains its legacy palette rules.");
assert.equal(createArtPlan(JSON.stringify(validArtFixture)).valid, false, "No implicit v0 migration.");
assert.equal((ArtSpecJsonSchema.properties as Record<string, unknown>).modelIntent, undefined);
assert.equal(ArtSpecV1JsonSchema.additionalProperties, false);
assert.equal((ArtSpecV1JsonSchema.properties as Record<string, { const?: number }>).schemaVersion!.const, 1);

let negatives = 0;
function reject(change: (draft: ArtSpecV1) => void, path: string, fixture = weapon): void {
  const draft = structuredClone(fixture);
  change(draft);
  const snapshot = JSON.stringify(draft);
  const result = validateSpec(draft, "art");
  assert.equal(result.valid, false, `Expected rejection at ${path}.`);
  assert.equal(result.value, undefined);
  assert(result.diagnostics.some(issue => issue.path.startsWith(path)), JSON.stringify(result.diagnostics));
  const plan = createArtPlan(snapshot);
  assert.equal(plan.valid, false);
  assert.equal(plan.plan, undefined);
  assert.equal(JSON.stringify(draft), snapshot, "Validation must not edit the source.");
  assert(result.diagnostics.length <= MAX_DIAGNOSTICS);
  negatives += 1;
}
reject(d => { d.modelIntent.parts[1]!.materialRecipe = "minemod:missing"; }, "/modelIntent/parts/1/materialRecipe");
for(const text of ["😀","\uD83D","\uDC00"])reject(d=>{d.modelIntent.parts[0]!.label=text;},"/modelIntent/parts/0/label");
reject(d => { d.style.materialRecipes.push(structuredClone(d.style.materialRecipes[0]!)); }, "/style/materialRecipes");
reject(d => { d.style.materialRecipes[0]!.base = "#FFFFFF"; }, "/style/materialRecipes/0");
reject(d => { d.style.materialRecipes[0]!.highlight = d.style.materialRecipes[0]!.base; }, "/style/materialRecipes/0");
reject(d => { d.style.hueValueHierarchy.midtones = ["#FFFFFF"]; }, "/style/hueValueHierarchy/midtones/0");
reject(d => { d.style.hueValueHierarchy.shadows.push(d.style.hueValueHierarchy.shadows[0]!); }, "/style/hueValueHierarchy/shadows");
reject(d => { d.style.outline = { policy: "full" }; }, "/style/outline/color");
reject(d => { d.style.outline = { policy: "full", color: "#FFFFFF" }; }, "/style/outline/color");
reject(d => { d.style.silhouetteLanguage = "Другая форма"; }, "/style/silhouetteLanguage");
reject(d => { d.modelIntent.parts[1]!.parent = null; }, "/modelIntent/parts");
reject(d => { d.modelIntent.parts[1]!.parent = "missing"; }, "/modelIntent/parts/1/parent");
reject(d => { d.modelIntent.proportions[0]!.minimum = 1; }, "/modelIntent/proportions/0/minimum");
reject(d => { d.modelIntent.proportions[0]!.maximum = 1.1; }, "/modelIntent/proportions/0/maximum");
reject(d => { d.modelIntent.proportions.push(structuredClone(d.modelIntent.proportions[0]!)); }, "/modelIntent/proportions");
reject(d => { d.assetClass = "wearable-set"; }, "/assetClass");
reject(d => { d.modelIntent.runtimeRequirement = "native-block-model"; }, "/modelIntent/runtimeRequirement");
reject(d => { d.targetContexts = d.targetContexts.filter(c => c !== "hand"); }, "/targetContexts");
reject(d => { d.targetMatrix[0]!.runtime.version = "25"; }, "/targetMatrix/0/runtime/version");
reject(d => { d.style.textureResolution = 1024 as ArtSpecV1["style"]["textureResolution"]; }, "/style/textureResolution");
reject(d => { d.budgets.maxCubes = 0; }, "/budgets/maxCubes");
reject(d => { d.budgets.maxTextureBytes = 0; }, "/budgets/maxTextureBytes");
reject(d => { d.modelIntent.bounds.height = 49; }, "/modelIntent/bounds");
reject(d => { d.modelIntent.parts.push(...Array.from({ length: 32 }, () => d.modelIntent.parts[0]!)); }, "/modelIntent/parts");
const block = JSON.parse(readFixture("copper-masonry")) as ArtSpecV1;
reject(d => { d.modelIntent.bounds.width = 15; }, "/modelIntent/bounds", block);
const creature = JSON.parse(readFixture("tidecaller-crab")) as ArtSpecV1;
reject(d => { d.budgets.maxKeyframes = 0; }, "/budgets", creature);
const armor = JSON.parse(readFixture("polar-armor")) as ArtSpecV1;
reject(d => { d.assetClass = "cuboid-model"; }, "/assetClass", armor);
reject(d => { d.textureLayout = { kind: "square-atlas", count: 1 }; }, "/textureLayout", armor);
reject(d => { d.style.textureResolution = 128; }, "/textureLayout", armor);
reject(d => { d.modelIntent.parts = d.modelIntent.parts.filter(p => p.role !== "helmet"); }, "/modelIntent/parts", armor);
for (const key of ["shell", "eval", "script"]) {
  const result = createArtPlan(JSON.stringify({ ...weapon, [key]: "arbitrary" }));
  assert.equal(result.valid, false);
  assert.equal(result.plan, undefined);
  negatives += 1;
}
assert.equal(createArtPlan(JSON.stringify({ ...weapon, schemaVersion: 2 })).valid, false);
assert.equal(createArtPlan(JSON.stringify({ ...weapon, modelIntent: undefined })).valid, false);
assert.equal(createArtPlan("{}").plan, undefined);
assert.equal(createArtPlan("x".repeat(262_145)).diagnostics[0]!.code, "PAYLOAD_TOO_LARGE");
assert.equal(JSON.stringify(weapon), original);
const longMaterial = structuredClone(weapon);
const longId = `${"a".repeat(64)}:${"b".repeat(128)}`;
longMaterial.style.materialRecipes[0]!.id = longId;
for (const part of longMaterial.modelIntent.parts) {
  if (part.materialRecipe === "minemod:steel") part.materialRecipe = longId;
}
assert.equal(validateSpec(longMaterial).valid, true, "A part can reference the maximum valid ResourceLocation length.");

// Новые максимальные массивы всё ещё помещаются в прежние structural limits.
const largest = structuredClone(weapon);
while (largest.modelIntent.parts.length < 32) {
  largest.modelIntent.parts.push({ ...largest.modelIntent.parts[0]!, id: `part_${largest.modelIntent.parts.length}`, parent: "handle", role: "accent" });
}
largest.modelIntent.proportions = largest.modelIntent.parts.map(part => ({ partId: part.id, dimension: "width", relativeTo: "whole", relativeDimension: "width", minimum: 0.01, maximum: 1, reason: "Граница размера конкретного задания" }));
largest.modelIntent.features = Array.from({ length: 8 }, (_, index) => ({ label: `Feature ${index}`, partIds: largest.modelIntent.parts.slice(index, index + 8).map(part => part.id), meaning: "Контроль связей максимального массива", readableAt: [32, 64] }));
largest.modelIntent.reject = Array.from({ length: 8 }, (_, index) => `Reject ${index}`);
assert.equal(validateSpec(largest).valid, true, JSON.stringify(validateSpec(largest).diagnostics));
assert.equal(createArtPlan(JSON.stringify(largest)).valid, true);
process.stdout.write(`ArtSpec v1: six pre-generation plans, five classes, legacy v0, ${negatives} negative cases, bounded output and maximum intent collections PASS\n`);
