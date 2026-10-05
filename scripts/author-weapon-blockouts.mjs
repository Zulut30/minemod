/* global structuredClone */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import console from "node:console";
import {
  EditorSession, emptyProject, cubes, assetRequest, validateProject,
} from "../packages/editor-core/index.ts";
import { compileItemAssetPayload } from "../packages/application/item-assets.ts";
import { ConceptStore, checkConceptPng } from "../apps/model-editor/worker/concept-files.ts";

// Локальный инструмент автора. Он не расширяет файловые права или команды MCP.
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(process.argv[3] ?? join(workspace, "fixtures/production/weapon-blockouts.v1.json"));
const output = resolve(process.argv[2] ?? join(workspace, "output/model-editor/blockouts-" + randomUUID().slice(0, 8)));
const outputRelative = relative(join(workspace, "output"), output);
assert(outputRelative && outputRelative !== ".." && !outputRelative.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) && !isAbsolute(outputRelative), "Результат должен находиться внутри workspace/output");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = await readFile(fixturePath);
const fixture = JSON.parse(source.toString("utf8"));
assert.equal(fixture.schemaVersion, 1);
assert.equal(fixture.kind, "mcdev-authored-blockouts");
assert(fixture.variants.length >= 2 && fixture.variants.length <= 3);
assert.equal(new Set(fixture.variants.map(v => v.key)).size, fixture.variants.length);
for (const v of fixture.variants) {
  assert(/^[a-z]$/u.test(v.key));
  assert.equal(new Set(v.shapes.map(s => s.id)).size, v.shapes.length);
  for (const s of v.shapes) {
    assert.equal(s.origin.length, 3);
    assert.equal(s.size.length, 3);
    assert(s.origin.every(Number.isFinite));
    assert(s.size.every(n => Number.isFinite(n) && n >= .02 && n <= 40), "Недопустимый размер " + s.id);
  }
}
const conceptPath = resolve(dirname(fixturePath), fixture.concept.path);
const original = await readFile(conceptPath);
assert.equal(hash(original), fixture.concept.sha256, "Сохраняется точный исходный концепт");
const metadata = checkConceptPng(original);

// Не обновляем старые результаты: каждая художественная итерация имеет отдельную папку.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
await writeFile(join(output, "concept-board.png"), original, { flag: "wx" });
const store = new ConceptStore(join(output, "concept-cache"));
await store.import(conceptPath);
const { path: ignoredPath, sha256: ignoredHash, ...declaration } = fixture.concept;
void ignoredPath; void ignoredHash;
const concept = { ...metadata, ...declaration };
const transactions = [], authored = [];
for (const variant of fixture.variants) {
  const initial = emptyProject(fixture.projectId);
  initial.model.id = fixture.modelId;
  initial.texturePlan.modelId = fixture.modelId;
  initial.model.name = variant.label;
  const session = new EditorSession(initial);
  const apply = (commands, actor) => {
    const mutation = { projectId: initial.projectId, expectedRevision: session.state().revision, key: randomUUID(), commands };
    const before = session.state(), preview = session.preview(mutation, actor);
    assert.deepEqual(session.state(), before);
    session.apply(mutation, actor);
    assert.deepEqual(session.state().project, preview.project);
    transactions.push({ variant: variant.key, actor, revision: session.state().revision, commands });
  };
  for (const shape of variant.shapes) {
    apply([{ type: "add", cubeId: shape.id }], "agent");
    const cube = cubes(session.state().project).find(c => c.id === shape.id);
    apply([
      { type: "transform", cubeIds: [shape.id], translation: shape.origin.map((n, i) => n - cube.origin[i]), scale: shape.size.map((n, i) => n / cube.size[i]) },
      { type: "recolor", cubeIds: [shape.id], color: fixture.material },
    ], "agent");
    if (shape.rotation) {
      const { axis, angle, pivot } = shape.rotation;
      apply([
        ...["x", "y", "z"].map((a, i) => ({ type: "pivot", cubeIds: [shape.id], axis: a, value: pivot[i] })),
        { type: "rotate", cubeIds: [shape.id], axis, angle },
      ], "agent");
    }
  }
  for (const group of variant.groups)
    apply([{ type: "groupPart", partId: group.id, label: group.label, cubeIds: group.cubeIds }], "human");
  apply([{ type: "designBrief", brief: fixture.brief }, { type: "conceptAdd", concept }], "human");
  authored.push({ variant, project: session.state().project });
}
assert.equal(new Set(authored.map(a => hash(JSON.stringify(a.project.model.bones)))).size, authored.length, "Варианты различаются геометрией");
const snapshots = authored.map(({ variant, project }) => ({
  id: variant.id, label: variant.label, note: variant.note,
  project: { schemaVersion: project.schemaVersion, kind: project.kind, projectId: project.projectId, model: project.model, texturePlan: project.texturePlan, parts: project.parts },
}));
const files = [];
for (const { variant, project } of authored) {
  project.design.variants = structuredClone(snapshots);
  validateProject(project);
  const projectPath = join(output, variant.key + ".mmeditor.json");
  await store.persist(projectPath, project);
  const serialized = JSON.stringify(project, null, 2) + "\n";
  await writeFile(projectPath, serialized, { flag: "wx" });
  const asset = assetRequest(project), bundle = compileItemAssetPayload(JSON.stringify(asset));
  const exportPath = join(output, variant.key + "-export");
  await mkdir(exportPath);
  for (const file of bundle.files) {
    const target = join(exportPath, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.content, file.encoding), { flag: "wx" });
  }
  await writeFile(join(exportPath, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(exportPath, "source.item-asset.json"), JSON.stringify(asset, null, 2) + "\n", { flag: "wx" });
  const reference = snapshots[variant.id === snapshots[1].id ? 0 : 1];
  files.push({ variant: variant.key, variantId: variant.id, referenceVariantId: reference.id, name: variant.label,
    projectPath, projectSha256: hash(serialized), cubes: cubes(project).length,
    geometrySha256: hash(JSON.stringify(project.model.bones)),
    bundleFiles: bundle.files.map(({ path, sha256 }) => ({ path, sha256 })),
  });
}
const report = {
  status: "TECHNICAL_DRAFT", fixturePath, fixtureSha256: hash(source),
  source: "editor-core agent geometry commands, not a live independent CLI/MCP authoring session",
  concept: metadata, brief: fixture.brief, files, transactions,
  humanOwnedMetadata: "Groups/brief/concept/checkpoints prepared by the local authoring workflow; agent MCP permissions unchanged",
  artisticApproval: "NOT_PERFORMED", gameAcceptance: "NOT_RUN",
  workflow036: "PARTIAL_EXAMPLE_NOT_GENERAL_AGENT_VARIANT_GENERATOR",
};
await writeFile(join(output, "authoring-report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, output, files: files.map(({ variant, cubes, geometrySha256 }) => ({ variant, cubes, geometrySha256 })) }));
