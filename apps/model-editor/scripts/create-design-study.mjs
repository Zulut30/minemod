/* global window, document */
import { _electron as electron } from "playwright";
import electronPath from "electron";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cubes, bounds } from "@mcdev/editor-core";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { packagedPath } from "./packaged-path.mjs";
import {
  qualityStudyCommands,
  qualityRepairCommands,
} from "./quality-study-commands.mjs";

// Воспроизводимый авторский пример; команды MCP остаются закрытыми данными.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  repo = resolve(appDir, "../..");
const output = join(
  repo,
  "output/model-editor",
  `design-study-${randomUUID().slice(0, 8)}`,
);
await mkdir(output, { recursive: true });
const packaged = process.argv.includes("--packaged");
const quality = process.argv.includes("--quality");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      key !== "ELECTRON_RUN_AS_NODE" && typeof value === "string",
  ),
);
const application = await electron.launch({
  executablePath: packaged ? await packagedPath(repo, appDir) : electronPath,
  args: [
    ...(packaged ? [] : [appDir]),
    "--editor-hidden",
    `--editor-data=${join(output, "user-data")}`,
  ],
  env,
});
let client;
try {
  const page = await application.firstWindow();
  await page.getByTestId("part-guard").waitFor();
  const inspect = async () => {
    const response = await page.evaluate(() =>
      window.studio.request({ kind: "inspect" }),
    );
    if (!response.ok) throw new Error(response.error.message);
    return response.state;
  };
  const human = async (commands) => {
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
    if (!response.ok) throw new Error(JSON.stringify(response.error));
  };
  await human([
    {
      type: "brief",
      text: quality
        ? "Полярный страж: тяжёлый Minecraft-клинок с широкими плечами, коротким ступенчатым остриём и поднятой золотой гардой. Один крупный бирюзовый знак вместо мелких рун; читаемые материалы и одинаковая покраска спереди/сзади. Рукоять и навершие не изменять. Проверить боковые стыки и вид на 32/64 px."
        : "Выразительное оружие Minecraft: читаемый силуэт, холодная сталь, бирюзовый акцент. Сравнить широкий клинок и тонкий вытянутый. Рукоять и навершие сохраняются. Оценить спереди, сбоку, сзади, в три четверти и на 64 px.",
    },
    { type: "lock", partId: "grip", locked: true },
    { type: "lock", partId: "pommel", locked: true },
  ]);
  const baselineId = randomUUID();
  await human([
    {
      type: "checkpoint",
      variantId: baselineId,
      label: "Исходник",
      note: "Северное сияние v2 до правок; защищены рукоять и навершие.",
    },
  ]);
  const original = await inspect();
  const connected = await page.evaluate(() =>
    window.studio.request({ kind: "connection", action: "start" }),
  );
  client = new Client({
    name: "codex-authored-design-study",
    version: "0.5.0",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connected.connection.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${connected.connection.token}` },
      },
    }),
  );
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) throw new Error(response.content[0].text);
    return { response, data: JSON.parse(response.content[0].text) };
  };
  await call("studio_project_inspect", { includeTexture: true });
  await call("studio_variant_inspect", {
    projectId: original.project.projectId,
    expectedRevision: original.revision,
    variantId: baselineId,
    includeTexture: true,
  });
  const blade = cubes(original.project).filter((c) =>
    /^(blade|tip)/u.test(c.id),
  );
  const bladeIds = blade.map((c) => c.id),
    width = bounds(blade).size[0];
  const edges = bladeIds.filter((id) =>
    /^(blade_edge|tip_left|tip_right)/u.test(id),
  );
  const studies = quality
    ? [
        {
          id: randomUUID(),
          key: "polar-guard",
          label: "Полярный страж",
          note: "Новый силуэт: широкие плечи клинка, поднятая гарда и крупный знак. Рукоять и навершие сохранены.",
          scale: [1, 1, 1],
          commands: qualityStudyCommands(original.project),
        },
        {
          id: randomUUID(),
          key: "polar-guard-repair",
          label: "Полярный страж · правки",
          note: "После обзора: крупнее бирюзовый знак и на 22% толще клинок. Сохраняются исходник и первый проход.",
          scale: [1, 1, 1],
          commands: [],
          fromPrevious: true,
        },
      ]
    : [
        {
          id: randomUUID(),
          key: "frost-guard",
          label: "Страж льда",
          note: "Более широкий и короткий клинок; светлые кромки отделяются от тёмного дола.",
          scale: [1.4, 0.9, 1],
          commands: [{ type: "recolor", cubeIds: edges, color: "#d8e5e8" }],
        },
        {
          id: randomUUID(),
          key: "moon-needle",
          label: "Лунная игла",
          note: "Более узкий вытянутый клинок; спокойная холодная гарда, прежний цвет рукояти.",
          scale: [0.78, 1.04, 1.2],
          commands: [
            {
              type: "recolor",
              cubeIds: original.project.parts.find((p) => p.id === "guard")
                .cubeIds,
              color: "#607780",
            },
          ],
        },
      ];
  const captures = [];
  const exportedAssets = [];
  const reviewShots = [];
  const saveReview = async (name, args) => {
    const shot = await call("studio_model_review", args);
    const bytes = Buffer.from(shot.response.content[1].data, "base64");
    await writeFile(join(output, name), bytes);
    reviewShots.push({
      path: name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      metadata: shot.data,
    });
  };
  if (quality)
    await saveReview("review-before.png", {
      projectId: original.project.projectId,
      expectedRevision: original.revision,
    });
  for (const study of studies) {
    await human([
      {
        type: "restoreVariant",
        variantId: study.fromPrevious ? studies[0].id : baselineId,
      },
    ]);
    const state = await inspect();
    const commands = [
      {
        type: "transform",
        cubeIds: bladeIds,
        scale: study.scale,
        translation: [
          (-width * (study.scale[0] - 1)) / 2,
          0,
          ((1 - study.scale[2]) * bounds(blade).size[2]) / 2,
        ],
      },
      ...(study.fromPrevious
        ? qualityRepairCommands(state.project)
        : study.commands),
    ];
    for (let offset = 0; offset < commands.length; offset += 24) {
      const current = await inspect();
      const proposal = await call("studio_changes_preview", {
        projectId: current.project.projectId,
        expectedRevision: current.revision,
        key: randomUUID(),
        commands: commands.slice(offset, offset + 24),
      });
      await call("studio_changes_apply", {
        projectId: current.project.projectId,
        proposalId: proposal.data.proposalId,
      });
    }
    await human([
      {
        type: "checkpoint",
        variantId: study.id,
        label: study.label,
        note: study.note,
      },
    ]);
    const candidate = await inspect();
    for (const part of ["grip", "pommel"]) {
      const ids = original.project.parts.find((p) => p.id === part).cubeIds;
      if (
        JSON.stringify(
          cubes(original.project).filter((c) => ids.includes(c.id)),
        ) !==
        JSON.stringify(
          cubes(candidate.project).filter((c) => ids.includes(c.id)),
        )
      )
        throw new Error("Изменилась защищённая часть");
    }
    const ref = {
      projectId: candidate.project.projectId,
      expectedRevision: candidate.revision,
    };
    if (quality)
      await saveReview(`${study.key}-review.png`, {
        ...ref,
        compareToVariantId: baselineId,
      });
    for (const view of ["front", "side", "back", "perspective"])
      for (const source of [false, true]) {
        const shot = await call("studio_view_capture", {
          ...ref,
          view,
          ...(source
            ? { variantId: baselineId }
            : { compareToVariantId: baselineId }),
        });
        const bytes = Buffer.from(shot.response.content[1].data, "base64"),
          name = `${study.key}-${source ? "source" : "candidate"}-${view}.png`;
        await writeFile(join(output, name), bytes);
        captures.push({
          path: name,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          metadata: shot.data,
        });
      }
    await call("studio_asset_validate", ref);
    const exported = (await call("studio_asset_export", ref)).data;
    const assetRoot = resolve(output, "exports", study.key);
    for (const file of exported.bundle.files) {
      const target = resolve(assetRoot, file.path);
      if (
        !target.startsWith(assetRoot + sep) ||
        !["utf8", "base64"].includes(file.encoding)
      )
        throw new Error(
          "Экспорт выходит за каталог assets или содержит неизвестную кодировку",
        );
      const bytes = Buffer.from(file.content, file.encoding);
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error("Hash экспортированного файла не совпадает");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      exportedAssets.push({
        path: `exports/${study.key}/${file.path}`,
        sha256: file.sha256,
        bytes: bytes.length,
      });
    }
    await writeFile(
      join(output, `${study.key}-bundle.json`),
      JSON.stringify(exported, null, 2),
    );
    await writeFile(
      join(output, `${study.key}-commands.json`),
      JSON.stringify(commands, null, 2),
    );
  }
  const path = join(output, "сравнение клинков.mmeditor.json");
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
  await page.getByTestId("save-project").click();
  await page.waitForFunction(() => !document.querySelector(".unsaved"));
  await page.getByTestId("mode-variants").click();
  await page.getByLabel("Вариант для сравнения").selectOption(baselineId);
  await page.getByTestId("compare-front").click();
  await page.locator(".comparison-small img").nth(1).waitFor();
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll(".comparison-canvas canvas")],
      images = [...document.querySelectorAll(".comparison-small img")];
    return (
      images.length === 2 &&
      nodes.every((source, i) => {
        if (
          JSON.parse(source.dataset.camera ?? "{}").view !== "front" ||
          !images[i].complete ||
          images[i].naturalWidth !== 64
        )
          return false;
        return images[i].naturalHeight === 64;
      })
    );
  });
  for (const [i, name] of ["source-64.png", "candidate-64.png"].entries())
    await writeFile(
      join(output, name),
      Buffer.from(
        (
          await page.locator(".comparison-small img").nth(i).getAttribute("src")
        ).split(",")[1],
        "base64",
      ),
    );
  await page.evaluate(
    () =>
      new Promise((done) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(done)),
      ),
  );
  const image = await application.evaluate(async ({ BrowserWindow }) =>
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
  await writeFile(join(output, "comparison.png"), Buffer.from(image, "base64"));
  await writeFile(
    join(output, "review.json"),
    JSON.stringify(
      {
        date: "2026-10-04",
        author: "Codex, current session; explicit design commands",
        externalCliModelTurns: "not-run",
        packaged,
        project: path,
        projectSha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        sourceFixture: "aurora-longsword-v2.item-asset.json",
        variants: studies.map(({ id, key, label, note }) => ({
          id,
          key,
          label,
          note,
        })),
        captures,
        reviewShots,
        exportedAssets,
        technical: "PASS",
        artisticStatus: "DRAFT",
        reviewRequested: false,
        visualReview: {
          reviewer: "Codex, current session",
          observations: quality
            ? [
                "Широкий клинок и поднятая гарда заметно меняют силуэт, рукоять и навершие сохранены.",
                "После первого обзора увеличены знак и толщина клинка; оба прохода сохранены для сравнения.",
                "На 32 px тонкие детали по-прежнему требуют визуальной оценки; игровой инвентарь не проверен.",
              ]
            : [
                "Широкий клинок лучше передаёт массу спереди.",
                "Узкий клинок сохраняет вытянутый силуэт; после бокового снимка толщину увеличили с 0.9× до 1.2×.",
                "Руны и мелкие акценты теряют детали при уменьшении до 64 px.",
              ],
          automaticArtisticScore: false,
        },
        artisticAcceptance: "pending human acceptance",
        game: "not-verified",
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    JSON.stringify(
      { output, project: path, captures: captures.length },
      null,
      2,
    ) + "\n",
  );
} finally {
  await client?.close();
  await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
}
