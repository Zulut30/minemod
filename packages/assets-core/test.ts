import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ReferenceStudySchema, type CuboidModelSpec } from "@mcdev/assets-contracts";
import {
  analyzeArticulatedModelQuality,
  analyzeReferenceCatalog,
  analyzeTexturePlanQuality,
  compileBlockbenchModel,
  compileAnimatedTexturedBlockbenchModel,
  compileInventoryIcon,
  compileTexturedBlockbenchModel,
  createBilateralBonePair,
  createDragonArchetype,
  createDragonTexturePlan,
  materializeArticulatedModel,
  renderCropStageTexture,
  renderCuboidTextureAtlas,
} from "./index.ts";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/assets/${name}`, import.meta.url)), "utf8"));
}

function referenceFixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/reference-studies/${name}`, import.meta.url)), "utf8"));
}

const riceReference = ReferenceStudySchema.parse(referenceFixture("farmers-delight-rice-1.20.1.json"));
const singleReferenceReport = analyzeReferenceCatalog([riceReference], "crop");
assert.equal(singleReferenceReport.readyForRulePromotion, false);
assert.deepEqual(singleReferenceReport.diagnostics.map(({ id }) => id), [
  "REFERENCE_STUDY_COUNT_LOW",
  "REFERENCE_PROJECT_DIVERSITY_LOW",
  "REFERENCE_SUBJECT_DIVERSITY_LOW",
  "REFERENCE_RULE_SUPPORT_LOW",
]);

const diverseReferenceReport = analyzeReferenceCatalog([
  riceReference,
  referenceFixture("croptopia-rice-1.20.1.json"),
  referenceFixture("corn-delight-corn-1.20.1.json"),
], "crop");
assert.equal(diverseReferenceReport.readyForRulePromotion, true);
assert.deepEqual(diverseReferenceReport.candidateRules, [
  { id: "compress_runtime_ages_into_visual_stages", projectSupport: 1, promotable: false },
  { id: "require_growth_silhouette_progression", projectSupport: 3, promotable: true },
  { id: "split_tall_crop_layers", projectSupport: 2, promotable: true },
]);

const waterRicePlan = fixture("water-rice.crop.json");
const waterRiceStages = Array.from({ length: 4 }, (_, stage) => ({
  lower: renderCropStageTexture(waterRicePlan, "lower", stage),
  upper: renderCropStageTexture(waterRicePlan, "upper", stage),
}));
for (let stage = 1; stage < waterRiceStages.length; stage += 1) {
  const previous = waterRiceStages[stage - 1];
  const current = waterRiceStages[stage];
  assert.equal((current?.lower.opaquePixels ?? 0) + (current?.upper.opaquePixels ?? 0) >
    (previous?.lower.opaquePixels ?? 0) + (previous?.upper.opaquePixels ?? 0), true,
  `crop stage ${stage} must increase visible plant mass`);
}
assert.equal(waterRiceStages[3]?.lower.colorCount, 4);
assert.equal(waterRiceStages[3]?.upper.colorCount, 4);
assert.equal(
  waterRiceStages[3]?.lower.sha256,
  renderCropStageTexture(structuredClone(waterRicePlan), "lower", 3).sha256,
  "crop textures must be byte-deterministic",
);
assert.throws(() => renderCropStageTexture(waterRicePlan, "lower", 4), /between 0 and 3/u);

function assertNoUvOverlap(model: CuboidModelSpec): void {
  const rectangles = model.bones.flatMap(({ cubes }) => cubes.map((cube) => ({
    id: cube.id,
    left: cube.uv[0],
    top: cube.uv[1],
    right: cube.uv[0] + 2 * (cube.size[0] + cube.size[2]),
    bottom: cube.uv[1] + cube.size[1] + cube.size[2],
  })));
  for (const [index, left] of rectangles.entries()) {
    for (const right of rectangles.slice(index + 1)) {
      assert.equal(
        left.right <= right.left || right.right <= left.left ||
        left.bottom <= right.top || right.bottom <= left.top,
        true,
        `${left.id} and ${right.id} UV rectangles overlap`,
      );
    }
  }
}

