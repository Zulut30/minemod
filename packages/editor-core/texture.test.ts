import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import {
  EditorSession,
  EditorError,
  emptyProject,
  validateProject,
  parseProject,
  FACE_NAMES,
  pixelLine,
  previewTexture,
  texturePixels,
  textureMask,
  type EditorCommand,
  type EditorProject,
} from "./index.ts";
import { compilePaintedMinecraftItemAssets } from "../assets-core/index.ts";

function fixture(): EditorProject {
  const session = new EditorSession(emptyProject(randomUUID()));
  session.apply({
    projectId: session.state().project.projectId,
    expectedRevision: 0,
    key: randomUUID(),
    commands: [
      { type: "add", cubeId: "first" },
      { type: "add", cubeId: "second" },
    ],
  });
  const p = session.state().project;
  p.model.texture = { width: 32, height: 32 };
  p.texturePlan.palette = [
    { symbol: "0", color: "#112233" },
    { symbol: "1", color: "#778899" },
  ];
  const pixels = Array<string>(1024).fill(".");
  let count = 0;
  for (const binding of p.texturePlan.faces)
    for (const face of FACE_NAMES) {
      const x = 1 + (count % 5) * 6,
        y = 1 + Math.floor(count / 5) * 6;
      binding.uv[face] = [x, y, x + 4, y + 4];
      for (let v = y; v < y + 4; v++)
        for (let u = x; u < x + 4; u++) pixels[v * 32 + u] = "0";
      count++;
    }
  // Асимметричный узор позволяет обнаружить отражение и потерю рисунка при переносе.
  pixels[1 * 32 + 1] = "1";
  pixels[2 * 32 + 4] = "1";
  p.texturePlan.rows = Array.from({ length: 32 }, (_, y) =>
    pixels.slice(y * 32, y * 32 + 32).join(""),
  );
  return validateProject(p);
}
function apply(
  s: EditorSession,
  commands: EditorCommand[],
  actor: "human" | "agent" = "human",
) {
  const state = s.state();
  return s.apply(
    {
      projectId: state.project.projectId,
      expectedRevision: state.revision,
      key: randomUUID(),
      commands,
    },
    actor,
  );
}
function rejects(s: EditorSession, command: unknown, code?: string) {
  const before = s.state();
  assert.throws(
    () => apply(s, [command as EditorCommand]),
    (e) => !code || (e instanceof EditorError && e.code === code),
  );
  assert.deepEqual(
    s.state(),
    before,
    "Ошибка должна сохранять документ, историю и ревизию",
  );
}
const paint: Extract<EditorCommand, { type: "paint" }> = {
  type: "paint",
  cubeIds: ["first"],
  face: "north",
  color: "#ff9900",
  size: 1,
  points: [[2, 2]],
};
const command = () => structuredClone(paint);
const source = fixture(),
  s = new EditorSession(source);
const line = pixelLine([1, 3], [4, 3]);
assert.deepEqual(line, [
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
]);
assert.equal(pixelLine([255, 0], [0, 255]).length, 256);
const mutation = {
  projectId: source.projectId,
  expectedRevision: 0,
  key: randomUUID(),
  commands: [{ ...paint, points: line }],
};
const preview = s.preview(mutation);
assert.deepEqual(s.state().project, source);
assert.notDeepEqual(preview.project, source);
s.apply(mutation);
assert.equal(s.state().history.length, 1);
assert.equal(s.apply(mutation).revision, 1);
const old = texturePixels(source),
  now = texturePixels(s.state().project);
assert(
  now.every((v, i) => (i >= 97 && i <= 100 ? v === "#ff9900" : v === old[i])),
);
assert.deepEqual(s.state().project.model, source.model);
const drawn = s.state().project;
apply(s, [{ type: "undo" }]);
assert.deepEqual(s.state().project, source);
apply(s, [{ type: "redo" }]);
assert.deepEqual(s.state().project, drawn);
assert.throws(
  () => s.apply({ ...mutation, key: randomUUID() }),
  (e) => e instanceof EditorError && e.code === "REVISION_CONFLICT",
);
rejects(s, { ...paint, points: [[0, 0]] }, "NO_CHANGE");
rejects(s, { ...paint, points: [[32, 1]] }, "PIXEL_BOUNDS");
for (const invalid of [
  { ...paint, points: [[-1, 1]] },
  { ...paint, points: [[1.5, 1]] },
  { ...paint, points: Array(4097).fill([1, 1]) },
  { ...paint, size: 9 },
  { ...paint, color: "red" },
  { ...paint, eval: "unsafe" },
])
  rejects(s, invalid);
