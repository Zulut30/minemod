/* global window, document */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { historyScenario } from "../../../fixtures/editor-projects/history-scenario.ts";
import { verifyAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";

export async function checkHistoryDesktop(options, output) {
  const root = join(output, "history"), data = join(root, "user-data");
  await mkdir(data, { recursive: true });
  await writeFile(join(data, "recovery.mmeditor.json"), await readFile(new URL("../../../fixtures/editor-projects/v1-painted-variants.mmeditor.json", import.meta.url)));
  const application = await electron.launch({ ...options, args: options.args
    .filter((arg) => !arg.startsWith("--editor-data=")) .concat(`--editor-data=${data}`) });
  let client;
  try {
    const page = await application.firstWindow(); await page.getByTestId("part-guard").waitFor();
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())));
    const inspect = async () => (await page.evaluate(() => window.studio.request({ kind: "inspect" }))).state;
    const apply = async (commands) => {
      const state = await inspect();
      const result = await page.evaluate((mutation) => window.studio.request({ kind: "apply", mutation }),
        { projectId: state.project.projectId, expectedRevision: state.revision, key: randomUUID(), commands });
      assert.equal(result.ok, true); return result.state;
    };
    const connection = await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" }));
    client = new Client({ name: "history-acceptance", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),
      { requestInit: { headers: { Authorization: `Bearer ${connection.connection.token}` } } }));
    const exportSignature = async () => {
      const state = await inspect(), result = await client.callTool({ name: "studio_asset_export",
        arguments: { projectId: state.project.projectId, expectedRevision: state.revision, format: "bundle-v1" } });
      assert(!result.isError);
      const bundle = verifyAssetBundleV1(JSON.parse(result.content[0].text).bundle);
      return bundle.manifest.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    };
    const capture = async (name) => {
      const state = await inspect(), result = await client.callTool({ name: "studio_view_capture",
        arguments: { projectId: state.project.projectId, expectedRevision: state.revision, view: "front" } });
      assert(!result.isError); const block = result.content.find((c) => c.type === "image"); assert(block);
      const bytes = Buffer.from(block.data, "base64"); await writeFile(join(root, name), bytes);
      return createHash("sha256").update(bytes).digest("hex");
    };
    const initial = await inspect(), projects = [initial.project], signatures = [await exportSignature()];
    const beforeCapture = await capture("before-front.png");
    for (const commands of historyScenario(initial.project, randomUUID())) {
      const state = await apply(commands); projects.push(state.project); signatures.push(await exportSignature());
    }
    assert.notDeepEqual(signatures.at(-1), signatures[0]);
    for (let i = projects.length - 2; i >= 0; i--) {
      await page.getByTestId("undo").click();
      await page.waitForFunction((revision) => document.querySelector('[data-testid="revision"]').textContent === `r${revision}`, (projects.length - 1) * 2 - i);
      assert.deepEqual((await inspect()).project, projects[i]);
      assert.deepEqual(await exportSignature(), signatures[i]);
    }
    assert.equal((await inspect()).canUndo, false);
    const afterCapture = await capture("after-undo-front.png");
    assert.equal(afterCapture, beforeCapture, "Undo must restore the actual renderer output with identical camera.");
    for (let i = 1; i < projects.length; i++) {
      await page.getByTestId("redo").click();
      await page.waitForFunction((revision) => document.querySelector('[data-testid="revision"]').textContent === `r${revision}`, (projects.length - 1) * 2 + i);
      assert.deepEqual((await inspect()).project, projects[i]);
      assert.deepEqual(await exportSignature(), signatures[i]);
    }
    assert.equal((await inspect()).canRedo, false);
    const report = { status: "PASS", hidden: true, mixedOperations: projects.length - 1,
      undoCount: projects.length - 1, redoCount: projects.length - 1, exactFileHashes: true,
      initialFrontSha256: beforeCapture, afterUndoFrontSha256: afterCapture,
      checks: ["real human IPC mutations", "UI undo/redo buttons", "entire project at every step",
        "MCP bundle file hashes at every step", "actual front render after full undo"] };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await client?.close(); await application.close(); }
}
