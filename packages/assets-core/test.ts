import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileBlockbenchModel, renderCuboidTextureAtlas } from "./index.ts";

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

assert.throws(
  () => compileBlockbenchModel({ ...(golem as object), command: "execute" }),
  /CuboidModelSpec/u,
);
