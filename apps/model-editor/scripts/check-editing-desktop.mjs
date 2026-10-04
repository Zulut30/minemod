/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

export async function checkEditingDesktop(options, output) {
  const root = join(output, "editing");
  await mkdir(root, { recursive: true });
  let application = await electron.launch({
    ...options,
    args: options.args
      .filter((arg) => !arg.startsWith("--editor-data="))
      .concat(`--editor-data=${join(root, "user-data")}`),
  });
  let client;
  try {
    const page = await application.firstWindow();
    await page.getByTestId("part-guard").waitFor();
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    assert(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
      ),
    );
    const path = join(root, "проект после ввода.json");
    await application.evaluate(({ dialog }, path) => {
      globalThis.editingTest = { calls: 0, path };
      dialog.showSaveDialog = async () => {
        globalThis.editingTest.calls++;
        return { canceled: false, filePath: globalThis.editingTest.path };
      };
      dialog.showMessageBox = async () => ({ response: 1 });
    }, path);
    const inspect = async () => {
      const result = await page.evaluate(() =>
        window.studio.request({ kind: "inspect" }),
      );
      assert.equal(result.ok, true);
      assert(Number.isSafeInteger(result.sequence));
      return result;
    };
    const settled = async () => {
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="save-project"]').disabled,
      );
      await page.evaluate(
        () =>
          new Promise((done) =>
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(done),
            ),
          ),
      );
    };
    const initial = await inspect();
    const width = page.getByLabel("Размер X");
    await width.fill("36");
    await width.press("Control+s");
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="status-message"]')
        .textContent.includes("BOUNDS"),
    );
    await settled();
    assert.equal(
      await application.evaluate(() => globalThis.editingTest.calls),
      0,
      "Неверный ввод не открывает сохранение",
    );
    assert.deepEqual((await inspect()).state, initial.state);
    const size = page.getByLabel("Размер Y");
    await size.fill(String(Number(await size.inputValue()) + 0.25));
    await page.getByTestId("save-project").click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="status-message"]').textContent ===
        "Проект сохранён.",
    );
    await settled();
    const saved = await inspect();
    assert.equal(saved.state.revision, 1);
    assert.equal(saved.state.dirty, false);
    assert.equal(
      await application.evaluate(() => globalThis.editingTest.calls),
      1,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")),
      saved.state.project,
    );
    assert.equal(await page.locator(".unsaved").count(), 0);

    // Проверяем Ctrl+S и клик после отказа, не меняя уже сохранённый файл.
    const previousBytes = await readFile(path);
    for (const shortcut of [true, false]) {
      await width.fill("36");
      if (shortcut) await width.press("Control+Shift+s");
      else await page.getByTestId("save-project").click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="status-message"]')
          .textContent.includes("BOUNDS"),
      );
      await settled();
      assert.deepEqual(await readFile(path), previousBytes);
      assert.equal(
        await application.evaluate(() => globalThis.editingTest.calls),
        1,
      );
      assert.equal((await inspect()).state.revision, 1);
    }

    await size.fill(String(Number(await size.inputValue()) + 0.25));
    await size.press("Enter");
    await settled();
    assert.equal((await inspect()).state.dirty, true);
    assert.equal(await page.locator(".unsaved").count(), 1);
    await page.getByTestId("undo").click();
    await settled();
    const restored = await inspect();
    assert.deepEqual(restored.state.project, saved.state.project);
    assert.equal(restored.state.dirty, false);
    assert.equal(await page.locator(".unsaved").count(), 0);
    await page.getByTestId("redo").click();
    await settled();
    assert.equal((await inspect()).state.dirty, true);
    const beforeSave = await inspect();
    const copy = join(root, "копия после ввода.json");
    await application.evaluate((_electron, path) => {
      globalThis.editingTest.path = path;
    }, copy);
    await size.fill(String(Number(await size.inputValue()) + 0.25));
    await page.getByTestId("save-as").click();
    await page.waitForFunction(() =>
      document.body.textContent.includes("копия после ввода.json"),
    );
    await settled();
    const copyState = await inspect();
    assert.equal(copyState.state.revision, beforeSave.state.revision + 1);
    assert.equal(copyState.state.dirty, false);
    assert.deepEqual(
      JSON.parse(await readFile(copy, "utf8")),
      copyState.state.project,
    );
    assert.deepEqual(await readFile(path), previousBytes);

    // Доставляем настоящий более ранний snapshot после сохранения той же ревизии.
    await page.getByTestId("undo").click();
    await settled();
    const late = await inspect();
    assert.equal(late.state.dirty, true);
    await page.getByTestId("save-project").click();
    await settled();
    const lastSaved = await inspect();
    assert(lastSaved.sequence > late.sequence);
    await page.evaluate(() => {
      window.editingEventSeen = false;
      window.studio.onState(() => {
        window.editingEventSeen = true;
      });
    });
    await application.evaluate(
      ({ BrowserWindow }, result) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "studio://app/index.html")
          .webContents.send("studio:state", result),
      {
        ...late,
        note: "УСТАРЕВШЕЕ УВЕДОМЛЕНИЕ",
      },
    );
    await page.waitForFunction(() => window.editingEventSeen);
    await settled();
    assert.equal(await page.locator(".unsaved").count(), 0);
    assert.equal(
      await page.getByTestId("status-message").textContent(),
      "Проект сохранён.",
    );

    // Ввод числового поля не применяется к изменившейся во время ввода сцене.
    const connection = await page.evaluate(() =>
      window.studio.request({ kind: "connection", action: "start" }),
    );
    client = new Client({ name: "studio-editing-regression", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(connection.connection.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${connection.connection.token}` },
        },
      }),
    );
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert(!result.isError, result.content[0]?.text);
      return JSON.parse(result.content[0].text);
    };
    await size.fill(String(Number(await size.inputValue()) + 0.25));
    const beforeAgent = await inspect();
    const proposal = await call("studio_changes_preview", {
      projectId: beforeAgent.state.project.projectId,
      expectedRevision: beforeAgent.state.revision,
      key: randomUUID(),
      commands: [
        {
          type: "transform",
          cubeIds: ["guard_center"],
          translation: [0.125, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    });
    await call("studio_changes_apply", {
      projectId: beforeAgent.state.project.projectId,
      proposalId: proposal.proposalId,
    });
    await page.waitForFunction(
      (revision) =>
        document.querySelector('[data-testid="revision"]').textContent ===
        `r${revision}`,
      beforeAgent.state.revision + 1,
    );
    const beforeStaleSave = await inspect();
    await page.getByTestId("save-project").click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="status-message"]')
        .textContent.includes("STALE_REVISION"),
    );
    await settled();
    assert.deepEqual((await inspect()).state, beforeStaleSave.state);
    assert.deepEqual(
      JSON.parse(await readFile(copy, "utf8")),
      lastSaved.state.project,
    );
    await client.close();
    client = undefined;

    // Старый проект не возвращается в интерфейс после переключения документа.
    const oldProject = await inspect();
    await page.getByTestId("new-project").click();
    await page.locator(".empty-scene").waitFor();
    await page.evaluate(() => {
      window.editingEventSeen = false;
    });
    await application.evaluate(
      ({ BrowserWindow }, result) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "studio://app/index.html")
          .webContents.send("studio:state", result),
      oldProject,
    );
    await page.waitForFunction(() => window.editingEventSeen);
    await settled();
    assert.equal(await page.locator(".empty-scene").count(), 1);
    assert.notEqual(
      (await inspect()).state.project.projectId,
      oldProject.state.project.projectId,
    );
    assert.deepEqual(problems, []);
    await application.close();
    application = await electron.launch({
      ...options,
      args: options.args
        .filter((arg) => !arg.startsWith("--editor-data="))
        .concat(
          `--editor-data=${join(root, "clean-close")}`,
          "--editor-test-close",
        ),
    });
    const cleanPage = await application.firstWindow();
    await cleanPage.getByTestId("part-guard").waitFor();
    await application.evaluate(
      ({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: path,
        });
        dialog.showMessageBox = async () => {
          throw new Error("Чистый документ не должен запрашивать сохранение");
        };
      },
      join(root, "checkpoint.json"),
    );
    await cleanPage.getByTestId("save-project").click();
    await cleanPage.waitForFunction(() => !document.querySelector(".unsaved"));
    const cleanSize = cleanPage.getByLabel("Размер Y");
    await cleanSize.fill(String(Number(await cleanSize.inputValue()) + 0.25));
    await cleanSize.press("Enter");
    await cleanPage.waitForFunction(() => !!document.querySelector(".unsaved"));
    await cleanPage.getByTestId("undo").click();
    await cleanPage.waitForFunction(() => !document.querySelector(".unsaved"));
    const closed = application.waitForEvent("close");
    await application.evaluate(({ app }) => app.quit());
    await closed;
    application = undefined;
    const report = {
      status: "PASS",
      hidden: true,
      checks: [
        "invalid Ctrl+S preserves error and skips save",
        "mouse save commits focused value",
        "invalid Save As preserves files",
        "undo to saved content is clean",
        "redo restores dirty state",
        "mouse Save As commits value and preserves original",
        "late same-revision state ignored",
        "agent update rejects focused stale value and save",
        "late old project ignored",
        "undo to checkpoint closes without a save dialog",
      ],
    };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
    return report;
  } finally {
    await client?.close();
    if (application)
      await application
        .evaluate(({ app }) => app.exit(0))
        .catch(() => undefined);
  }
}
