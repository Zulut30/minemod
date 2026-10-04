/* global window, structuredClone */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";

export async function checkMigrationsDesktop(options, output) {
  const root = join(output, "migrations");
  await mkdir(root, { recursive: true });
  const source = await readFile(new URL("../../../fixtures/editor-projects/v1-painted-variants.mmeditor.json", import.meta.url), "utf8");
  const sourceBytes = Buffer.from(source.replaceAll("\n", "\r\n"));
  const legacy = JSON.parse(source), expected = structuredClone(legacy);
  expected.schemaVersion = 2;
  for (const variant of expected.design.variants) variant.project.schemaVersion = 2;
  const future = JSON.stringify({ ...expected, schemaVersion: 99 });
  let application;
  const inspect = (page) => page.evaluate(() => window.studio.request({ kind: "inspect" }));
  const request = (page, args) => page.evaluate((value) => window.studio.request(value), args);
  const change = async (page, state, text) => {
    const result = await request(page, { kind: "apply", mutation: { projectId: state.project.projectId,
      expectedRevision: state.revision, key: randomUUID(), commands: [{ type: "brief", text }] } });
    assert.equal(result.ok, true); return result;
  };
  const start = async (name, primary, backup) => {
    const data = join(root, name);
    await mkdir(data, { recursive: true });
    const recovery = join(data, "recovery.mmeditor.json");
    if (primary !== undefined) await writeFile(recovery, primary);
    if (backup !== undefined) await writeFile(recovery + ".bak", backup);
    application = await electron.launch({ ...options, args: options.args
      .filter((arg) => !arg.startsWith("--editor-data=")) .concat(`--editor-data=${data}`) });
    const page = await application.firstWindow();
    await page.getByTestId("part-guard").waitFor();
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())));
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    return { page, recovery };
  };
  const stop = async () => { await application.close(); application = undefined; };
  try {
    const { page, recovery } = await start("legacy", sourceBytes);
    const loaded = await inspect(page);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.state.project, expected);
    assert.match(await page.getByTestId("status-message").textContent(), /Миграция в v2/u);
    assert.deepEqual(await readFile(recovery), sourceBytes, "Startup must not write legacy source.");
    const changed = await change(page, loaded.state, "Первая правка после миграции");
    const hash = createHash("sha256").update(sourceBytes).digest("hex");
    const original = `${recovery}.v1-${hash}.original.json`;
    assert.deepEqual(await readFile(original), sourceBytes);
    assert.deepEqual(await readFile(recovery + ".bak"), sourceBytes);
    assert.deepEqual(JSON.parse(await readFile(recovery, "utf8")), changed.state.project);
    const changedAgain = await change(page, changed.state, "Вторая правка после миграции");
    assert.deepEqual(changedAgain.state.project.texturePlan, expected.texturePlan);
    assert.deepEqual(changedAgain.state.project.design.variants, expected.design.variants);
    assert.deepEqual(await readFile(original), sourceBytes);

    const manual = join(root, "legacy-manual.json"); await writeFile(manual, sourceBytes);
    await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, manual);
    const opened = await request(page, { kind: "open" });
    assert.equal(opened.ok, true); assert.deepEqual(opened.state.project, expected); assert.match(opened.note, /v1.*v2/u);
    assert.deepEqual(await readFile(manual), sourceBytes);
    const saved = await request(page, { kind: "save" });
    assert.equal(saved.ok, true); assert.equal(JSON.parse(await readFile(manual, "utf8")).schemaVersion, 2);
    assert.deepEqual(await readFile(`${manual}.v1-${hash}.original.json`), sourceBytes);

    const futureFile = join(root, "future-manual.json"); await writeFile(futureFile, future);
    await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, futureFile);
    const before = await inspect(page), rejected = await request(page, { kind: "open" });
    assert.equal(rejected.error.code, "UNSUPPORTED_PROJECT_VERSION");
    assert.deepEqual((await inspect(page)).state, before.state);
    assert.equal(await readFile(futureFile, "utf8"), future);
    await application.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, futureFile);
    const rejectedSave = await request(page, { kind: "saveAs" });
    assert.equal(rejectedSave.error.code, "UNSUPPORTED_PROJECT_VERSION");
    assert.equal(await readFile(futureFile, "utf8"), future);
    await stop();

    const futureVariant = structuredClone(legacy); futureVariant.design.variants[0].project.schemaVersion = 99;
    const scenarios = [
      ["future-primary", future, source],
      ["future-backup-only", undefined, future],
      ["future-backup", JSON.stringify(expected), future],
      ["future-variant", JSON.stringify(futureVariant), source],
    ];
    for (const [name, primary, backup] of scenarios) {
      const active = await start(name, primary, backup), state = await inspect(active.page);
      assert.equal(state.ok, true);
      if (name !== "future-backup") {
        assert.match(state.warning, /Автосохранение остановлено/u);
        assert.notEqual(state.state.project.projectId, legacy.projectId, "Future primary cannot silently fall back to older backup.");
      }
      const updated = await change(active.page, state.state, "Проверка защиты неподдерживаемого проекта");
      assert.match(updated.warning, /Автосохранение остановлено/u);
      await active.page.getByTestId("status-message").filter({ hasText: "Автосохранение остановлено" }).waitFor();
      if (primary !== undefined) assert.equal(await readFile(active.recovery, "utf8"), primary);
      else await assert.rejects(readFile(active.recovery), { code: "ENOENT" });
      assert.equal(await readFile(active.recovery + ".bak", "utf8"), backup);
      await stop();
    }
    const report = { status: "PASS", hidden: true, sourceVersion: 1, targetVersion: 2,
      originalSourceSha256: hash, originalSourceBytes: sourceBytes.length,
      checks: ["real v1 recovery keeps IDs/pixels/UV/variants", "startup read leaves source bytes intact",
        "autosave keeps permanent exact original and rotating backup", "manual open/save migration",
        "future open/save refuse without changing file or active project", "future primary bypasses old fallback",
        "future backup-only blocks autosave", "future backup with current primary blocks autosave",
        "future variant blocks autosave", "persistent visible recovery warning"] };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
}