const articulatedPlan = fixture("articulated-biped.plan.json");
const articulated = materializeArticulatedModel(articulatedPlan);
assert.deepEqual(articulated, materializeArticulatedModel(structuredClone(articulatedPlan)));
assert.equal(articulated.model.bones.length, 13);
assert.deepEqual(articulated.packing, {
  rectangles: 12,
  occupiedPixels: 2_682,
  usedWidth: 63,
  usedHeight: 61,
  atlasPixels: 4_096,
  utilization: 0.65478515625,
});
assert.deepEqual(articulated.model.bones.find(({ id }) => id === "head")?.pivot, [0, 26, 0]);
assert.deepEqual(articulated.model.bones.find(({ id }) => id === "left_forearm")?.pivot, [7, 19, 0]);
assert.deepEqual(
  articulated.model.bones.find(({ id }) => id === "left_forearm")?.cubes[0]?.origin,
  [5, 13, -2],
);

assertNoUvOverlap(articulated.model);

const reversedPlan = structuredClone(articulatedPlan) as { bones: unknown[] };
reversedPlan.bones.reverse();
const reversed = materializeArticulatedModel(reversedPlan);
for (const bone of articulated.model.bones) {
  assert.deepEqual(reversed.model.bones.find(({ id }) => id === bone.id)?.pivot, bone.pivot);
}
const compiledArticulated = compileBlockbenchModel(articulated.model);
assert.deepEqual(compiledArticulated.metrics, { bones: 13, cubes: 12, triangles: 144 });
assert.equal(compiledArticulated.sha256, "46e99621e21a28833419096e359edf7819dd5fe1fce23af0db52fe6f68a6f498");
assert.throws(
  () => materializeArticulatedModel({ ...(articulatedPlan as object), texture: { width: 16, height: 16 } }),
  /cannot fit cube/u,
);

const [leftDetail, rightDetail] = createBilateralBonePair({
  id: "detail",
  parents: "root",
  leftPivotOffset: [3, 2, 1],
  leftRotation: [10, 20, 30],
  cubes: [{
    id: "plate",
    originOffset: [1, -2, -3],
    size: [3, 4, 5],
    rotation: [5, 15, 25],
    inflate: 0,
    mirror: false,
  }],
});
assert.deepEqual(rightDetail.pivotOffset, [-3, 2, 1]);
assert.deepEqual(rightDetail.rotation, [10, -20, -30]);
assert.deepEqual(rightDetail.cubes[0]?.originOffset, [-4, -2, -3]);
assert.deepEqual(rightDetail.cubes[0]?.rotation, [5, -15, -25]);
assert.equal(leftDetail.cubes[0]?.id, "left_detail_plate");
assert.equal(rightDetail.cubes[0]?.id, "right_detail_plate");

