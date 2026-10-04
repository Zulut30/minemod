import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileItemAssetPayload, itemAssetDiagnostic, MAX_ITEM_ASSET_PAYLOAD_BYTES } from "./item-assets.ts";

const payload = readFileSync(new URL("../../fixtures/assets/aurora-longsword.item-asset.json", import.meta.url), "utf8");
const bundle = compileItemAssetPayload(payload);
assert.equal(bundle.reviewRequired, true);
assert.equal(bundle.elements, 35);
assert.deepEqual(bundle.files.map(({ path }) => path), [
  "assets/mcdev/models/item/aurora_longsword.json",
  "assets/mcdev/textures/item/aurora_longsword.png",
  "editable/mcdev/aurora_longsword.bbmodel",
]);
assert.deepEqual(compileItemAssetPayload(payload), bundle);
assert.equal(Object.isFrozen(bundle.files), true);
const project = JSON.parse(bundle.files[2]!.content) as {
  meta: { model_format: string; box_uv: boolean };
  elements: { name: string; box_uv: boolean; faces: Record<string, { uv: number[]; texture: number }> }[];
  display: { gui: { scale: number[] } };
  front_gui_light: boolean;
  textures: { folder: string; particle: boolean }[];
};
assert.equal(project.meta.model_format, "java_block");
assert.equal(project.meta.box_uv, false);
assert.deepEqual(project.display.gui.scale, [.55, .55, .55]);
assert.equal(project.front_gui_light, true);
assert.equal(project.textures[0]?.folder, "item");
assert.equal(project.textures[0]?.particle, true);
for (const cube of project.elements) {
  assert.equal(cube.box_uv, false);
  assert.equal(Object.keys(cube.faces).length, 6);
  for (const face of Object.values(cube.faces)) {
    assert.equal(face.texture, 0);
    assert.notEqual(face.uv[0], face.uv[2], "Thin faces must retain nonzero UV width.");
    assert.notEqual(face.uv[1], face.uv[3], "Thin faces must retain nonzero UV height.");
  }
}
const band = project.elements.find(({ name }) => name === "grip_band_0")!;
assert.deepEqual(band.faces.north?.uv, [12.5, 3.5, 15, 4]);
const nestedPayload = JSON.parse(payload) as { model: { id: string }; texturePlan: { modelId: string } };
nestedPayload.model.id = "mcdev:weapons/aurora_longsword";
nestedPayload.texturePlan.modelId = nestedPayload.model.id;
const nestedProject = JSON.parse(compileItemAssetPayload(JSON.stringify(nestedPayload)).files[2]!.content) as typeof project;
assert.equal(nestedProject.textures[0]?.folder, "item/weapons");
for (const file of bundle.files) {
  const bytes = Buffer.from(file.content, file.encoding);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  assert.equal(Object.isFrozen(file), true);
  if (file.encoding === "base64") {
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), 128);
  }
}
for (const invalid of ["{", "[]", "{}", "я".repeat(MAX_ITEM_ASSET_PAYLOAD_BYTES / 2 + 1),
  JSON.stringify({ ...JSON.parse(payload) as object, script: "unsafe" })]) {
  assert.throws(() => compileItemAssetPayload(invalid), { code: "SPEC_UNSUPPORTED" });
}
const badTexture = JSON.parse(payload) as { texturePlan: { assignments: unknown[] } };
badTexture.texturePlan.assignments.pop();
assert.throws(() => compileItemAssetPayload(JSON.stringify(badTexture)), /missing assignments/u);
assert.deepEqual(itemAssetDiagnostic(new Error("private path")), { code: "INTERNAL_ERROR", message: "Item asset compilation failed safely." });
const paintedPayload = readFileSync(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8");
const paintedBundle = compileItemAssetPayload(paintedPayload);
assert.equal(paintedBundle.elements, 52);
assert.equal(Buffer.from(paintedBundle.files[1]!.content, "base64").readUInt32BE(16), 256);
for (const file of paintedBundle.files) {
  assert.equal(createHash("sha256").update(Buffer.from(file.content, file.encoding)).digest("hex"), file.sha256);
}
const paintedInvalid = JSON.parse(paintedPayload) as { texturePlan: { faces: { uv: { north: number[] } }[] } };
paintedInvalid.texturePlan.faces[0]!.uv.north = [0, 0, 0, 0];
assert.throws(() => compileItemAssetPayload(JSON.stringify(paintedInvalid)), { code: "SPEC_UNSUPPORTED" });
process.stdout.write("Item asset bundle: PNG, paths, hashes and bounded validation passed.\n");
