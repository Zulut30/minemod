import { writeFileSync } from "node:fs";
import { URL } from "node:url";

// Авторский источник второй версии: силуэт, материалы и пиксели, без исполнения кода из payload.
const cubes = [];
const materials = new Map();
function part(id, origin, size, material, rotation = [0, 0, 0], pivot = [8, 9, 8]) {
  cubes.push({ id, origin, size, pivot, rotation, uv: [0, 0], inflate: 0, mirror: false });
  materials.set(id, material);
}

part("grip", [7.375, 3.8, 7.375], [1.25, 4.7, 1.25], "leather");
part("grip_upper_collar", [7.25, 8.15, 7.25], [1.5, .45, 1.5], "gold");
part("grip_lower_collar", [7.25, 3.65, 7.25], [1.5, .45, 1.5], "gold");
part("pommel", [7.3, 2.3, 7.3], [1.4, 1.4, 1.4], "gold", [0, 0, 45], [8, 3, 8]);
part("pommel_inset_front", [7.6, 2.6, 7.14], [.8, .8, .2], "steel", [0, 0, 45], [8, 3, 8]);
part("pommel_inset_back", [7.6, 2.6, 8.66], [.8, .8, .2], "steel", [0, 0, 45], [8, 3, 8]);

part("guard_center", [6.7, 8.55, 7.325], [2.6, .85, 1.35], "gold");
part("guard_left", [3.8, 8.55, 7.55], [3.5, .65, .9], "gold", [0, 0, 22.5], [7.3, 8.9, 8]);
part("guard_right", [8.7, 8.55, 7.55], [3.5, .65, .9], "gold", [0, 0, -22.5], [8.7, 8.9, 8]);
part("guard_tip_left", [3.45, 7.55, 7.55], [.8, .55, .9], "steel", [0, 0, 22.5], [3.85, 7.825, 8]);
part("guard_tip_right", [11.75, 7.55, 7.55], [.8, .55, .9], "steel", [0, 0, -22.5], [12.15, 7.825, 8]);
part("gem_frame_front", [7.36, 8.4, 7.05], [1.28, 1.28, .25], "gold", [0, 0, 45], [8, 9.04, 8]);
part("gem_frame_back", [7.36, 8.4, 8.7], [1.28, 1.28, .25], "gold", [0, 0, 45], [8, 9.04, 8]);
part("gem_front", [7.56, 8.6, 6.95], [.88, .88, .18], "gem", [0, 0, 45], [8, 9.04, 8]);
part("gem_back", [7.56, 8.6, 8.87], [.88, .88, .18], "gem", [0, 0, 45], [8, 9.04, 8]);

part("blade_ricasso", [6.4, 9.4, 7.7], [3.2, 1.1, .6], "steel");
part("blade_fuller", [7, 10.5, 7.75], [2, 12.5, .5], "fuller");
part("blade_edge_left", [6.45, 10.5, 7.83], [.55, 12.5, .34], "edge", [0, -22.5, 0], [6.725, 16.75, 8]);
part("blade_edge_right", [9, 10.5, 7.83], [.55, 12.5, .34], "edge", [0, 22.5, 0], [9.275, 16.75, 8]);

// Небольшие ступени сужают клинок к настоящему острию и читаются как Minecraft-силуэт.
const taper = [3, 2.875, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1, .75, .5, .25];
for (const [index, width] of taper.entries()) {
  const y = 23 + index * .5;
  if (width > .75) {
    const rim = .3, center = width - 2 * rim;
    part(`tip_core_${index}`, [8 - center / 2, y, 7.75], [center, .5, .5], "steel");
    part(`tip_left_${index}`, [8 - width / 2, y, 7.875], [rim, .5, .25], "edge");
    part(`tip_right_${index}`, [8 + width / 2 - rim, y, 7.875], [rim, .5, .25], "edge");
  } else part(`tip_${index}`, [8 - width / 2, y, 7.875], [width, .5, .25], "edge");
}