rejects(s, { type: "uv", cubeId: "first", face: "north", rect: [1, 1, 1, 4] });
const atomic = s.state();
assert.throws(() =>
  apply(s, [
    command(),
    { type: "uv", cubeId: "first", face: "north", rect: [32, 24, 36, 28] },
  ]),
);
assert.deepEqual(s.state(), atomic);

const clipped = previewTexture(source, { ...paint, size: 8, points: [[1, 1]] });
const scope = textureMask(source, ["first"], "north");
assert(
  texturePixels(clipped).every((v, i) =>
    scope[i] ? v === "#ff9900" : v === old[i],
  ),
  "Большая кисть не задевает соседние поверхности",
);
const erased = previewTexture(source, { ...paint, color: null });
assert.equal(texturePixels(erased)[66], null);
assert.equal(
  texturePixels(previewTexture(erased, { ...paint }))[66],
  "#ff9900",
);
const filled = previewTexture(source, {
  type: "fill",
  cubeIds: ["first"],
  face: "north",
  seed: [1, 1],
  color: "#ff9900",
});
assert.equal(
  texturePixels(filled).filter((v) => v === "#ff9900").length,
  1,
  "Заливка не пересекает границы цвета",
);
const uniform = previewTexture(source, {
  type: "fill",
  cubeIds: ["first"],
  face: "north",
  seed: [2, 2],
  color: null,
});
assert.equal(
  texturePixels(uniform).filter((v, i) => scope[i] && v === null).length,
  14,
);
assert(texturePixels(uniform).every((v, i) => scope[i] || v === old[i]));
rejects(
  s,
  { type: "fill", cubeIds: ["first"], color: "#ff9900", seed: [0, 0] },
  "EMPTY_PAINT",
);

const moved = previewTexture(source, {
  type: "uv",
  cubeId: "first",
  face: "north",
  rect: [2, 22, 6, 26],
});
const transferred = texturePixels(moved);
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++) {
    assert.equal(transferred[(y + 22) * 32 + x + 2], old[(y + 1) * 32 + x + 1]);
    assert.equal(transferred[(y + 1) * 32 + x + 1], null);
  }
assert.deepEqual(moved.model, source.model);
assert.deepEqual(parseProject(JSON.stringify(moved)), moved);
const reversed = previewTexture(source, {
  type: "uv",
  cubeId: "first",
  face: "north",
  rect: [6, 26, 2, 22],
});
assert.equal(texturePixels(reversed)[25 * 32 + 5], "#778899");
assert.equal(texturePixels(reversed)[22 * 32 + 2], old[4 * 32 + 4]);
const oldReversed = structuredClone(source);
oldReversed.texturePlan.faces[0]!.uv.north = [5, 5, 1, 1];
const both = previewTexture(oldReversed, {
  type: "uv",
  cubeId: "first",
  face: "north",
  rect: [6, 26, 2, 22],
});
assert.equal(texturePixels(both)[22 * 32 + 2], old[1 * 32 + 1]);
const scaled = previewTexture(source, {
  type: "uv",
  cubeId: "first",
  face: "north",
  rect: [2, 22, 10, 30],
});
assert.equal(texturePixels(scaled)[22 * 32 + 2], old[33]);
assert.equal(texturePixels(scaled)[23 * 32 + 3], old[33]);
rejects(
  new EditorSession(source),
  { type: "uv", cubeId: "first", face: "north", rect: [6, 1, 10, 5] },
  "UV_COLLISION",
);
rejects(
  new EditorSession(source),
  { type: "uv", cubeId: "first", face: "north", rect: [2, 17, 6, 21] },
  "UV_COLLISION",
);