const dragonPlan = createDragonArchetype({
  id: "mcdev:ancient_verdant_dragon",
  name: "Ancient Verdant Dragon",
});
const dragon = materializeArticulatedModel(dragonPlan);
assert.deepEqual(dragon.packing, {
  rectangles: 100,
  occupiedPixels: 50_560,
  usedWidth: 255,
  usedHeight: 255,
  atlasPixels: 65_536,
  utilization: 0.771484375,
});
assertNoUvOverlap(dragon.model);
const dragonQuality = analyzeArticulatedModelQuality(dragon.model, {
  minBones: 44,
  minCubes: 90,
  minHierarchyDepth: 7,
  minScaleBands: 6,
  symmetryTolerance: 0.001,
  minDetailCubeRatio: 0.3,
  requiredBones: ["head", "jaw", "left_wing_shoulder", "right_wing_shoulder", "tail_tip"],
});
assert.equal(dragonQuality.passes, true);
assert.deepEqual({
  bones: dragonQuality.boneCount,
  cubes: dragonQuality.cubeCount,
  depth: dragonQuality.hierarchyDepth,
  scaleBands: dragonQuality.scaleBands,
  bilateralPairs: dragonQuality.bilateralPairs,
  detailCubeRatio: dragonQuality.detailCubeRatio,
  span: dragonQuality.bounds.span,
}, {
  bones: 48,
  cubes: 100,
  depth: 10,
  scaleBands: 12,
  bilateralPairs: 16,
  detailCubeRatio: 0.78,
  span: [150, 52, 148],
});
const asymmetricDragon = structuredClone(dragon.model);
const rightWing = asymmetricDragon.bones.find(({ id }) => id === "right_wing_shoulder");
if (rightWing === undefined) throw new Error("Dragon fixture lost right_wing_shoulder.");
rightWing.pivot[1] += 2;
assert.equal(analyzeArticulatedModelQuality(asymmetricDragon, {
  minBones: 40,
  minCubes: 70,
  minHierarchyDepth: 7,
  minScaleBands: 6,
  symmetryTolerance: 0.001,
  requiredBones: ["head", "jaw"],
}).diagnostics.some(({ id }) => id === "ART_ANATOMY_SYMMETRY_DRIFT"), true);
const dragonTexturePlan = createDragonTexturePlan(dragonPlan);
const compiledDragon = compileTexturedBlockbenchModel(dragon.model, dragonTexturePlan);
const dragonTextureQuality = analyzeTexturePlanQuality(dragon.model, dragonTexturePlan, {
  minShadowLuminanceDelta: 0.02,
  minHighlightLuminanceDelta: 0.03,
  minAccentRgbDistance: 0.05,
});
assert.equal(dragonTextureQuality.passes, true);
assert.deepEqual({
  materials: dragonTextureQuality.materialCount,
  assignments: dragonTextureQuality.assignmentCount,
  bilateralPairs: dragonTextureQuality.texturedBilateralPairs,
}, { materials: 6, assignments: 100, bilateralPairs: 34 });
const flatPalettePlan = structuredClone(dragonTexturePlan);
const flatHide = flatPalettePlan.materials.find(({ id }) => id === "hide");
if (flatHide === undefined) throw new Error("Dragon fixture lost hide material.");
flatHide.colors.highlight = flatHide.colors.base;
assert.equal(analyzeTexturePlanQuality(dragon.model, flatPalettePlan, {
  minShadowLuminanceDelta: 0.02,
  minHighlightLuminanceDelta: 0.03,
  minAccentRgbDistance: 0.05,
}).diagnostics.some(({ id }) => id === "ART_PALETTE_HIGHLIGHT_CONTRAST_LOW"), true);
const asymmetricTexturePlan = structuredClone(dragonTexturePlan);
const rightWingTexture = asymmetricTexturePlan.assignments.find(({ cubeId }) =>
  cubeId === "right_wing_shoulder_membrane");
if (rightWingTexture === undefined) throw new Error("Dragon fixture lost right wing texture assignment.");
rightWingTexture.seed += 1;
assert.equal(analyzeTexturePlanQuality(dragon.model, asymmetricTexturePlan, {
  minShadowLuminanceDelta: 0.02,
  minHighlightLuminanceDelta: 0.03,
  minAccentRgbDistance: 0.05,
}).diagnostics.some(({ id }) => id === "ART_TEXTURE_SYMMETRY_DRIFT"), true);
assert.deepEqual(compiledDragon.metrics, { bones: 48, cubes: 100, triangles: 1_200 });
assert.equal(compiledDragon.texture.colorCount >= 20, true);
assert.equal(compiledDragon.texture.opaquePixels, 50_560);
assert.equal(compiledDragon.sha256, "71d48bbf150f2bbefdc7a8059d5795ab5952ed444293c0b82f7810a408612374");
assert.equal(compiledDragon.texture.sha256, "7fe46d9f9bbd5d81169a4a1661c85aa951a7351fed7edf3efbae0ec3bd2fcc68");

