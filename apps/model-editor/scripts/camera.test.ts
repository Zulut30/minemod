import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as THREE from "three";
import { projectFromAsset, cubes, type Cube } from "@mcdev/editor-core";
import { frameCubes, comparisonFrame, cameraSettings } from "../renderer/camera.ts";
import { VIEWS } from "../shared/bridge.ts";

const project = projectFromAsset(JSON.parse(await readFile(new URL("../../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8")), randomUUID());
const all = cubes(project), guard = all.filter((c) => project.parts.find((p) => p.id === "guard")!.cubeIds.includes(c.id));
const edge: Cube = { ...structuredClone(all[0]!), origin: [-15.875, -15.875, -15.875],
  size: [47.75, 47.75, 47.75], inflate: 0.125, pivot: [128, -128, 128], rotation: [0, 0, 45] };
const frames = [all, guard, [edge], [...all, edge]];
let projected = 0;
for (const items of frames) {
  const frame = frameCubes(items);
  for (const [width, height] of [[1024, 768], [256, 256], [280, 150], [150, 350]]) {
    const zooms = new Set<number>();
    for (const view of VIEWS) {
      const settings = cameraSettings(frame, view, width!, height!);
      assert.deepEqual(settings, cameraSettings(frame, view, width!, height!));
      zooms.add(settings.zoom);
      const camera = new THREE.OrthographicCamera(-width! / 2, width! / 2, height! / 2, -height! / 2, settings.near, settings.far);
      camera.position.set(...settings.position); camera.up.set(...settings.up); camera.zoom = settings.zoom;
      camera.lookAt(...frame.center); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      for (const cube of items) for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
        const point = new THREE.Vector3(...cube.origin.map((v, a) => v + ([x, y, z][a] ? cube.size[a]! + cube.inflate : -cube.inflate)) as [number, number, number]);
        point.sub(new THREE.Vector3(...cube.pivot)).applyEuler(new THREE.Euler(...cube.rotation.map((v) => v * Math.PI / 180) as [number, number, number]))
          .add(new THREE.Vector3(...cube.pivot)).project(camera);
        assert([point.x, point.y, point.z].every(Number.isFinite));
        assert(Math.abs(point.x) < 0.9 && Math.abs(point.y) < 0.9 && Math.abs(point.z) < 1, `${view} must fit inflated rotated corner at extreme pivot.`);
        projected++;
      }
    }
    assert.equal(zooms.size, 1, "Every side must use the same pixels per model unit.");
  }
}
assert.deepEqual(cameraSettings(frameCubes(all), "right", 1024, 768), cameraSettings(frameCubes(all), "side", 1024, 768));
assert.deepEqual(cameraSettings(frameCubes(all), "top", 1024, 768).up, [0, 0, -1]);
assert.deepEqual(cameraSettings(frameCubes(all), "bottom", 1024, 768).up, [0, 0, 1]);
assert.deepEqual(frameCubes([]), { center: [8, 8, 8], extent: 16, diameter: 16 * Math.sqrt(3) });
assert.deepEqual(comparisonFrame([project, project]), frameCubes(all));
const rotated = structuredClone(project);
for (const c of cubes(rotated)) { c.rotation = [0, 0, 45]; c.pivot = [128, -128, 128]; }
const before = JSON.stringify([project, rotated]);
assert.deepEqual(comparisonFrame([project, rotated]), comparisonFrame([rotated, project]));
assert.equal(JSON.stringify([project, rotated]), before, "Framing is read-only and must not mutate snapshots.");
assert(comparisonFrame([project, rotated]).diameter > comparisonFrame([project]).diameter);
process.stdout.write(`Studio camera: ${projected} projected corners, 9 presets, four aspect ratios, extreme pivot/inflate and equal-scale comparison PASS\n`);
