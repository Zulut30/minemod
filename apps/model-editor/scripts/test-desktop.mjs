/* global window, document */
import { _electron as electron } from "playwright";
import electronPath from "electron";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import process from "node:process";
import console from "node:console";
import { checkMcpDesktop } from "./check-mcp-desktop.mjs";
import { checkTextureDesktop } from "./check-texture-desktop.mjs";
import { checkPolishDesktop } from "./check-polish-desktop.mjs";
import { checkEditingDesktop } from "./check-editing-desktop.mjs";
import { checkVariantsDesktop } from "./check-variants-desktop.mjs";
import { checkReviewDesktop } from "./check-review-desktop.mjs";
import { packagedPath } from "./packaged-path.mjs";
import { verifyAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";
import { checkMigrationsDesktop } from "./check-migrations-desktop.mjs";
import { checkHistoryDesktop } from "./check-history-desktop.mjs";
import { checkGeometryDesktop } from "./check-geometry-desktop.mjs";
import { checkCameraDesktop } from "./check-camera-desktop.mjs";
import { checkDiscoveryDesktop } from "./check-discovery-desktop.mjs";
import { checkBriefDesktop } from "./check-brief-desktop.mjs";
import { checkPartsDesktop } from "./check-parts-desktop.mjs";
import { checkManualDesktop } from "./check-manual-desktop.mjs";
import { checkAccessibilityDesktop } from "./check-accessibility-desktop.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  repo = resolve(appDir, "../..");
const packaged = process.argv.includes("--packaged");
const output = join(
  repo,
  "output/playwright",
  `studio-${packaged ? "packaged" : "development"}-${randomUUID().slice(0, 8)}`,
);
await mkdir(output, { recursive: true });
const data = join(output, "user-data"),
  savePath = join(output, "меч с пробелами.mmeditor.json");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      key !== "ELECTRON_RUN_AS_NODE" && typeof value === "string",
  ),
);
const options = {
  executablePath: packaged ? await packagedPath(repo, appDir) : electronPath,
  args: [
    ...(packaged ? [] : [appDir]),
    "--editor-hidden",
    `--editor-data=${data}`,
  ],
  env,
  timeout: 45_000,
};
const problems = [],
  stderr = [];
