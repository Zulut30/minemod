/* global structuredClone */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import console from "node:console";
import * as THREE from "three";
import { OBB } from "three/addons/math/OBB.js";
import {
  EditorSession, emptyProject, parseProject, cubes, assetRequest,
} from "../../../packages/editor-core/index.ts";
import { compileItemAssetPayload } from "../../../packages/application/item-assets.ts";
import { ConceptStore } from "../worker/concept-files.ts";

// Локальный авторский эксперимент одного меча. Команды и права MCP не расширяются.
const priorRoot = resolve("output/model-editor/leaf-volume-20261005-v3c");
const output = resolve("output/model-editor/leaf-bevel-" + randomUUID().slice(0, 8));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inputs = await Promise.all(["a", "b"].map(async key => {
  const path = join(priorRoot, key + ".mmeditor.json"), bytes = await readFile(path);
  return { key, path, bytes, sha256: hash(bytes), project: parseProject(bytes.toString("utf8")) };
}));
assert.deepEqual(inputs.map(i => i.sha256), [
  "6996f1cceb3ac0f1ffed341c0ff109d289a05b608ca4994493b3601bd76c007b",
  "7f0407e6840320b2255c0f59e87ea643ac5644204f04053c4a4c99784d1c76e8",
]);
const prior = inputs[1].project;
assert.equal(prior.design.variants.length, 2);
assert.equal(prior.design.concepts.length, 1);
const originalSnapshots = structuredClone(prior.design.variants);
for (const [i, input] of inputs.entries()) {
  for (const field of ["model", "texturePlan", "parts"])
    assert.deepEqual(input.project[field], originalSnapshots[i].project[field]);
}
const artSpec = JSON.parse(await readFile("fixtures/art/leaf-sword.artspec-v1.json", "utf8"));
const shapes = [];
function shape(id, center, size, axis = "y", angle = 0) {
  shapes.push({ id, origin: center.map((n, i) => n - size[i] / 2), size,
    rotation: { axis, angle, pivot: center } });
}

// Сохраняем хват и листовую массу; уменьшаем гарду и скачок толщины у основания.
for (const source of cubes(prior).filter(c => !c.id.startsWith("blade_"))) {
  const c = structuredClone(source);
  if (c.id.endsWith("collar")) {
    c.origin[0] = c.origin[2] = 7.375;
    c.size[0] = c.size[2] = 1.25;
  }
  if (c.id === "guard_core") { c.origin = [6.9, 8.8, 7.4]; c.size = [2.2, .8, 1.2]; }
  if (c.id === "guard_left") { c.origin[0] = 5.2; c.size[0] = 1.9; c.pivot[0] = 7.1; }
  if (c.id === "guard_right") { c.origin[0] = 8.9; c.size[0] = 1.9; c.pivot[0] = 8.9; }
  const index = c.rotation.findIndex(Boolean);
  shapes.push({ id: c.id, origin: c.origin, size: c.size,
    rotation: { axis: ["x", "y", "z"][index < 0 ? 1 : index], angle: index < 0 ? 0 : c.rotation[index], pivot: c.pivot } });
}
shape("blade_ricasso", [8, 10.55, 8], [1.6, 1.9, .9]);

