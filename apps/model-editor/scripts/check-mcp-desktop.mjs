/* global window, document, fetch, Image */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import process from "node:process";
import { URL } from "node:url";
import { checkInstalledClients } from "./check-installed-clients.mjs";

async function snapshotPixels(page, base64) {
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const background = pixels.slice((32 * width + 32) * 4, (32 * width + 32) * 4 + 3);
    const rows = new Set(), columns = new Set(), colors = new Set();
    let foreground = 0;
    // Центральная область фиксированного fixture исключает подписи и линию пола.
    for (let y = 64; y < height - 64; y++) {
      for (let x = width / 4; x < width * 3 / 4; x++) {
        const offset = (y * width + x) * 4;
        if (pixels[offset + 3] < 250) continue;
        const rgb = pixels.slice(offset, offset + 3);
        if (rgb.every((channel, i) => Math.abs(channel - background[i]) <= 24)) continue;
        foreground++;
        rows.add(y);
        columns.add(x);
        colors.add([...rgb].map((channel) => channel >> 4).join(","));
      }
    }
    return { foreground, rows: rows.size, columns: columns.size, colors: colors.size };
  }, base64);
}

function assertModelPixels(pixels, view) {
  assert(
    pixels.foreground > 1_000 && pixels.rows > 300 &&
      pixels.columns > 8 && pixels.colors >= 6,
    `Snapshot ${view} must contain the textured fixture: ${JSON.stringify(pixels)}`,
  );
}