let application;
async function inspect(page) {
  return page.evaluate(async () => {
    const result = await window.studio.request({ kind: "inspect" });
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  });
}
async function revision(page, value) {
  await page.waitForFunction(
    (wanted) =>
      document.querySelector('[data-testid="revision"]')?.textContent ===
      `r${wanted}`,
    value,
  );
}
async function capture(name, rectangle = null) {
  const rect = rectangle
    ? Object.fromEntries(
        Object.entries(rectangle).map(([key, value]) => [
          key,
          Math.round(value),
        ]),
      )
    : null;
  const png = await application.evaluate(async ({ BrowserWindow }, rect) => {
    const image = await BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === "studio://app/index.html")
      .webContents.capturePage(rect ?? undefined, {
        stayHidden: true,
        stayAwake: true,
      });
    return image.toPNG().toString("base64");
  }, rect);
  await writeFile(join(output, name), Buffer.from(png, "base64"));
}
try {
  application = await electron.launch(options);
  application.process().stderr.on("data", (b) => stderr.push(String(b)));
  const page = await application.firstWindow();
  page.on("pageerror", (error) => problems.push(error.message));
  await page.getByTestId("part-guard").waitFor({ timeout: 30_000 });
  await page.locator("canvas[data-ready='true']").waitFor();
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
    "Tests must never show desktop windows",
  );
  await page.waitForTimeout(200);
  await capture("01-studio.png");
  const before = await inspect(page);
  assert.equal(before.project.model.bones.flatMap((b) => b.cubes).length, 52);
  const security = await application.evaluate(({ BrowserWindow }) => {
    const preferences =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
    };
  });
  assert.deepEqual(security, {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  await application.evaluate(
    ({ dialog }, paths) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: paths.savePath,
      });
      dialog.showOpenDialog = async (_window, options) => ({
        canceled: false,
        filePaths: [
          options.properties.includes("openDirectory")
            ? paths.output
            : paths.savePath,
        ],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    },
    { savePath, output },
  );
  const viewportSize = await page.getByTestId("viewport").boundingBox();
  await page.getByTestId("viewport").click({
    position: { x: viewportSize.width / 2, y: viewportSize.height * 0.4 },
  });
  assert.match(
    await page.locator(".selection-heading strong").textContent(),
    /^(blade_|tip_)/u,
    "Picking must select actual model geometry",
  );
  await page.getByTestId("part-guard").click();
  const sizeInput = page.getByLabel("Размер X");
  const initialWidth = Number(await sizeInput.inputValue());
  await sizeInput.fill(String(initialWidth + 0.5));
  await sizeInput.press("Tab");
  await revision(page, 1);
  const resized = await inspect(page);
  assert.notDeepEqual(resized.project.model, before.project.model);
  assert.deepEqual(resized.project.texturePlan, before.project.texturePlan);
  await sizeInput.fill("36");
  await sizeInput.press("Tab");
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="status-message"]')
      ?.textContent?.includes("BOUNDS"),
  );
  assert.deepEqual(
    await inspect(page),
    resized,
    "An invalid inspector value must not change document or revision",
  );
  assert.equal(Number(await sizeInput.inputValue()), initialWidth + 0.5);
  await page
    .getByRole("button", { name: "Выбрать #aa8ccd", exact: true })
    .click();
  await page.getByTestId("apply-color").click();
  await revision(page, 2);
  let painted = await inspect(page);
  assert.notDeepEqual(
    painted.project.texturePlan.rows,
    resized.project.texturePlan.rows,
  );
  await page.getByTestId("undo").click();
  await revision(page, 3);
  assert.deepEqual((await inspect(page)).project, resized.project);
  await page.getByTestId("redo").click();
  await revision(page, 4);
  assert.deepEqual((await inspect(page)).project, painted.project);
  for (const view of ["front", "back", "side"]) {
    await page.getByTestId(`view-${view}`).click();
    await page.waitForTimeout(100);
    await capture(
      `view-${view}.png`,
      await page.getByTestId("viewport").boundingBox(),
    );
  }
  await page.getByTestId("view-perspective").click();
  await page.waitForTimeout(100);
  await capture("02-edited.png");
  const texture = await checkTextureDesktop(page, inspect, capture);
  painted = texture.state;
  const windowSize = await application.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === "studio://app/index.html",
    );
    const size = w.getSize();
    w.setSize(1120, 760);
    return size;
  });
  await page.getByTestId("mode-texture").click();
  await page.getByLabel("Грань текстуры").selectOption("north");
  await page.getByTestId("move-uv").scrollIntoViewIfNeeded();
  const compact = await page.evaluate(() => {
    const panel = document.querySelector(".viewport-panel"),
      r = panel.getBoundingClientRect(),
      button = document
        .querySelector('[data-testid="move-uv"]')
        .getBoundingClientRect(),
      atlas = document.querySelector(".texture-scroll").getBoundingClientRect();
    const view = document
      .querySelector('[data-testid="viewport"]')
      .getBoundingClientRect();
    return {
      uvAccessible:
        button.top >= r.top &&
        button.bottom <= r.bottom &&
        button.right <= r.right,
      atlasHeight: atlas.height,
      bodyOverflow: document.body.scrollHeight > window.innerHeight,
      visible3dHeight: Math.max(
        0,
        Math.min(view.bottom, r.bottom) - Math.max(view.top, r.top),
      ),
    };
  });
  assert.equal(compact.uvAccessible, true);
  assert(compact.atlasHeight >= 100);
  assert.equal(compact.bodyOverflow, false);
  assert(
    compact.visible3dHeight >= 150,
    "Компактное окно должно показывать 3D одновременно с атласом и UV",
  );
  await capture("07-compact.png");
  await application.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === "studio://app/index.html")
        .setSize(...size),
    windowSize,
  );
  await page.getByTestId("mode-model").click();
  texture.report.compactWindow = compact;
  await page.getByTestId("save-project").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="status-message"]')?.textContent ===
      "Проект сохранён.",
  );
  assert.deepEqual(
    JSON.parse(await readFile(savePath, "utf8")),
    painted.project,
  );
  await page.getByTestId("new-project").click();
  await page.locator(".empty-scene").waitFor();
  assert.equal((await inspect(page)).project.parts.length, 0);
  await page.getByTestId("add-cube").click();
  await revision(page, 1);
  const added = await inspect(page);
  assert.equal(added.project.model.bones[0].cubes.length, 1);
  await page.getByTestId(`part-${added.project.parts[0].id}`).click();
  await page.waitForTimeout(100);
  await capture("03-new-model.png");
  await page.getByTestId("open-project").click();
  await page.waitForFunction(
    (wanted) =>
      document.querySelector(".document-bar strong")?.textContent === wanted,
    painted.project.model.name,
  );
  assert.deepEqual((await inspect(page)).project, painted.project);
  await page.getByTestId("export-assets").click();
  await page.waitForFunction(() => {
    const status = document.querySelector(
      '[data-testid="status-message"]',
    )?.textContent;
    if (status?.includes("SERVICE_ERROR")) throw new Error(status);
    return status?.startsWith("Экспортировано");
  });
  const bundleDir = (await readdir(output)).find((name) =>
    name.startsWith("item-"),
  );
  assert(bundleDir);
  const bundle = JSON.parse(
    await readFile(join(output, bundleDir, "bundle.json"), "utf8"),
  );
  assert.equal(bundle.files.length, 3);
  const versionedBundle = verifyAssetBundleV1(JSON.parse(
    await readFile(join(output, bundleDir, "asset-bundle.v1.json"), "utf8"),
  ));
  assert.equal(versionedBundle.files.length, 4);
  for (const file of versionedBundle.files) {
    const bytes = await readFile(join(output, bundleDir, file.path));
    const descriptor = versionedBundle.manifest.files.find((d) => d.path === file.path);
    assert.equal(bytes.length, descriptor.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256);
    assert.deepEqual(bytes, Buffer.from(file.content, file.encoding));
  }
  const exportedSource = JSON.parse(versionedBundle.files[3].content);
  assert.deepEqual(exportedSource.model, painted.project.model);
  assert.deepEqual(exportedSource.texturePlan, painted.project.texturePlan);
  for (const file of bundle.files)
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(output, bundleDir, file.path)))
        .digest("hex"),
      file.sha256,
    );
  const textureFile = bundle.files.find((f) => f.path.endsWith(".png"));
  const texturePng = await readFile(join(output, bundleDir, textureFile.path));
  const width = texturePng.readUInt32BE(16),
    height = texturePng.readUInt32BE(20),
    chunks = [];
  assert.equal(width, painted.project.model.texture.width);
  assert.equal(height, painted.project.model.texture.height);
  for (let offset = 8; offset < texturePng.length; ) {
    const n = texturePng.readUInt32BE(offset);
    if (texturePng.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(texturePng.subarray(offset + 8, offset + 8 + n));
    offset += n + 12;
  }
  const rgba = inflateSync(Buffer.concat(chunks)),
    palette = new Map(
      painted.project.texturePlan.palette.map((c) => [
        c.symbol,
        [1, 3, 5]
          .map((i) => Number.parseInt(c.color.slice(i, i + 2), 16))
          .concat(255),
      ]),
    );
  for (let y = 0; y < height; y++) {
    assert.equal(rgba[y * (width * 4 + 1)], 0);
    for (let x = 0; x < width; x++) {
      const start = y * (width * 4 + 1) + 1 + x * 4;
      assert.deepEqual(
        [...rgba.subarray(start, start + 4)],
        palette.get(painted.project.texturePlan.rows[y][x]) ?? [0, 0, 0, 0],
      );
    }
  }
  assert.deepEqual(
    JSON.parse(
      await readFile(join(output, bundleDir, "source.mmeditor.json"), "utf8"),
    ),
    painted.project,
  );
  const rejected = await page.evaluate(() =>
    window.studio.request({ kind: "inspect", shell: "whoami" }),
  );
  assert.equal(rejected.ok, false);
  const rendered = await page
    .locator("canvas[data-ready='true']")
    .evaluate((canvas) => canvas.toDataURL());
  assert(
    Buffer.from(rendered.split(",")[1], "base64").length > 5000,
    "A real GPU render must contain image data",
  );
  const mcp = await checkMcpDesktop(application, page, output);
  await application.close();
  application = undefined;
  application = await electron.launch(options);
  const restarted = await application.firstWindow();
  await restarted.getByTestId("part-guard").waitFor();
  assert.deepEqual((await inspect(restarted)).project, painted.project);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  assert.deepEqual(problems, []);
  await application.close();
  application = undefined;
  const polish = await checkPolishDesktop(options, output);
  const editing = await checkEditingDesktop(options, output);
  const variants = await checkVariantsDesktop(options, output);
  const brief = await checkBriefDesktop(options, output);
  const parts = await checkPartsDesktop(options, output);
  const manual = await checkManualDesktop(options, output);
  const accessibility = await checkAccessibilityDesktop(options, output);
  const review = await checkReviewDesktop(options, output);
  const migrations = await checkMigrationsDesktop(options, output);
  const history = await checkHistoryDesktop(options, output);
  const geometry = await checkGeometryDesktop(options, output);
  const camera = await checkCameraDesktop(options, output);
  const discovery = await checkDiscoveryDesktop(options, output);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        status: "PASS",
        packaged,
        executablePath: options.executablePath,
        hidden: true,
        security,
        mcp,
        texture: texture.report,
        polish,
        editing,
        variants,
        brief,
        parts,
        manual,
        accessibility,
        review,
        migrations,
        history,
        geometry,
        camera,
        discovery,
        checks: [
          "real texture render",
          "resize",
          "part recolor",
          "undo/redo",
          "Cyrillic save",
          "new project",
          "add cube",
          "reopen",
          "export hashes",
          "asset bundle v1 manifest/source/runtime integrity",
          "decoded exported RGBA",
          "compact window controls",
          "IPC bounds",
          "restart recovery",
        ],
        screenshots: [
          "01-studio.png",
          "02-edited.png",
          "03-new-model.png",
          "04-connected.png",
          "05-paint-draft.png",
          "06-pixel-workshop.png",
          "07-compact.png",
        ],
        stderr,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", packaged, output }, null, 2));
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ error: String(error), problems, stderr }, null, 2),
  );
  if (application) {
    try {
      await capture("failure.png");
    } catch {
      /* Renderer may have failed to start. */
    }
  }
  throw error;
} finally {
  if (application) await application.close();
}
