/* global window, document */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EditorSession, emptyProject, FACE_NAMES, validateProject } from "@mcdev/editor-core";

export async function checkTexelDensityDesktop(options, output) {
  const root = join(output, "texel-density"); await mkdir(root, { recursive: true });
  const application = await electron.launch({ ...options, args: options.args.filter(value => !value.startsWith("--editor-data="))
    .concat(`--editor-data=${join(root, "user-data")}`) });
  let client;
  try {
    const page = await application.firstWindow(), errors = [];
    page.on("pageerror", error => errors.push(error.message)); await page.getByTestId("part-guard").waitFor();
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible())));
    const session = new EditorSession(emptyProject(randomUUID()));
    session.apply({ projectId: session.state().project.projectId, expectedRevision: 0, key: randomUUID(), commands: [{ type: "add", cubeId: "sample" }] });
    const project = session.state().project, cube = project.model.bones[0].cubes[0];
    cube.size = [2, 4, 8]; cube.inflate = 1; cube.uv = [0, 0]; cube.rotation = [0, 22.5, 0];
    project.model.texture = { width: 32, height: 32 };
    project.texturePlan.rows = project.texturePlan.rows.slice(0, 32).map(row => row.slice(0, 32));
    project.texturePlan.faces[0].uv = Object.fromEntries(FACE_NAMES.map(face => [face, [4, 8, 0, 0]]));
    validateProject(project);
    const path = join(root, "измерение UV.mmeditor.json"), bytes = Buffer.from(JSON.stringify(project)); await writeFile(path, bytes);
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, path);
    const opened = await page.evaluate(() => window.studio.request({ kind: "open" })); assert(opened.ok);
    const inspect = async () => (await page.evaluate(() => window.studio.request({ kind: "inspect" }))).state;
    const initial = await inspect(); assert.deepEqual(initial.project, project);
    await page.getByTestId("mode-texture").click();
    await page.getByTestId("part-" + project.parts[0].id).click();
    await page.locator(".texel-density summary").click();
    await page.getByTestId("density-summary").waitFor();
    assert.match(await page.getByTestId("density-summary").innerText(), /8 из 12/u);
    assert.equal(await page.getByTestId("density-face").count(), 6);
    await page.getByLabel("Плотность пикселей на блок").fill("32");
    await page.waitForFunction(() => document.querySelector('[data-testid="density-summary"]').textContent.includes("12 из 12"));
    await page.getByLabel("Плотность пикселей на блок").fill("0");
    assert.match(await page.locator(".texel-density [role=status]").innerText(), /Введите целые/u);
    await page.getByLabel("Плотность пикселей на блок").fill("16");
    await page.getByLabel("Грань текстуры").selectOption("north");
    assert.match(await page.locator(".uv-fields").getAttribute("title"), /1\.0 × 1\.3/u);
    assert.deepEqual(await inspect(), initial);
    const connected = await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" })); assert(connected.ok && connected.connection.enabled);
    client = new Client({ name: "texel-density-verification", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connected.connection.url), { requestInit: { headers: { Authorization: "Bearer " + connected.connection.token } } }));
    const ref = { projectId: project.projectId, expectedRevision: initial.revision };
    const result = await client.callTool({ name: "studio_uv_inspect", arguments: { ...ref, profile: { pixelsPerBlock: 16, tolerancePercent: 10 }, cubeIds: ["sample"] } });
    assert(!result.isError); const measurement = JSON.parse(result.content[0].text).measurement;
    assert.equal(measurement.summary.faces, 6); assert.equal(measurement.summary.axesOutsideTolerance, 8);
    assert.deepEqual(measurement.faces.find(face => face.face === "north").axes.map(axis => axis.pixelsPerBlock), [16, 64 / 3]);
    assert.equal(measurement.artisticAcceptance, "requires-human-review");
    assert.equal(measurement.profileSource, "caller-supplied-not-ArtSpec-verified");
    for (const args of [{ ...ref, profile: { pixelsPerBlock: 257, tolerancePercent: 10 } },
      { ...ref, expectedRevision: ref.expectedRevision + 1, profile: { pixelsPerBlock: 16, tolerancePercent: 10 } }])
      assert((await client.callTool({ name: "studio_uv_inspect", arguments: args })).isError);
    assert.deepEqual(await inspect(), initial); assert.deepEqual(await readFile(path), bytes);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === "studio://app/index.html").setSize(1120, 760));
    await page.locator(".texture-editor").hover(); await page.mouse.wheel(0, 1500);
    await page.waitForFunction(() => document.querySelector(".texture-editor").scrollTop > 0, undefined, { timeout: 3000 });
    await page.getByTestId("paint-canvas").scrollIntoViewIfNeeded();
    await page.locator(".uv-fields button").scrollIntoViewIfNeeded();
    const controls = await page.evaluate(() => {
      const pane = document.querySelector(".texture-editor"), bounds = pane.getBoundingClientRect();
      const button = document.querySelector(".uv-fields button").getBoundingClientRect();
      return { buttonInsidePane: button.top >= bounds.top && button.bottom <= bounds.bottom + 1,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    assert(controls.buttonInsidePane); assert(!controls.horizontalOverflow);
    const capture = () => application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === "studio://app/index.html").webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
    const controlsPng = await capture(); await writeFile(join(root, "controls.png"), Buffer.from(controlsPng, "base64"));
    await page.locator(".texture-editor").hover(); await page.mouse.wheel(0, -1500);
    await page.waitForFunction(() => document.querySelector(".texture-editor").scrollTop === 0, undefined, { timeout: 3000 });
    const png = await capture();
    await writeFile(join(root, "inspector.png"), Buffer.from(png, "base64"));
    assert.deepEqual(errors, []);
    const report = { status: "PASS", hidden: true, uiProfileInput: true, invalidProfileHint: true, inflatedUvHint: true,
      mcpReadOnlyInspection: true, staleAndBoundsRejected: true, exactProjectAndFileUnchanged: true, measurement,
      compactControlsReachableByScroll: true,
      controlsScreenshotSha256: createHash("sha256").update(Buffer.from(controlsPng, "base64")).digest("hex"),
      screenshotSha256: createHash("sha256").update(Buffer.from(png, "base64")).digest("hex"), artisticApproval: "NOT_PERFORMED", gameIntegration: "NOT_RUN" };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } catch (error) {
    await writeFile(join(root, "failure.json"), JSON.stringify({ error: String(error) }, null, 2) + "\n"); throw error;
  } finally { await client?.close(); await application.close(); }
}
