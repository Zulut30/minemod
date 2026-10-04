/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";

export async function checkVariantsDesktop(options, output) {
  const root = join(output, "variants");
  await mkdir(root, { recursive: true });
  const launchOptions = {
    ...options,
    args: options.args
      .filter((a) => !a.startsWith("--editor-data="))
      .concat(`--editor-data=${join(root, "user-data")}`),
  };
  let application = await electron.launch(launchOptions),
    client;
  try {
    let page = await application.firstWindow();
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.getByTestId("part-guard").waitFor();
    const path = join(root, "варианты меча.mmeditor.json");
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, path);
    const inspect = async () => {
      const result = await page.evaluate(() =>
        window.studio.request({ kind: "inspect" }),
      );
      assert.equal(result.ok, true);
      return result.state;
    };
    const settled = async () =>
      page.waitForFunction(
        () => !document.querySelector('[data-testid="save-project"]').disabled,
      );
    await page.getByTestId("lock-grip").click();
    await settled();
    await page.getByTestId("mode-variants").click();
    await page
      .getByTestId("design-brief")
      .fill(
        "Выразительный стиль Minecraft. Сохранить рукоять, сравнить силуэт и контраст.",
      );
    await page.getByTestId("save-brief").click();
    await settled();
    await page.getByLabel("Название варианта").fill("Исходник");
    await page.getByTestId("save-variant").click();
    await settled();
    const baseline = await inspect(),
      source = baseline.project.design.variants[0];
    assert.equal(
      source.project.parts.find((p) => p.id === "grip").locked,
      true,
    );
    await page.evaluate(() =>
      window.studio.request({ kind: "connection", action: "start" }),
    );
    const connection = await page.evaluate(() =>
      window.studio.request({ kind: "connection", action: "get" }),
    );
    client = new Client({ name: "variant-shared-scene-check", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(connection.connection.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${connection.connection.token}` },
        },
      }),
    );
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      return { response, data: JSON.parse(response.content[0].text) };
    };
    const reference = async () => {
      const state = await inspect();
      return {
        projectId: state.project.projectId,
        expectedRevision: state.revision,
      };
    };
    const agent = async (commands) => {
      const proposal = await call("studio_changes_preview", {
        ...(await reference()),
        key: randomUUID(),
        commands,
      });
      assert(!proposal.response.isError, JSON.stringify(proposal.data));
      const result = await call("studio_changes_apply", {
        projectId: (await inspect()).project.projectId,
        proposalId: proposal.data.proposalId,
      });
      assert(!result.response.isError, JSON.stringify(result.data));
      await page.waitForFunction(
        (revision) =>
          window.studio
            .request({ kind: "inspect" })
            .then((r) => r.ok && r.state.revision === revision),
        result.data.revision,
      );
    };
    const context = (await call("studio_project_inspect")).data;
    assert.match(context.project.design.brief, /Minecraft/u);
    assert.equal(context.project.design.variants[0].project, undefined);
    assert.deepEqual(
      (
        await call("studio_variant_inspect", {
          ...(await reference()),
          variantId: source.id,
          includeTexture: true,
        })
      ).data.variant.project,
      source.project,
    );
    await agent([
      {
        type: "transform",
        cubeIds: ["guard_center"],
        translation: [0.25, 0, 0],
        scale: [1, 1, 1],
      },
      { type: "recolor", cubeIds: ["guard_center"], color: "#bd894f" },
    ]);
    assert.deepEqual(
      (await inspect()).project.design.variants[0].project,
      source.project,
    );
    await page.getByLabel("Название варианта").fill("Вариант A");
    await page.getByTestId("save-variant").click();
    await settled();
    const candidate = await inspect();
    const cameras = async () =>
      page
        .locator(".comparison-canvas canvas")
        .evaluateAll((nodes) => nodes.map((c) => JSON.parse(c.dataset.camera)));
    for (const view of ["front", "side", "back", "perspective"]) {
      await page.getByTestId(`compare-${view}`).click();
      await page.waitForFunction((view) => {
        const nodes = [
          ...document.querySelectorAll(".comparison-canvas canvas"),
        ];
        return (
          nodes.length === 2 &&
          nodes.every(
            (c) =>
              c.dataset.camera && JSON.parse(c.dataset.camera).view === view,
          ) &&
          nodes[0].dataset.camera === nodes[1].dataset.camera
        );
      }, view);
      await page.waitForFunction(() => {
        const images = [...document.querySelectorAll(".comparison-small img")];
        return (
          images.length === 2 &&
          images.every(
            (image) =>
              image.complete &&
              image.naturalWidth === 64 &&
              image.naturalHeight === 64,
          )
        );
      });
      const pair = await cameras();
      assert.deepEqual(pair[0], pair[1]);
    }
    await page.locator(".comparison-small img").nth(1).waitFor();
    const previousThumb = await page
      .locator(".comparison-small img")
      .nth(1)
      .getAttribute("src");
    await page.getByTestId("compare-silhouette").click();
    await page.waitForFunction(
      (before) =>
        document.querySelectorAll(".comparison-small img")[1]?.src !== before,
      previousThumb,
    );
    const black = await page
      .locator('[data-testid="comparison-working"] canvas')
      .evaluate((canvas) => {
        const c = document.createElement("canvas");
        c.width = canvas.width;
        c.height = canvas.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i + 3] > 0) {
            opaque++;
            if (pixels[i] || pixels[i + 1] || pixels[i + 2]) return false;
          }
        return opaque > 100;
      });
    assert.equal(
      black,
      true,
      "Силуэт должен быть реальным непрозрачным чёрным рендером",
    );
    const screenshot = async (name) => {
      const png = await application.evaluate(async ({ BrowserWindow }) =>
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
      await writeFile(join(root, name), Buffer.from(png, "base64"));
    };
    await screenshot("comparison-silhouette.png");
    const blackThumb = await page
      .locator(".comparison-small img")
      .nth(1)
      .getAttribute("src");
    await page.getByTestId("compare-silhouette").click();
    await page.waitForFunction(
      (before) =>
        document.querySelectorAll(".comparison-small img")[1]?.src !== before,
      blackThumb,
    );
    await screenshot("comparison-texture.png");
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === "studio://app/index.html")
        .setSize(1120, 760),
    );
    await page.waitForFunction(
      () => document.querySelector(".comparison-canvas").clientHeight >= 200,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.body.scrollHeight > window.innerHeight ||
          document.body.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await screenshot("comparison-compact.png");
    const stale = await call("studio_changes_preview", {
      ...(await reference()),
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
    await page.getByTestId("restore-variant").click();
    await settled();
    assert.deepEqual((await inspect()).project.model, source.project.model);
    assert.equal(
      (
        await call("studio_changes_apply", {
          projectId: source.project.projectId,
          proposalId: stale.data.proposalId,
        })
      ).data.error.code,
      "REVISION_CONFLICT",
    );
    await page.getByTestId("restore-variant").press("Control+z");
    await settled();
    assert.deepEqual((await inspect()).project.model, candidate.project.model);
    const forbidden = await call("studio_changes_preview", {
      ...(await reference()),
      key: randomUUID(),
      commands: [{ type: "restoreVariant", variantId: source.id }],
    });
    assert.equal(forbidden.data.error.code, "HUMAN_ONLY");
    for (const args of [
      { variantId: source.id },
      { compareToVariantId: source.id },
    ]) {
      const shot = await call("studio_view_capture", {
        ...(await reference()),
        ...args,
        view: "front",
      });
      assert.equal(shot.response.content[1].type, "image");
      await writeFile(
        join(root, args.variantId ? "source-front.png" : "working-front.png"),
        Buffer.from(shot.response.content[1].data, "base64"),
      );
    }
    await page.getByTestId("save-project").click();
    await settled();
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")),
      (await inspect()).project,
    );
    await page.getByTestId("delete-variant").click();
    await settled();
    assert.equal((await inspect()).project.design.variants.length, 1);
    await page.getByTestId("delete-variant").press("Control+z");
    await settled();
    assert.equal((await inspect()).project.design.variants.length, 2);
    await client.close();
    client = undefined;
    await application.close();
    application = await electron.launch(launchOptions);
    page = await application.firstWindow();
    await page.getByTestId("part-guard").waitFor();
    assert.equal((await inspect()).project.design.variants.length, 2);
    assert.deepEqual(
      (await inspect()).project.design.variants[0].project,
      source.project,
    );
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
        "brief reaches MCP",
        "independent saved variants",
        "agent cannot manage variants",
        "four identical camera presets",
        "real silhouette and 64px preview",
        "restore and undo",
        "stale proposal rejected after restore",
        "reference captures",
        "delete and undo",
        "save and restart recovery",
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