// Сечение: центральная плоскость, тонкий край и четыре наклонные грани.
// Перекрытие внутри сечения намеренное: треугольные скосы заполнены без полостей.
function bevelSection(id, y, height, width, thickness) {
  const edge = .375, angle = Math.PI / 8, delta = (thickness - edge) / 2;
  const run = delta / Math.tan(angle), midY = y + height / 2;
  assert(run > 0 && width > run * 2);
  // Толщина полосы удерживает нижние углы rectangles внутри противоположного скоса.
  assert(edge >= delta * Math.cos(angle * 2));
  shape(id + "_core", [8, midY, 8], [width - run * 2, height, thickness]);
  shape(id + "_edge", [8, midY, 8], [width, height, edge]);
  for (const side of [-1, 1]) for (const face of [-1, 1]) {
    const inset = run / 2 + delta * Math.sin(angle) * Math.cos(angle) / 2;
    const center = [8 + side * (width / 2 - inset), midY,
      8 + face * (edge / 2 + delta * Math.sin(angle) ** 2 / 2)];
    shape(id + (side < 0 ? "_l" : "_r") + (face < 0 ? "_back" : "_front"),
      center, [delta / Math.sin(angle), height, delta * Math.cos(angle)], "y", side * face * 22.5);
  }
}
const bladeHeightScale = (25.75 - 11.5) / (28.5 - 11.5);
const sections = [
  [11.5, .75, 2, .875], [12.25, 1.5, 3.25, 1.125], [13.75, .75, 4.25, 1.25],
  [14.5, 3, 4.75, 1.25], [17.5, 2.625, 4.125, 1.25], [20.125, 2.625, 3, 1.125],
  [22.75, 1.75, 2, .875], [24.5, 1.75, 1.25, .625],
].map(([y, height, width, thickness]) => [11.5 + (y - 11.5) * bladeHeightScale, height * bladeHeightScale, width, thickness]);
sections.forEach((s, i) => bevelSection("blade_section_" + i, ...s));
for (const [i, s] of [[26.25, .875, .75], [27.125, .875, .375], [28, .5, .25]].entries())
  shape("blade_tip_" + i, [8, 11.5 + (s[0] + s[1] / 2 - 11.5) * bladeHeightScale, 8], [s[2], s[1] * bladeHeightScale, .25]);
assert(shapes.length <= artSpec.budgets.maxCubes);
assert(shapes.length * 12 <= artSpec.budgets.maxTriangles);

function oriented(s) {
  const pivot = new THREE.Vector3(...s.rotation.pivot);
  const angles = [0, 0, 0]; angles[["x", "y", "z"].indexOf(s.rotation.axis)] = s.rotation.angle * Math.PI / 180;
  const rotation = new THREE.Euler(...angles);
  const center = new THREE.Vector3(...s.origin.map((n, i) => n + s.size[i] / 2)).sub(pivot).applyEuler(rotation).add(pivot);
  return new OBB(center, new THREE.Vector3(...s.size.map(n => n / 2)),
    new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation)));
}
// Аналитическая маска выпуклого сечения проверяет полости и выступы, включая знаки поворота.
let sampledPoints = 0;
for (const [i, [y, height, width, thickness]] of sections.entries()) {
  const obbs = shapes.filter(s => s.id.startsWith("blade_section_" + i + "_")).map(oriented);
  for (let xi = 0; xi < 61; xi++) for (let zi = 0; zi < 61; zi++) {
    const x = (xi / 60 - .5) * (width + .2), z = (zi / 60 - .5) * (thickness + .2);
    const margin = Math.min(width / 2 - Math.abs(x), thickness / 2 - Math.abs(z),
      (width / 2 - Math.abs(x)) * Math.tan(Math.PI / 8) + .375 / 2 - Math.abs(z));
    if (Math.abs(margin) < 1e-9) continue;
    assert.equal(obbs.some(b => b.containsPoint(new THREE.Vector3(8 + x, y + height / 2, 8 + z))), margin > 0,
      `Сечение ${i}, x=${x}, z=${z}`);
    sampledPoints++;
  }
}

