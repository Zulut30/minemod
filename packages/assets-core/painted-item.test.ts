import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import type { CuboidModelSpec, ItemPixelTexturePlan } from "@mcdev/assets-contracts";
import { compilePaintedMinecraftItemAssets } from "./index.ts";

// Дробная геометрия и прямоугольный атлас: плотность пикселей не зависит от box UV.
const model: CuboidModelSpec = {
  schemaVersion: 0, kind: "cuboid-model", id: "example:weapons/painted", name: "Painted UV test", modelType: "held-item",
  texture: { width: 32, height: 16 }, bones: [{ id: "root", parent: null, pivot: [8, 8, 8], rotation: [0, 0, 0], cubes: [{
    id: "blade", origin: [7, 4, 7], size: [.25, 2, .25], pivot: [8, 8, 8], rotation: [0, 0, 0], uv: [0, 0], inflate: 0, mirror: false,
  }] }],
};
const plan: ItemPixelTexturePlan = {
  schemaVersion: 0, kind: "item-pixel-texture-plan", modelId: model.id,
  palette: [{ symbol: "0", color: "#102030" }, { symbol: "1", color: "#ffeedd" }, { symbol: "2", color: "#102030" }],
  rows: ["012" + ".".repeat(29), ...Array<string>(15).fill(".".repeat(32))],
  faces: [{ cubeId: "blade", uv: {
    north: [0, 0, 4, 8], south: [4, 8, 0, 0], east: [5, 1, 6, 7], west: [7, 1, 8, 7], up: [8, 0, 12, 2], down: [12, 2, 16, 0],
  } }],
};
const result = compilePaintedMinecraftItemAssets(model, plan);
const native = JSON.parse(result.native.text) as { elements: { faces: Record<string, { uv: number[] }> }[] };
assert.deepEqual(native.elements[0]!.faces.north?.uv, [0, 0, 2, 8]);
assert.deepEqual(native.elements[0]!.faces.south?.uv, [2, 8, 0, 0]);
assert.deepEqual(native.elements[0]!.faces.down?.uv, [6, 2, 8, 0]);
const editable = JSON.parse(result.editable.text) as {
  meta: { model_format: string; box_uv: boolean };
  elements: { box_uv: boolean; faces: Record<string, { uv: number[]; texture: number }> }[];
  textures: { folder: string; source: string }[];
};
assert.equal(editable.meta.model_format, "java_block");
assert.equal(editable.elements[0]?.box_uv, false);
assert.deepEqual(editable.elements[0]!.faces.south, { uv: [4, 8, 0, 0], texture: 0 });
assert.equal(editable.textures[0]?.folder, "item/weapons");
assert.equal(editable.textures[0]?.source, result.editable.texture.dataUrl);
assert.equal(result.editable.texture.opaquePixels, 3);
assert.equal(result.editable.texture.colorCount, 2, "Two symbols for one RGB value must not inflate the colour count.");

// Проверяем реальные RGBA после распаковки PNG, включая прозрачный фон.
const png = Buffer.from(result.editable.texture.bytes);
const imageChunks: Buffer[] = [];
for (let offset = 8; offset < png.length;) {
  const length = png.readUInt32BE(offset);
  if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") imageChunks.push(png.subarray(offset + 8, offset + 8 + length));
  offset += length + 12;
}
const scanlines = inflateSync(Buffer.concat(imageChunks));
assert.deepEqual([...scanlines.subarray(0, 17)], [0, 16, 32, 48, 255, 255, 238, 221, 255, 16, 32, 48, 255, 0, 0, 0, 0]);
assert.equal(compilePaintedMinecraftItemAssets(model, plan).editable.sha256, result.editable.sha256);

function rejects(mutate: (input: ItemPixelTexturePlan) => void, message: RegExp): void {
  const changed = structuredClone(plan); mutate(changed);
  assert.throws(() => compilePaintedMinecraftItemAssets(model, changed), (error) => error instanceof TypeError && message.test(error.message));
}
rejects((input) => { input.rows[0] = "v" + ".".repeat(31); }, /undeclared palette/u);
rejects((input) => { input.rows.pop(); }, /width and height/u);
rejects((input) => { input.faces[0]!.uv.north[2] = 33; }, /exceeds/u);
rejects((input) => { input.faces[0]!.uv.north[2] = 0; }, /nonzero area/u);
rejects((input) => { input.faces[0]!.uv.north[0] = -1; }, /Invalid pixel texture/u);
rejects((input) => { input.faces[0]!.cubeId = "unknown"; }, /every model cube/u);
rejects((input) => { input.faces.push(input.faces[0]!); }, /unique/u);
rejects((input) => { input.palette[1]!.symbol = "0"; }, /unique/u);
rejects((input) => { input.modelId = "example:other"; }, /modelId must match/u);
assert.throws(() => compilePaintedMinecraftItemAssets(model, { ...plan, script: "unsafe" }), TypeError);
process.stdout.write("Painted item: explicit UV, decoded PNG pixels and invalid inputs passed.\n");
