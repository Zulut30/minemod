import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  EditorSession,
  EditorError,
  projectFromAsset,
  validateProject,
  parseProject,
  MAX_VARIANTS,
  cubes,
} from "./index.ts";

const asset = JSON.parse(
  await readFile(
    new URL(
      "../../fixtures/assets/aurora-longsword-v2.item-asset.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const session = new EditorSession(projectFromAsset(asset, randomUUID()));
const apply = (
  commands: Parameters<EditorSession["apply"]>[0],
  actor: "human" | "agent" = "human",
) => {
  const state = session.state();
  return session.apply(
    {
      projectId: state.project.projectId,
      expectedRevision: state.revision,
      key: randomUUID(),
      commands,
    },
    actor,
  );
};
const original = session.state().project;
const baseline = randomUUID();
apply([
  { type: "brief", text: "Выразительный силуэт Minecraft; сохранить рукоять." },
]);
apply([{ type: "checkpoint", variantId: baseline, label: "Исходник" }]);
const source = structuredClone(
  session.state().project.design!.variants[0]!.project,
);
apply(
  [
    {
      type: "transform",
      cubeIds: ["guard_center"],
      translation: [0.25, 0, 0],
      scale: [1, 1, 1],
    },
  ],
  "agent",
);
assert.deepEqual(session.state().project.design!.variants[0]!.project, source);
const changed = session.state().project;
const candidate = randomUUID();
apply([
  {
    type: "checkpoint",
    variantId: candidate,
    label: "Вариант A",
    note: "Изменён центр гарды",
  },
]);
assert.equal(
  "design" in session.state().project.design!.variants[1]!.project,
  false,
);
apply([{ type: "restoreVariant", variantId: baseline }]);
assert.deepEqual(session.state().project.model, original.model);
assert.equal(session.state().project.design!.variants.length, 2);
apply([{ type: "undo" }]);
assert.deepEqual(session.state().project.model, changed.model);
apply([{ type: "redo" }]);
assert.deepEqual(session.state().project.model, original.model);
apply([{ type: "restoreVariant", variantId: candidate }]);
assert.deepEqual(session.state().project.model, changed.model);
for (const command of [
  { type: "brief", text: "Изменить задачу" },
  { type: "checkpoint", variantId: randomUUID(), label: "Подмена" },
  { type: "restoreVariant", variantId: baseline },
  { type: "deleteVariant", variantId: baseline },
]) {
  const before = session.state();
  assert.throws(
    () => apply([command], "agent"),
    (e: unknown) => e instanceof EditorError && e.code === "HUMAN_ONLY",
  );
  assert.deepEqual(session.state(), before);
}
const beforeConflict = session.state();
assert.throws(
  () => apply([{ type: "checkpoint", variantId: baseline, label: "Дубликат" }]),
  (e: unknown) => e instanceof EditorError && e.code === "VARIANT_ID",
);
assert.deepEqual(session.state(), beforeConflict);
while (session.state().project.design!.variants.length < MAX_VARIANTS)
  apply([{ type: "checkpoint", variantId: randomUUID(), label: "Ещё один" }]);
const full = session.state();
assert.throws(
  () =>
    apply([
      {
        type: "transform",
        cubeIds: ["guard_center"],
        translation: [0.25, 0, 0],
        scale: [1, 1, 1],
      },
      { type: "checkpoint", variantId: randomUUID(), label: "Лишний" },
    ]),
  (e: unknown) => e instanceof EditorError && e.code === "VARIANT_LIMIT",
);
assert.deepEqual(session.state(), full, "Отказ снимка откатывает весь batch");
apply([{ type: "deleteVariant", variantId: candidate }]);
apply([{ type: "undo" }]);
assert.deepEqual(
  session.state().project.design!.variants,
  full.project.design!.variants,
);
assert.deepEqual(
  parseProject(JSON.stringify(session.state().project)),
  session.state().project,
);
const corrupt = session.state().project;
corrupt.design!.variants[0]!.project.texturePlan.faces[0]!.uv.north = [
  0, 0, 257, 1,
];
assert.throws(() => validateProject(corrupt), EditorError);
const recursive = session.state().project as unknown as Record<string, unknown>;
(
  recursive.design as { variants: { project: Record<string, unknown> }[] }
).variants[0]!.project.design = recursive.design;
assert.throws(() => validateProject(recursive), EditorError);
assert.equal(cubes(session.state().project).length, 52);
// Допустимая крупная геометрия не должна создавать несохраняемый снимок.
const large = structuredClone(original);
const cube = cubes(large)[0]!;
const binding = large.texturePlan.faces[0]!;
large.model.bones = Array.from({ length: 4 }, (_, bone) => ({
  ...structuredClone(large.model.bones[0]!),
  id: `bone_${bone}`,
  cubes: Array.from({ length: 64 }, (_, index) => ({
    ...structuredClone(cube),
    id: `cube_${bone}_${index}`,
  })),
}));
large.texturePlan.faces = cubes(large).map((c) => ({
  ...structuredClone(binding),
  cubeId: c.id,
}));
large.parts = [
  {
    id: "large",
    label: "Крупный документ",
    locked: false,
    cubeIds: cubes(large).map((c) => c.id),
  },
];
const sizeSession = new EditorSession(validateProject(large));
let sizeRejected = false;
for (let i = 0; i < MAX_VARIANTS; i++) {
  const before = sizeSession.state();
  try {
    sizeSession.apply({
      projectId: before.project.projectId,
      expectedRevision: before.revision,
      key: randomUUID(),
      commands: [
        { type: "checkpoint", variantId: randomUUID(), label: "Большой" },
      ],
    });
  } catch (error) {
    assert(error instanceof EditorError && error.code === "SIZE_LIMIT");
    assert.deepEqual(sizeSession.state(), before);
    sizeRejected = true;
    break;
  }
}
assert(sizeRejected, "Переполнение файла должно быть отклонено до commit");
console.log(
  "Варианты: независимые снимки, восстановление/undo, лимиты, права агента, rollback и сохранение PASS",
);
