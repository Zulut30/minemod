/* global window, document */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cubes, bounds, snapToGrid } from "../../../packages/editor-core/index.ts";
import { verifyAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";

export async function checkGeometryDesktop(options, output) {
  const root = join(output, "geometry"); await mkdir(root, { recursive: true });
  const application = await electron.launch({ ...options, args: options.args.filter((v) => !v.startsWith("--editor-data="))
    .concat(`--editor-data=${join(root, "user-data")}`) });
  let client;
  try {
    const page = await application.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const problems = []; page.on("pageerror", (e) => problems.push(e.message));
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())));
    const inspect = async () => (await page.evaluate(() => window.studio.request({ kind: "inspect" }))).state;
    const settled = async (revision) => {
      await page.waitForFunction((r) => document.querySelector('[data-testid="revision"]').textContent === `r${r}` &&
        !document.querySelector('[data-testid="save-project"]').disabled, revision);
    };
    const connection = await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" }));
    client = new Client({ name: "geometry-acceptance", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),
      { requestInit: { headers: { Authorization: `Bearer ${connection.connection.token}` } } }));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert(!result.isError, result.content[0]?.text); return JSON.parse(result.content[0].text);
    };
    const exportBundle = async () => {
      const state = await inspect(); return verifyAssetBundleV1((await call("studio_asset_export",
        { projectId: state.project.projectId, expectedRevision: state.revision, format: "bundle-v1" })).bundle);
    };
    const capture = async (name) => {
      const state = await inspect(), result = await client.callTool({ name: "studio_view_capture",
        arguments: { projectId: state.project.projectId, expectedRevision: state.revision, view: "front" } });
      assert(!result.isError); const block = result.content.find((c) => c.type === "image"); assert(block);
      const bytes = Buffer.from(block.data, "base64"); await writeFile(join(root, name), bytes);
      return createHash("sha256").update(bytes).digest("hex");
    };
    const initial = await inspect(), ids = initial.project.parts.find((p) => p.id === "guard").cubeIds;
    const selected = (project) => cubes(project).filter((c) => ids.includes(c.id));
    const oldBundle = await exportBundle(), initialCapture = await capture("before-front.png");
    await page.getByLabel("Шаг привязки").selectOption("0.25");
    const oldBox = bounds(selected(initial.project));
    await page.getByLabel("Положение X", { exact: true }).fill(String(oldBox.min[0] + 0.13));
    await page.getByLabel("Положение X", { exact: true }).press("Enter"); await settled(1);
    assert.equal(bounds(selected((await inspect()).project)).min[0], snapToGrid(oldBox.min[0] + 0.13, 0.25));
    await page.getByLabel("Размер X", { exact: true }).fill(String(oldBox.size[0] + 0.13));
    assert.equal(await page.getByLabel("Размер X", { exact: true }).inputValue(), String(oldBox.size[0] + 0.13));
    await page.getByLabel("Размер X", { exact: true }).press("Enter"); await settled(2);
    const actualSize = bounds(selected((await inspect()).project)).size[0], expectedSize = snapToGrid(oldBox.size[0] + 0.13, 0.25);
    assert(Math.abs(actualSize - expectedSize) < 1e-12, `Size after keyboard commit: ${actualSize}, expected ${expectedSize}`);

    const state = await inspect();
    assert((await page.evaluate((mutation) => window.studio.request({ kind: "apply", mutation }),
      { projectId: state.project.projectId, expectedRevision: state.revision, key: randomUUID(),
        commands: [{ type: "pivot", cubeIds: [ids[0]], axis: "x", value: 7.125 }] })).ok);
    await settled(3);
    const pivotX = page.getByLabel("Центр вращения X", { exact: true });
    assert.equal(await pivotX.inputValue(), ""); assert.equal(await pivotX.getAttribute("placeholder"), "Разные");
    const mixed = await inspect();
    await pivotX.fill("9"); await pivotX.press("Escape");
    assert.deepEqual(await inspect(), mixed, "Escape must preserve different pivots.");
    assert.equal(await pivotX.inputValue(), "");
    await pivotX.fill("8.12"); await pivotX.press("Enter"); await settled(4);
    assert(selected((await inspect()).project).every((c) => c.pivot[0] === 8));
    await page.getByLabel("Шаг привязки").selectOption("0");
    const pivotY = page.getByLabel("Центр вращения Y", { exact: true });
    await pivotY.fill("12.123456"); await pivotY.press("Enter"); await settled(5);
    assert(selected((await inspect()).project).every((c) => c.pivot[1] === 12.123456));
    assert.equal(await pivotY.inputValue(), "12.123456");
    await pivotY.focus(); await pivotY.press("Enter"); assert.equal((await inspect()).revision, 5);
    await page.getByLabel("Ось вращения", { exact: true }).selectOption("z");
    await page.getByLabel("Угол вращения", { exact: true }).selectOption("22.5");
    await page.getByTestId("apply-rotation").click(); await settled(6);
    const changed = await inspect(), bundle = await exportBundle(), changedCapture = await capture("pivot-rotation-front.png");
    assert.notEqual(changedCapture, initialCapture);
    const model = JSON.parse(bundle.files.find((f) => f.path.includes("/models/item/")).content);
    for (const cube of selected(changed.project)) assert.deepEqual(model.elements.find((e) => e.name === cube.id).rotation,
      { origin: cube.pivot, axis: "z", angle: 22.5, rescale: false });
    assert.equal(bundle.manifest.files.find((f) => f.role === "texture").sha256, oldBundle.manifest.files.find((f) => f.role === "texture").sha256);
    for (let i = 0; i < 6; i++) { await page.getByTestId("undo").click(); await settled(7 + i); }
    assert.deepEqual((await inspect()).project, initial.project);
    const afterUndoCapture = await capture("after-undo-front.png"); assert.equal(afterUndoCapture, initialCapture);
    for (let i = 0; i < 6; i++) { await page.getByTestId("redo").click(); await settled(13 + i); }
    assert.deepEqual((await inspect()).project, changed.project);

    const tools = (await client.listTools()).tools;
    const schemaText = JSON.stringify(tools.find((t) => t.name === "studio_changes_preview").inputSchema);
    assert(schemaText.includes('"pivot"') && schemaText.includes('"snap"'));
    await pivotY.fill("13");
    const beforeAgent = await inspect(), mutation = { projectId: beforeAgent.project.projectId, expectedRevision: beforeAgent.revision,
      key: randomUUID(), commands: [{ type: "pivot", cubeIds: ids, axis: "x", value: 8.25 }, { type: "snap", cubeIds: ids, step: 0.25 }] };
    const proposal = await call("studio_changes_preview", mutation);
    assert.deepEqual(await inspect(), beforeAgent);
    await call("studio_changes_apply", { projectId: mutation.projectId, proposalId: proposal.proposalId });
    await settled(19);
    const afterAgent = await inspect(); await pivotY.press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-testid="status-message"]').textContent.includes("STALE_REVISION"));
    assert.deepEqual(await inspect(), afterAgent);
    for (const command of [{ type: "rotate", cubeIds: ids, axis: "z", angle: 30 }, { type: "snap", cubeIds: ids, step: 0.3 }]) {
      const result = await client.callTool({ name: "studio_changes_preview", arguments: { ...mutation, expectedRevision: afterAgent.revision,
        key: randomUUID(), commands: [command] } }); assert(result.isError); assert.deepEqual(await inspect(), afterAgent);
    }
    await page.getByLabel("Шаг привязки").selectOption("0.5");
    await page.getByTestId("snap-selection").click(); await settled(20);
    assert(bounds(selected((await inspect()).project)).min.every((v) => Math.abs(v / 0.5 - Math.round(v / 0.5)) < 1e-12));
    assert.deepEqual(problems, []);
    const report = { status: "PASS", hidden: true, gridNumericFields: true, mixedPivotEscape: true, exactPivotDecimal: true,
      nativeRotationExport: true, pngUnchanged: true, humanUndoRedo: 6, publicMcpPivotSnap: true, stalePivotInputRejected: true,
      beforeFrontSha256: initialCapture, changedFrontSha256: changedCapture, afterUndoFrontSha256: afterUndoCapture };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await client?.close(); await application.close(); }
}
