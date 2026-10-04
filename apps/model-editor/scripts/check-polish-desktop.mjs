/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

// Реальные регрессии файловых диалогов и выхода проверяются в скрытом Electron.
export async function checkPolishDesktop(options, output) {
  const root = join(output, "polish");
  await mkdir(root, { recursive: true });
  let application;
  let client;
  const start = async (name, guardClose = false) => {
    const data = join(root, name);
    await mkdir(data, { recursive: true });
    application = await electron.launch({
      ...options,
      args: options.args
        .filter((arg) => !arg.startsWith("--editor-data="))
        .concat(
          `--editor-data=${data}`,
          ...(guardClose ? ["--editor-test-close"] : []),
        ),
    });
    const page = await application.firstWindow();
    await page.getByTestId("part-guard").waitFor();
    assert(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
      ),
    );
    return { page, data };
  };
  const inspect = async (page) => {
    const result = await page.evaluate(() =>
      window.studio.request({ kind: "inspect" }),
    );
    assert.equal(
      result.ok,
      true,
      "Отмена выхода должна оставлять сервис работоспособным",
    );
    return result.state;
  };
  const stop = async () => {
    await application.close();
    application = undefined;
  };
  try {
    const { page } = await start("close", true);
    const savedPath = join(root, "сохранение при выходе.json");
    await application.evaluate(({ dialog }, path) => {
      globalThis.studioTest = {
        mode: 2,
        cancelSave: false,
        messages: 0,
        opens: 0,
        path,
      };
      dialog.showMessageBox = async () => {
        const test = globalThis.studioTest;
        test.messages++;
        return test.mode === -1
          ? new Promise((done) => {
              test.resolveMessage = (response) => done({ response });
            })
          : { response: test.mode };
      };
      dialog.showSaveDialog = async () => ({
        canceled: globalThis.studioTest.cancelSave,
        filePath: globalThis.studioTest.path,
      });
      dialog.showOpenDialog = async () => {
        globalThis.studioTest.opens++;
        return new Promise((done) => {
          globalThis.studioTest.resolveOpen = (path) =>
            done({ canceled: false, filePaths: [path] });
        });
      };
    }, savedPath);
    await application.evaluate(({ app }) => app.quit());
    await application.evaluate(async () => {
      while (globalThis.studioTest.messages !== 1)
        await new Promise((done) => globalThis.setTimeout(done, 10));
    });
    const initial = await inspect(page);
    await application.evaluate(({ app }) => {
      globalThis.studioTest.mode = 0;
      globalThis.studioTest.cancelSave = true;
      app.quit();
    });
    await application.evaluate(async () => {
      while (globalThis.studioTest.messages !== 2)
        await new Promise((done) => globalThis.setTimeout(done, 10));
    });
    assert.deepEqual(await inspect(page), initial);
    await application.evaluate(({ BrowserWindow }) => {
      globalThis.studioTest.mode = -1;
      const w = BrowserWindow.getAllWindows()[0];
      w.close();
      w.close();
      w.close();
    });
    await application.evaluate(async () => {
      while (!globalThis.studioTest.resolveMessage)
        await new Promise((done) => globalThis.setTimeout(done, 10));
      if (globalThis.studioTest.messages !== 3)
        throw new Error("Повторное закрытие создало лишний диалог");
      globalThis.studioTest.resolveMessage(2);
      delete globalThis.studioTest.resolveMessage;
    });
    assert.deepEqual(await inspect(page), initial);

    const connection = await page.evaluate(() =>
      window.studio.request({ kind: "connection", action: "start" }),
    );
    client = new Client({ name: "studio-polish-regression", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(connection.connection.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${connection.connection.token}` },
        },
      }),
    );
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      assert.equal(response.isError, undefined, response.content[0]?.text);
      return JSON.parse(response.content[0].text);
    };
    const agentEdit = async () => {
      const state = await inspect(page);
      const preview = await call("studio_changes_preview", {
        projectId: state.project.projectId,
        expectedRevision: state.revision,
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
        projectId: state.project.projectId,
        proposalId: preview.proposalId,
      });
    };
    // MCP может изменить документ, пока очередь файлового диалога ожидает человека.
    await application.evaluate(({ app }) => app.quit());
    await application.evaluate(async () => {
      while (!globalThis.studioTest.resolveMessage)
        await new Promise((done) => globalThis.setTimeout(done, 10));
    });
    // inspect идёт через hostQueue, поэтому читаем базу через MCP внутри agentEdit.
    const base = await call("studio_project_inspect");
    const proposal = await call("studio_changes_preview", {
      projectId: base.project.projectId,
      expectedRevision: base.revision,
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
      projectId: base.project.projectId,
      proposalId: proposal.proposalId,
    });
    await application.evaluate(() => {
      globalThis.studioTest.resolveMessage(1);
      delete globalThis.studioTest.resolveMessage;
      globalThis.studioTest.mode = 1;
    });
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="status-message"]')
        .textContent.includes("STALE_REVISION"),
    );
    assert.equal((await inspect(page)).revision, 1);

    // Пустое поле не переносит геометрию в нулевую координату.
    const position = page.getByLabel("Положение X");
    await position.fill("");
    await position.press("Tab");
    assert.equal((await inspect(page)).revision, 1);
    // Сохраняется именно завершённый ввод, даже когда Ctrl+S нажат внутри поля.
    const size = page.getByLabel("Размер Y");
    await size.fill(String(Number(await size.inputValue()) + 0.25));
    await application.evaluate(() => {
      globalThis.studioTest.cancelSave = false;
    });
    await size.press("Control+s");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="status-message"]').textContent ===
        "Проект сохранён.",
    );
    const saved = await inspect(page);
    assert.equal(saved.revision, 2);
    assert.equal(saved.savedRevision, saved.revision);
    assert.deepEqual(
      JSON.parse(await readFile(savedPath, "utf8")),
      saved.project,
    );
    const copyPath = join(root, "другая копия.json");
    await application.evaluate((_electron, path) => {
      globalThis.studioTest.path = path;
    }, copyPath);
    await position.focus();
    await position.press("Control+Shift+s");
    await page.waitForFunction(() =>
      document.body.textContent.includes("другая копия.json"),
    );
    assert.deepEqual(
      JSON.parse(await readFile(copyPath, "utf8")),
      saved.project,
    );
    assert.deepEqual(
      JSON.parse(await readFile(savedPath, "utf8")),
      saved.project,
    );
    await agentEdit();
    const selectionBefore = await call("studio_selection_get");
    const corrupted = join(root, "повреждённый проект.json");
    await writeFile(corrupted, "{broken");
    await page.evaluate(() => {
      window.polishRequest = window.studio.request({ kind: "open" });
    });
    await application.evaluate(async () => {
      while (!globalThis.studioTest.resolveOpen)
        await new Promise((done) => globalThis.setTimeout(done, 10));
    });
    const openBase = await call("studio_project_inspect");
    const openProposal = await call("studio_changes_preview", {
      projectId: openBase.project.projectId,
      expectedRevision: openBase.revision,
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
      projectId: openBase.project.projectId,
      proposalId: openProposal.proposalId,
    });
    await application.evaluate((_electron, path) => {
      globalThis.studioTest.resolveOpen(path);
      delete globalThis.studioTest.resolveOpen;
    }, savedPath);
    const staleOpen = await page.evaluate(() => window.polishRequest);
    assert.equal(staleOpen.error.code, "STALE_REVISION");
    assert.equal((await inspect(page)).revision, 4);
    // Неудачный open сохраняет документ и общее с агентом выделение.
    await page.evaluate(() => {
      window.polishRequest = window.studio.request({ kind: "open" });
    });
    await application.evaluate(async (_electron, path) => {
      while (!globalThis.studioTest.resolveOpen)
        await new Promise((done) => globalThis.setTimeout(done, 10));
      globalThis.studioTest.resolveOpen(path);
      delete globalThis.studioTest.resolveOpen;
    }, corrupted);
    assert.equal((await page.evaluate(() => window.polishRequest)).ok, false);
    const selectionAfter = await call("studio_selection_get");
    assert.deepEqual(selectionAfter.cubeIds, selectionBefore.cubeIds);
    assert.equal(selectionAfter.revision, 4);
    const finalState = await inspect(page);
    await client.close();
    client = undefined;
    await application.evaluate(() => {
      globalThis.studioTest.mode = 0;
    });
    const closed = application.waitForEvent("close");
    await application.evaluate(({ app }) => app.quit());
    await closed;
    application = undefined;
    assert.deepEqual(
      JSON.parse(await readFile(copyPath, "utf8")),
      finalState.project,
    );

    const backupData = join(root, "backup-only");
    await mkdir(backupData);
    const backup = join(backupData, "recovery.mmeditor.json.bak");
    await writeFile(backup, JSON.stringify(finalState.project));
    const backupApp = await start("backup-only");
    assert.deepEqual(
      (await inspect(backupApp.page)).project,
      finalState.project,
    );
    assert.match(
      await backupApp.page.getByTestId("status-message").textContent(),
      /резервная копия/u,
    );
    await stop();

    const corruptData = join(root, "corrupt-recovery");
    await mkdir(corruptData);
    const primary = join(corruptData, "recovery.mmeditor.json");
    await writeFile(primary, "{original-corrupt");
    await writeFile(primary + ".bak", "{original-backup-corrupt");
    const corruptApp = await start("corrupt-recovery");
    await inspect(corruptApp.page);
    assert.equal(await readFile(primary, "utf8"), "{original-corrupt");
    assert.equal(
      await readFile(primary + ".bak", "utf8"),
      "{original-backup-corrupt",
    );
    await stop();

    const warningApp = await start("recovery-warning");
    const recoveryTarget = join(warningApp.data, "recovery.mmeditor.json");
    await mkdir(recoveryTarget);
    const warningBase = await inspect(warningApp.page);
    const changed = await warningApp.page.evaluate(
      (mutation) => window.studio.request({ kind: "apply", mutation }),
      {
        projectId: warningBase.project.projectId,
        expectedRevision: warningBase.revision,
        key: randomUUID(),
        commands: [
          {
            type: "transform",
            cubeIds: ["guard_center"],
            translation: [0.125, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      },
    );
    assert.equal(changed.ok, true);
    assert.match(changed.warning, /копия недоступна/u);
    await inspect(warningApp.page);
    await warningApp.page.waitForFunction(() =>
      document
        .querySelector('[data-testid="status-message"]')
        .textContent.includes("копия недоступна"),
    );
    const manualPath = join(root, "ручное сохранение.json");
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, manualPath);
    const manual = await warningApp.page.evaluate(() =>
      window.studio.request({ kind: "save" }),
    );
    assert.equal(manual.ok, true);
    assert.deepEqual(
      JSON.parse(await readFile(manualPath, "utf8")),
      changed.state.project,
    );
    assert(resolve(recoveryTarget).startsWith(resolve(root) + sep));
    await rm(recoveryTarget, { recursive: true });
    await stop();
    const report = {
      status: "PASS",
      hidden: true,
      checks: [
        "cancel app.quit keeps worker alive",
        "cancel save on quit",
        "repeated close has one dialog",
        "agent change during close prevents exit",
        "empty position has no mutation",
        "Ctrl+S commits focused input before saving",
        "Ctrl+Shift+S preserves original file",
        "stale open preserves agent changes",
        "invalid open preserves shared selection",
        "save before quit",
        "backup without primary recovers",
        "corrupt recovery files preserved",
        "persistent recovery warning and manual save",
      ],
    };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
    return report;
  } finally {
    await client?.close();
    // При провале теста отменяем только его скрытый процесс и его мок-диалоги.
    if (application) {
      await application
        .evaluate(({ app }) => app.exit(0))
        .catch(() => undefined);
    }
  }
}
