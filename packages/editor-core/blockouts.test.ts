import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  EditorSession, EditorError, emptyProject, cubes, parseProject,
  blockoutGeometry, AGENT_DRAFT_PREFIX, MAX_AGENT_DRAFTS,
  type EditorCommand,
} from "./index.ts";

const session = new EditorSession(emptyProject(randomUUID()));
const request = (commands: EditorCommand[]) => ({
  projectId: session.state().project.projectId,
  expectedRevision: session.state().revision, key: randomUUID(), commands,
});
const apply = (commands: EditorCommand[], actor: "agent" | "human" = "agent") => session.apply(request(commands), actor);
const rejected = (commands: EditorCommand[], code: string) => {
  const before = session.state();
  assert.throws(() => apply(commands), (error: unknown) => error instanceof EditorError && error.code === code);
  assert.deepEqual(session.state(), before, "Отказ не меняет сцену, snapshots или историю");
};
const draft = (label = "A", variantId = randomUUID()): EditorCommand => ({ type: "draftVariant", variantId, label, note: "Форма, без покраски" });
rejected([draft()], "EMPTY_MODEL");
apply([{ type: "add", cubeId: "manual_grip" }], "human");
apply([{ type: "add", cubeId: "blade_mass" }], "human");
apply([
  { type: "transform", cubeIds: ["manual_grip"], translation: [0, -5, 0], scale: [.6, 2.75, .6] },
  { type: "recolor", cubeIds: ["manual_grip"], color: "#65452f" },
  { type: "transform", cubeIds: ["blade_mass"], translation: [-1, 1, 0], scale: [2, 3, .5] },
  { type: "lock", partId: "manual_grip", locked: true },
  { type: "brief", text: "Сохранить ручную рукоять. Три нейтральные формы клинка." },
], "human");
const baselineId = randomUUID();
apply([{ type: "checkpoint", variantId: baselineId, label: "Ручной исходник", note: "Не изменять" }], "human");
const baseline = session.state().project.design!.variants[0]!;
const protectedGrip = cubes(session.state().project).find(c => c.id === "manual_grip");
rejected([draft()], "VARIANT_GEOMETRY_DUPLICATE");
rejected([{ type: "recolor", cubeIds: ["blade_mass"], color: "#8899aa" }, draft()], "VARIANT_GEOMETRY_DUPLICATE");
rejected([{ type: "pivot", cubeIds: ["blade_mass"], axis: "x", value: 2 }, draft()], "VARIANT_GEOMETRY_DUPLICATE");

// Другой ID и UV того же размещённого кубоида не создают новую форму.
rejected([
  { type: "duplicate", cubeId: "blade_mass", newId: "same_shape" },
  { type: "transform", cubeIds: ["same_shape"], translation: [-1, 0, 0], scale: [1, 1, 1] },
  draft(),
], "VARIANT_GEOMETRY_DUPLICATE");

apply([{ type: "transform", cubeIds: ["blade_mass"], translation: [-.5, 0, 0], scale: [1.25, 1, 1] }]);
const mutation = request([draft("Широкий лист")]);
const beforePreview = session.state(), preview = session.preview(mutation, "agent");
assert.deepEqual(session.state(), beforePreview);
session.apply(mutation, "agent");
const first = session.state();
assert.deepEqual(first.project, preview.project);
assert.deepEqual(session.apply(mutation, "agent"), first, "Точный replay не дублирует snapshot");
assert.deepEqual(first.project.design!.variants[0], baseline);
assert.deepEqual(cubes(first.project).find(c => c.id === "manual_grip"), protectedGrip);
assert.equal(first.project.design!.variants[1]!.label, AGENT_DRAFT_PREFIX + "Широкий лист");
assert.match(first.project.design!.variants[1]!.note, /приёмка человеком не выполнена/u);
assert.equal("design" in first.project.design!.variants[1]!.project, false);
apply([{ type: "undo" }]);
assert.deepEqual(session.state().project, beforePreview.project);
apply([{ type: "redo" }]);
assert.deepEqual(session.state().project, first.project);

const stale = request([
  { type: "transform", cubeIds: ["blade_mass"], translation: [.25, 0, 0], scale: [1, 1, 1] },
  draft("Устаревший черновик"),
]);
session.preview(stale, "agent");
apply([{ type: "brief", text: "Сохранить ручную рукоять. Сравнить три формы до текстуры." }], "human");
const afterManualBrief = session.state();
assert.throws(() => session.apply(stale, "agent"), (error: unknown) => error instanceof EditorError && error.code === "REVISION_CONFLICT");
assert.deepEqual(session.state(), afterManualBrief);

rejected([{ type: "transform", cubeIds: ["blade_mass"], translation: [.25, 0, 0], scale: [1, 1, 1] }, draft("Подмена", baselineId)], "VARIANT_ID");
rejected([{ type: "restoreVariant", variantId: baselineId }], "HUMAN_ONLY");
rejected([{ type: "deleteVariant", variantId: baselineId }], "HUMAN_ONLY");
rejected([{ type: "transform", cubeIds: ["manual_grip"], translation: [0, .25, 0], scale: [1, 1, 1] }, draft()], "LOCKED");

for (const [label,translation,scale] of [
  ["Асимметричный клык", [1, 0, 0], [.75, 1.2, 1]],
  ["Короткий широкий клинок", [-.5, 0, 0], [1.5, .7, 1.25]],
] as const) apply([
  { type: "transform", cubeIds: ["blade_mass"], translation: [...translation], scale: [...scale] },
  draft(label),
]);
assert.equal(session.state().project.design!.variants.length, MAX_AGENT_DRAFTS + 1);
assert.equal(new Set(session.state().project.design!.variants.map(v => blockoutGeometry(v.project))).size, 4);
assert.deepEqual(session.state().project.design!.variants[0], baseline);
rejected([{ type: "transform", cubeIds: ["blade_mass"], translation: [.25, 0, 0], scale: [1, 1, 1] }, draft("Четвёртый")], "VARIANT_LIMIT");
const saved = session.state().project;
assert.deepEqual(parseProject(JSON.stringify(saved)), saved);

apply([{ type: "restoreVariant", variantId: baselineId }], "human");
assert.deepEqual(session.state().project.model, baseline.project.model);
rejected([{ type: "undo" }], "HUMAN_HISTORY");
apply([{ type: "undo" }], "human");
assert.deepEqual(session.state().project, saved);

// Лимит трёх черновиков действует и без ручного baseline; свободный слот не обход.
const noBaseline = new EditorSession({ ...saved, design: { brief: saved.design!.brief, variants: saved.design!.variants.slice(1) } });
assert.throws(() => noBaseline.apply({ projectId: saved.projectId, expectedRevision: 0, key: randomUUID(),
  commands: [{ type: "transform", cubeIds: ["blade_mass"], translation: [1, 0, 0], scale: [1, 1, 1] }, draft()] }, "agent"),
  (error: unknown) => error instanceof EditorError && error.code === "VARIANT_DRAFT_LIMIT");
assert.equal(noBaseline.state().revision, 0);

session.setRepair({ projectId: saved.projectId, expectedRevision: session.state().revision,
  repair: { id: randomUUID(), note: "Только адресная правка клинка", partIds: ["blade_mass"], area: "geometry", maxIterations: 2 } });
rejected([draft()], "REPAIR_SCOPE");
assert.equal(session.state().repair!.usedIterations, 0);

console.log("Blockouts: append-only drafts, geometry-only uniqueness, manual preservation, preview/replay/CAS history, caps and repair isolation PASS");
