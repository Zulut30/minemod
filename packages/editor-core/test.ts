import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  rm,
  writeFile,
  rename,
  mkdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  EditorSession,
  EditorError,
  projectFromAsset,
  cubes,
  parseProject,
  emptyProject,
  assetRequest,
  type EditorCommand,
  type Mutation,
  type EditorProject,
  MAX_PROJECT_BYTES,
} from "./index.ts";
import {
  readProject,
  writeProject,
  renameWithRetry,
} from "../../apps/model-editor/worker/persistence.ts";
const source: unknown = JSON.parse(
  await readFile(
    new URL(
      "../../fixtures/assets/aurora-longsword-v2.item-asset.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const project = projectFromAsset(source, randomUUID());
const session = new EditorSession(project);
function request(commands: EditorCommand[]): Mutation {
  const s = session.state();
  return {
    projectId: s.project.projectId,
    expectedRevision: s.revision,
    key: randomUUID(),
    commands,
  };
}
function colors(p: EditorProject): string[] {
  const palette = new Map(
    p.texturePlan.palette.map((c) => [c.symbol, c.color]),
  );
  return [...p.texturePlan.rows.join("")].map((s) =>
    s === "." ? "transparent" : palette.get(s)!,
  );
}
const guard = project.parts.find((p) => p.id === "guard")!;
// Признак несохранённых данных следует документу, а не только номеру ревизии.
const checkpoint = new EditorSession(project);
assert.equal(checkpoint.state().dirty, true);
checkpoint.markSaved();
assert.equal(checkpoint.state().dirty, false);
const checkpointMutation = (commands: EditorCommand[]) => ({
  projectId: project.projectId,
  expectedRevision: checkpoint.state().revision,
  key: randomUUID(),
  commands,
});
checkpoint.apply(
  checkpointMutation([
    {
      type: "transform",
      cubeIds: ["guard_center"],
      translation: [0.25, 0, 0],
      scale: [1, 1, 1],
    },
  ]),
);
assert.equal(checkpoint.state().dirty, true);
checkpoint.apply(checkpointMutation([{ type: "undo" }]));
assert.equal(checkpoint.state().dirty, false);
assert.equal(checkpoint.state().savedRevision, 0);
assert.equal(checkpoint.state().revision, 2);
assert.equal(
  checkpoint.preview(checkpointMutation([{ type: "redo" }]), "human").dirty,
  true,
);
assert.equal(
  checkpoint.state().dirty,
  false,
  "Preview не меняет состояние сохранения",
);
checkpoint.apply(checkpointMutation([{ type: "redo" }]));
checkpoint.markSaved();
checkpoint.apply(checkpointMutation([{ type: "undo" }]));
assert.equal(checkpoint.state().dirty, true);
checkpoint.apply(checkpointMutation([{ type: "redo" }]));
assert.equal(checkpoint.state().dirty, false);
assert.equal(cubes(project).length, 52);
const oldPixels = colors(project),
  oldGeometry = cubes(project);
const recolor = request([
  { type: "recolor", cubeIds: guard.cubeIds, color: "#915ed0" },
]);
session.apply(recolor);
const painted = session.state();
const newPixels = colors(painted.project);
const mask = new Set<number>();
for (const face of project.texturePlan.faces.filter((f) =>
  guard.cubeIds.includes(f.cubeId),
))
  for (const uv of Object.values(face.uv)) {
    for (let y = Math.min(uv[1], uv[3]); y < Math.max(uv[1], uv[3]); y++)
      for (let x = Math.min(uv[0], uv[2]); x < Math.max(uv[0], uv[2]); x++)
        mask.add(y * 256 + x);
  }
assert(newPixels.some((c, i) => mask.has(i) && c !== oldPixels[i]));
assert(
  newPixels.every((c, i) => mask.has(i) || c === oldPixels[i]),
  "Other parts must keep exact RGBA colors",
);
assert.deepEqual(cubes(painted.project), oldGeometry);
assert(
  new Set([...mask].map((i) => newPixels[i])).size > 1,
  "Shading must survive recolor",
);
assert.equal(
  session.apply(recolor).revision,
  painted.revision,
  "Lost-response retry must not duplicate mutation",
);
assert.throws(
  () =>
    session.apply({
      ...recolor,
      commands: [{ type: "delete", cubeIds: guard.cubeIds }],
    }),
  (e) => e instanceof EditorError && e.code === "KEY_CONFLICT",
);
assert.throws(
  () => session.apply({ ...recolor, key: randomUUID() }),
  (e) => e instanceof EditorError && e.code === "REVISION_CONFLICT",
);
session.apply(request([{ type: "undo" }]));
assert.deepEqual(session.state().project, project);
session.apply(request([{ type: "redo" }]));
assert.deepEqual(session.state().project, painted.project);
assert(session.state().revision > painted.revision);
const beforeInvalid = session.state();
assert.throws(() =>
  session.apply(
    request([
      {
        type: "transform",
        cubeIds: guard.cubeIds,
        translation: [1, 0, 0],
        scale: [1, 1, 1],
      },
      {
        type: "transform",
        cubeIds: guard.cubeIds,
        translation: [999, 0, 0],
        scale: [1, 1, 1],
      },
    ]),
  ),
);
assert.deepEqual(
  session.state(),
  beforeInvalid,
  "A failing batch must roll back all commands and history",
);
session.apply(request([{ type: "lock", partId: "guard", locked: true }]));
assert.throws(
  () =>
    session.apply(
      request([{ type: "recolor", cubeIds: guard.cubeIds, color: "#aabbcc" }]),
      "agent",
    ),
  (e) => e instanceof EditorError && e.code === "LOCKED",
);
assert.throws(() =>
  session.apply(
    request([{ type: "lock", partId: "guard", locked: false }]),
    "agent",
  ),
);
assert.throws(
  () => session.apply(request([{ type: "undo" }]), "agent"),
  (e) => e instanceof EditorError && e.code === "HUMAN_HISTORY",
);
assert.throws(() =>
  session.apply({
    ...request([{ type: "delete", cubeIds: guard.cubeIds }]),
    eval: "process.exit()",
  }),
);
assert.throws(
  () => session.apply({ payload: "я".repeat(150_000) }),
  (e) => e instanceof EditorError && e.code === "SIZE_LIMIT",
);
const duplicateId = "test_guard_copy",
  originalFace = session
    .state()
    .project.texturePlan.faces.find((f) => f.cubeId === "guard_center")!;
session.apply(
  request([
    { type: "rotate", cubeIds: ["guard_center"], axis: "z", angle: 22.5 },
  ]),
);
const beforeDuplicate = session.state().project;
session.apply(
  request([{ type: "duplicate", cubeId: "guard_center", newId: duplicateId }]),
);
const copied = session.state().project,
  copyFace = copied.texturePlan.faces.find((f) => f.cubeId === duplicateId)!;
const originalCube = cubes(beforeDuplicate).find(
    (c) => c.id === "guard_center",
  )!,
  copyCube = cubes(copied).find((c) => c.id === duplicateId)!;
assert.deepEqual(
  copyCube.origin.map((v, a) => v - copyCube.pivot[a]!),
  originalCube.origin.map((v, a) => v - originalCube.pivot[a]!),
  "Duplication must preserve geometry relative to its rotation pivot",
);
assert.deepEqual(copyCube.rotation, originalCube.rotation);
for (const face of Object.keys(
  originalFace.uv,
) as (keyof typeof originalFace.uv)[]) {
  const a = originalFace.uv[face],
    b = copyFace.uv[face];
  assert.equal(b[2] - b[0], a[2] - a[0]);
  assert.equal(b[3] - b[1], a[3] - a[1]);
  for (let y = 0; y < Math.abs(a[3] - a[1]); y++)
    for (let x = 0; x < Math.abs(a[2] - a[0]); x++) {
      assert.equal(
        copied.texturePlan.rows[Math.min(b[1], b[3]) + y]![
          Math.min(b[0], b[2]) + x
        ],
        beforeDuplicate.texturePlan.rows[Math.min(a[1], a[3]) + y]![
          Math.min(a[0], a[2]) + x
        ],
      );
    }
}
const empty = emptyProject(randomUUID());
assert.equal(cubes(empty).length, 0);
assert.throws(() => assetRequest(empty));
const shared = structuredClone(project);
shared.texturePlan.faces[0]!.uv.north = [
  ...shared.texturePlan.faces.find((f) => f.cubeId === "guard_center")!.uv
    .north,
];
const sharedSession = new EditorSession(shared),
  sharedState = sharedSession.state();
assert.throws(
  () =>
    sharedSession.apply({
      projectId: shared.projectId,
      expectedRevision: 0,
      key: randomUUID(),
      commands: [{ type: "recolor", cubeIds: guard.cubeIds, color: "#00ff00" }],
    }),
  (e) => e instanceof EditorError && e.code === "SHARED_UV",
);
assert.deepEqual(sharedSession.state(), sharedState);
assert.throws(() => parseProject('{"schemaVersion":1}'));
const directory = await mkdtemp(join(tmpdir(), "mcdev-editor-"));
try {
  const path = join(directory, "проект с пробелами.json");
  await writeProject(path, project);
  await writeProject(path, painted.project);
  assert.deepEqual(await readProject(path), painted.project);
  assert.deepEqual(await readProject(path + ".bak"), project);
  await writeFile(path, "{broken");
  await assert.rejects(readProject(path));
  await writeProject(path, painted.project);
  assert.deepEqual(await readProject(path), painted.project);
  assert.deepEqual(
    await readProject(path + ".bak"),
    project,
    "Corrupt current file must not overwrite valid backup",
  );
  const stage = join(directory, "pending.json"),
    final = join(directory, "final.json");
  await writeProject(stage, project);
  let attempts = 0;
  await renameWithRetry(stage, final, async (from, to) => {
    attempts++;
    if (attempts < 3)
      throw Object.assign(new Error("Temporary Windows lock"), {
        code: "EPERM",
      });
    await rename(from, to);
  });
  assert.deepEqual(await readProject(final), project);
  const sentinel = path + ".pending";
  await writeFile(sentinel, "чужой временный файл");
  await writeProject(path, project);
  assert.equal(await readFile(sentinel, "utf8"), "чужой временный файл");
  const blocked = join(directory, "directory-target.json");
  await mkdir(blocked);
  await assert.rejects(writeProject(blocked, project));
  assert.equal(
    (await readdir(directory)).filter((name) =>
      name.startsWith("directory-target.json."),
    ).length,
    0,
    "Неудачное сохранение должно удалять только собственный временный файл",
  );
  assert.deepEqual(await readProject(path), project);
  const oversized = join(directory, "oversized.json");
  await writeFile(oversized, " ".repeat(MAX_PROJECT_BYTES + 1));
  await assert.rejects(
    readProject(oversized),
    (e) => e instanceof EditorError && e.code === "SIZE_LIMIT",
  );
  assert.equal(
    attempts,
    3,
    "Temporary locks must not discard a completed project",
  );
  let nonRetryAttempts = 0;
  await assert.rejects(
    renameWithRetry(final, stage, async () => {
      nonRetryAttempts++;
      throw Object.assign(new Error("Invalid target"), { code: "EINVAL" });
    }),
  );
  assert.equal(nonRetryAttempts, 1);
  assert.deepEqual(await readProject(final), project);
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write(
  "editor-core: transactions, pixel isolation, history, locks, limits, UV copy and atomic persistence PASS\n",
);
