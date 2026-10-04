import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CuboidModelSpec } from "@mcdev/assets-contracts";
import { compileMinecraftItemModel, MinecraftItemModelError } from "./minecraft-item.ts";

const model: CuboidModelSpec = {
  schemaVersion: 0, kind: "cuboid-model", id: "example:test", name: "UV test", modelType: "held-item",
  texture: { width: 64, height: 32 }, bones: [{ id: "root", parent: null, pivot: [8, 8, 8], rotation: [0, 0, 0], cubes: [{
    id: "cube", origin: [0, 0, 0], size: [4, 6, 2], pivot: [2, 3, 1], rotation: [0, 0, 0], uv: [8, 4], inflate: 0, mirror: false,
  }] }],
};
type Element = { from: number[]; to: number[]; rotation?: { axis: string; angle: number }; faces: Record<string, { uv: number[] }> };
function documentFor(input: unknown): { parent?: string; textures: Record<string, string>; elements: Element[] } {
  return JSON.parse(compileMinecraftItemModel(input).text) as ReturnType<typeof documentFor>;
}
const document = documentFor(model);
assert.equal(document.parent, undefined);
assert.equal(document.textures["0"], "example:item/test");
const element = document.elements[0]!;
assert.equal(element.rotation, undefined);
// Несимметричный куб и прямоугольный атлас выявляют перепутанные грани и масштабы UV.
assert.deepEqual(element.faces.north?.uv, [2.5, 3, 3.5, 6]);
assert.deepEqual(element.faces.east?.uv, [2, 3, 2.5, 6]);
assert.deepEqual(element.faces.up?.uv, [3.5, 3, 2.5, 2]);
assert.deepEqual(element.faces.down?.uv, [4.5, 2, 3.5, 3]);
const mirrored = structuredClone(model);
mirrored.bones[0]!.cubes[0]!.mirror = true;
assert.deepEqual(documentFor(mirrored).elements[0]!.faces.east?.uv, [4, 3, 3.5, 6]);
assert.deepEqual(documentFor(mirrored).elements[0]!.faces.north?.uv, [3.5, 3, 2.5, 6]);

function rejectMutation(mutate: (input: CuboidModelSpec) => void, message: RegExp): void {
  const changed = structuredClone(model); mutate(changed);
  assert.throws(() => compileMinecraftItemModel(changed), (error) => error instanceof MinecraftItemModelError && message.test(error.message));
}
rejectMutation((input) => { input.modelType = "entity"; }, /held-item/u);
rejectMutation((input) => { input.bones[0]!.cubes = []; }, /visible geometry/u);
rejectMutation((input) => { input.bones[0]!.rotation[1] = 22.5; }, /Bone root/u);
rejectMutation((input) => { input.bones[0]!.cubes[0]!.rotation = [0, 15, 0]; }, /Cube cube/u);
rejectMutation((input) => { input.bones[0]!.cubes[0]!.rotation = [22.5, 45, 0]; }, /one rotation axis/u);
rejectMutation((input) => { input.bones[0]!.cubes[0]!.origin[0] = 28.1; }, /bounds/u);
rejectMutation((input) => { input.bones[0]!.cubes[0]!.origin[0] = -16; input.bones[0]!.cubes[0]!.inflate = .1; }, /bounds/u);
const boundary = structuredClone(model);
boundary.bones[0]!.cubes[0]!.origin = [27, 0, 0];
boundary.bones[0]!.cubes[0]!.inflate = 1;
boundary.bones[0]!.cubes[0]!.rotation = [0, -45, 0];
assert.deepEqual(documentFor(boundary).elements[0]!.to, [32, 7, 3]);
assert.deepEqual(documentFor(boundary).elements[0]!.rotation, { origin: [2, 3, 1], axis: "y", angle: -45, rescale: false });
assert.throws(() => compileMinecraftItemModel({ ...model, script: "unsafe" }), MinecraftItemModelError);
assert.throws(() => compileMinecraftItemModel({ ...model, id: "example:../escape" }), MinecraftItemModelError);

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/assets/aurora-longsword.item-asset.json", import.meta.url), "utf8")) as { model: CuboidModelSpec };
const compiled = compileMinecraftItemModel(fixture.model);
assert.equal(compiled.elements, 35);
const reversed = structuredClone(fixture.model);
reversed.bones.reverse(); reversed.bones.forEach(({ cubes }) => cubes.reverse());
assert.equal(compileMinecraftItemModel(reversed).text, compiled.text);
process.stdout.write("Minecraft item export: UV, geometry boundaries and deterministic fixture passed.\n");
