/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { URL } from "node:url";
import { Buffer } from "node:buffer";

export async function checkPartsDesktop(options, output) {
  const root = join(output, "parts"); await mkdir(root, { recursive: true });
  const launch = { ...options, args: options.args.filter(a => !a.startsWith("--editor-data=") && a !== "--editor-test-close")
    .concat(`--editor-data=${join(root, "user-data")}`) };
  let app = await electron.launch(launch), client;
  try {
    let page = await app.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const inspect = async () => { const r = await page.evaluate(() => window.studio.request({ kind: "inspect" })); assert(r.ok); return r.state; };
    const settled = () => page.waitForFunction(() => !document.querySelector('[data-testid="save-project"]').disabled);
    const savedPath = join(root, "именованные части.mmeditor.json");
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, savedPath);
    const original = await inspect();
    await page.getByTestId("part-grip").click(); await page.getByTestId("lock-grip").click(); await settled();
    await page.getByTestId("part-label").fill("Кожаная рукоять");
    await page.getByTestId("rename-part").click(); await settled();
    const named = await inspect(); assert.equal(named.project.parts.find(p => p.id === "grip").label, "Кожаная рукоять");
    assert(named.project.parts.find(p => p.id === "grip").locked);
    assert.deepEqual(named.project.model, original.project.model); assert.deepEqual(named.project.texturePlan, original.project.texturePlan);
    assert(await page.getByTestId("group-part").isDisabled());
    const captureViewport = async () => {
      await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      const rect = await page.getByTestId("viewport").locator("canvas").boundingBox(); assert(rect);
      const region = { x: Math.ceil(rect.x), y: Math.ceil(rect.y), width: Math.floor(rect.width) - 2, height: Math.floor(rect.height) - 2 };
      const pixels = await app.evaluate(async ({ BrowserWindow }, region) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage(region, { stayHidden: true, stayAwake: true })).toPNG().toString("base64"), region);
      return Buffer.from(pixels, "base64");
    };
    const shownPng = await captureViewport();
    await page.getByTestId("hide-grip").click();
    assert.equal(await page.getByTestId("hide-grip").getAttribute("aria-pressed"), "true");
    assert.deepEqual(await inspect(), named);
    const hiddenPng = await captureViewport(); assert(!hiddenPng.equals(shownPng), "Hidden grip must change real viewport pixels");
    await page.getByTestId("hide-grip").click();
    assert.equal(await page.getByTestId("hide-grip").getAttribute("aria-pressed"), "false");
    assert((await captureViewport()).equals(shownPng), "Showing grip must restore exact viewport pixels");
    await writeFile(join(root, "grip-shown.png"), shownPng); await writeFile(join(root, "grip-hidden.png"), hiddenPng);

    await page.getByTestId("part-guard").click();
    await page.getByTestId("part-pommel").click({ modifiers: ["Control"] });
    const ids = [...original.project.parts.find(p => p.id === "guard").cubeIds, ...original.project.parts.find(p => p.id === "pommel").cubeIds];
    await page.getByTestId("part-label").fill("Стальная гарда и навершие");
    await page.getByTestId("group-part").click(); await settled();
    const grouped = await inspect(), part = grouped.project.parts.find(p => p.label === "Стальная гарда и навершие");
    assert(part); assert.deepEqual([...part.cubeIds].sort(), [...ids].sort());
    assert(!grouped.project.parts.some(p => ["guard", "pommel"].includes(p.id)));
    assert.deepEqual(grouped.project.parts.find(p => p.id === "grip"), named.project.parts.find(p => p.id === "grip"));
    assert.deepEqual(grouped.project.model, original.project.model); assert.deepEqual(grouped.project.texturePlan, original.project.texturePlan);
    await page.keyboard.press("Control+z"); await settled(); assert.deepEqual((await inspect()).project, named.project);
    await page.keyboard.press("Control+Shift+z"); await settled(); assert.deepEqual((await inspect()).project, grouped.project);

    await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" }));
    const connection = await page.evaluate(() => window.studio.request({ kind: "connection", action: "get" }));
    client = new Client({ name: "parts-check", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url), { requestInit: { headers: { Authorization: `Bearer ${connection.connection.token}` } } }));
    const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { response: r, data: JSON.parse(r.content[0].text) }; };
    const reference = await inspect();
    const input = commands => ({ projectId: grouped.project.projectId, expectedRevision: reference.revision, key: randomUUID(), commands });
    const scene = await call("studio_project_inspect");
    assert.equal(scene.data.project.parts.find(p => p.id === part.id).label, part.label);
    for (const command of [{ type: "renamePart", partId: part.id, label: "Подмена" },
      { type: "groupPart", partId: "agent_group", label: "Подмена", cubeIds: part.cubeIds }]) {
      const denied = await call("studio_changes_preview", input([command])); assert(denied.response.isError); assert.equal(denied.data.error.code, "HUMAN_ONLY");
    }
    const locked = await call("studio_changes_preview", input([{ type: "transform", cubeIds: named.project.parts.find(p => p.id === "grip").cubeIds,
      translation: [1, 0, 0], scale: [1, 1, 1] }])); assert.equal(locked.data.error.code, "LOCKED");
    const unlock = await call("studio_changes_preview", input([{ type: "lock", partId: "grip", locked: false }]));
    assert.equal(unlock.data.error.code, "LOCKED");
    assert.deepEqual((await inspect()).project, grouped.project);
    await page.getByTestId("part-label").fill("Исправленное имя человека");
    const preview = await call("studio_changes_preview", input([{ type: "transform", cubeIds: [part.cubeIds[0]], translation: [0.125, 0, 0], scale: [1, 1, 1] }]));
    assert(!preview.response.isError);
    const applied = await call("studio_changes_apply", { projectId: grouped.project.projectId, proposalId: preview.data.proposalId }); assert(!applied.response.isError);
    await page.getByTestId("refresh-part-reference").waitFor(); const concurrent = await inspect();
    await page.getByTestId("rename-part").click(); await settled();
    await page.locator(".part-error").waitFor(); assert.deepEqual((await inspect()).project, concurrent.project);
    assert.equal(await page.getByTestId("part-label").inputValue(), "Исправленное имя человека");
    await page.getByTestId("refresh-part-reference").click(); await page.getByTestId("rename-part").click(); await settled();
    const final = await inspect(); assert.equal(final.project.parts.find(p => p.id === part.id).label, "Исправленное имя человека");
    assert.deepEqual(final.project.model, concurrent.project.model); assert.deepEqual(final.project.texturePlan, concurrent.project.texturePlan);
    await page.getByTestId("save-as").click(); await settled(); const bytes = await readFile(savedPath);
    assert.deepEqual(JSON.parse(bytes.toString("utf8")), final.project);
    const hidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible())); assert(hidden);
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
    await writeFile(join(root, "named-parts.png"), Buffer.from(png, "base64"));
    await client.close(); client = undefined; await app.close(); app = await electron.launch(launch);
    page = await app.firstWindow(); await page.getByTestId(`part-${part.id}`).waitFor(); assert.deepEqual((await inspect()).project, final.project);
    const report = { status: "PASS", hidden, projectId: final.project.projectId, groupId: part.id, finalRevision: final.revision,
      savedFile: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
      checks: ["rename locked part preserves ID and protection", "real hide/show PNG with unchanged document", "Control multiselect groups parts",
        "grouping preserves geometry/pixels/UV and protected grip", "exact undo/redo", "public MCP names and new group ID",
        "agent cannot rename/regroup/unlock", "locked agent edit rejected", "stale name rejected with draft retained",
        "explicit refresh preserves agent geometry", "exact saved project", "restart restores names/group/locks"] };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await client?.close(); await app.close(); }
}
