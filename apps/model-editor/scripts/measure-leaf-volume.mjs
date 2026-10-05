import * as THREE from "three";
import { OBB } from "three/addons/math/OBB.js";
import { cubes, parseProject } from "../../../packages/editor-core/index.ts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { URL } from "node:url";
import assert from "node:assert/strict";
import console from "node:console";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const steps = [.1, .05, .025];

function oriented(cube) {
  const pivot = new THREE.Vector3(...cube.pivot);
  const rotation = new THREE.Euler(...cube.rotation.map(v => v * Math.PI / 180), "XYZ");
  const center = new THREE.Vector3(...cube.origin.map((v, i) => v + cube.size[i] / 2))
    .sub(pivot).applyEuler(rotation).add(pivot);
  const half = new THREE.Vector3(...cube.size.map(v => v / 2 + cube.inflate));
  const matrix = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
  const obb = new OBB(center, half, matrix), axes = [0, 3, 6].map(i => matrix.elements.slice(i, i + 3));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const signs = [x, y, z], point = center.toArray().map((v, a) => v + signs.reduce((s, n, i) => s + n * half.getComponent(i) * axes[i][a], 0));
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], point[a]); max[a] = Math.max(max[a], point[a]); }
  }
  return { id: cube.id, obb, center: center.toArray(), half: half.toArray(), axes, min, max };
}

function contains(box, x, y, z) {
  const dx = x - box.center[0], dy = y - box.center[1], dz = z - box.center[2];
  for (let i = 0; i < 3; i++) {
    const axis = box.axes[i];
    if (Math.abs(dx * axis[0] + dy * axis[1] + dz * axis[2]) > box.half[i] + 1e-10) return false;
  }
  return true;
}

function sampleUnion(boxes, requestedStep) {
  const min = [0, 1, 2].map(a => Math.min(...boxes.map(b => b.min[a])));
  const max = [0, 1, 2].map(a => Math.max(...boxes.map(b => b.max[a])));
  // Не создаём лишний слой из-за округления вроде 72.00000000000003.
  const cells = max.map((v, i) => Math.ceil((v - min[i]) / requestedStep - 1e-10));
  assert(cells.every(v => v > 0) && cells.reduce((n, v) => n * v, 1) <= 25_000_000,
    `Исследование ограничено 25 млн ячеек на сетку: ${JSON.stringify({ requestedStep, cells, min, max })}`);
  const spacing = max.map((v, i) => (v - min[i]) / cells[i]);
  let occupied = 0, sx = 0, sy = 0, sz = 0;
  for (let iy = 0; iy < cells[1]; iy++) {
    const y = min[1] + (iy + .5) * spacing[1], row = boxes.filter(b => y >= b.min[1] && y <= b.max[1]);
    for (let iz = 0; iz < cells[2]; iz++) {
      const z = min[2] + (iz + .5) * spacing[2], layer = row.filter(b => z >= b.min[2] && z <= b.max[2]);
      if (!layer.length) continue;
      for (let ix = 0; ix < cells[0]; ix++) {
        const x = min[0] + (ix + .5) * spacing[0];
        if (!layer.some(b => x >= b.min[0] && x <= b.max[0] && contains(b, x, y, z))) continue;
        // Общая ячейка учитывается один раз, независимо от числа перекрывающихся коробок.
        occupied++; sx += x; sy += y; sz += z;
      }
    }
  }
  assert(occupied > 0);
  return { requestedStep, spacing, cells, occupied, volume: occupied * spacing.reduce((n, v) => n * v, 1), centroid: [sx / occupied, sy / occupied, sz / occupied] };
}