const initial = emptyProject(prior.projectId);
initial.model.id = prior.model.id;
initial.model.name = "Лист · широкие скосы v4c";
initial.texturePlan.modelId = prior.model.id;
initial.design = structuredClone(prior.design);
const session = new EditorSession(initial), transactions = [];
function apply(commands, actor = "agent") {
  const mutation = { projectId: initial.projectId, expectedRevision: session.state().revision, key: randomUUID(), commands };
  const before = session.state(), preview = session.preview(mutation, actor);
  assert.deepEqual(session.state(), before);
  session.apply(mutation, actor);
  assert.deepEqual(session.state().project, preview.project);
  transactions.push({ actor, revision: session.state().revision, commands });
}
for (const s of shapes) {
  apply([{ type: "add", cubeId: s.id }]);
  const c = cubes(session.state().project).find(c => c.id === s.id);
  apply([
    { type: "transform", cubeIds: [s.id], translation: s.origin.map((n, i) => n - c.origin[i]), scale: s.size.map((n, i) => n / c.size[i]) },
    { type: "recolor", cubeIds: [s.id], color: "#aebdcb" },
    ...["x", "y", "z"].map((axis, i) => ({ type: "pivot", cubeIds: [s.id], axis, value: s.rotation.pivot[i] })),
    { type: "rotate", cubeIds: [s.id], axis: s.rotation.axis, angle: s.rotation.angle },
  ]);
}
// Actor human здесь относится только к developer metadata, не к художественной приёмке.
for (const part of prior.parts) {
  const cubeIds = part.id === "blade_group" ? shapes.filter(s => s.id.startsWith("blade_")).map(s => s.id) : part.cubeIds;
  apply([{ type: "groupPart", partId: part.id, label: part.label, cubeIds }], "human");
}
const variantId = randomUUID();
apply([{ type: "draftVariant", variantId, label: "Лист · широкие скосы v4c", note: "Скосы ±22.5°, более тонкое основание, собранная гарда и высота до 24 units из ArtSpec. Силуэт изменён; нейтральный объём требует review. Текстура и Minecraft не приняты." }]);
const candidate = session.state().project;
assert.deepEqual(candidate.design.variants.slice(0, 2), originalSnapshots);
const snapshots = candidate.design.variants;
const concept = prior.design.concepts[0], conceptPath = join(inputs[1].path + ".assets", "concepts", concept.sha256 + ".png");
assert.equal(hash(await readFile(conceptPath)), concept.sha256);
await mkdir(output);
const store = new ConceptStore(join(output, "concept-cache"));
await store.import(conceptPath);
await writeFile(join(output, "concept-board.png"), await readFile(conceptPath), { flag: "wx" });
const files = [];
for (const [i, key] of ["a", "b", "c"].entries()) {
  const project = i === 2 ? candidate : { ...structuredClone(snapshots[i].project), design: structuredClone(candidate.design) };
  const serialized = JSON.stringify(project, null, 2) + "\n";
  parseProject(serialized);
  const projectPath = join(output, key + ".mmeditor.json");
  await store.persist(projectPath, project);
  await writeFile(projectPath, serialized, { flag: "wx" });
  const asset = assetRequest(project), bundle = compileItemAssetPayload(JSON.stringify(asset));
  const exportPath = join(output, key + "-export");
  for (const file of bundle.files) {
    const bytes = Buffer.from(file.content, file.encoding), target = join(exportPath, file.path);
    assert.equal(hash(bytes), file.sha256);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  }
  await writeFile(join(exportPath, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(exportPath, "source.item-asset.json"), JSON.stringify(asset, null, 2) + "\n", { flag: "wx" });
  files.push({ variant: key, variantId: snapshots[i].id, referenceVariantId: snapshots[i === 0 ? 1 : 0].id,
    name: project.model.name, projectPath, projectSha256: hash(serialized), cubes: cubes(project).length,
    geometrySha256: hash(JSON.stringify(project.model.bones)), bundleFiles: bundle.files.map(({ path, sha256 }) => ({ path, sha256 })) });
}
for (const input of inputs) assert.equal(hash(await readFile(input.path)), input.sha256);
const report = { status: "TECHNICAL_DRAFT", source: "Fixed developer recipe through editor-core agent commands; not an independent CLI agent session",
  inputs: inputs.map(({ key, path, sha256 }) => ({ key, path, sha256 })), originalSnapshotsPreserved: true,
  concept, files, shapes, transactions, crossSectionProbes: { status: "PASS", sampledPoints },
  budget: { cubes: shapes.length, maxCubes: artSpec.budgets.maxCubes, triangles: shapes.length * 12, maxTriangles: artSpec.budgets.maxTriangles },
  boundary: "Cube/triangle budgets checked; full ArtSpec conformity, bounds/proportions, human recognition, volume approval and game acceptance remain open.",
  artisticApproval: "NOT_PERFORMED", gameAcceptance: "NOT_RUN" };
await writeFile(join(output, "authoring-report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, output, cubes: shapes.length, crossSectionProbes: report.crossSectionProbes }));