const galleon = materializeArticulatedModel(fixture("merchant-galleon.plan.json"));
assert.deepEqual(galleon.packing, {
  rectangles: 72,
  occupiedPixels: 50_998,
  usedWidth: 255,
  usedHeight: 255,
  atlasPixels: 65_536,
  utilization: 0.778167724609375,
});
assert.deepEqual(galleon.model.bones.find(({ id }) => id === "deck")?.pivot, [0, 17, 0]);
assert.deepEqual(galleon.model.bones.find(({ id }) => id === "main_mast")?.pivot, [0, 18, 7]);
assert.deepEqual(galleon.model.bones.find(({ id }) => id === "main_flag")?.pivot, [0, 58, 7]);
assert.deepEqual(galleon.model.bones.find(({ id }) => id === "bowsprit")?.pivot, [0, 19, -24]);
assertNoUvOverlap(galleon.model);
const compiledGalleon = compileTexturedBlockbenchModel(
  galleon.model,
  fixture("merchant-galleon.texture.json"),
);
assert.deepEqual(compiledGalleon.metrics, { bones: 30, cubes: 72, triangles: 864 });
assert.equal(compiledGalleon.texture.colorCount >= 40, true);
assert.equal(compiledGalleon.texture.opaquePixels, 50_998);
assert.equal(compiledGalleon.sha256, "e0e1bda3ba1058cc8f3c7f284228f3dd25a9c0bacb780ec0a5cc0f9ebb523b63");
assert.equal(compiledGalleon.texture.sha256, "d159697b6102aa62d2ccbde351895a814a790f5d299ce3b1222369578f3bcf3b");

const golem = fixture("copper-guardian.model.json");
const golemObject = golem as { id: string; bones: Array<{ cubes: Array<{ id: string }> }> };
const copperTexturePlan = {
  schemaVersion: 0,
  kind: "cuboid-texture-plan",
  modelId: golemObject.id,
  materials: [{
    id: "copper",
    colors: {
      base: "#b85f3d",
      shadow: "#67352d",
      highlight: "#ed9a62",
      accent: "#f4c542",
    },
  }],
  assignments: golemObject.bones.flatMap(({ cubes }) => cubes.map(({ id }, index) => ({
    cubeId: id,
    materialId: "copper",
    pattern: index % 2 === 0 ? "riveted" : "panel",
    seed: index,
  }))),
};

const copperAtlas = renderCuboidTextureAtlas(golem, copperTexturePlan);
assert.equal(copperAtlas.format, "png");
assert.equal(copperAtlas.width, 128);
assert.equal(copperAtlas.height, 128);
assert.equal(copperAtlas.bytes.subarray(1, 4).toString(), "80,78,71");
assert.equal(copperAtlas.dataUrl.startsWith("data:image/png;base64,iVBOR"), true);
assert.equal(copperAtlas.opaquePixels > 1_000, true);
assert.equal(copperAtlas.colorCount >= 4, true);
assert.equal(copperAtlas.sha256, "3a7b7c92dd0ea8533bae8d9624c8fb57b4019e6b87cf03eb676148f64db02447");
assert.equal(copperAtlas.sha256, renderCuboidTextureAtlas(structuredClone(golem), structuredClone(copperTexturePlan)).sha256);
assert.throws(
  () => renderCuboidTextureAtlas(golem, { ...copperTexturePlan, assignments: copperTexturePlan.assignments.slice(1) }),
  /missing assignments/u,
);
assert.throws(
  () => renderCuboidTextureAtlas(golem, { ...copperTexturePlan, modelId: "mcdev:wrong" }),
  /modelId/u,
);

const compiledGolem = compileBlockbenchModel(golem);
const repeatedGolem = compileBlockbenchModel(structuredClone(golem));
assert.equal(compiledGolem.text, repeatedGolem.text, "export must be byte-deterministic");
assert.equal(compiledGolem.sha256, repeatedGolem.sha256);
assert.equal(compiledGolem.sha256, "32760315de9f2a21aee4bb417267ae17b069954ced4f88d6f06f63a51d4fe3ab");
assert.deepEqual(compiledGolem.metrics, { bones: 8, cubes: 18, triangles: 216 });