function checkProbes() {
  const cube = (origin, size, rotation = [0, 0, 0], pivot = [0, 0, 0], inflate = 0) => ({ id: "probe", origin, size, rotation, pivot, inflate });
  const near = (a, b, tolerance = 1e-8) => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
  const first = oriented(cube([-1, -1, -1], [2, 2, 2]));
  assert.throws(() => sampleUnion([first], .0001), /25 млн/u);
  const single = sampleUnion([first], .1), duplicate = sampleUnion([first, first], .1);
  near(single.volume, 8); assert.deepEqual(single, duplicate);
  const overlap = sampleUnion([first, oriented(cube([0, -1, -1], [2, 2, 2]))], .1);
  near(overlap.volume, 12); overlap.centroid.forEach((v, i) => near(v, [.5, 0, 0][i]));
  const rotated = oriented(cube([0, 0, 0], [2, 1, 1], [0, 0, 45]));
  const sampled = sampleUnion([rotated], .025);
  near(sampled.volume, 2, .02); sampled.centroid.forEach((v, i) => near(v, rotated.center[i], 1e-8));
  near(sampleUnion([oriented(cube([0, 0, 0], [2, 2, 2], [0, 0, 0], [0, 0, 0], .25))], .1).volume, 15.625);
  const shifted = oriented(cube([-.3, -.2, .1], [1.5, .7, .6], [0, 22.5, 0], [4, 2, -3]));
  const point = new THREE.Vector3(); let seed = 1729, comparisons = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const box of [first, rotated, shifted]) for (let i = 0; i < 2048; i++) {
    point.set(...box.min.map((v, a) => v + random() * (box.max[a] - v)));
    assert.equal(contains(box, point.x, point.y, point.z), box.obb.containsPoint(point)); comparisons++;
  }
  return { status: "PASS", exactCases: ["single solid", "duplicate solid", "overlapping union", "inflate", "cell budget rejection"], approximateRotatedVolume: sampled.volume, membershipComparisons: comparisons };
}

const inputs = [
  { key: "a", path: "output/model-editor/leaf-volume-20261005-v3c/a.mmeditor.json", sha256: "6996f1cceb3ac0f1ffed341c0ff109d289a05b608ca4994493b3601bd76c007b" },
  { key: "b", path: "output/model-editor/leaf-volume-20261005-v3c/b.mmeditor.json", sha256: "7f0407e6840320b2255c0f59e87ea643ac5644204f04053c4a4c99784d1c76e8" },
  { key: "c", path: "output/model-editor/leaf-bevel-94fbca11/c.mmeditor.json", sha256: "9b8e63ce3279981870260d8c960dffea567e4c7a091b672154fa46d1c455f82b" },
];
const probes = checkProbes(), results = [];
for (const input of inputs) {
  const bytes = await readFile(input.path); assert.equal(hash(bytes), input.sha256);
  const project = parseProject(bytes.toString("utf8")), boxes = cubes(project).map(oriented);
  const guard = boxes.find(b => b.id === "guard_core"); assert(guard, "Нужен guard_core выбранного исследования");
  const samples = steps.map(step => sampleUnion(boxes, step)), last = samples.at(-1), previous = samples.at(-2);
  const summedCuboidVolume = boxes.reduce((s, b) => s + 8 * b.half.reduce((n, v) => n * v, 1), 0);
  results.push({ ...input, cubeCount: boxes.length, guardCoreCenter: guard.center, samples, summedCuboidVolume,
    duplicateVolumeAvoided: summedCuboidVolume - last.volume,
    centroidAboveGuard: last.centroid[1] - guard.center[1],
    lastRefinement: { relativeVolumeChange: Math.abs(last.volume - previous.volume) / last.volume,
      centroidDistance: Math.hypot(...last.centroid.map((v, i) => v - previous.centroid[i])) } });
  assert.equal(hash(await readFile(input.path)), input.sha256);
}
const output = "output/verification/leaf-union-volume-044-" + randomUUID().slice(0, 8) + ".json";
await mkdir("output/verification", { recursive: true });
await writeFile(output, JSON.stringify({ status: "MEASURED", method: "Midpoint quadrature of the union of solid oriented cuboids; equal geometric density; XYZ rotation/pivot/inflate",
  scriptSha256: hash(await readFile(new URL(import.meta.url))), three: "0.186.1", probes, results,
  limits: "Convergence observations are not certified error bounds. Ignores texture alpha, material density and physical simulation. No balance target, artistic acceptance or game acceptance is assigned.",
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: "MEASURED", output, probes, results: results.map(r => ({ key: r.key, volume: r.samples.at(-1).volume,
  summedCuboidVolume: r.summedCuboidVolume, centroid: r.samples.at(-1).centroid, centroidAboveGuard: r.centroidAboveGuard, lastRefinement: r.lastRefinement })) }));
