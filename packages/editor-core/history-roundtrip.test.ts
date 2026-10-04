import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EditorSession, parseProject, assetRequest, type EditorCommand, type EditorProject } from "./index.ts";
import { compileItemAssetBundleV1 } from "../application/asset-bundles.ts";
import { historyScenario } from "../../fixtures/editor-projects/history-scenario.ts";

const initial = parseProject(await readFile(new URL("../../fixtures/editor-projects/v1-painted-variants.mmeditor.json", import.meta.url), "utf8"));
const session = new EditorSession(initial);
session.markSaved();
const signatures = (project: EditorProject) => compileItemAssetBundleV1(JSON.stringify(assetRequest(project)))
  .manifest.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
const apply = (commands: EditorCommand[]) => {
  const state = session.state();
  return session.apply({ projectId: state.project.projectId, expectedRevision: state.revision, key: randomUUID(), commands });
};
const projects = [initial], exports = [signatures(initial)];
for (const commands of historyScenario(initial, randomUUID())) {
  const state = apply(commands);
  projects.push(state.project); exports.push(signatures(state.project));
}
assert.notDeepEqual(exports.at(-1), exports[0], "The scenario must change runtime geometry.");
assert.notEqual(exports[6]![1]!.sha256, exports[5]![1]!.sha256, "Painting must change actual PNG bytes.");
assert.notDeepEqual(projects[8]!.texturePlan.faces, projects[7]!.texturePlan.faces, "UV change must be observable.");
assert.notEqual(exports[8]![1]!.sha256, exports[7]![1]!.sha256, "UV reflection must also change PNG pixels.");
assert.equal(projects[11]!.parts.length, projects[10]!.parts.length + 1, "Adding a cube must create a part.");
assert.equal(projects[14]!.parts.length, projects[10]!.parts.length, "Deleting it must remove the empty part.");
assert.equal(projects[4]!.design!.variants.length, initial.design!.variants.length + 1);
assert.equal(projects[16]!.design!.variants.length, initial.design!.variants.length);
for (let i = projects.length - 2; i >= 0; i--) {
  const state = apply([{ type: "undo" }]);
  assert.deepEqual(state.project, projects[i], `Undo ${i} must restore the entire document including metadata.`);
  assert.deepEqual(signatures(state.project), exports[i], `Undo ${i} must restore every exact exported file.`);
}
assert.equal(session.state().canUndo, false);
assert.equal(session.state().dirty, false);
for (let i = 1; i < projects.length; i++) {
  const state = apply([{ type: "redo" }]);
  assert.deepEqual(state.project, projects[i], `Redo ${i} must restore the entire document.`);
  assert.deepEqual(signatures(state.project), exports[i], `Redo ${i} must restore every exact exported file.`);
}
assert.equal(session.state().canRedo, false);
apply([{ type: "undo" }]);
const branch = apply([{ type: "brief", text: "Новая ветка после отмены" }]);
assert.equal(branch.canRedo, false);
assert.throws(() => apply([{ type: "redo" }]), { code: "EMPTY_HISTORY" });
assert.deepEqual(session.state(), branch, "Rejected redo cannot change revision, history or document.");
process.stdout.write(`editor-core: ${projects.length - 1} mixed operations fully undo/redo exact project and exported JSON/PNG/bbmodel/source PASS\n`);
