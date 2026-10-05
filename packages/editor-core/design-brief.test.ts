import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  EditorSession, projectFromAsset, parseProject, readDesignBrief,
  serializeDesignBrief, DesignBriefSchema, emptyProject, cubes,
} from "./index.ts";

const asset = JSON.parse(await readFile(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8"));
const session = new EditorSession(projectFromAsset(asset, randomUUID()));
const request = (commands: unknown[]) => ({projectId: session.state().project.projectId, expectedRevision: session.state().revision, key: randomUUID(), commands});
const brief = {
  schemaVersion: 1 as const, kind: "mcdev-design-brief" as const, target: "fabric-1.20.1-held-item" as const,
  purpose: "Короткий ледяной топор", style: "Выразительный Minecraft",
  silhouette: "Односторонняя широкая кромка и короткий тёмный обух",
  materials: "Лёд, тёмная сталь, кожаная обмотка", palette: ["#E9F8ED", "#172333", "#665040"], preserve: ["grip"],
};
assert(session.state().project.parts.some(p => p.id === "grip"));
const before = session.state();
assert.throws(() => session.apply(request([{type: "designBrief", brief}]), "human"), {code: "BRIEF_PROTECTION"});
assert.deepEqual(session.state(), before, "Unprotected preserve reference must leave everything intact");
session.apply(request([{type: "lock", partId: "grip", locked: true}]), "human");
const locked = session.state();
session.apply(request([{type: "designBrief", brief}]), "human");
const saved = session.state();
assert.deepEqual(saved.project.model, locked.project.model);
assert.deepEqual(saved.project.texturePlan, locked.project.texturePlan);
assert.deepEqual(saved.project.parts, locked.project.parts);
assert.equal(saved.revision, locked.revision + 1);
const parsed = readDesignBrief(saved.project.design!.brief)!;
assert.deepEqual(parsed, {...brief, palette: brief.palette.map(c => c.toLowerCase())});
assert.deepEqual(parseProject(JSON.stringify(saved.project)), saved.project, "Existing project v2 roundtrip preserves the entire brief text");
assert.equal(saved.project.schemaVersion, 2);
assert.throws(() => session.preview(request([{type: "designBrief", brief}]), "agent"), {code: "HUMAN_ONLY"});
assert.throws(() => session.apply(request([{type: "designBrief", brief}]), "agent"), {code: "HUMAN_ONLY"});
assert.deepEqual(session.state(), saved);
const stale = {...request([{type: "designBrief", brief: {...brief, purpose: "Новая форма"}}]), expectedRevision: locked.revision};
assert.throws(() => session.apply(stale, "human"), {code: "REVISION_CONFLICT"});
assert.deepEqual(session.state(), saved);
assert.throws(() => session.apply(request([{type: "designBrief", brief: {...brief, preserve: ["missing_part"]}}]), "human"), {code: "BRIEF_PROTECTION"});
assert.deepEqual(session.state(), saved);
for (const candidate of [
  {...brief, schemaVersion: 2}, {...brief, target: "entity"}, {...brief, purpose: " "},
  {...brief, style: "x".repeat(161)}, {...brief, silhouette: "x".repeat(241)},
  {...brief, palette: ["#172333", "#172333"]}, {...brief, palette: ["#ABCDEF", "#abcdef"]},
  {...brief, palette: ["red"]}, {...brief, palette: []}, {...brief, palette: Array.from({length: 25}, (_, i) => `#${i.toString(16).padStart(6,"0")}`)},
  {...brief, preserve: ["grip", "grip"]}, {...brief, preserve: ["../part"]}, {...brief, code: "shell"},
]) {
  assert.equal(DesignBriefSchema.safeParse(candidate).success, false);
  assert.throws(() => session.apply(request([{type: "designBrief", brief: candidate}]), "human"), {code: "INVALID_COMMAND"});
  assert.deepEqual(session.state(), saved);
}
assert.throws(() => serializeDesignBrief({...brief, purpose: "a".repeat(160), style: "b".repeat(160), silhouette: "c".repeat(240), materials: "d".repeat(240), preserve: Array.from({length: 60}, (_, i) => `part_${i}`)}), {code: "BRIEF_LIMIT"});
for (const value of ["Обычное старое задание", "{", JSON.stringify({...brief, schemaVersion: 99}), JSON.stringify({...brief, extra: true})]) assert.equal(readDesignBrief(value), undefined);
session.apply(request([{type: "undo"}]), "human");
assert.deepEqual(session.state().project, locked.project);
session.apply(request([{type: "redo"}]), "human");
assert.deepEqual(session.state().project, saved.project);
const blank = new EditorSession(emptyProject(randomUUID()));
blank.apply({projectId: blank.state().project.projectId, expectedRevision: 0, key: randomUUID(), commands: [
  {type: "designBrief", brief: {...brief, preserve: [], palette: Array.from({length: 24}, (_, i) => `#${i.toString(16).padStart(6,"0")}`)}},
]}, "human");
assert.equal(cubes(blank.state().project).length, 0, "Brief can be reviewed before any geometry is created");
assert.equal(readDesignBrief(blank.state().project.design!.brief)!.palette.length, 24);
process.stdout.write("Structured brief: human-only/CAS/protection/13 malformed cases, unchanged geometry/pixels and exact v2 persistence/undo PASS\n");
