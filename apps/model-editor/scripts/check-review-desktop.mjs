/* global window, document, getComputedStyle */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";

export async function checkReviewDesktop(options, output) {
  const root = join(output, "review");
  await mkdir(root, { recursive: true });
  const application = await electron.launch({
    ...options,
    args: options.args
      .filter((v) => !v.startsWith("--editor-data="))
      .concat(`--editor-data=${join(root, "user-data")}`),
  });
  let client;
  try {
    const page = await application.firstWindow();
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    await page.getByTestId("part-guard").waitFor();
    const inspect = async () =>
      (await page.evaluate(() => window.studio.request({ kind: "inspect" })))
        .state;
    await page.getByTestId("mode-review").click();
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll(".review-readability img")];
      return (
        imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth > 0)
      );
    });
    const visuals = await page.evaluate(async () => {
      const cameras = [
        ...document.querySelectorAll(".review-canvas canvas"),
      ].map((c) => JSON.parse(c.dataset.camera));
      const images = [...document.querySelectorAll(".review-readability img")];
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = image.naturalWidth;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const mask = pixels(images[0]);
      let painted = 0,
        invalidMask = 0;
      for (let i = 0; i < mask.length; i += 4)
        if (mask[i + 3]) {
          painted++;
          if (
            mask[i + 3] === 255 &&
            (mask[i] !== 230 || mask[i + 1] !== 237 || mask[i + 2] !== 245)
          )
            invalidMask++;
        }
      const paintedRows = new Set();
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++)
          if (mask[(y * 64 + x) * 4 + 3]) paintedRows.add(y);
      const small = document.createElement("canvas");
      small.width = small.height = 32;
      const smallCtx = small.getContext("2d");
      smallCtx.imageSmoothingEnabled = false;
      smallCtx.drawImage(images[2], 0, 0, 32, 32);
      const luminance = (color) => {
        const rgb = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      };
      const rootStyle = getComputedStyle(document.documentElement);
      const activeStyle = getComputedStyle(
        document.querySelector('[data-testid="mode-review"]'),
      );
      const contrast = (fg, bg) =>
        (Math.max(luminance(fg), luminance(bg)) + 0.05) /
        (Math.min(luminance(fg), luminance(bg)) + 0.05);
      const rect = document
        .querySelector(".review-board")
        .getBoundingClientRect();
      return {
        cameras,
        widths: images.map((i) => i.naturalWidth),
        painted,
        invalidMask,
        actual64: paintedRows.size >= 44 && paintedRows.size <= 60,
        actual32: images[1].src === small.toDataURL(),
        colorScheme: rootStyle.colorScheme,
        textContrast: contrast(rootStyle.color, rootStyle.backgroundColor),
        activeContrast: contrast(
          activeStyle.color,
          activeStyle.backgroundColor,
        ),
        visible: rect.bottom <= window.innerHeight,
        overflow: document.body.scrollWidth > window.innerWidth,
      };
    });
    assert.deepEqual(
      visuals.cameras.map((c) => c.view),
      ["front", "side", "back", "perspective"],
    );
    assert.equal(
      new Set(visuals.cameras.map((c) => JSON.stringify(c.target))).size,
      1,
    );
    assert.deepEqual(visuals.widths, [64, 32, 64]);
    assert(visuals.painted > 10);
    assert.equal(visuals.invalidMask, 0);
    assert(
      visuals.actual32 && visuals.actual64,
      "Миниатюры должны соответствовать текущему 3D-кадру",
    );
    assert.equal(visuals.colorScheme, "dark");
    assert(visuals.textContrast >= 4.5 && visuals.activeContrast >= 4.5);
    assert(visuals.visible && !visuals.overflow);
    const screenshot = async (name) => {
      await page.evaluate(
        () =>
          new Promise((done) =>
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(done),
            ),
          ),
      );
      const data = await application.evaluate(async ({ BrowserWindow }) =>
        (
          await BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() === "studio://app/index.html")
            .webContents.capturePage(undefined, {
              stayHidden: true,
              stayAwake: true,
            })
        )
          .toPNG()
          .toString("base64"),
      );
      await writeFile(join(root, name), Buffer.from(data, "base64"));
    };
    await screenshot("dark-review.png");
    const squareBeforeResize = await page
      .locator(".review-readability img")
      .nth(2)
      .getAttribute("src");
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === "studio://app/index.html")
        .setSize(1120, 760),
    );
    await page.waitForFunction(() => {
      const bounds = document
        .querySelector(".review-board")
        .getBoundingClientRect();
      return (
        bounds.bottom <= window.innerHeight &&
        document.body.scrollWidth <= window.innerWidth
      );
    });
    // Изменение и undo вынуждают новый GPU-кадр при другом размере панели.
    const compactBefore = await inspect();
    const mutate = async (commands) => {
      const state = await inspect();
      const response = await page.evaluate(
        (mutation) => window.studio.request({ kind: "apply", mutation }),
        {
          projectId: state.project.projectId,
          expectedRevision: state.revision,
          key: randomUUID(),
          commands,
        },
      );
      assert.equal(response.ok, true);
    };
    await mutate([
      { type: "recolor", cubeIds: ["guard_center"], color: "#cc6644" },
    ]);
    await page.waitForFunction(
      (old) =>
        document.querySelectorAll(".review-readability img")[2]?.src !== old,
      squareBeforeResize,
    );
    await mutate([{ type: "undo" }]);
    await page.waitForFunction(
      (old) =>
        document.querySelectorAll(".review-readability img")[2]?.src === old,
      squareBeforeResize,
    );
    assert.deepEqual((await inspect()).project, compactBefore.project);
    await screenshot("compact-review.png");
    await page.getByTestId("mode-model").click();
    await page.getByTestId("view-front").click();
    await page.waitForFunction(() => {
      const camera = document.querySelector('[data-testid="viewport"] canvas')
        ?.dataset.camera;
      return camera && JSON.parse(camera).view === "front";
    });
    const cameraBefore = await page
      .locator('[data-testid="viewport"] canvas')
      .getAttribute("data-camera");
    const before = await inspect();
    const connection = await page.evaluate(() =>
      window.studio.request({ kind: "connection", action: "start" }),
    );
    client = new Client({ name: "review-desktop-check", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(connection.connection.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${connection.connection.token}` },
        },
      }),
    );
    const ref = {
      projectId: before.project.projectId,
      expectedRevision: before.revision,
    };
    const reviewed = await client.callTool({
      name: "studio_model_review",
      arguments: ref,
    });
    assert(!reviewed.isError, JSON.stringify(reviewed.content));
    assert(Buffer.byteLength(JSON.stringify(reviewed)) <= 2_097_152);
    const metadata = JSON.parse(reviewed.content[0].text);
    assert.deepEqual(metadata.views, ["front", "side", "back", "perspective"]);
    assert.equal(metadata.game, "not-verified");
    const data = Buffer.from(reviewed.content[1].data, "base64");
    assert.equal(data.readUInt32BE(16), 1024);
    assert.equal(data.readUInt32BE(20), 768);
    await writeFile(join(root, "mcp-review.png"), data);
    assert.deepEqual((await inspect()).project, before.project);
    assert.equal((await inspect()).revision, before.revision);
    assert.equal(
      await page
        .locator('[data-testid="viewport"] canvas')
        .getAttribute("data-camera"),
      cameraBefore,
    );
    const rejected = await client.callTool({
      name: "studio_model_review",
      arguments: { ...ref, projectId: randomUUID() },
    });
    assert.equal(rejected.isError, true);
    assert(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
      ),
    );
    assert.deepEqual(problems, []);
    const report = {
      status: "PASS",
      hidden: true,
      checks: [
        "dark text and active control contrast",
        "four independent views with common framing",
        "real alpha silhouette",
        "native square 64px render and nearest 32px preview",
        "thumbnail framing independent of panel aspect ratio",
        "compact review",
        "bounded MCP review PNG",
        "read-only scene and manual camera",
        "project conflict rejected",
      ],
      textContrast: visuals.textContrast,
      activeContrast: visuals.activeContrast,
    };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
    return report;
  } finally {
    await client?.close();
    await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
}