const shared = structuredClone(source);
shared.texturePlan.faces[0]!.uv.south = [
  ...shared.texturePlan.faces[0]!.uv.north,
];
rejects(new EditorSession(shared), command(), "SHARED_UV");
const separated = previewTexture(shared, {
  type: "uv",
  cubeId: "first",
  face: "north",
  rect: [2, 22, 6, 26],
});
assert.equal(
  texturePixels(separated)[33],
  old[33],
  "Перенос общей UV сохраняет пиксели другой грани",
);
const exclusive = previewTexture(separated, { ...paint, points: [[2, 22]] });
assert.equal(texturePixels(exclusive)[33], old[33]);

const full = fixture();
full.texturePlan.palette = Array.from({ length: 32 }, (_, i) => ({
  symbol: i.toString(32),
  color: `#${(i * 1111).toString(16).padStart(6, "0")}`,
}));
full.texturePlan.rows[31] = full.texturePlan.palette
  .map((c) => c.symbol)
  .join("");
rejects(new EditorSession(full), command(), "PALETTE_FULL");
const reclaim = structuredClone(full);
reclaim.texturePlan.rows[31] = "0".repeat(32);
assert.equal(
  previewTexture(
    reclaim,
    command() as Extract<EditorCommand, { type: "paint" }>,
  ).texturePlan.palette.length,
  3,
);
const locked = new EditorSession(source);
apply(locked, [{ type: "lock", partId: source.parts[0]!.id, locked: true }]);
for (const action of [
  command(),
  { type: "fill", cubeIds: ["first"], seed: [1, 1], color: null },
  { type: "uv", cubeId: "first", face: "north", rect: [2, 22, 6, 26] },
]) {
  const before = locked.state();
  assert.throws(
    () => apply(locked, [action as EditorCommand], "agent"),
    (e) => e instanceof EditorError && e.code === "LOCKED",
  );
  assert.deepEqual(locked.state(), before);
}
apply(locked, [command()]);

// Проверяем реальные RGBA экспортированного PNG, включая прозрачность и UV-перенос.
const exported = compilePaintedMinecraftItemAssets(
    moved.model,
    moved.texturePlan,
  ),
  png = Buffer.from(exported.editable.texture.bytes),
  chunks: Buffer[] = [];
for (let offset = 8; offset < png.length; ) {
  const n = png.readUInt32BE(offset);
  if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
    chunks.push(png.subarray(offset + 8, offset + 8 + n));
  offset += n + 12;
}
const raw = inflateSync(Buffer.concat(chunks));
function rgba(x: number, y: number) {
  const offset = y * (32 * 4 + 1) + 1 + x * 4;
  return [...raw.subarray(offset, offset + 4)];
}
assert.deepEqual(rgba(2, 22), [119, 136, 153, 255]);
assert.deepEqual(rgba(1, 1), [0, 0, 0, 0]);
assert.equal(
  compilePaintedMinecraftItemAssets(moved.model, moved.texturePlan).editable
    .sha256,
  exported.editable.sha256,
);

