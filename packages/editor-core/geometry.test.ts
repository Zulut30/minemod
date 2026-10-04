import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EditorSession, projectFromAsset, cubes, bounds, assetRequest, validateProject, snapToGrid, type EditorCommand, type GridStep } from "./index.ts";
import { compileItemAssetBundleV1 } from "../application/asset-bundles.ts";

const initial = projectFromAsset(JSON.parse(await readFile(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8")), randomUUID());
const guardIds = initial.parts.find((p) => p.id === "guard")!.cubeIds;
const session = new EditorSession(initial);
const apply = (commands: EditorCommand[], actor: "human" | "agent" = "human") => session.apply({
  projectId: initial.projectId, expectedRevision: session.state().revision, key: randomUUID(), commands,
}, actor);
const files = () => compileItemAssetBundleV1(JSON.stringify(assetRequest(session.state().project)));
const originalFiles = files();
const signature = (bundle: ReturnType<typeof files>) => bundle.manifest.files.map(({ path, sha256 }) => ({ path, sha256 }));
const texture = (bundle: ReturnType<typeof files>) => bundle.manifest.files.find((f) => f.role === "texture")!.sha256;
for (const step of [0.125, 0.25, 0.5, 1] as const) {
  assert.equal(snapToGrid(step / 2, step), step);
  assert.equal(snapToGrid(-step / 2, step), -step);
  assert.equal(snapToGrid(-step / 3, step), 0);
  assert(!Object.is(snapToGrid(-0, step), -0));
}
assert.throws(() => snapToGrid(Infinity, 0.25), { code: "INVALID_GRID" });
assert.throws(() => snapToGrid(1, 0.3 as GridStep), { code: "INVALID_GRID" });

apply([{ type: "transform", cubeIds: guardIds, translation: [-0.13, 0.07, 0.11], scale: [1, 1, 1] }]);
const beforeSnap = session.state().project, selected = cubes(beforeSnap).filter((c) => guardIds.includes(c.id));
const min = bounds(selected).min;
const snapped = apply([{ type: "snap", cubeIds: guardIds, step: 0.25 }]).project;
const afterSnap = cubes(snapped).filter((c) => guardIds.includes(c.id));
assert.notDeepEqual(afterSnap, selected);
for (const axis of [0, 1, 2] as const) {
  const expected = snapToGrid(min[axis], 0.25), delta = expected - min[axis];
  assert(Math.abs(bounds(afterSnap).min[axis] - expected) < 1e-12);
  for (let i = 0; i < selected.length; i++) {
    assert(Math.abs(afterSnap[i]!.origin[axis] - selected[i]!.origin[axis] - delta) < 1e-12);
    assert(Math.abs(afterSnap[i]!.pivot[axis] - selected[i]!.pivot[axis] - delta) < 1e-12);
    assert.equal(afterSnap[i]!.size[axis], selected[i]!.size[axis]);
    assert.equal(afterSnap[i]!.rotation[axis], selected[i]!.rotation[axis]);
  }
}
assert.deepEqual(snapped.texturePlan, initial.texturePlan);
assert.deepEqual(cubes(snapped).filter((c) => !guardIds.includes(c.id)), cubes(initial).filter((c) => !guardIds.includes(c.id)));
assert.equal(texture(files()), texture(originalFiles));
apply([{ type: "pivot", cubeIds: guardIds, axis: "x", value: 8.125 }, { type: "pivot", cubeIds: guardIds, axis: "y", value: 12.5 }], "agent");
const pivotProject = session.state().project;
assert(cubes(pivotProject).filter((c) => guardIds.includes(c.id)).every((c) => c.pivot[0] === 8.125 && c.pivot[1] === 12.5));
apply([{ type: "rotate", cubeIds: guardIds, axis: "z", angle: 22.5 }], "agent");
const final = session.state().project, exported = files();
const model = JSON.parse(exported.files.find((f) => f.path.endsWith(`/models/item/${initial.model.id.split(":")[1]}.json`))!.content);
for (const id of guardIds) {
  const cube = cubes(final).find((c) => c.id === id)!;
  const element = model.elements.find((e: { name: string }) => e.name === id);
  assert.deepEqual(element.rotation, { origin: cube.pivot, axis: "z", angle: 22.5, rescale: false });
  assert.deepEqual(element.from, cube.origin.map((v) => v - cube.inflate));
  assert.deepEqual(element.to, cube.origin.map((v, a) => v + cube.size[a]! + cube.inflate));
}
assert.equal(texture(exported), texture(originalFiles));
for (let i = 0; i < 4; i++) apply([{ type: "undo" }]);
assert.deepEqual(session.state().project, initial);
assert.deepEqual(signature(files()), signature(originalFiles));
for (let i = 0; i < 4; i++) apply([{ type: "redo" }]);
assert.deepEqual(session.state().project, final);
assert.deepEqual(signature(files()), signature(exported));

let rejected = 0;
const reject = (command: unknown, code: string) => {
  const before = session.state();
  assert.throws(() => session.apply({ projectId: initial.projectId, expectedRevision: before.revision, key: randomUUID(), commands: [command] }), { code });
  assert.deepEqual(session.state(), before); rejected++;
};
for (const step of [0, -1, 0.3, 2, null, "0.25"]) reject({ type: "snap", cubeIds: guardIds, step }, "INVALID_COMMAND");
for (const value of [129, -129, NaN, Infinity, "8"]) reject({ type: "pivot", cubeIds: guardIds, axis: "x", value }, "INVALID_COMMAND");
for (const angle of [1, 10, 90, 180, "22.5"]) reject({ type: "rotate", cubeIds: guardIds, axis: "x", angle }, "INVALID_COMMAND");
reject({ type: "pivot", cubeIds: ["missing"], axis: "x", value: 8 }, "TARGET");
reject({ type: "snap", cubeIds: [guardIds[0], guardIds[0]], step: 0.25 }, "TARGET");
reject({ type: "pivot", cubeIds: guardIds, axis: "diagonal", value: 8 }, "INVALID_COMMAND");
const previous = session.state();
assert.throws(() => apply([{ type: "pivot", cubeIds: guardIds, axis: "y", value: 9 }, { type: "transform", cubeIds: guardIds, translation: [60, 0, 0], scale: [1, 1, 1] }]), { code: "BOUNDS" });
assert.deepEqual(session.state(), previous);
apply([{ type: "lock", partId: "guard", locked: true }]);
for (const command of [{ type: "pivot", cubeIds: guardIds, axis: "y", value: 10 }, { type: "snap", cubeIds: guardIds, step: 1 }] as const) {
  const before = session.state();
  assert.throws(() => apply([{ ...command, cubeIds: [...command.cubeIds] }], "agent"), { code: "LOCKED" });
  assert.deepEqual(session.state(), before); rejected++;
}
const edge = structuredClone(initial);
delete edge.design;
for (const bone of edge.model.bones) bone.cubes = bone.cubes.filter((c) => c.id === "guard_center");
edge.parts = [{ id: "edge", label: "Inflated edge", locked: false, cubeIds: ["guard_center"] }];
edge.texturePlan.faces = edge.texturePlan.faces.filter((f) => f.cubeId === "guard_center");
const cube = cubes(edge)[0]!;
cube.origin = [-15.7, 8, 8]; cube.size = [1, 1, 1]; cube.inflate = 0.3;
const edgeSession = new EditorSession(validateProject(edge)), edgeState = edgeSession.state();
assert.throws(() => edgeSession.apply({ projectId: edge.projectId, expectedRevision: 0, key: randomUUID(), commands: [{ type: "snap", cubeIds: [cube.id], step: 1 }] }), { code: "BOUNDS" });
assert.deepEqual(edgeSession.state(), edgeState); rejected++;
cube.rotation = [22.5, 45, 0];
assert.throws(() => validateProject(edge), { code: "ROTATION" });
process.stdout.write(`editor-core geometry: snapping, pivots, native rotations, exact PNG/UV/history and ${rejected} rejected inputs PASS\n`);
