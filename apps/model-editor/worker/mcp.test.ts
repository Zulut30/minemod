import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { request as httpRequest } from "node:http";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  EditorSession,
  projectFromAsset,
  type EditorCommand,
} from "@mcdev/editor-core";
import { compileItemAssetPayload } from "../../../packages/application/item-assets.ts";
import { verifyAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";
import { isOperationEvidence } from "../../../packages/contracts/index.ts";
import { assetRequest } from "@mcdev/editor-core";
import { startEditorMcp } from "./mcp.ts";
import { VIEWS, type View } from "../shared/bridge.ts";
let session = new EditorSession(
  projectFromAsset(
    JSON.parse(
      await readFile(
        new URL(
          "../../../fixtures/assets/aurora-longsword-v2.item-asset.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    randomUUID(),
  ),
);
let queue: Promise<unknown> = Promise.resolve();
let captureLayout: string | undefined;
let captureView: View | undefined;
let captureData =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const editor = await startEditorMcp({
  inspect: () => session.state(),
  selection: () => ["guard_left"],
  preview: (m) => session.preview(m),
  apply: async (m) => session.apply(m, "agent"),
  capture: async (_state, _view, options) => {
    captureView = _view;
    captureLayout = options?.layout;
    return captureData;
  },
  export: () =>
    compileItemAssetPayload(
      JSON.stringify(assetRequest(session.state().project)),
    ),
  enqueue: (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  },
});
const clients = [
  new Client({ name: "client-a", version: "1" }),
  new Client({ name: "client-b", version: "1" }),
];
const headers = {
  Authorization: `Bearer ${editor.token}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};
const mutation = (commands: EditorCommand[]) => ({
  projectId: session.state().project.projectId,
  expectedRevision: session.state().revision,
  key: randomUUID(),
  commands,
});
async function call(
  index: number,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await clients[index]!.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return {
    data: JSON.parse(content[0]!.text) as Record<string, unknown>,
    error: result.isError,
  };
}
try {
  for (const client of clients)
    await client.connect(
      new StreamableHTTPClientTransport(new URL(editor.url), {
        requestInit: { headers },
      }) as Transport,
    );
  assert.equal((await clients[0]!.listTools()).tools.length, 10);
  assert.equal(
    (
      await fetch(editor.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(editor.url, {
        method: "POST",
        headers: { ...headers, Origin: "https://evil.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  const hostileHost = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      editor.url,
      { method: "POST", headers: { ...headers, Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
  assert.equal(hostileHost, 403);
  assert.equal((await fetch(editor.url, { headers })).status, 405);
  assert.equal(
    (await fetch(editor.url, { method: "POST", headers, body: "[{}]" })).status,
    400,
  );
  assert.equal(
    (await fetch(editor.url, { method: "POST", headers, body: "{bad" })).status,
    400,
  );
  assert.equal(
    (
      await fetch(editor.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "я".repeat(140000) }),
      })
    ).status,
    413,
  );
  const all = session
    .state()
    .project.parts.find((p) => p.id === "guard")!.cubeIds;
  const request = mutation([
    { type: "recolor", cubeIds: all, color: "#aa8ccd" },
  ]);
  const before = session.state();
  const proposal = await call(0, "studio_changes_preview", request);
  assert.equal(proposal.error, undefined);
  assert.deepEqual(
    session.state(),
    before,
    "Preview must not mutate history or replay cache",
  );
  const apply = {
    projectId: before.project.projectId,
    proposalId: proposal.data.proposalId,
  };
  await call(1, "studio_changes_apply", apply);
  assert.equal(session.state().revision, 1);
  assert.equal(session.state().history[0]!.actor, "agent");
  await call(0, "studio_changes_apply", apply);
  assert.equal(
    session.state().revision,
    1,
    "Cross-client retry must not double-apply",
  );
  const previewAgain = await call(0, "studio_changes_preview", request);
  assert.equal(
    previewAgain.error,
    undefined,
    "Preview shares replay semantics with apply",
  );
  const conflict = await call(0, "studio_changes_preview", {
    ...request,
    commands: [{ type: "add", cubeId: "new_cube" }],
  });
  assert.equal((conflict.data.error as { code: string }).code, "KEY_CONFLICT");
  const stale = await call(
    0,
    "studio_changes_preview",
    mutation([{ type: "rotate", cubeIds: all, axis: "x", angle: 22.5 }]),
  );
  session.apply(
    mutation([{ type: "rotate", cubeIds: all, axis: "y", angle: 22.5 }]),
  );
  const rejected = await call(1, "studio_changes_apply", {
    projectId: before.project.projectId,
    proposalId: stale.data.proposalId,
  });
  assert.equal(
    (rejected.data.error as { code: string }).code,
    "REVISION_CONFLICT",
  );
  const human = await call(0, "studio_history_undo", {
    projectId: before.project.projectId,
    expectedRevision: 2,
    key: randomUUID(),
  });
  assert.equal((human.data.error as { code: string }).code, "HUMAN_HISTORY");
  session.apply(mutation([{ type: "lock", partId: "guard", locked: true }]));
  const locked = await call(
    0,
    "studio_changes_preview",
    mutation([{ type: "delete", cubeIds: all }]),
  );
  assert.equal((locked.data.error as { code: string }).code, "LOCKED");
  const unknown = await clients[0]!.callTool({
    name: "studio_project_inspect",
    arguments: { shell: "whoami" },
  });
  assert.equal(unknown.isError, true);
  const bounds = await call(
    0,
    "studio_changes_preview",
    mutation([
      { type: "add", cubeId: "safe_cube" },
      {
        type: "transform",
        cubeIds: ["safe_cube"],
        translation: [100, 0, 0],
        scale: [1, 1, 1],
      },
    ]),
  );
  assert.equal((bounds.data.error as { code: string }).code, "BOUNDS");
  assert.equal(session.state().revision, 3);
  const ref = {
    projectId: session.state().project.projectId,
    expectedRevision: 3,
  };
  assert.equal(
    (await call(0, "studio_asset_validate", ref)).data.technical,
    "pass",
  );
  const exported = await call(0, "studio_asset_export", ref);
  assert.equal((exported.data.bundle as { files: unknown[] }).files.length, 3);
  const beforeExport = session.state();
  const exportedV1 = await call(0, "studio_asset_export", { ...ref, format: "bundle-v1" });
  const verified = verifyAssetBundleV1(exportedV1.data.bundle);
  assert(isOperationEvidence(exportedV1.data.evidence));
  assert.deepEqual(exportedV1.data.evidence.revision, { kind: "editor", projectId: ref.projectId, revision: ref.expectedRevision });
  assert.equal(exportedV1.data.evidence.input.sha256,
    createHash("sha256").update(JSON.stringify(assetRequest(beforeExport.project))).digest("hex"));
  assert.equal(exportedV1.data.evidence.technical.status, "pass");
  assert.equal(exportedV1.data.evidence.artistic.status, "requires-human-review");
  assert.equal(exportedV1.data.evidence.game.status, "not-run");
  assert.equal(exportedV1.data.evidence.pack, null);
  assert.equal(verified.files.length, 4);
  assert.equal(verified.manifest.reviewRequired, true);
  assert.deepEqual(JSON.parse(verified.files[3]!.content), assetRequest(beforeExport.project));
  assert.deepEqual(session.state(), beforeExport, "Export must leave project and revision unchanged.");
  assert.equal((await clients[0]!.callTool({ name: "studio_asset_export", arguments: { ...ref, format: "future" } })).isError, true);
  const captured = await clients[0]!.callTool({
    name: "studio_view_capture",
    arguments: { ...ref, view: "front" },
  });
  assert.equal((captured.content as { type: string }[])[1]!.type, "image");
  const priorProject = session.state().project;
  session = new EditorSession({ ...priorProject, projectId: randomUUID() });
  const switched = await call(0, "studio_changes_apply", apply);
  assert.equal(
    (switched.data.error as { code: string }).code,
    "PROJECT_CONFLICT",
  );
  assert(Buffer.byteLength(JSON.stringify(exported.data)) < 2_097_152);
  const textureBefore = session.state();
  const part = textureBefore.project.parts.find((p) => !p.locked)!;
  const cubeId = part.cubeIds[0]!;
  const rect = textureBefore.project.texturePlan.faces.find(
    (f) => f.cubeId === cubeId,
  )!.uv.north;
  const pixel: [number, number] = [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
  ];
  const stroke: EditorCommand = {
    type: "paint",
    cubeIds: [cubeId],
    face: "north",
    color: "#ff9900",
    size: 1,
    points: [pixel],
  };
  const pixelProposal = await call(
    0,
    "studio_changes_preview",
    mutation([stroke]),
  );
  assert.equal(pixelProposal.error, undefined);
  assert.deepEqual(session.state(), textureBefore);
  const pixelApply = {
    projectId: textureBefore.project.projectId,
    proposalId: pixelProposal.data.proposalId,
  };
  assert.equal(
    (await call(1, "studio_changes_apply", pixelApply)).error,
    undefined,
  );
  assert.notDeepEqual(
    session.state().project.texturePlan,
    textureBefore.project.texturePlan,
  );
  assert.deepEqual(session.state().project.model, textureBefore.project.model);
  await call(0, "studio_changes_apply", pixelApply);
  assert.equal(session.state().revision, textureBefore.revision + 1);
  assert.equal(
    (
      await clients[0]!.callTool({
        name: "studio_changes_preview",
        arguments: mutation([{ ...stroke, points: Array(4097).fill(pixel) }]),
      })
    ).isError,
    true,
  );
  const uvProposal = await call(
    0,
    "studio_changes_preview",
    mutation([
      { type: "uv", cubeId, face: "north", rect: [240, 240, 244, 244] },
    ]),
  );
  assert.equal(uvProposal.error, undefined);
  assert.equal(
    (
      await call(1, "studio_changes_apply", {
        projectId: session.state().project.projectId,
        proposalId: uvProposal.data.proposalId,
      })
    ).error,
    undefined,
  );
  assert.deepEqual(
    session.state().project.texturePlan.faces.find((f) => f.cubeId === cubeId)!
      .uv.north,
    [240, 240, 244, 244],
  );
  const fillProposal = await call(
    0,
    "studio_changes_preview",
    mutation([
      {
        type: "fill",
        cubeIds: [cubeId],
        face: "north",
        color: null,
        seed: [240, 240],
      },
    ]),
  );
  assert.equal(fillProposal.error, undefined);
  assert.equal(
    (
      await call(1, "studio_changes_apply", {
        projectId: session.state().project.projectId,
        proposalId: fillProposal.data.proposalId,
      })
    ).error,
    undefined,
  );
  for (let i = 0; i < 3; i++)
    await call(0, "studio_history_undo", {
      projectId: session.state().project.projectId,
      expectedRevision: session.state().revision,
      key: randomUUID(),
    });
  assert.deepEqual(session.state().project, textureBefore.project);
  const variantId = randomUUID();
  session.apply(
    mutation([
      { type: "brief", text: "Сохранить рукоять, улучшить силуэт" },
      {
        type: "checkpoint",
        variantId,
        label: "Исходник",
        note: "Базовая форма",
      },
    ]),
  );
  const variantRef = {
    projectId: session.state().project.projectId,
    expectedRevision: session.state().revision,
  };
  const variantResult = await call(0, "studio_variant_inspect", {
    ...variantRef,
    variantId,
    includeTexture: true,
  });
  assert.equal(variantResult.error, undefined);
  assert.deepEqual(
    (variantResult.data.variant as { project: unknown }).project,
    session.state().project.design!.variants[0]!.project,
  );
  const designInspect = await call(0, "studio_project_inspect", {});
  const designSummary = (
    designInspect.data.project as {
      design: { variants: Record<string, unknown>[] };
    }
  ).design;
  assert.equal(designSummary.variants[0]!.label, "Исходник");
  assert.equal(designSummary.variants[0]!.project, undefined);
  const deniedVariant = await call(
    0,
    "studio_changes_preview",
    mutation([{ type: "deleteVariant", variantId }]),
  );
  assert.equal(
    (deniedVariant.data.error as { code: string }).code,
    "HUMAN_ONLY",
  );
  const unknownVariant = await call(0, "studio_view_capture", {
    ...variantRef,
    variantId: randomUUID(),
    view: "front",
  });
  assert.equal(
    (unknownVariant.data.error as { code: string }).code,
    "VARIANT_NOT_FOUND",
  );
  assert.equal(
    (
      await call(0, "studio_variant_inspect", {
        ...variantRef,
        expectedRevision: variantRef.expectedRevision - 1,
        variantId,
      })
    ).error,
    true,
  );
  const snapshotCapture = await call(0, "studio_view_capture", {
    ...variantRef,
    variantId,
    view: "front",
    silhouette: true,
  });
  assert.equal(snapshotCapture.data.variantId, variantId);
  assert.equal(snapshotCapture.data.silhouette, true);
  const beforeReview = session.state();
  for (const view of VIEWS) {
    const result = await call(0, "studio_view_capture", { ...variantRef, view });
    assert.equal(result.error, undefined);
    assert.equal(captureView, view);
    assert.deepEqual(session.state(), beforeReview);
  }
  assert.equal((await clients[0]!.callTool({ name: "studio_view_capture", arguments: { ...variantRef, view: "arbitrary-camera-eval" } })).isError, true);
  const review = await call(0, "studio_model_review", {
    ...variantRef,
    variantId,
  });
  assert.equal(review.error, undefined);
  assert.equal(captureLayout, "review");
  assert.deepEqual(review.data.views, ["front", "side", "back", "perspective"]);
  assert.deepEqual(review.data.smallPreviews, [32, 64]);
  assert.deepEqual(session.state(), beforeReview);
  for (const bad of [
    { ...variantRef, expectedRevision: variantRef.expectedRevision - 1 },
    { ...variantRef, variantId: randomUUID() },
    { ...variantRef, compareToVariantId: randomUUID() },
    { ...variantRef, layout: "arbitrary" },
  ])
    assert.equal(
      (
        await clients[0]!.callTool({
          name: "studio_model_review",
          arguments: bad,
        })
      ).isError,
      true,
    );
  captureData = "x".repeat(2_097_152);
  const oversizedCapture = await call(0, "studio_view_capture", variantRef);
  assert.equal((oversizedCapture.data.error as { code: string }).code, "OUTPUT_LIMIT");
  const oversizedReview = await call(0, "studio_model_review", variantRef);
  assert.equal(
    (oversizedReview.data.error as { code: string }).code,
    "OUTPUT_LIMIT",
  );
  const repairPart = session.state().project.parts.find(part => !part.locked)!;
  const repairBefore = session.state();
  session.setRepair({ projectId: repairBefore.project.projectId, expectedRevision: repairBefore.revision,
    repair: { id: randomUUID(), note: "Исправить пропорции выбранной детали", partIds: [repairPart.id], area: "geometry", maxIterations: 1 } });
  const repairScene = await call(0, "studio_project_inspect", {});
  assert.deepEqual(repairScene.data.repair, session.state().repair);
  const repairMove: EditorCommand = { type: "transform", cubeIds: [repairPart.cubeIds[0]!], translation: [0.125,0,0], scale: [1,1,1] };
  const repairPreview = await call(0, "studio_changes_preview", mutation([repairMove]));
  assert.equal(repairPreview.error, undefined);assert.equal(session.state().repair?.usedIterations,0);
  const repairApplyArgs = { projectId: session.state().project.projectId, proposalId: repairPreview.data.proposalId };
  assert.equal((await call(0,"studio_changes_apply",repairApplyArgs)).error,undefined);
  assert.equal(session.state().repair?.usedIterations,1);
  assert.equal((await call(0,"studio_changes_apply",repairApplyArgs)).error,undefined);
  assert.equal(session.state().repair?.usedIterations,1);
  const budgetDenied = await call(0,"studio_changes_preview",mutation([repairMove]));
  assert.equal((budgetDenied.data.error as {code:string}).code,"REPAIR_BUDGET");
  assert.deepEqual(session.state().project.texturePlan,repairBefore.project.texturePlan);
  assert.equal((await clients[0]!.callTool({name:"studio_repair_reset",arguments:{}})).isError,true);
  // Перепаковка через настоящий HTTP; предыдущая последовательность сохраняет свои revision assertions.
  session = new EditorSession({ ...repairBefore.project, projectId: randomUUID() });
  const packBefore = session.state(), packPart = packBefore.project.parts.find(p => !p.locked)!;
  const packCommand: EditorCommand = { type: "repackUv", cubeIds: packPart.cubeIds, shared: "split" };
  const packPreview = await call(0, "studio_changes_preview", mutation([packCommand]));
  assert.equal(packPreview.error, undefined); assert.deepEqual(session.state(), packBefore);
  const packArgs = { projectId: packBefore.project.projectId, proposalId: packPreview.data.proposalId };
  assert.equal((await call(0, "studio_changes_apply", packArgs)).error, undefined);
  const packed = session.state();
  assert.deepEqual(packed.project.model, packBefore.project.model);
  assert.notDeepEqual(packed.project.texturePlan, packBefore.project.texturePlan);
  assert.equal((await call(0, "studio_changes_apply", packArgs)).error, undefined);
  assert.deepEqual(session.state(), packed, "Повторный apply не перепаковывает второй раз");
  const packRef = { projectId: packed.project.projectId, expectedRevision: packed.revision };
  const packedExport = await call(0, "studio_asset_export", { ...packRef, format: "bundle-v1" });
  assert.equal(packedExport.error, undefined);
  assert.deepEqual(JSON.parse(verifyAssetBundleV1(packedExport.data.bundle).files[3]!.content), assetRequest(packed.project));
  assert.deepEqual(session.state(), packed);
  const stalePack = await call(0, "studio_changes_preview", { ...mutation([packCommand]), expectedRevision: packBefore.revision });
  assert.equal((stalePack.data.error as { code: string }).code, "REVISION_CONFLICT");
  assert.deepEqual(session.state(), packed);
  assert.equal((await call(0, "studio_history_undo", { ...packRef, key: randomUUID() })).error, undefined);
  assert.deepEqual(session.state().project, packBefore.project);
  for (const bad of [{ ...packCommand, shared: "rotate" }, { ...packCommand, placementChecks: 100_000_000 }]) {
    const beforeBad = session.state();
    assert((await clients[0]!.callTool({ name: "studio_changes_preview", arguments: mutation([bad as EditorCommand]) })).isError);
    assert.deepEqual(session.state(), beforeBad);
  }
  const packRepair = session.state();
  session.setRepair({ projectId: packRepair.project.projectId, expectedRevision: packRepair.revision,
    repair: { id: randomUUID(), note: "Перенести только заданную грань", partIds: [packPart.id], area: "uv", face: "north", maxIterations: 2 } });
  const repairPackBefore = session.state();
  const repairPack = await call(0, "studio_changes_preview", mutation([packCommand]));
  assert.equal((repairPack.data.error as { code: string }).code, "REPAIR_SCOPE");
  assert.deepEqual(session.state(), repairPackBefore);
  process.stdout.write(
    "Studio MCP: real HTTP clients, authentication, origins, byte limits, preview isolation, conflicts, locks, human history, replay and bounded export PASS\n",
  );
} finally {
  for (const client of clients) await client.close();
  editor.close();
}
