import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { EditorSession, EditorError, emptyProject, FACE_NAMES, inspectTexelDensity, validateProject } from "./index.ts";

const session = new EditorSession(emptyProject(randomUUID()));
session.apply({ projectId: session.state().project.projectId, expectedRevision: 0, key: randomUUID(), commands: [{ type: "add", cubeId: "sample" }] });
const project = session.state().project, cube = project.model.bones[0]!.cubes[0]!;
cube.size = [2, 4, 8]; cube.uv = [0, 0];
project.model.texture = { width: 32, height: 32 };
project.texturePlan.rows = project.texturePlan.rows.slice(0, 32).map(row => row.slice(0, 32));
project.texturePlan.faces[0]!.uv = Object.fromEntries(FACE_NAMES.map(face => [face, [4, 8, 0, 0]])) as typeof project.texturePlan.faces[0]["uv"];
validateProject(project);
const before = structuredClone(project), profile = { pixelsPerBlock: 16, tolerancePercent: 0 };
const report = inspectTexelDensity(project, profile);
assert.equal(report.faces.length, 6); assert.equal(report.summary.axes, 12);
const densities = Object.fromEntries(report.faces.map(face => [face.face, face.axes.map(axis => axis.pixelsPerBlock)]));
assert.deepEqual(densities, { north: [32, 32], south: [32, 32], east: [8, 32], west: [8, 32], up: [32, 16], down: [32, 16] });
assert.equal(report.summary.axesWithinTolerance, 2); assert.equal(report.summary.axesOutsideTolerance, 10);
assert.equal(report.summary.axesWithoutIntegerCoverage, 0);
assert.equal(report.artisticAcceptance, "requires-human-review");
assert.equal(report.profileSource, "caller-supplied-not-ArtSpec-verified");
assert.deepEqual(project, before);
cube.rotation = [0, 22.5, 0];
assert.deepEqual(inspectTexelDensity(project, profile).faces, report.faces, "Rigid rotations cannot change intrinsic density");
project.model.bones[0]!.rotation = [0, 0, 45];
assert.throws(() => inspectTexelDensity(project, profile), error => error instanceof EditorError && error.code === "ROTATION");
project.model.bones[0]!.rotation = [0, 0, 0];
cube.inflate = 1;
const inflated = inspectTexelDensity(project, profile).faces;
assert.deepEqual(inflated.find(face => face.face === "north")!.axes.map(axis => axis.modelUnits), [4, 6]);
assert.equal(inflated.find(face => face.face === "north")!.axes[0]!.pixelsPerBlock, 16);
assert.equal(inflated.find(face => face.face === "north")!.axes[1]!.pixelsPerBlock, 64 / 3);
assert.deepEqual(inflated.find(face => face.face === "east")!.axes.map(axis => axis.modelUnits), [10, 6]);
assert.deepEqual(inflated.find(face => face.face === "up")!.axes.map(axis => axis.modelUnits), [4, 10]);
cube.inflate = 0; cube.size = [0.125, 4, 8];
const thin = inspectTexelDensity(project, { pixelsPerBlock: 16, tolerancePercent: 10 });
assert.equal(thin.summary.axesWithoutIntegerCoverage, 4);
assert.equal(thin.faces[0]!.axes[0]!.integerPixelRange, null);
assert.equal(thin.faces[0]!.axes[0]!.closestPositivePixels, 1);
assert.equal(thin.faces[0]!.axes[0]!.withinTolerance, false, "Nearest positive pixel is not a profile exception");
cube.size = [2, 4, 8];
const capacity = inspectTexelDensity(project, { pixelsPerBlock: 256, tolerancePercent: 0 });
assert.equal(capacity.summary.axesWithoutAtlasCapacity, 8);
assert.deepEqual(capacity.faces[0]!.axes[1]!.integerPixelRange, [64, 64]);
const fullTolerance = inspectTexelDensity(project, { pixelsPerBlock: 16, tolerancePercent: 100 });
assert.equal(fullTolerance.summary.axesWithinTolerance, 12);
cube.size = [2.5, 4, 8];
assert(inspectTexelDensity(project, { pixelsPerBlock: 32, tolerancePercent: 20 }).faces[0]!.axes[0]!.withinTolerance, "Inclusive lower density boundary");
cube.size[0] = Number.MIN_VALUE;
const overflow = inspectTexelDensity(project, profile);
assert.equal(overflow.summary.unmeasurableAxes, 4);
assert.equal(overflow.faces[0]!.axes[0]!.pixelsPerBlock, null);
assert.deepEqual(JSON.parse(JSON.stringify(overflow)), overflow, "No JSON Infinity/NaN or hidden null coercion");

for (const [badProfile, ids, code] of [
  [{ pixelsPerBlock: 0, tolerancePercent: 10 }, undefined, "INVALID_ARGUMENTS"],
  [{ pixelsPerBlock: 257, tolerancePercent: 10 }, undefined, "INVALID_ARGUMENTS"],
  [{ pixelsPerBlock: 16.5, tolerancePercent: 10 }, undefined, "INVALID_ARGUMENTS"],
  [{ pixelsPerBlock: NaN, tolerancePercent: 10 }, undefined, "INVALID_ARGUMENTS"],
  [{ pixelsPerBlock: Infinity, tolerancePercent: 10 }, undefined, "INVALID_ARGUMENTS"],
  [{ pixelsPerBlock: 16, tolerancePercent: -1 }, undefined, "INVALID_ARGUMENTS"],
  [{ pixelsPerBlock: 16, tolerancePercent: 101 }, undefined, "INVALID_ARGUMENTS"],
  [{ ...profile, approve: true }, undefined, "INVALID_ARGUMENTS"],
  [profile, [], "INVALID_ARGUMENTS"], [profile, Array(257).fill("sample"), "INVALID_ARGUMENTS"],
  [profile, ["sample", "sample"], "DUPLICATE_ID"], [profile, ["missing"], "TARGET"],
] as const) assert.throws(() => inspectTexelDensity(project, badProfile, ids), error => error instanceof EditorError && error.code === code);
assert.deepEqual(inspectTexelDensity(project, profile, ["sample"]), overflow);
const empty = inspectTexelDensity(emptyProject(randomUUID()), profile);
assert.equal(empty.summary.axes, 0); assert.equal(empty.selectedCubes, 0);
assert(Buffer.byteLength(JSON.stringify(overflow)) < 20_000);
const maximum = structuredClone(before), bone = maximum.model.bones[0]!;
const ids = Array.from({ length: 256 }, (_, index) => "sample_" + index);
maximum.model.bones = Array.from({ length: 4 }, (_, index) => ({ ...bone, id: "root_" + index, parent: index ? "root_0" : null,
  cubes: ids.slice(index * 64, index * 64 + 64).map(id => ({ ...structuredClone(bone.cubes[0]!), id })) }));
maximum.parts = [{ ...maximum.parts[0]!, cubeIds: ids }];
maximum.texturePlan.faces = ids.map(cubeId => ({ ...structuredClone(maximum.texturePlan.faces[0]!), cubeId }));
const maximumReport = inspectTexelDensity(maximum, profile, ids);
assert.equal(maximumReport.summary.faces, 1536); assert.equal(maximumReport.summary.axes, 3072);
assert(Buffer.byteLength(JSON.stringify(maximumReport)) < 2_097_152, "Largest supported report fits fixed MCP response limit");
process.stdout.write("Texel density: six non-square faces, reflected UV, inflate, rigid rotations, integer/atlas feasibility, strict bounds, finite JSON and read-only inputs PASS\n");
