/* global window, document, Image */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FACE_NAMES, texturePixels, textureMask, validateProject } from "@mcdev/editor-core";
import { verifyAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";

// Сравнение рисунка в локальных координатах каждой грани, включая отражённые UV.
function surfaces(project) {
  const pixels = texturePixels(project), width = project.model.texture.width;
  return project.texturePlan.faces.flatMap(binding => FACE_NAMES.map(face => {
    const r = binding.uv[face], w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
    const colors = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = r[0] < r[2] ? r[0] + x : r[0] - x - 1;
      const v = r[1] < r[3] ? r[1] + y : r[1] - y - 1;
      colors.push(pixels[v * width + u]);
    }
    return { cubeId: binding.cubeId, face, width: w, height: h, colors };
  }));
}

export async function checkUvRepackDesktop(options, output) {
  const root = join(output, "uv-repack"); await mkdir(root, { recursive: true });
  const application = await electron.launch({ ...options, args: options.args.filter(v => !v.startsWith("--editor-data="))
    .concat(`--editor-data=${join(root, "user-data")}`) });
  let client;
  try {
    const page = await application.firstWindow(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.getByTestId("part-guard").waitFor(); await page.locator("canvas[data-ready='true']").waitFor();
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible())));
    const inspect = async () => (await page.evaluate(() => window.studio.request({ kind: "inspect" }))).state;
    const settled = async r => page.waitForFunction(wanted => document.querySelector('[data-testid="revision"]').textContent === `r${wanted}`
      && !document.querySelector('[data-testid="save-project"]').disabled, r);
    const paths = { original: join(root, "исходный меч.mmeditor.json"), packed: join(root, "UV меч.mmeditor.json") };
    const dialogs = async path => application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, path);
    const save = async () => {
      await page.getByTestId("save-project").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="status-message"]').textContent === "Проект сохранён.");
    };
    const initial = await inspect(), ids = initial.project.parts.find(p => p.id === "guard").cubeIds;
    await dialogs(paths.original); await save();
    await page.getByTestId("part-guard").click();
    const connected = await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" }));
    assert(connected.ok && connected.connection.enabled);
    client = new Client({ name: "uv-repack-acceptance", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connected.connection.url), {
      requestInit: { headers: { Authorization: `Bearer ${connected.connection.token}` } },
    }));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert(!result.isError, result.content[0]?.text); return JSON.parse(result.content[0].text);
    };
    const views = async prefix => {
      const result = [];
      for (const view of ["front", "back", "side", "perspective"]) {
        const state = await inspect(), response = await client.callTool({ name: "studio_view_capture",
          arguments: { projectId: state.project.projectId, expectedRevision: state.revision, view } });
        assert(!response.isError); const image = response.content.find(c => c.type === "image"); assert(image);
        const bytes = Buffer.from(image.data, "base64"); await writeFile(join(root, `${prefix}-${view}.png`), bytes);
        result.push({ view, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      return result;
    };
    const beforeViews = await views("before");
    await page.getByTestId("mode-texture").click();
    const details = page.locator(".uv-repack"); assert.equal(await details.getAttribute("open"), null);
    await details.locator("summary").click();
    await page.getByLabel("Общие UV при перепаковке").selectOption("split");
    const before = await inspect();
    await page.getByTestId("repack-uv").click(); await settled(before.revision + 1);
    const packed = await inspect();
    assert.deepEqual(packed.project.model, initial.project.model);
    assert.notDeepEqual(packed.project.texturePlan.faces, initial.project.texturePlan.faces);
    assert.deepEqual(surfaces(packed.project), surfaces(initial.project));
    const unselected = textureMask(initial.project, initial.project.texturePlan.faces.filter(f => !ids.includes(f.cubeId)).map(f => f.cubeId));
    const oldPixels = texturePixels(initial.project), newPixels = texturePixels(packed.project);
    assert(newPixels.every((c, i) => !unselected[i] || c === oldPixels[i]));
    const packedViews = await views("packed"); assert.deepEqual(packedViews, beforeViews, "Все виды сохраняют рисунок модели");
    const screenshot = await application.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === "studio://app/index.html")
        .webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
    await writeFile(join(root, "workshop.png"), Buffer.from(screenshot, "base64"));
    await page.getByTestId("undo").click(); await settled(packed.revision + 1);
    assert.deepEqual((await inspect()).project, initial.project);
    await page.getByTestId("redo").click(); await settled(packed.revision + 2);
    assert.deepEqual((await inspect()).project, packed.project);
    // Save As создаёт отдельный файл; исходник остаётся доступен для полного возврата.
    await dialogs(paths.packed);
    const saved = await page.evaluate(() => window.studio.request({ kind: "saveAs" }));
    assert(saved.ok); assert.deepEqual(JSON.parse(await readFile(paths.packed, "utf8")), packed.project);
    await page.getByTestId("open-project").click();
    await page.waitForFunction(r => document.querySelector('[data-testid="revision"]').textContent !== `r${r}`, saved.state.revision);
    assert.deepEqual((await inspect()).project, packed.project);
    const reopenedViews = await views("reopened"); assert.deepEqual(reopenedViews, beforeViews);
    await dialogs(paths.original); await page.getByTestId("open-project").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="status-message"]').textContent === "Проект открыт.");
    assert.deepEqual((await inspect()).project, initial.project);
    const agentBase = await inspect(), request = { projectId: agentBase.project.projectId, expectedRevision: agentBase.revision,
      key: randomUUID(), commands: [{ type: "repackUv", cubeIds: ids }] };
    const preview = await call("studio_changes_preview", request); assert.deepEqual(await inspect(), agentBase);
    const applied = await call("studio_changes_apply", { projectId: request.projectId, proposalId: preview.proposalId });
    await settled(applied.revision); const agentPacked = await inspect();
    assert.deepEqual(surfaces(agentPacked.project), surfaces(initial.project));
    const exported = await call("studio_asset_export", { projectId: request.projectId, expectedRevision: agentPacked.revision, format: "bundle-v1" });
    const bundle = verifyAssetBundleV1(exported.bundle), png = bundle.files.find(f => f.encoding === "base64" && f.path.endsWith(".png")); assert(png);
    const pngSha256 = bundle.manifest.files.find(f => f.path === png.path).sha256;
    const rgba = await page.evaluate(async data => {
      const image = new Image(); image.src = "data:image/png;base64," + data; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
    }, png.content);
    texturePixels(agentPacked.project).forEach((c, i) => assert.deepEqual(rgba.slice(i * 4, i * 4 + 4),
      c ? [1, 3, 5].map(at => Number.parseInt(c.slice(at, at + 2), 16)).concat(255) : [0, 0, 0, 0]));
    const noChange = await client.callTool({ name: "studio_changes_preview", arguments: { ...request,
      expectedRevision: agentPacked.revision, key: randomUUID() } });
    assert(noChange.isError); assert.equal(JSON.parse(noChange.content[0].text).error.code, "NO_CHANGE");
    assert.deepEqual(await inspect(), agentPacked);
    const undone = await call("studio_history_undo", { projectId: request.projectId, expectedRevision: agentPacked.revision, key: randomUUID() });
    await settled(undone.revision); assert.deepEqual((await inspect()).project, initial.project);
    const mirrorBase = await inspect(), cubeId = ids[0], rect = mirrorBase.project.texturePlan.faces.find(f => f.cubeId === cubeId).uv.north;
    const mirroredRequest = { projectId: request.projectId, expectedRevision: mirrorBase.revision, key: randomUUID(),
      commands: [{ type: "uv", cubeId, face: "north", rect: [200 + Math.abs(rect[2] - rect[0]), 200 + Math.abs(rect[3] - rect[1]), 200, 200] }] };
    const mirrorPreview = await call("studio_changes_preview", mirroredRequest);
    const mirrorApply = await call("studio_changes_apply", { projectId: request.projectId, proposalId: mirrorPreview.proposalId });
    await settled(mirrorApply.revision); const mirrored = await inspect();
    assert.deepEqual(surfaces(mirrored.project), surfaces(initial.project));
    const mirroredViews = await views("mirrored"); assert.deepEqual(mirroredViews, beforeViews, "Отражения UV сохраняют рисунок в GPU-render");
    const mirrorUndo = await call("studio_history_undo", { projectId: request.projectId, expectedRevision: mirrored.revision, key: randomUUID() });
    await settled(mirrorUndo.revision); assert.deepEqual((await inspect()).project, initial.project);
    // Тот же cube ID переиспользует материал в CaptureApp: размер атласа не должен оставаться от прошлого проекта.
    const atlasSwitchViews = [], bone = initial.project.model.bones.find(b => b.cubes.some(c => c.id === cubeId)),
      cube = bone.cubes.find(c => c.id === cubeId);
    for (const width of [256, 32, 256]) {
      const project = globalThis.structuredClone(initial.project); project.projectId = randomUUID(); project.design = { brief: "", variants: [] };
      project.model.texture = { width, height: width };
      project.model.bones = [{ ...bone, parent: null, cubes: [{ ...cube, uv: [0, 0] }] }];
      project.parts = [{ ...initial.project.parts.find(p => p.id === "guard"), cubeIds: [cubeId] }];
      project.texturePlan.faces = [{ cubeId, uv: Object.fromEntries(FACE_NAMES.map(face => [face, [0, 0, 4, 4]])) }];
      project.texturePlan.palette = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"].map((color, i) => ({ symbol: String(i), color }));
      project.texturePlan.rows = Array.from({ length: width }, (_, y) => y < 4
        ? (y < 2 ? "0011" : "2233") + ".".repeat(width - 4) : ".".repeat(width));
      validateProject(project);
      const path = join(root, `atlas-${width}.mmeditor.json`); await writeFile(path, JSON.stringify(project)); await dialogs(path);
      const opened = await page.evaluate(() => window.studio.request({ kind: "open" })); assert(opened.ok);
      await settled(opened.state.revision); assert.deepEqual((await inspect()).project, project);
      const snapshots = await views(`atlas-${atlasSwitchViews.length}-${width}`);
      atlasSwitchViews.push({ width, views: snapshots });
    }
    for (const sample of atlasSwitchViews) assert.deepEqual(sample.views, atlasSwitchViews[0].views,
      "Переход 256 → 32 → 256 сохраняет четыре цветных области грани");
    await dialogs(paths.original);
    const restored = await page.evaluate(() => window.studio.request({ kind: "open" })); assert(restored.ok);
    await settled(restored.state.revision); assert.deepEqual((await inspect()).project, initial.project);
    assert.deepEqual(errors, []);
    const report = { status: "PASS", hidden: true, selectedCubes: ids.length, checkedSurfaces: surfaces(initial.project).length,
      uiSplit: true, semanticPixelsUnchanged: true, unselectedPixelsUnchanged: true, humanUndoRedo: true, saveReopen: true,
      mcpPreviewApplyExportUndo: true, repeatNoChange: true, pngExactRgba: true, pngSha256,
      beforeViews, packedViews, reopenedViews, mirroredViews, mirroredGpuPattern: true, atlasSwitchViews,
      artisticApproval: "NOT_PERFORMED", gameIntegration: "NOT_RUN" };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } catch (error) {
    await writeFile(join(root, "failure.json"), JSON.stringify({ error: String(error) }, null, 2) + "\n"); throw error;
  } finally { await client?.close(); await application.close(); }
}
