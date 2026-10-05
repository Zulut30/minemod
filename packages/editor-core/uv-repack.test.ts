import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { EditorSession, EditorError, emptyProject, validateProject, FACE_NAMES, texturePixels, textureMask,
  type EditorProject, type EditorCommand, type FaceName } from "./index.ts";
import { compilePaintedMinecraftItemAssets } from "../assets-core/index.ts";

function fixture(): EditorProject {
  const s = new EditorSession(emptyProject(randomUUID()));
  s.apply({ projectId: s.state().project.projectId, expectedRevision: 0, key: randomUUID(), commands: [
    { type: "add", cubeId: "first" }, { type: "add", cubeId: "second" },
  ] });
  const p = s.state().project;
  p.model.texture = { width: 32, height: 32 };
  p.texturePlan.palette = [{ symbol: "0", color: "#112233" }, { symbol: "1", color: "#778899" }, { symbol: "2", color: "#00ffaa" }];
  const pixels = Array<string>(1024).fill("."); let count = 0;
  for (const binding of p.texturePlan.faces) for (const face of FACE_NAMES) {
    const x = 2 + count % 4 * 7, y = 2 + Math.floor(count / 4) * 7;
    binding.uv[face] = [x, y, x + 4, y + 4];
    for (let v = y; v < y + 4; v++) for (let u = x; u < x + 4; u++) pixels[v * 32 + u] = "0";
    pixels[(y + 1) * 32 + x + 2] = "1"; pixels[y * 32 + x] = "."; count++;
  }
  pixels[0] = "2"; // Неиспользуемый рисунок на первом месте, которое выбрал бы незащищённый packer.
  const first = p.texturePlan.faces[0]!;
  first.uv.north = [6, 6, 2, 2]; first.uv.south = [2, 2, 6, 6];
  p.texturePlan.faces[1]!.uv.north = [3, 2, 7, 6]; // Частично общий исходный UV другой части.
  p.texturePlan.rows = Array.from({ length: 32 }, (_, y) => pixels.slice(y * 32, y * 32 + 32).join(""));
  return validateProject(p);
}
function apply(s: EditorSession, commands: EditorCommand[], actor: "human" | "agent" = "agent") {
  const state = s.state(); return s.apply({ projectId: state.project.projectId, expectedRevision: state.revision, key: randomUUID(), commands }, actor);
}
function reject(s: EditorSession, command: unknown, code?: string) {
  const before = s.state();
  assert.throws(() => apply(s, [command as EditorCommand]), e => !code || e instanceof EditorError && e.code === code);
  assert.deepEqual(s.state(), before, "Отказ сохраняет проект, историю, repair и revision");
}
function facePixels(p: EditorProject, cubeId: string, face: FaceName): (string | null)[] {
  const rect = p.texturePlan.faces.find(b => b.cubeId === cubeId)!.uv[face], pixels = texturePixels(p), result = [];
  const w = Math.abs(rect[2] - rect[0]), h = Math.abs(rect[3] - rect[1]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = rect[0] < rect[2] ? rect[0] + x : rect[0] - 1 - x;
    const v = rect[1] < rect[3] ? rect[1] + y : rect[1] - 1 - y;
    result.push(pixels[v * p.model.texture.width + u]!);
  }
  return result;
}
function exportedPixels(p: EditorProject): number[] {
  const png = Buffer.from(compilePaintedMinecraftItemAssets(p.model, p.texturePlan).editable.texture.bytes), chunks = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") chunks.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), pixels = [], stride = p.model.texture.width * 4 + 1;
  for (let y = 0; y < p.model.texture.height; y++) { assert.equal(raw[y * stride], 0); pixels.push(...raw.subarray(y * stride + 1, (y + 1) * stride)); }
  return pixels;
}
for (const shared of [undefined, "preserve-exact", "split"] as const) {
  const source = fixture(), s = new EditorSession(source), command: EditorCommand = { type: "repackUv", cubeIds: ["first"], ...(shared ? { shared } : {}) };
  const before = s.state(), preview = s.preview({ projectId: source.projectId, expectedRevision: 0, key: randomUUID(), commands: [command] }, "agent");
  assert.deepEqual(s.state(), before, "Preview не меняет документ");
  apply(s, [command]); const after = s.state().project;
  assert.deepEqual(after, preview.project); assert.deepEqual(after.model, source.model); assert.deepEqual(after.parts, source.parts); assert.deepEqual(after.design, source.design);
  const a = after.texturePlan.faces[0]!.uv;
  const normal = (r: number[]) => [Math.min(r[0]!, r[2]!), Math.min(r[1]!, r[3]!), Math.max(r[0]!, r[2]!), Math.max(r[1]!, r[3]!)];
  if (shared === "split") assert.notDeepEqual(normal(a.north), normal(a.south)); else assert.deepEqual(normal(a.north), normal(a.south));
  assert(a.north[0] > a.north[2] && a.north[1] > a.north[3], "Оба отражения сохраняются");
  for (const b of source.texturePlan.faces) for (const face of FACE_NAMES)
    assert.deepEqual(facePixels(after, b.cubeId, face), facePixels(source, b.cubeId, face), `${b.cubeId}:${face}`);
  const other = textureMask(source, ["second"]), old = texturePixels(source), pixels = texturePixels(after);
  assert(pixels.every((color, i) => !other[i] || color === old[i])); assert.equal(pixels[0], "#00ffaa");
  const rectangles = Object.values(a).map(normal), foreign = Object.values(source.texturePlan.faces[1]!.uv).map(normal);
  for (const r of rectangles) for (const q of foreign)
    assert(r[2]! + 1 <= q[0]! || q[2]! + 1 <= r[0]! || r[3]! + 1 <= q[1]! || q[3]! + 1 <= r[1]!, "Сохраняется padding до чужих UV");
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
    const r = rectangles[i]!, q = rectangles[j]!;
    if (JSON.stringify(r) === JSON.stringify(q) && shared !== "split") continue;
    assert(r[2]! + 1 <= q[0]! || q[2]! + 1 <= r[0]! || r[3]! + 1 <= q[1]! || q[3]! + 1 <= r[1]!);
  }
  const rgba = exportedPixels(after);
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i], expected = c ? [1, 3, 5].map(at => Number.parseInt(c.slice(at, at + 2), 16)).concat(255) : [0, 0, 0, 0];
    assert.deepEqual(rgba.slice(i * 4, i * 4 + 4), expected);
  }
  reject(s, command, "NO_CHANGE");
  apply(s, [{ type: "undo" }]); assert.deepEqual(s.state().project, source);
  apply(s, [{ type: "redo" }]); assert.deepEqual(s.state().project, after);
}
const source = fixture(), locked = structuredClone(source);
locked.parts.find(p => p.cubeIds.includes("first"))!.locked = true;
reject(new EditorSession(locked), { type: "repackUv", cubeIds: ["first"] }, "LOCKED");
for (const command of [{ type: "repackUv", cubeIds: ["missing"] }, { type: "repackUv", cubeIds: ["first", "first"] }])
  reject(new EditorSession(source), command, "TARGET");
