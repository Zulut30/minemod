import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EditorSession, assetRequest, cubes, parseProject, projectFromAsset, type EditorCommand } from "./index.ts";
const asset = JSON.parse(await readFile(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8"));
const original = projectFromAsset(asset, randomUUID());
const session = new EditorSession(original);
const apply = (commands: EditorCommand[], actor: "human" | "agent" = "human") => session.apply({
  projectId: original.projectId, expectedRevision: session.state().revision, key: randomUUID(), commands,
}, actor);
const reject = (command: unknown, code: string, actor: "human" | "agent" = "human") => {
  const before = session.state();
  assert.throws(() => session.apply({ projectId: original.projectId, expectedRevision: before.revision,
    key: randomUUID(), commands: [command] }, actor), { code });
  assert.deepEqual(session.state(), before);
};
const grip = original.parts.find(p => p.id === "grip")!, guard = original.parts.find(p => p.id === "guard")!;
assert(grip && guard && grip.cubeIds.length > 1);
apply([{ type: "lock", partId: "grip", locked: true }]);
apply([{ type: "renamePart", partId: "grip", label: "  Кожаная рукоять  " }]);
assert.equal(session.state().project.parts.find(p => p.id === "grip")!.label, "Кожаная рукоять");
assert.deepEqual(assetRequest(session.state().project), assetRequest(original));
for (const command of [
  { type: "renamePart", partId: "grip", label: "" },
  { type: "renamePart", partId: "grip", label: "   " },
  { type: "renamePart", partId: "grip", label: "a".repeat(81) },
  { type: "groupPart", partId: "../escape", label: "Часть", cubeIds: guard.cubeIds },
  { type: "groupPart", partId: "new_part", label: "Часть", cubeIds: [] },
]) reject(command, "INVALID_COMMAND");
reject({ type: "renamePart", partId: "missing", label: "Часть" }, "TARGET");
reject({ type: "groupPart", partId: "new_part", label: "Часть", cubeIds: ["missing"] }, "TARGET");
reject({ type: "groupPart", partId: "new_part", label: "Часть", cubeIds: [guard.cubeIds[0], guard.cubeIds[0]] }, "TARGET");
reject({ type: "groupPart", partId: "guard", label: "Часть", cubeIds: guard.cubeIds }, "DUPLICATE_ID");
reject({ type: "groupPart", partId: guard.cubeIds[0], label: "Часть", cubeIds: guard.cubeIds }, "DUPLICATE_ID");
reject({ type: "groupPart", partId: "new_part", label: "Часть", cubeIds: [grip.cubeIds[0], guard.cubeIds[0]] }, "LOCKED");
reject({ type: "renamePart", partId: "guard", label: "Подмена" }, "HUMAN_ONLY", "agent");
reject({ type: "groupPart", partId: "new_part", label: "Часть", cubeIds: guard.cubeIds }, "HUMAN_ONLY", "agent");
apply([{ type: "groupPart", partId: "guard_trim", label: "Окантовка гарды", cubeIds: [guard.cubeIds[0]!] }]);
const regrouped = session.state().project;
assert.deepEqual(assetRequest(regrouped), assetRequest(original));
assert.deepEqual(regrouped.parts.find(p => p.id === "grip"), { ...grip, label: "Кожаная рукоять", locked: true });
assert.deepEqual(regrouped.parts.find(p => p.id === "guard")!.cubeIds, guard.cubeIds.slice(1));
const unchanged = session.state();
assert.throws(() => session.apply({ projectId: original.projectId, expectedRevision: unchanged.revision - 1,
  key: randomUUID(), commands: [{ type: "renamePart", partId: "guard_trim", label: "Устаревшая правка" }] }), { code: "REVISION_CONFLICT" });
assert.deepEqual(session.state(), unchanged);
assert.throws(() => apply([{ type: "groupPart", partId: "failed_group", label: "Часть", cubeIds: guard.cubeIds },
  { type: "transform", cubeIds: guard.cubeIds, translation: [100, 0, 0], scale: [1, 1, 1] }]), { code: "BOUNDS" });
assert.deepEqual(session.state(), unchanged);
apply([{ type: "transform", cubeIds: [guard.cubeIds[0]!], translation: [0.125, 0, 0], scale: [1, 1, 1] }], "agent");
const current = session.state().project;
assert.deepEqual(cubes(current).filter(c => grip.cubeIds.includes(c.id)), cubes(original).filter(c => grip.cubeIds.includes(c.id)));
assert.deepEqual(current.texturePlan, original.texturePlan);
reject({ type: "transform", cubeIds: grip.cubeIds, translation: [1, 0, 0], scale: [1, 1, 1] }, "LOCKED", "agent");
assert.deepEqual(parseProject(JSON.stringify(current)), current);
for (let i = 0; i < 4; i++) apply([{ type: "undo" }]);
assert.deepEqual(session.state().project, original);
for (let i = 0; i < 4; i++) apply([{ type: "redo" }]);
assert.deepEqual(session.state().project, current);
process.stdout.write("Parts: naming/grouping permissions, exact assets/locks/persistence/history and addressable agent edits PASS\n");