export async function checkMcpDesktop(application, page, output) {
  await page.getByTestId("agent-settings").click();
  await page.getByTestId("agent-toggle").click();
  await page.getByTestId("agent-endpoint").waitFor();
  const status = await page.evaluate(() =>
    window.studio.request({ kind: "connection", action: "get" }),
  );
  assert.equal(status.connection.enabled, true);
  const { url, token } = status.connection;
  const client = new Client({
    name: "studio-desktop-verification",
    version: "1",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const result = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    return { response, data: JSON.parse(response.content[0].text) };
  };
  const inspect = async () =>
    (await result("studio_project_inspect", { includeTexture: true })).data;
  const revision = async (value) =>
    page.waitForFunction(
      (wanted) =>
        document.querySelector('[data-testid="revision"]')?.textContent ===
        `r${wanted}`,
      value,
    );
  const applyHuman = async (command) => {
    const state = await inspect();
    const response = await page.evaluate(
      (mutation) => window.studio.request({ kind: "apply", mutation }),
      {
        projectId: state.project.projectId,
        expectedRevision: state.revision,
        key: randomUUID(),
        commands: [command],
      },
    );
    assert.equal(response.ok, true);
    await revision(response.state.revision);
    return response.state;
  };
  try {
    const before = await inspect();
    assert.deepEqual(before.project, status.state.project);
    await page.getByTestId("part-guard").click();
    const selection = (await result("studio_selection_get")).data;
    assert.deepEqual(
      selection.cubeIds,
      before.project.parts.find((p) => p.id === "guard").cubeIds,
    );
    const guard = selection.cubeIds;
    const mutation = (state, color) => ({
      projectId: state.project.projectId,
      expectedRevision: state.revision,
      key: randomUUID(),
      commands: [{ type: "recolor", cubeIds: guard, color }],
    });
    const stale = (
      await result("studio_changes_preview", mutation(before, "#ad7284"))
    ).data;
    assert.deepEqual(await inspect(), before);
    await applyHuman({ type: "recolor", cubeIds: guard, color: "#77aa99" });
    const manual = await inspect();
    const rejected = await result("studio_changes_apply", {
      projectId: before.project.projectId,
      proposalId: stale.proposalId,
    });
    assert.equal(rejected.data.error.code, "REVISION_CONFLICT");
    assert.deepEqual(await inspect(), manual, "Stale proposal must preserve the manual state and revision");
    const base = await inspect();
    const proposed = (
      await result("studio_changes_preview", mutation(base, "#ad7284"))
    ).data;
    const applied = (
      await result("studio_changes_apply", {
        projectId: base.project.projectId,
        proposalId: proposed.proposalId,
      })
    ).data;
    await revision(applied.revision);
    assert.match(
      await page.locator(".history-strip").textContent(),
      /AI · Смена цвета/u,
    );
    assert.notDeepEqual(
      (await inspect()).project.texturePlan,
      base.project.texturePlan,
    );
    await result("studio_changes_apply", {
      projectId: base.project.projectId,
      proposalId: proposed.proposalId,
    });
    assert.equal((await inspect()).revision, applied.revision);
    await page.getByTestId("view-side").click();
    const chosen = await page
      .locator(".selection-heading strong")
      .textContent();
    const images = [];
    const blank = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 768;
      const context = canvas.getContext("2d");
      context.fillStyle = "#10151c";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL().split(",")[1];
    });
    const blankPixels = await snapshotPixels(page, blank);
    assert.throws(() => assertModelPixels(blankPixels, "blank render"));
    for (const view of ["perspective", "front", "side", "back"]) {
      const captured = await result("studio_view_capture", {
        projectId: base.project.projectId,
        expectedRevision: applied.revision,
        view,
      });
      assert.equal(
        captured.response.isError,
        undefined,
        JSON.stringify(captured.data),
      );
      const png = Buffer.from(
        captured.response.content.find((c) => c.type === "image").data,
        "base64",
      );
      await writeFile(join(output, `mcp-${view}.png`), png);
      assert.equal(png.readUInt32BE(16), 1024);
      assert.equal(png.readUInt32BE(20), 768);
      const pixels = await snapshotPixels(page, png.toString("base64"));
      assertModelPixels(pixels, view);
      const sha256 = createHash("sha256").update(png).digest("hex");
      images.push({ view, sha256, bytes: png.length, pixels });
    }
    assert(
      new Set(images.map((i) => i.sha256)).size >= 3,
      "Different views must render different images",
    );
    assert(
      await page
        .getByTestId("view-side")
        .evaluate((element) => element.classList.contains("active")),
    );
    assert.equal(
      await page.locator(".selection-heading strong").textContent(),
      chosen,
    );
    const connectionPng = await application.evaluate(
      async ({ BrowserWindow }) =>
        (
          await BrowserWindow.getAllWindows()
            .find(
              (window) =>
                window.webContents.getURL() === "studio://app/index.html",
            )
            .webContents.capturePage(undefined, {
              stayHidden: true,
              stayAwake: true,
            })
        )
          .toPNG()
          .toString("base64"),
    );
    await writeFile(
      join(output, "04-connected.png"),
      Buffer.from(connectionPng, "base64"),
    );
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
      ),
      true,
    );
    await result("studio_history_undo", {
      projectId: base.project.projectId,
      expectedRevision: applied.revision,
      key: randomUUID(),
    });
    await revision(applied.revision + 1);
    assert.deepEqual((await inspect()).project, manual.project, "Agent undo must restore the newer manual edit");
    await applyHuman({ type: "undo" });
    assert.deepEqual((await inspect()).project, before.project);
    await applyHuman({ type: "lock", partId: "guard", locked: true });
    const locked = await result(
      "studio_changes_preview",
      mutation(await inspect(), "#445566"),
    );
    assert.equal(locked.data.error.code, "LOCKED");
    const state = await inspect();
    const history = await result("studio_history_undo", {
      projectId: state.project.projectId,
      expectedRevision: state.revision,
      key: randomUUID(),
    });
    assert.equal(history.data.error.code, "HUMAN_HISTORY");
    await applyHuman({ type: "undo" });
    assert.deepEqual((await inspect()).project, before.project);
    const pixelBase = await inspect(),
      cubeId = guard[0];
    const uv = pixelBase.project.texturePlan.faces.find(
      (f) => f.cubeId === cubeId,
    ).uv.north;
    const x = Math.min(uv[0], uv[2]),
      y = Math.min(uv[1], uv[3]);
    const symbol = pixelBase.project.texturePlan.rows[y][x];
    const currentColor = pixelBase.project.texturePlan.palette.find(
      (c) => c.symbol === symbol,
    )?.color;
    const brushColor = pixelBase.project.texturePlan.palette.find(
      (c) => c.color !== currentColor,
    ).color;
    const pixelProposal = (
      await result("studio_changes_preview", {
        projectId: pixelBase.project.projectId,
        expectedRevision: pixelBase.revision,
        key: randomUUID(),
        commands: [
          {
            type: "paint",
            cubeIds: [cubeId],
            face: "north",
            color: brushColor,
            size: 1,
            points: [[x, y]],
          },
          { type: "uv", cubeId, face: "north", rect: [240, 240, 244, 244] },
        ],
      })
    ).data;
    assert.deepEqual((await inspect()).project, pixelBase.project);
    const pixelApplied = await result("studio_changes_apply", {
      projectId: pixelBase.project.projectId,
      proposalId: pixelProposal.proposalId,
    });
    assert.equal(
      pixelApplied.response.isError,
      undefined,
      JSON.stringify(pixelApplied.data),
    );
    await revision(pixelBase.revision + 1);
    assert.deepEqual((await inspect()).project.model, pixelBase.project.model);
    const paintSnapshots = [];
    for (const view of ["perspective", "front", "side", "back"]) {
      const shot = await result("studio_view_capture", {
        projectId: pixelBase.project.projectId,
        expectedRevision: pixelBase.revision + 1,
        view,
      });
      assert.equal(shot.response.isError, undefined);
      const png = Buffer.from(
        shot.response.content.find((c) => c.type === "image").data,
        "base64",
      );
      assert.equal(png.readUInt32BE(16), 1024);
      assert.equal(png.readUInt32BE(20), 768);
      paintSnapshots.push({
        view,
        bytes: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
      });
      await writeFile(join(output, `paint-${view}.png`), png);
    }
    await result("studio_history_undo", {
      projectId: pixelBase.project.projectId,
      expectedRevision: pixelBase.revision + 1,
      key: randomUUID(),
    });
    await revision(pixelBase.revision + 2);
    assert.deepEqual((await inspect()).project, before.project);
    const state2 = await inspect();
    const ref = {
      projectId: state2.project.projectId,
      expectedRevision: state2.revision,
    };
    assert.equal(
      (await result("studio_asset_validate", ref)).data.technical,
      "pass",
    );
    assert.equal(
      (await result("studio_asset_export", ref)).data.bundle.files.length,
      3,
    );
    const installedClients = process.argv.includes("--check-installed-clients")
      ? await checkInstalledClients({ url, token }, output)
      : { status: "not-run" };
    await page.getByTestId("agent-toggle").click();
    await page
      .getByRole("button", { name: "Включить подключение", exact: true })
      .waitFor();
    await assert.rejects(
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    return {
      status: "PASS",
      transport: "Streamable HTTP",
      clients: "MCP SDK",
      hiddenCaptureWindows: true,
      snapshots: images,
      painting: {
        status: "PASS",
        commands: ["paint", "uv"],
        snapshots: paintSnapshots,
      },
      cliModelSessions: "not-run",
      installedClients,
    };
  } finally {
    await client.close();
  }
}
