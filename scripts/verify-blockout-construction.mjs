import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import console from "node:console";
import { cubes, parseProject } from "../packages/editor-core/index.ts";

// Проверка связности твёрдых кубоидов. Художественную оценку и collision в игре не заменяет.
const path = process.argv[2];
assert(path, "Укажите .mmeditor.json");
const bytes = await readFile(path);
const project = parseProject(bytes.toString("utf8"));
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const epsilon = 1e-6;
const boxes = cubes(project).map(cube => {
  assert(cube.rotation.filter(Boolean).length <= 1, "Требуется нативный поворот по одной оси");
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const index = cube.rotation.findIndex(Boolean);
  if (index >= 0) {
    const angle = cube.rotation[index] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    if (index === 0) { axes[1] = [0, c, s]; axes[2] = [0, -s, c]; }
    if (index === 1) { axes[0] = [c, 0, -s]; axes[2] = [s, 0, c]; }
    if (index === 2) { axes[0] = [c, s, 0]; axes[1] = [-s, c, 0]; }
  }
  const local = subtract(cube.origin.map((n, i) => n + cube.size[i] / 2), cube.pivot);
  const center = cube.pivot.map((n, a) => n + local.reduce((sum, v, i) => sum + v * axes[i][a], 0));
  return { id: cube.id, axes, center, radius: cube.size.map(n => n / 2 + cube.inflate) };
});

// SAT для ориентированных коробок; касание лишь ребром или точкой не считается креплением.
function joined(a, b) {
  const axes = [...a.axes, ...b.axes, ...a.axes.flatMap(x => b.axes.map(y => cross(x, y)))];
  const delta = subtract(b.center, a.center), zeroDirections = [];
  for (const raw of axes) {
    const length = Math.sqrt(dot(raw, raw));
    if (length < epsilon) continue;
    const axis = raw.map(n => n / length);
    const radius = (box) => box.radius.reduce((sum, n, i) => sum + n * Math.abs(dot(box.axes[i], axis)), 0);
    const overlap = radius(a) + radius(b) - Math.abs(dot(delta, axis));
    if (overlap < -epsilon) return false;
    if (overlap <= epsilon && zeroDirections.every(old => Math.abs(dot(old, axis)) < 1 - epsilon)) zeroDirections.push(axis);
  }
  return zeroDirections.length <= 1;
}
const adjacency = boxes.map(() => []), edges = [];
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  if (!joined(boxes[i], boxes[j])) continue;
  adjacency[i].push(j); adjacency[j].push(i);
  edges.push([boxes[i].id, boxes[j].id]);
}
const visited = new Set(), components = [];
for (let i = 0; i < boxes.length; i++) {
  if (visited.has(i)) continue;
  const pending = [i], component = [];
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current); component.push(boxes[current].id);
    pending.push(...adjacency[current]);
  }
  components.push(component.sort());
}
const result = {
  status: components.length === 1 ? "CONNECTED" : "DISCONNECTED", path,
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  method: "SAT of solid oriented cuboids, face/volume contacts; edge/point contacts excluded; epsilon=1e-6 model units",
  cubeCount: boxes.length, contactCount: edges.length, components, edges,
  limits: "Ignores alpha-cut texture holes and semantics of deliberate intersections; not an artistic or game collision approval",
};
console.log(JSON.stringify(result, null, 2));
if (components.length !== 1) process.exitCode = 1;
