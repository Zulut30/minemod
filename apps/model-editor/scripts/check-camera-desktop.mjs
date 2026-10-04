/* global window, document, Image */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VIEWS } from "../shared/bridge.ts";

export async function checkCameraDesktop(options, output) {
  const root = join(output, "camera"); await mkdir(root, { recursive: true });
  const application = await electron.launch({ ...options, args: options.args.filter((v) => !v.startsWith("--editor-data="))
    .concat(`--editor-data=${join(root, "user-data")}`) });
  let client;
  try {
    const page = await application.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const problems = []; page.on("pageerror", (e) => problems.push(e.message));
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())));
    const inspect = async () => (await page.evaluate(() => window.studio.request({ kind: "inspect" }))).state;
    const canvas = page.locator('[data-testid="viewport"] canvas');
    const camera = async () => JSON.parse(await canvas.getAttribute("data-camera"));
    const settled = async (view) => page.waitForFunction((view) => {
      const data = document.querySelector('[data-testid="viewport"] canvas')?.dataset.camera;
      return data && JSON.parse(data).view === view;
    }, view);
    const apply = async (commands) => {
      const state = await inspect(), result = await page.evaluate((mutation) => window.studio.request({ kind: "apply", mutation }),
        { projectId: state.project.projectId, expectedRevision: state.revision, key: randomUUID(), commands });
      assert(result.ok); return result.state;
    };
    await page.getByTestId("view-front").click(); await settled("front");
    const firstCamera = await camera(), initial = await inspect();
    const rect = await canvas.boundingBox(); assert(rect);
    // CDP события только в собственном скрытом окне; системный курсор не используется.
    await page.mouse.move(rect.x + 20, rect.y + 30); await page.mouse.down();
    await page.mouse.move(rect.x + 70, rect.y + 55, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction((before) => document.querySelector('[data-testid="viewport"] canvas').dataset.camera !== before, JSON.stringify(firstCamera));
    const orbit = await camera(); assert.notDeepEqual(orbit.position, firstCamera.position);
    await page.mouse.move(rect.x + 20, rect.y + 30); await page.mouse.down({ button: "right" });
    await page.mouse.move(rect.x + 50, rect.y + 45, { steps: 5 }); await page.mouse.up({ button: "right" });
    const manualCamera = await camera(); assert.notDeepEqual(manualCamera.target, orbit.target);
    assert.deepEqual(await inspect(), initial);
    const connection = await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" }));
    client = new Client({ name: "camera-acceptance", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),
      { requestInit: { headers: { Authorization: `Bearer ${connection.connection.token}` } } }));
    const capture = async (view, extra = {}, label = view) => {
      const state = await inspect(), result = await client.callTool({ name: "studio_view_capture",
        arguments: { projectId: state.project.projectId, expectedRevision: state.revision, view, ...extra } });
      assert(!result.isError); const block = result.content.find((c) => c.type === "image"); assert(block);
      const png = Buffer.from(block.data, "base64");
      assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 768);
      await writeFile(join(root, `${label}.png`), png);
      const pixels = await page.evaluate(async (data) => {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const bitmap = document.createElement("canvas"); bitmap.width = image.naturalWidth; bitmap.height = image.naturalHeight;
        const context = bitmap.getContext("2d"); context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data, colors = new Set();
        let bright = 0;
        for (let y = 64; y < 704; y++) for (let x = 64; x < 960; x++) {
          const i = (y * bitmap.width + x) * 4;
          if (rgba[i + 3] > 240 && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 90) {
            bright++; colors.add(`${rgba[i] >> 4},${rgba[i + 1] >> 4},${rgba[i + 2] >> 4}`);
          }
        }
        return { bright, colors: colors.size };
      }, block.data);
      assert(pixels.bright > 50 && pixels.colors > 2, `${view} must contain actual textured geometry.`);
      const metadata = await application.evaluate(async ({ BrowserWindow }) => {
        const captureWindow = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("?capture=1"));
        return JSON.parse(await captureWindow.webContents.executeJavaScript("document.querySelector('canvas').dataset.camera"));
      });
      return { view, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), pixels, camera: metadata };
    };
    const images = [];
    for (const view of VIEWS) {
      images.push(await capture(view));
      assert.deepEqual(await camera(), manualCamera, "Capture must preserve actual orbit/pan/zoom.");
      assert.deepEqual(await inspect(), initial);
    }
    assert.equal(new Set(images.map((i) => i.camera.zoom)).size, 1);
    assert.equal(new Set(images.map((i) => JSON.stringify(i.camera.target))).size, 1);
    assert.equal(images.find((i) => i.view === "side").sha256, images.find((i) => i.view === "right").sha256);
    await page.getByTestId("fit-model").click();
    await page.waitForFunction((target) => JSON.stringify(JSON.parse(document.querySelector('[data-testid="viewport"] canvas').dataset.camera).target) === JSON.stringify(target), firstCamera.target);
    assert.deepEqual(await camera(), firstCamera);
    for (const view of ["top", "bottom", "left", "right", "rear-perspective"]) {
      await page.getByLabel("Дополнительный ракурс").selectOption(view); await settled(view);
      assert.equal(await page.getByLabel("Дополнительный ракурс").inputValue(), view);
      const data = await camera();
      if (view === "top") assert.deepEqual(data.up, [0, 0, -1]);
      if (view === "bottom") assert.deepEqual(data.up, [0, 0, 1]);
    }
    const variantId = randomUUID();
    await apply([{ type: "checkpoint", variantId, label: "Camera source", note: "Equal-scale comparison" }]);
    const guard = initial.project.parts.find((p) => p.id === "guard").cubeIds;
    await apply([{ type: "transform", cubeIds: guard, translation: [3, 0, 0], scale: [1.5, 1, 1] }]);
    const compared = [];
    for (const view of ["front", "top", "rear-perspective"]) {
      const source = await capture(view, { variantId }, `source-${view}`);
      const working = await capture(view, { compareToVariantId: variantId }, `working-${view}`);
      assert.deepEqual(source.camera, working.camera, "Both source and candidate must use the same actual camera.");
      assert.notEqual(source.sha256, working.sha256, "Camera comparison must still show the changed geometry.");
      compared.push({ view, sourceSha256: source.sha256, workingSha256: working.sha256, camera: source.camera });
    }
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === "studio://app/index.html").setSize(1120, 760));
    await page.getByTestId("view-front").click(); await settled("front");
    assert(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth));
    assert.deepEqual(problems, []);
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())));
    const report = { status: "PASS", hidden: true, actualOrbitPanPreserved: true, fitRestoresCamera: true,
      publicCapturePresets: VIEWS.length, eightViewsPlusLegacyAlias: true, modelPixelsVerified: true, images,
      sharedZoomAndTarget: true, sameActualComparisonCamera: true, compared, compactToolbar: true };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await client?.close(); await application.close(); }
}
