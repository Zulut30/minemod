/* global window, document */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { cubes, assetRequest } from "@mcdev/editor-core";
import { verifyAssetBundleV1 } from "@mcdev/application";

export async function checkManualDesktop(options, output) {
  const root = join(output, "manual"); await mkdir(root, { recursive: true });
  const path = join(root, "ручной новый предмет.mmeditor.json");
  const launch = { ...options, args: options.args.filter(a => !a.startsWith("--editor-data=") && a !== "--editor-test-close")
    .concat(`--editor-data=${join(root, "user-data")}`) };
  let app = await electron.launch(launch);
  try {
    let page = await app.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const inspect = async () => { const r = await page.evaluate(() => window.studio.request({ kind: "inspect" })); assert(r.ok); return r.state; };
    const settled = () => page.waitForFunction(() => !document.querySelector('[data-testid="save-project"]').disabled);
    await app.evaluate(({ dialog }, { path, root }) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async (_w, options) => ({ canceled: false, filePaths: [options.properties.includes("openDirectory") ? root : path] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, { path, root });
    await page.getByTestId("new-project").click(); await settled();
    const empty = await inspect(); assert.equal(cubes(empty.project).length, 0);
    assert(await page.getByTestId("export-assets").isDisabled());
    await page.getByTestId("add-cube").click(); await settled();
    const added = await inspect(); const id = added.project.parts[0].id;
    await page.getByTestId(`part-${id}`).click();
    await page.getByTestId("part-label").fill("Кожаная деталь"); await page.getByTestId("rename-part").click(); await settled();
    await page.getByLabel("Размер X", { exact: true }).fill("3"); await page.getByLabel("Размер X", { exact: true }).press("Tab"); await settled();
    await page.getByLabel("Положение Y", { exact: true }).fill("9"); await page.getByLabel("Положение Y", { exact: true }).press("Tab"); await settled();
    await page.getByTestId("part-color").fill("#d8aa6f"); await page.getByTestId("apply-color").click(); await settled();
    const edited = await inspect(); assert.equal(edited.project.parts[0].label, "Кожаная деталь");
    assert.equal(cubes(edited.project)[0].size[0], 3); assert.equal(cubes(edited.project)[0].origin[1], 9);
    assert.notDeepEqual(edited.project.texturePlan.palette, added.project.texturePlan.palette);
    await page.getByTestId("save-as").click(); await settled();
    const savedBytes = await readFile(path); assert.deepEqual(JSON.parse(savedBytes.toString("utf8")), edited.project);
    assert(!(await inspect()).dirty);
    await page.getByTestId("new-project").click(); await settled();
    assert.notEqual((await inspect()).project.projectId, edited.project.projectId);
    await page.getByTestId("open-project").click(); await settled();
    assert.deepEqual((await inspect()).project, edited.project); assert(!(await inspect()).dirty);
    await page.getByTestId("export-assets").click(); await settled();
    await page.waitForFunction(() => document.querySelector('[data-testid="status-message"]')?.textContent?.startsWith("Экспортировано"));
    const directory = (await readdir(root)).find(name => name.startsWith("item-")); assert(directory);
    const exported = join(root, directory), bundle = verifyAssetBundleV1(JSON.parse(await readFile(join(exported, "asset-bundle.v1.json"), "utf8")));
    assert.equal(bundle.files.length, 4);
    const files = [];
    for (const file of bundle.files) {
      const bytes = await readFile(join(exported, file.path)), descriptor = bundle.manifest.files.find(f => f.path === file.path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      assert.equal(bytes.length, descriptor.bytes); assert.equal(sha256, descriptor.sha256);
      assert(bytes.equals(Buffer.from(file.content, file.encoding))); files.push({ path: file.path, bytes: bytes.length, sha256 });
    }
    const source = bundle.files.find(f => f.path === bundle.manifest.assets[0].source); assert(source);
    assert.deepEqual(JSON.parse(source.content), assetRequest(edited.project));
    const hidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible())); assert(hidden);
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
    await writeFile(join(root, "manual-export.png"), Buffer.from(png, "base64"));
    await app.close(); app = await electron.launch(launch); page = await app.firstWindow();
    await page.getByTestId(`part-${id}`).waitFor(); assert.deepEqual((await inspect()).project, edited.project);
    assert((await readFile(path)).equals(savedBytes));
    const report = { status: "PASS", hidden, projectId: edited.project.projectId, startedEmpty: true,
      savedFile: { bytes: savedBytes.length, sha256: createHash("sha256").update(savedBytes).digest("hex") },
      manifestSha256: bundle.manifestSha256, files,
      mutationPath: "UI controls only; inspect reads state, native dialog mocks provide paths only",
      checks: ["new empty project", "add/name/geometry/color from UI", "Cyrillic Save As exact bytes", "saved clean state",
        "switch to another empty document", "reopen exact original", "GUI export actual bundle/files/source integrity", "restart restores authored document and original file"] };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await app.close(); }
}