// Цветной знак и прозрачное отверстие сохраняются при смене материала.
const materialSource = fixture();
materialSource.texturePlan.palette = [
  { symbol: "0", color: "#808080" }, { symbol: "1", color: "#202020" },
  { symbol: "2", color: "#ffff00" },
];
materialSource.texturePlan.rows[2] = materialSource.texturePlan.rows[2]!.slice(0, 2) + "2" + materialSource.texturePlan.rows[2]!.slice(3);
materialSource.texturePlan.rows[3] = materialSource.texturePlan.rows[3]!.slice(0, 3) + "." + materialSource.texturePlan.rows[3]!.slice(4);
validateProject(materialSource);
const material = new EditorSession(materialSource), materialBefore = texturePixels(materialSource);
const materialMask = textureMask(materialSource, ["first"]);
apply(material, [{ type: "recolor", cubeIds: ["first"], color: "#804020", preserveColors: ["#FFFF00"] }], "agent");
const recoloredMaterial = material.state().project, materialAfter = texturePixels(recoloredMaterial);
assert.equal(materialAfter[1 * 32 + 2], "#804020", "Самый светлый незащищённый металл получает целевой цвет");
assert.equal(materialAfter[1 * 32 + 1], "#201008", "Тень сохраняет четверть яркости основы");
assert.equal(materialAfter[2 * 32 + 2], "#ffff00", "Цвет знака сохранён без изменения RGB и не задаёт яркость металла");
assert.equal(materialAfter[3 * 32 + 3], null);
assert(materialAfter.every((color, i) => materialMask[i] || color === materialBefore[i]), "Соседняя часть не меняется");
assert.deepEqual(recoloredMaterial.model, materialSource.model);
assert.deepEqual(recoloredMaterial.parts, materialSource.parts);
const materialPng = Buffer.from(compilePaintedMinecraftItemAssets(recoloredMaterial.model, recoloredMaterial.texturePlan).editable.texture.bytes);
const materialChunks: Buffer[] = [];
for (let offset = 8; offset < materialPng.length;) {
  const n = materialPng.readUInt32BE(offset);
  if (materialPng.toString("ascii", offset + 4, offset + 8) === "IDAT") materialChunks.push(materialPng.subarray(offset + 8, offset + 8 + n));
  offset += n + 12;
}
const materialRaw = inflateSync(Buffer.concat(materialChunks));
for (let y = 0; y < 32; y++) assert.equal(materialRaw[y * 129], 0);
const materialRgba = (x: number, y: number) => [...materialRaw.subarray(y * 129 + 1 + x * 4, y * 129 + 5 + x * 4)];
assert.deepEqual(materialRgba(2, 2), [255, 255, 0, 255]);
assert.deepEqual(materialRgba(2, 1), [128, 64, 32, 255]);
assert.deepEqual(materialRgba(1, 1), [32, 16, 8, 255]);
assert.deepEqual(materialRgba(3, 3), [0, 0, 0, 0]);
apply(material, [{ type: "undo" }]); assert.deepEqual(material.state().project, materialSource);
apply(material, [{ type: "redo" }]); assert.deepEqual(material.state().project, recoloredMaterial);
const unchangedMaterial = new EditorSession(materialSource);
rejects(unchangedMaterial, { type: "recolor", cubeIds: ["first"], color: "#804020", preserveColors: ["#808080", "#202020", "#ffff00"] }, "NO_CHANGE");
for (const invalid of [["#ff00ff", "#FF00FF"], ["red"], Array.from({ length: 33 }, (_, i) => "#" + i.toString(16).padStart(6, "0"))])
  rejects(unchangedMaterial, { type: "recolor", cubeIds: ["first"], color: "#804020", preserveColors: invalid });
const legacyMaterial = new EditorSession(materialSource), explicitEmpty = new EditorSession(materialSource);
apply(legacyMaterial, [{ type: "recolor", cubeIds: ["first"], color: "#804020" }]);
apply(explicitEmpty, [{ type: "recolor", cubeIds: ["first"], color: "#804020", preserveColors: [] }]);
assert.deepEqual(legacyMaterial.state().project, explicitEmpty.state().project, "Старый recolor сохраняет поведение");
assert.notEqual(texturePixels(legacyMaterial.state().project)[66], "#ffff00");
const overflowMaterial = structuredClone(materialSource), neighborMask = textureMask(materialSource, ["second"]);
let extra = 0;
for (let i = 0; i < neighborMask.length && extra < 29; i++) {
  if (!neighborMask[i]) continue;
  const symbol = (extra + 3).toString(32), color = "#" + (extra + 1).toString(16).padStart(6, "0");
  overflowMaterial.texturePlan.palette.push({ symbol, color });
  const y = Math.floor(i / 32), x = i % 32, row = overflowMaterial.texturePlan.rows[y]!;
  overflowMaterial.texturePlan.rows[y] = row.slice(0, x) + symbol + row.slice(x + 1);
  extra++;
}
assert.equal(extra, 29); validateProject(overflowMaterial);
rejects(new EditorSession(overflowMaterial), { type: "recolor", cubeIds: ["first"], color: "#804020", preserveColors: ["#ffff00"] }, "PALETTE_FULL");
process.stdout.write(
  "Покраска и UV: границы, прозрачность, заливка, перенос/отражение/масштаб, палитра, защищённые цвета, история, конфликты, закрепления и RGBA PNG PASS\n",
);