const golemProject = JSON.parse(compiledGolem.text) as {
  meta: { format_version: string; model_format: string; box_uv: boolean };
  elements: Array<{ name: string; uuid: string; from: number[]; to: number[] }>;
  groups: Array<{ name: string; uuid: string }>;
  outliner: Array<{ uuid: string; children: unknown[] }>;
};
assert.deepEqual(golemProject.meta, { format_version: "5.0", model_format: "free", box_uv: true });
assert.equal(golemProject.elements.length, 18);
assert.equal(golemProject.groups.length, 8);
assert.equal(golemProject.outliner.length, 1);
assert.match(golemProject.elements[0]!.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
assert.deepEqual(golemProject.elements.find(({ name }) => name === "body_core")?.from, [-8, 9, -4]);
assert.deepEqual(golemProject.elements.find(({ name }) => name === "body_core")?.to, [8, 23, 4]);
assert.equal(compiledGolem.text.includes("creation_time"), false);
assert.equal(compiledGolem.text.includes("/home/"), false);

const weapon = compileBlockbenchModel(fixture("clockwork-halberd.model.json"));
assert.deepEqual(weapon.metrics, { bones: 3, cubes: 8, triangles: 96 });
assert.equal(weapon.sha256, "9231495fe8bb57b3272d2679258b68f6779d7949d9623e3915eab822f64274fd");

const texturedGolem = compileTexturedBlockbenchModel(
  golem,
  fixture("copper-guardian.texture.json"),
);
const texturedProject = JSON.parse(texturedGolem.text) as {
  textures: Array<{ name: string; uuid: string; internal: boolean; source: string }>;
};
assert.equal(texturedProject.textures.length, 1);
assert.equal(texturedProject.textures[0]?.name, "copper_guardian.png");
assert.equal(texturedProject.textures[0]?.internal, true);
assert.match(texturedProject.textures[0]?.uuid ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
assert.equal(texturedProject.textures[0]?.source, texturedGolem.texture.dataUrl);
assert.equal(texturedGolem.text.includes("/home/"), false);
assert.equal(texturedGolem.texture.colorCount > 8, true);
assert.equal(texturedGolem.sha256, "94de00239c5c77512a4ddae2455332473a5a3a67d3526c8d511d1e26c530c5a2");
assert.equal(texturedGolem.texture.sha256, "f102ca35b799828cc4b0a0300efd8e3308e9f1361afc58ea6876c6335908d828");

const texturedWeapon = compileTexturedBlockbenchModel(
  fixture("clockwork-halberd.model.json"),
  fixture("clockwork-halberd.texture.json"),
);
assert.equal(texturedWeapon.texture.colorCount > 8, true);
assert.notEqual(texturedWeapon.texture.sha256, texturedGolem.texture.sha256);
assert.equal(texturedWeapon.sha256, "2432bc448de494d262b627040f78ad194093f4323b71b602ae7274ca383183fb");
assert.equal(texturedWeapon.texture.sha256, "4dd514804d2ccccd01691c3700c1abbf8d04b8902e50f01f08e2b589d1801b84");

const blueSteelSword = compileTexturedBlockbenchModel(
  fixture("blue-steel-greatsword.model.json"),
  fixture("blue-steel-greatsword.texture.json"),
);
assert.deepEqual(blueSteelSword.metrics, { bones: 5, cubes: 17, triangles: 204 });
assert.equal(blueSteelSword.texture.colorCount >= 12, true);
assert.equal(blueSteelSword.sha256, "bf5bd530bfb2578b4cfb12c2401e05ae0f607cbb2f7ca52e606ded264ebe44e3");
assert.equal(blueSteelSword.texture.sha256, "0e918e938f3dbe25f47eaf053ac17c0904e90d7299a204f540204eca39b0ef9a");

const deathScythe = compileTexturedBlockbenchModel(
  fixture("death-scythe.model.json"),
  fixture("death-scythe.texture.json"),
);
assert.deepEqual(deathScythe.metrics, { bones: 4, cubes: 19, triangles: 228 });
assert.equal(deathScythe.texture.colorCount >= 12, true);
assert.notEqual(deathScythe.sha256, blueSteelSword.sha256);
assert.equal(deathScythe.sha256, "ceb7ae11453aa4ce663d25ae154c4d34536a0eb13a289473de2d2a5332738444");
assert.equal(deathScythe.texture.sha256, "3ad8236db226dcbba485a7f9e60337bce71e4fc9b8428722017d1f297010f2d3");

const deathScytheIcon = compileInventoryIcon(fixture("death-scythe.inventory-icon.json"));
assert.equal(deathScytheIcon.texture.width, 32);
assert.equal(deathScytheIcon.texture.height, 32);
assert.equal(deathScytheIcon.texture.opaquePixels > 120, true);
assert.equal(deathScytheIcon.texture.colorCount >= 6, true);
assert.deepEqual(JSON.parse(deathScytheIcon.itemModelText), {
  parent: "minecraft:item/handheld",
  textures: { layer0: "mcdev:item/death_scythe" },
});
assert.equal(deathScytheIcon.texture.sha256, "149d8fbd69b0421e239f5b44be805ec79bd5af082905367c6e15e7f7863adbd9");
assert.equal(deathScytheIcon.itemModelSha256, "2f93ae9cacc20023500dfc4f4997e067416b5f6733f7de184a1f220ed64bed45");

const fungalInfected = compileTexturedBlockbenchModel(
  fixture("fungal-infected.model.json"),
  fixture("fungal-infected.texture.json"),
);
assert.deepEqual(fungalInfected.metrics, { bones: 27, cubes: 60, triangles: 720 });
assert.equal(fungalInfected.texture.colorCount >= 20, true);
assert.equal(fungalInfected.texture.opaquePixels >= 8_000, true);
assert.equal(fungalInfected.sha256, "ec80872b28c1276b61593273c5510689e0259a491c36b57295540ccb6aa32cf6");
assert.equal(fungalInfected.texture.sha256, "9968f8e7a4c56d121650a22e98b131964365b29c640f4cca895eab0c092b3863");
const fungalProject = JSON.parse(fungalInfected.text) as {
  groups: Array<{ name: string }>;
  outliner: unknown[];
};
for (const articulatedBone of [
  "pelvis", "chest", "neck", "left_forearm", "right_forearm",
  "left_shin", "right_shin", "fungus_cap_left", "fungus_cap_right",
]) {
  assert.equal(fungalProject.groups.some(({ name }) => name === articulatedBone), true, articulatedBone);
}
assert.equal(fungalProject.outliner.length, 1);

const animatedFungalInfected = compileAnimatedTexturedBlockbenchModel(
  fixture("fungal-infected.model.json"),
  fixture("fungal-infected.texture.json"),
  fixture("fungal-infected.animation.json"),
);
assert.deepEqual(animatedFungalInfected.animationMetrics, { clips: 4, tracks: 34, keyframes: 170 });
assert.equal(animatedFungalInfected.sha256, "6fabbb24e8d020fc36e51b0f040f09a5d215bf108cb40e6b5ae91697e2d069d0");
const animatedProject = JSON.parse(animatedFungalInfected.text) as {
  animations: Array<{
    name: string;
    animators: Record<string, { name: string; keyframes: Array<{ channel: string; time: number }> }>;
  }>;
};
assert.deepEqual(animatedProject.animations.map(({ name }) => name), [
  "animation.mcdev.fungal_infected.idle",
  "animation.mcdev.fungal_infected.walk",
  "animation.mcdev.fungal_infected.climb_block",
  "animation.mcdev.fungal_infected.attack",
]);
const walkAnimation = animatedProject.animations.find(({ name }) => name.endsWith(".walk"));
const testAnimator = Object.values(walkAnimation?.animators ?? {})[0];
assert.equal(testAnimator?.name, "root");
assert.deepEqual(testAnimator?.keyframes.map(({ channel, time }) => ({ channel, time })), [
  { channel: "position", time: 0 },
  { channel: "position", time: 0.25 },
  { channel: "position", time: 0.5 },
  { channel: "position", time: 0.75 },
  { channel: "position", time: 1 },
]);
assert.equal(animatedFungalInfected.text.includes("/home/"), false);
assert.throws(
  () => compileAnimatedTexturedBlockbenchModel(
    fixture("fungal-infected.model.json"),
    fixture("fungal-infected.texture.json"),
    { ...(fixture("fungal-infected.animation.json") as object), modelId: "mcdev:wrong" },
  ),
  /modelId/u,
);

assert.throws(
  () => compileBlockbenchModel({ ...(golem as object), command: "execute" }),
  /CuboidModelSpec/u,
);
