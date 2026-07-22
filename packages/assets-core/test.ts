import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compileBlockbenchModel,
  compileAnimatedTexturedBlockbenchModel,
  compileInventoryIcon,
  compileTexturedBlockbenchModel,
  renderCuboidTextureAtlas,
} from "./index.ts";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/assets/${name}`, import.meta.url)), "utf8"));
}

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