const palette = [
  ["0", "#162f3c"], ["1", "#294955"], ["2", "#3d6570"], ["3", "#5b8790"],
  ["4", "#7ea6ac"], ["5", "#aac6c6"], ["6", "#d4e2dc"], ["7", "#f0f3e7"],
  ["8", "#44302a"], ["9", "#75513a"], ["a", "#a27a47"], ["b", "#c69b5f"],
  ["c", "#dfbf82"], ["d", "#f3dfaa"], ["e", "#17232c"], ["f", "#293743"],
  ["g", "#43515b"], ["h", "#64717a"], ["i", "#154d5f"], ["j", "#267d8a"],
  ["k", "#53b9ba"], ["l", "#92e1d3"], ["m", "#d8fff0"], ["n", "#906657"],
].map(([symbol, color]) => ({ symbol, color }));
const pixels = Array.from({ length: 256 }, () => Array(256).fill("."));
let u = 2, v = 2, rowHeight = 0;
const faces = [];
function colorAt(material, face, x, y, w, h) {
  const front = face === "north" || face === "south";
  const position = (x + .5) / w;
  if (material === "gem") {
    if (x === 0 && y < h / 2) return "m";
    return x + y < (w + h) / 2 ? "l" : x > w / 2 ? "j" : "k";
  }
  if (material === "leather") {
    const diagonal = (y + Math.floor(x / 2)) % 5;
    if (diagonal === 0) return "e";
    if (diagonal === 1) return "g";
    if (x === 0 && y % 6 === 2) return "n";
    return "f";
  }
  if (material === "gold") {
    if (y === 0) return "d";
    if (y === h - 1) return "9";
    if (x === 0) return "c";
    if (x === w - 1) return "a";
    if (h > 5 && y === Math.floor(h * .3)) return "c";
    return position < .65 ? "b" : "a";
  }
  if (material === "edge") {
    if (w === 1) return front ? "6" : "5";
    if (h > 25 && x === w - 1 && (y === 12 || y === 36)) return "3";
    return x === 0 ? "7" : x === w - 1 ? "4" : "6";
  }
  const column = Math.min(7, Math.floor(position * 8));
  const steel = ["6", "4", "3", "2", "2", "3", "4", "6"];
  let color = steel[column];
  if (!front) return x === 0 ? "5" : "2";
  if (material === "fuller") {
    const center = Math.floor(w / 2), delta = x - center;
    if (delta === -1 || delta === 0) color = "0";
    // Один вытянутый знак с короткими ответвлениями, а не повторяющиеся объёмные V.
    if (y >= 15 && y <= 32 && delta === 0 && ![20, 26].includes(y)) color = "k";
    if ([16, 17, 23, 24, 31].includes(y) && delta === -1) color = "l";
    if ([18, 25, 30].includes(y) && delta === 1) color = "j";
  }
  if (h > 10 && y === Math.floor(h * .2) && ["3", "4"].includes(color)) color = "5";
  return color;
}
function paint(width, height, material, face) {
  const w = Math.max(1, Math.ceil(width * 4)), h = Math.max(1, Math.ceil(height * 4));
  if (u + w + 2 > 256) { u = 2; v += rowHeight + 3; rowHeight = 0; }
  if (v + h + 2 > 256) throw new Error("Painted atlas budget exceeded.");
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    pixels[v + y][u + x] = colorAt(material, face, Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)), w, h);
  }
  const uv = [u, v, u + w, v + h];
  u += w + 3; rowHeight = Math.max(rowHeight, h);
  return uv;
}
for (const cube of cubes) {
  const [w, h, d] = cube.size, material = materials.get(cube.id);
  faces.push({ cubeId: cube.id, uv: {
    north: paint(w, h, material, "north"), south: paint(w, h, material, "south"),
    east: paint(d, h, material, "east"), west: paint(d, h, material, "west"),
    up: paint(w, d, material, "up"), down: paint(w, d, material, "down"),
  } });
}
const id = "mcdev:aurora_longsword_v2";
const payload = { schemaVersion: 0, kind: "minecraft-item-asset",
  model: { schemaVersion: 0, kind: "cuboid-model", id, name: "Северное сияние · версия 2", modelType: "held-item",
    texture: { width: 256, height: 256 }, bones: [{ id: "weapon", parent: null, pivot: [8, 9, 8], rotation: [0, 0, 0], cubes }] },
  texturePlan: { schemaVersion: 0, kind: "item-pixel-texture-plan", modelId: id, palette, rows: pixels.map(row => row.join("")), faces },
};
writeFileSync(new URL("./aurora-longsword-v2.item-asset.json", import.meta.url), JSON.stringify(payload, null, 2) + "\n");
