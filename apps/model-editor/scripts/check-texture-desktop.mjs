/* global window, document, Event */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { URL } from "node:url";
import { checkLocalRecolorDesktop } from "./check-local-recolor-desktop.mjs";
function pixels(project) {
  const palette = new Map(
    project.texturePlan.palette.map((c) => [c.symbol, c.color.toLowerCase()]),
  );
  return [...project.texturePlan.rows.join("")].map((s) =>
    s === "." ? null : palette.get(s),
  );
}
export async function checkTextureDesktop(page, inspect, capture) {
  const localRecolor = await checkLocalRecolorDesktop(page, inspect, capture);
  const original = await inspect(page),
    cubeId = original.project.parts.find((p) => p.id === "guard").cubeIds[0];
  await page.getByTestId("mode-texture").click();
  await page.getByLabel("Куб для UV").selectOption(cubeId);
  await page.getByLabel("Грань текстуры").selectOption("north");
  await page.getByLabel("Масштаб текстуры").selectOption("4");
  // north смотрит в -Z: текущая перспектива +Z видит противоположную грань.
  await page.getByTestId("view-back").click();
  await page.waitForTimeout(150);
  const rect = original.project.texturePlan.faces.find(
    (f) => f.cubeId === cubeId,
  ).uv.north;
  const x = Math.min(rect[0], rect[2]) + 1,
    y = Math.min(rect[1], rect[3]) + 1;
  const before = pixels(original.project),
    index = y * 256 + x;
  const color = original.project.texturePlan.palette
    .find((c) => c.color.toLowerCase() !== before[index])
    .color.toLowerCase();
  await page.getByTestId("brush-color").fill(color);
  const canvas = page.getByTestId("paint-canvas");
  async function position(u, v) {
    await page.locator(".texture-scroll").evaluate(
      (el, p) => {
        el.scrollLeft = Math.max(0, p[0] - el.clientWidth / 2);
        el.scrollTop = Math.max(0, p[1] - el.clientHeight / 2);
      },
      [u * 4, v * 4],
    );
    const box = await canvas.boundingBox();
    return [
      box.x + ((u + 0.5) * box.width) / 256,
      box.y + ((v + 0.5) * box.height) / 256,
    ];
  }
  async function move(u, v) {
    await page.mouse.move(...(await position(u, v)));
  }
  async function click(u, v) {
    await move(u, v);
    await page.mouse.down();
    await page.mouse.up();
  }
  async function revision(value) {
    await page.waitForFunction(
      (r) =>
        document.querySelector('[data-testid="revision"]').textContent ===
        `r${r}`,
      value,
    );
  }
  async function rgba(u, v) {
    return canvas.evaluate(
      (el, p) => [...el.getContext("2d").getImageData(p[0], p[1], 1, 1).data],
      [u, v],
    );
  }
  const expected = [1, 3, 5]
    .map((i) => Number.parseInt(color.slice(i, i + 2), 16))
    .concat(255);
  const gpuBefore = await page
    .locator("canvas[data-ready='true']")
    .evaluate((el) => el.toDataURL());
  await move(x, y);
  await page.mouse.down();
  await move(x + 3, y);
  await page.waitForFunction(
    ({ x, y, expected }) => {
      const data = [
        ...document
          .querySelector('[data-testid="paint-canvas"]')
          .getContext("2d")
          .getImageData(x, y, 1, 1).data,
      ];
      return JSON.stringify(data) === JSON.stringify(expected);
    },
    { x, y, expected },
  );
  assert.deepEqual(
    await inspect(page),
    original,
    "Предпросмотр штриха не меняет документ и историю",
  );
  await page.waitForTimeout(150);
  assert(
    (await page
      .locator("canvas[data-ready='true']")
      .evaluate((el) => el.toDataURL())) !== gpuBefore,
    "3D показывает штрих до применения",
  );
  await capture("05-paint-draft.png");
  await page.mouse.up();
  await revision(original.revision + 1);
  const drawn = await inspect(page),
    drawnPixels = pixels(drawn.project);
  assert.equal(drawn.history.length, original.history.length + 1);
  const changed = new Set(Array.from({ length: 4 }, (_, i) => index + i));
  assert(
    drawnPixels.every((c, i) =>
      changed.has(i) ? c === color : c === before[i],
    ),
  );
  await page.getByTestId("undo").click();
  await revision(drawn.revision + 1);
  assert.deepEqual((await inspect(page)).project, original.project);
  await page.getByTestId("redo").click();
  await revision(drawn.revision + 2);
  assert.deepEqual((await inspect(page)).project, drawn.project);

  await page.getByTestId("paint-pick").click();
  const pickBefore = await inspect(page);
  await click(x, y);
  assert.deepEqual(await inspect(page), pickBefore);
  assert.equal(await page.getByTestId("brush-color").inputValue(), color);
  await page.getByTestId("paint-eraser").click();
  await click(x, y);
  await revision(pickBefore.revision + 1);
  assert.deepEqual(await rgba(x, y), [0, 0, 0, 0]);
  assert.equal(pixels((await inspect(page)).project)[index], null);
  await page.getByTestId("undo").click();
  await revision(pickBefore.revision + 2);
  await page.getByTestId("paint-fill").click();
  const fillColor = original.project.texturePlan.palette.find(
    (c) => c.color.toLowerCase() !== color,
  ).color;
  await page.getByTestId("brush-color").fill(fillColor);
  await click(x, y);
  await revision(pickBefore.revision + 3);
  const filled = pixels((await inspect(page)).project);
  assert(changed.size === filled.filter((c, i) => c !== drawnPixels[i]).length);
  await page.getByTestId("undo").click();
  await revision(pickBefore.revision + 4);

  await page.getByTestId("paint-brush").click();
  await page.getByTestId("brush-color").fill(fillColor);
  const cancelBefore = await inspect(page);
  for (const [label, cancel] of [
    ["Escape", async () => page.keyboard.press("Escape")],
    [
      "pointercancel",
      async () => canvas.dispatchEvent("pointercancel", { pointerId: 1 }),
    ],
    [
      "lostcapture",
      async () =>
        canvas.evaluate((el) => {
          const id = Number(el.dataset.testPointerId);
          if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
        }),
    ],
    [
      "blur",
      async () => page.evaluate(() => window.dispatchEvent(new Event("blur"))),
    ],
  ]) {
    await canvas.evaluate((el) =>
      el.addEventListener(
        "pointerdown",
        (event) => {
          el.dataset.testPointerId = String(event.pointerId);
        },
        { once: true },
      ),
    );
    await move(x, y);
    await page.mouse.down();
    await cancel();
    await page.mouse.up();
    await page.waitForTimeout(40);
    const canceled = await inspect(page);
    assert.equal(
      canceled.revision,
      cancelBefore.revision,
      `Отмена ${label} не создаёт commit`,
    );
    assert.deepEqual(
      canceled,
      cancelBefore,
      "Отмена указателя не сохраняет незавершённый штрих",
    );
    assert.deepEqual(await rgba(x, y), expected);
  }
  // Изменение через настоящий HTTP MCP во время ручного штриха.
  await page.getByTestId("agent-settings").click();
  await page.getByTestId("agent-toggle").click();
  await page.getByTestId("agent-endpoint").waitFor();
  const status = await page.evaluate(() =>
    window.studio.request({ kind: "connection", action: "get" }),
  );
  const client = new Client({
    name: "paint-conflict-verification",
    version: "1",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(status.connection.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${status.connection.token}` },
      },
    }),
  );
  try {
    const base = await inspect(page);
    const proposed = await client.callTool({
      name: "studio_changes_preview",
      arguments: {
        projectId: base.project.projectId,
        expectedRevision: base.revision,
        key: randomUUID(),
        commands: [
          {
            type: "transform",
            cubeIds: [cubeId],
            translation: [0.125, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      },
    });
    assert.equal(proposed.isError, undefined);
    const proposalId = JSON.parse(proposed.content[0].text).proposalId;
    await move(x, y);
    await page.mouse.down();
    const applied = await client.callTool({
      name: "studio_changes_apply",
      arguments: { projectId: base.project.projectId, proposalId },
    });
    assert.equal(applied.isError, undefined);
    await revision(base.revision + 1);
    await page.mouse.up();
    const concurrent = await inspect(page);
    assert.equal(concurrent.revision, base.revision + 1);
    assert.deepEqual(
      concurrent.project.texturePlan,
      base.project.texturePlan,
      "Незавершённый штрих не перезаписывает агентную ревизию",
    );
    assert.notDeepEqual(concurrent.project.model, base.project.model);
    assert.deepEqual(await rgba(x, y), expected);
    await page.getByTestId("undo").click();
    await revision(base.revision + 2);
    assert.deepEqual((await inspect(page)).project, base.project);
  } finally {
    await client.close();
    await page.getByTestId("agent-toggle").click();
  }

  const uvBefore = await inspect(page);
  const dest = [
    200,
    200,
    200 + Math.abs(rect[2] - rect[0]),
    200 + Math.abs(rect[3] - rect[1]),
  ];
  for (let i = 0; i < 4; i++)
    await page.getByTestId(`uv-${i}`).fill(String(dest[i]));
  await page.getByTestId("move-uv").click();
  await revision(uvBefore.revision + 1);
  const moved = await inspect(page),
    movedPixels = pixels(moved.project),
    uvPixels = pixels(uvBefore.project);
  assert.deepEqual(
    moved.project.texturePlan.faces.find((f) => f.cubeId === cubeId).uv.north,
    dest,
  );
  for (let v = 0; v < dest[3] - dest[1]; v++)
    for (let u = 0; u < dest[2] - dest[0]; u++)
      assert.equal(
        movedPixels[(dest[1] + v) * 256 + dest[0] + u],
        uvPixels[(rect[1] + v) * 256 + rect[0] + u],
      );
  // Пересечение: взять существующую грань этого же куба.
  const conflictRect = moved.project.texturePlan.faces.find(
    (f) => f.cubeId === cubeId,
  ).uv.south;
  for (let i = 0; i < 4; i++)
    await page.getByTestId(`uv-${i}`).fill(String(conflictRect[i]));
  await page.getByTestId("move-uv").click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="status-message"]')
      .textContent.includes("UV_COLLISION"),
  );
  assert.deepEqual(await inspect(page), moved);
  await page.getByTestId("undo").click();
  await revision(moved.revision + 1);
  assert.deepEqual((await inspect(page)).project, uvBefore.project);

  // Проверка переключения документа с удерживаемой кистью.
  await page.getByTestId("save-project").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="status-message"]').textContent ===
      "Проект сохранён.",
  );
  await move(x, y);
  await page.mouse.down();
  const switched = await page.evaluate(() =>
    window.studio.request({ kind: "new" }),
  );
  assert.equal(switched.ok, true);
  await revision(switched.state.revision);
  await page.mouse.up();
  assert.equal((await inspect(page)).project.parts.length, 0);
  assert.equal((await inspect(page)).revision, switched.state.revision);
  assert(switched.state.revision > moved.revision, "Смена документа не переиспользует старую revision");
  await page.getByTestId("open-project").click();
  await page.getByTestId("part-guard").waitFor();
  assert.deepEqual((await inspect(page)).project, uvBefore.project);
  await page.getByTestId("part-guard").click();
  await page.getByLabel("Куб для UV").selectOption(cubeId);
  await page.getByLabel("Грань текстуры").selectOption("north");
  await page.getByLabel("Масштаб текстуры").selectOption("4");
  await position(x, y);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="move-uv"]').disabled,
  );
  await page.evaluate(
    () =>
      new Promise((done) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(done)),
      ),
  );
  await capture("06-pixel-workshop.png");
  await page.getByTestId("mode-model").click();
  await page.getByTestId("view-perspective").click();
  return {
    state: await inspect(page),
    report: {
      status: "PASS",
      localRecolor,
      checks: [
        "real pointer stroke",
        "live 3D draft",
        "one history entry",
        "exact scope pixels",
        "undo/redo",
        "pipette",
        "eraser alpha",
        "connected fill",
        "Escape/pointercancel/lostcapture/blur",
        "concurrent agent revision",
        "UV pattern transfer",
        "UV collision rollback",
        "project switch cancels stroke",
      ],
    },
  };
}
