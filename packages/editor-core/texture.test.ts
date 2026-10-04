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
process.stdout.write(
  "Покраска и UV: границы, прозрачность, заливка, перенос/отражение/масштаб, палитра, история, конфликты, закрепления и RGBA PNG PASS\n",
);
