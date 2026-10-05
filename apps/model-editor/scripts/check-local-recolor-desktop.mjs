/* global window, document, Image */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { textureMask, texturePixels } from "@mcdev/editor-core";

export async function checkLocalRecolorDesktop(page, inspect, capture) {
  await page.getByTestId("mode-model").click();
  await page.getByTestId("part-guard").click();
  const before = await inspect(page), part = before.project.parts.find(p => p.id === "guard");
  const mask = textureMask(before.project, part.cubeIds), old = texturePixels(before.project);
  const luma = color => [1, 3, 5].reduce((sum, at, i) => sum + Number.parseInt(color.slice(at, at + 2), 16) * [.2126, .7152, .0722][i], 0);
  const colors = [...new Set(old.filter((c, i) => mask[i] && c))].sort((a, b) => luma(b) - luma(a));
  assert(colors.length > 1);
  const preserved = colors[0], preservedCount = old.filter((c, i) => mask[i] && c === preserved).length;
  const details = page.locator(".color-preservation");
  await details.locator("summary").click();
  await page.getByLabel("Сохранить цвет " + preserved, { exact: true }).check();
  await page.getByTestId("part-color").fill("#804020");
  const revision = value => page.waitForFunction(r => document.querySelector('[data-testid="revision"]').textContent === `r${r}`, value);
  await page.getByTestId("apply-color").click(); await revision(before.revision + 1);
  const human = await inspect(page), humanPixels = texturePixels(human.project);
  assert(humanPixels.some((c, i) => mask[i] && old[i] !== preserved && c !== old[i]));
  assert(humanPixels.every((c, i) => mask[i] && old[i] !== preserved || c === old[i]));
  assert.deepEqual(human.project.model, before.project.model);
  await capture("07-preserved-material-color.png");
  await page.getByTestId("undo").click(); await revision(before.revision + 2);
  assert.deepEqual((await inspect(page)).project, before.project);
  await page.getByTestId("redo").click(); await revision(before.revision + 3);
  assert.deepEqual((await inspect(page)).project, human.project);
  await page.getByTestId("undo").click(); await revision(before.revision + 4);

  const other = before.project.parts.find(p => p.id !== part.id);
  await page.getByTestId("part-" + other.id).click();
  assert.equal(await page.locator(".color-preservation input:checked").count(), 0, "Защита не переносится на другую выделенную часть");
  await page.getByTestId("part-guard").click();
  const boxes = details.locator('input[type="checkbox"]');
  for (const box of await boxes.all()) await box.check();
  assert(await page.getByTestId("apply-color").isDisabled(), "Все цвета сохранены: пустая операция отключена");
  for (const box of await boxes.all()) await box.uncheck();

  const initialConnection = await page.evaluate(() => window.studio.request({ kind: "connection", action: "get" }));
  assert(initialConnection.ok);
  const startedHere = !initialConnection.connection.enabled;
  const status = startedHere
    ? await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" }))
    : initialConnection;
  assert(status.ok && status.connection.enabled);
  const client = new Client({ name: "local-recolor-verification", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(status.connection.url), {
      requestInit: { headers: { Authorization: `Bearer ${status.connection.token}` } },
    }));
    const base = await inspect(page), ref = { projectId: base.project.projectId, expectedRevision: base.revision };
    const commands = [{ type: "recolor", cubeIds: part.cubeIds, color: "#408020", preserveColors: [preserved.toUpperCase()] }];
    const denied = await client.callTool({ name: "studio_changes_preview", arguments: {
      ...ref, key: randomUUID(), commands: [{ ...commands[0], preserveColors: [preserved, preserved.toUpperCase()] }],
    } });
    assert(denied.isError); assert.deepEqual(await inspect(page), base);
    const preview = await client.callTool({ name: "studio_changes_preview", arguments: { ...ref, key: randomUUID(), commands } });
    assert(!preview.isError); assert.deepEqual(await inspect(page), base);
    const proposalId = JSON.parse(preview.content.find(c => c.type === "text").text).proposalId;
    const applied = await client.callTool({ name: "studio_changes_apply", arguments: { projectId: base.project.projectId, proposalId } });
    assert(!applied.isError); await revision(base.revision + 1);
    const after = await inspect(page), pixels = texturePixels(after.project);
    assert(pixels.every((c, i) => mask[i] && old[i] !== preserved || c === old[i]));
    const lightest = old.map((color, i) => ({ color, i })).filter(p => mask[p.i] && p.color && p.color !== preserved)
      .sort((a, b) => luma(b.color) - luma(a.color))[0];
    assert.equal(pixels[lightest.i], "#408020");
    const exported = await client.callTool({ name: "studio_asset_export", arguments: { projectId: base.project.projectId, expectedRevision: after.revision } });
    assert(!exported.isError);
    const bundle = JSON.parse(exported.content.find(c => c.type === "text").text).bundle;
    const png = bundle.files.find(f => f.path.endsWith(".png"));
    assert.equal(createHash("sha256").update(Buffer.from(png.content, "base64")).digest("hex"), png.sha256);
    const rgba = await page.evaluate(async data => {
      const image = new Image(); image.src = "data:image/png;base64," + data; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
    }, png.content);
    for (let i = 0; i < old.length; i++) {
      if (!mask[i] || old[i] === preserved || old[i] === null) {
        const expected = old[i] ? [1, 3, 5].map(at => Number.parseInt(old[i].slice(at, at + 2), 16)).concat(255) : [0, 0, 0, 0];
        assert.deepEqual(rgba.slice(i * 4, i * 4 + 4), expected);
      }
    }
    assert.deepEqual(rgba.slice(lightest.i * 4, lightest.i * 4 + 4), [64, 128, 32, 255]);
    const undo = await client.callTool({ name: "studio_history_undo", arguments: {
      projectId: base.project.projectId, expectedRevision: after.revision, key: randomUUID(),
    } });
    assert(!undo.isError); await revision(after.revision + 1);
    assert.deepEqual((await inspect(page)).project, before.project);
    await details.locator("summary").click();
    return { status: "PASS", preservedColor: preserved, preservedPixels: preservedCount,
      changedPixels: pixels.filter((c, i) => c !== old[i]).length, pngSha256: png.sha256,
      checks: ["scripted UI action and full undo/redo", "selection isolation", "all-preserved disabled action",
        "HTTP MCP rejection atomicity", "read-only preview and actual apply", "exported PNG exact RGBA scope/alpha", "agent undo"],
      artisticApproval: "NOT_PERFORMED" };
  } finally {
    try { await client.close(); }
    finally {
      if (startedHere) {
        const stopped = await page.evaluate(() => window.studio.request({ kind: "connection", action: "stop" }));
        assert(stopped.ok && !stopped.connection.enabled);
      }
    }
  }
}