for (const command of [{ type: "repackUv", cubeIds: [] }, { type: "repackUv", cubeIds: ["first"], shared: "rotate" }, { type: "repackUv", cubeIds: ["first"], budget: 999999999 }])
  reject(new EditorSession(source), command);
const full = structuredClone(source); full.texturePlan.faces[1]!.uv.north = [0, 0, 32, 32]; validateProject(full);
reject(new EditorSession(full), { type: "repackUv", cubeIds: ["first"] }, "UV_PACK_FULL");
const repaired = new EditorSession(source), repairBase = repaired.state();
repaired.setRepair({ projectId: source.projectId, expectedRevision: repairBase.revision, repair: {
  id: randomUUID(), note: "Только адресный перенос UV", partIds: [source.parts.find(p => p.cubeIds.includes("first"))!.id], area: "uv", maxIterations: 2,
} });
reject(repaired, { type: "repackUv", cubeIds: ["first"] }, "REPAIR_SCOPE");
const dense = fixture(), template = dense.model.bones[0]!.cubes[0]!, templateBone = dense.model.bones[0]!;
const denseIds = Array.from({ length: 256 }, (_, i) => "pixel_" + i);
dense.model.texture = { width: 256, height: 256 };
dense.model.bones = Array.from({ length: 4 }, (_, b) => ({ ...templateBone, id: "root_" + b, parent: b ? "root_0" : null,
  cubes: denseIds.slice(b * 64, b * 64 + 64).map(id => ({ ...structuredClone(template), id, size: [1, 1, 1] as [number, number, number], uv: [0, 0] as [number, number] })) }));
dense.parts = [{ ...dense.parts[0]!, id: "batch", cubeIds: denseIds }];
dense.texturePlan.faces = denseIds.map(cubeId => ({ cubeId, uv: Object.fromEntries(FACE_NAMES.map(face => [face, [0, 0, 1, 1]])) as EditorProject["texturePlan"]["faces"][number]["uv"] }));
dense.texturePlan.rows = Array.from({ length: 256 }, (_, y) => (y ? "." : "0") + ".".repeat(255)); validateProject(dense);
reject(new EditorSession(dense), { type: "repackUv", cubeIds: denseIds, shared: "split" }, "UV_PACK_BUDGET");
process.stdout.write("UV repack: reflected/shared/partial UV, orphan pixels, padding, preview, exact exported RGBA, full history, locks, repair, invalid input, no-space and work-budget rollback PASS\n");
