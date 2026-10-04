/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  projectFromAsset,
  validateProject,
  parseProject,
  cubes,
} from "@mcdev/editor-core";
import { compileItemAssetPayload } from "../../../packages/application/item-assets.ts";
import { weaponDirectionAssets } from "../../../fixtures/assets/weapon-directions.mjs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import assert from "node:assert/strict";
import { packagedPath } from "./packaged-path.mjs";

// Только локальный авторский runner: импорт данных и закрытый HTTP MCP в скрытом EXE.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(appDir, "../..");
const output = resolve(
  repo,
  process.argv[2] ??
    `output/model-editor/weapon-redesign-${randomUUID().slice(0, 8)}`,
);
if (!output.startsWith(resolve(repo, "output") + sep))
  throw new Error("Результат должен находиться в output проекта");
await mkdir(output, { recursive: true });
const sourcePath = resolve(
  repo,
  "output/model-editor/design-study-fcfed2c1/сравнение клинков.mmeditor.json",
);
const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
const prior = validateProject(JSON.parse(sourceBytes));
const projectId = randomUUID();
const source = {
  schemaVersion: prior.schemaVersion,
  kind: prior.kind,
  projectId,
  model: prior.model,
  texturePlan: prior.texturePlan,
  parts: prior.parts,
};
const assets = weaponDirectionAssets();
const keys = ["arctic-cleaver", "crystal-sentinel", "ember-broadsword"];
const notes = [
  "Односторонняя широкая кромка, тёмный обух, короткая асимметричная гарда и крупный кристалл у основания.",
  "Широкие светлые скосы, короткое гранёное остриё, объёмное гнездо кристалла и бронзовая гарда.",
  "Тяжёлая тёмная масса, ступенчатая горячая кромка, три крепления обуха и бордовая рукоять.",
];
const directions = assets.map((asset, i) => ({
  key: keys[i],
  id: randomUUID(),
  label: asset.model.name,
  note: notes[i],
  project: projectFromAsset(asset, projectId),
}));
const originalId = randomUUID();
const selected = 0;
const project = validateProject({
  ...directions[selected].project,
  design: {
    brief:
      "Полная переработка отвергнутого дизайна в выразительном стиле Minecraft. Три самостоятельных силуэта, более толстые клинки и рукояти, один крупный акцент вместо мелких рун. Палитра из 18 цветов, атлас 128×128, крупные пиксельные группы. Оценивать форму без текстуры, стыки, обе стороны и честные 32/64 px. Предыдущая модель сохранена отдельно; работа в игре ещё не подтверждена.",
    variants: [
      {
        id: originalId,
        label: "Прежняя версия · не принята",
        note: "Полярный страж: сохранён для сравнения после отрицательной оценки пользователя.",
        project: source,
      },
      ...directions.map(({ id, label, note, project }) => ({
        id,
        label,
        note,
        project,
      })),
    ],
  },
});
const projectPath = join(output, "новые силуэты.mmeditor.json");
const serialized = JSON.stringify(project, null, 2) + "\n";
parseProject(serialized);
await writeFile(projectPath, serialized);
const conceptPath = resolve(
  process.argv[3] ??
    "C:/Users/zulut/.codex/generated_images/01a0feae-c42f-7901-95f1-92c8131d14a2/exec-8cd45080-a73e-4633-98fb-fde1905222af.png",
);
await copyFile(conceptPath, join(output, "concept-directions.png"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exportedFiles = [];
const exportBundle = async (key, bundle) => {
  const root = resolve(output, "exports", key);
  for (const file of bundle.files) {
    const target = resolve(root, file.path);
    if (
      !target.startsWith(root + sep) ||
      !["utf8", "base64"].includes(file.encoding)
    )
      throw new Error("Неверный путь или кодировка экспорта");
    const bytes = Buffer.from(file.content, file.encoding);
    assert.equal(hash(bytes), file.sha256);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    exportedFiles.push({
      path: `exports/${key}/${file.path}`,
      bytes: bytes.length,
      sha256: file.sha256,
    });
  }
  await writeFile(
    join(output, `${key}-bundle.json`),
    JSON.stringify(bundle, null, 2),
  );
};
for (const [i, asset] of assets.entries()) {
  await writeFile(
    join(output, `${keys[i]}.item-asset.json`),
    JSON.stringify(asset, null, 2),
  );
  await exportBundle(keys[i], compileItemAssetPayload(JSON.stringify(asset)));
}

const executable = await packagedPath(repo, appDir);
const application = await electron.launch({
  executablePath: executable,
  args: ["--editor-hidden", `--editor-data=${join(output, "user-data")}`],
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        key !== "ELECTRON_RUN_AS_NODE" && typeof value === "string",
    ),
  ),
});
let client;
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("part-guard").waitFor();
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, projectPath);
  const opened = await page.evaluate(() =>
    window.studio.request({ kind: "open" }),
  );
  if (!opened.ok)
    throw new Error(`Импорт не выполнен: ${JSON.stringify(opened.error)}`);
  await page.waitForFunction(
    (id) =>
      window.studio
        .request({ kind: "inspect" })
        .then((r) => r.ok && r.state.project.projectId === id),
    projectId,
  );
  const response = await page.evaluate(() =>
    window.studio.request({ kind: "connection", action: "start" }),
  );
  assert.equal(response.ok, true);
  const connection = response.connection;
  client = new Client({ name: "authored-weapon-directions", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.url), {
      requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
    }),
  );
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) throw new Error(JSON.stringify(response.content));
    return { response, data: JSON.parse(response.content[0].text) };
  };
  const state = (await call("studio_project_inspect")).data;
  const ref = { projectId, expectedRevision: state.revision };
  const captures = [],
    renderFrames = [],
    sheetItems = [],
    reviewShots = [],
    validation = [];
  const snapshots = [
    { key: "previous", id: originalId, label: "Прежняя модель" },
    ...directions,
  ];
  for (const item of snapshots) {
    const review = await call("studio_model_review", {
      ...ref,
      variantId: item.id,
      compareToVariantId: directions[0].id,
    });
    const bytes = Buffer.from(review.response.content[1].data, "base64");
    const name = `${item.key}-review.png`;
    await writeFile(join(output, name), bytes);
    reviewShots.push({
      path: name,
      sha256: hash(bytes),
      metadata: review.data,
    });
    const capturePage = application
      .windows()
      .find((p) => p.url().includes("capture=1"));
    assert(capturePage, "Нужно окно настоящего MCP-рендера");
    const pixels = await capturePage.evaluate(() => ({
      front: document.querySelector('[data-view="front"] canvas').toDataURL(),
      perspective: document
        .querySelector('[data-view="perspective"] canvas')
        .toDataURL(),
      silhouette: document.querySelectorAll(".review-readability img")[0].src,
      small32: document.querySelectorAll(".review-readability img")[1].src,
      small64: document.querySelectorAll(".review-readability img")[2].src,
    }));
    for (const [view, url] of Object.entries(pixels)) {
      const bytes = Buffer.from(url.split(",")[1], "base64");
      const path = `${item.key}-render-${view}.png`;
      await writeFile(join(output, path), bytes);
      renderFrames.push({ path, sha256: hash(bytes) });
    }
    sheetItems.push({
      key: item.key,
      label: item.label,
      note: item.note ?? "Отвергнутый предыдущий дизайн",
      ...pixels,
    });
    for (const view of ["front", "side", "back", "perspective"]) {
      const shot = await call("studio_view_capture", {
        ...ref,
        variantId: item.id,
        compareToVariantId: directions[0].id,
        view,
      });
      const bytes = Buffer.from(shot.response.content[1].data, "base64");
      const name = `${item.key}-${view}.png`;
      await writeFile(join(output, name), bytes);
      captures.push({ path: name, sha256: hash(bytes), metadata: shot.data });
    }
  }
  validation.push((await call("studio_asset_validate", ref)).data);
  const bundle = (await call("studio_asset_export", ref)).data.bundle;
  const offline = compileItemAssetPayload(JSON.stringify(assets[selected]));
  assert.deepEqual(
    bundle.files.map((f) => f.sha256),
    offline.files.map((f) => f.sha256),
  );
  await page.getByTestId("mode-review").click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".review-readability img")].length === 3 &&
      [...document.querySelectorAll(".review-readability img")].every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
  );
  const previews = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".review-grid canvas")].map((canvas) => [
        JSON.parse(canvas.dataset.camera).view,
        canvas.toDataURL(),
      ]),
    ),
  );
  for (const [view, data] of Object.entries(previews))
    await writeFile(
      join(output, `${keys[selected]}-working-${view}.png`),
      Buffer.from(data.split(",")[1], "base64"),
    );
  const hidden = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
  );
  assert.equal(hidden, true);
  assert.deepEqual(errors, []);
  assert.equal(hash(await readFile(sourcePath)), sourceHash);
  const safeData = JSON.stringify(sheetItems).replaceAll("<", "\\u003c");
  const sheet = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Новые силуэты оружия</title><style>
    :root{color-scheme:dark;font-family:system-ui,sans-serif;color:#e2e9f3;background:#10151d}*{box-sizing:border-box}body{margin:0;padding:24px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}h1{font-size:24px;margin:0 0 6px}p{color:#aab8c9;font-size:13px;margin:0}nav{display:flex;gap:6px}button{background:#222d3b;border:1px solid #3c4a5d;color:#e2e9f3;border-radius:8px;padding:9px 12px;cursor:pointer}button.active{color:#102727;background:#79d4c5}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:22px}.item{background:#19212c;border:1px solid #303d4d;border-radius:12px;padding:16px}.item h2{font-size:16px;margin:0 0 8px}.item .render{width:100%;height:400px;object-fit:cover;image-rendering:pixelated}.item .small{display:flex;justify-content:center;gap:20px;padding:10px}.small figure{margin:0;text-align:center}.small img{width:64px;height:64px;image-rendering:pixelated}.small figcaption{font-size:11px;color:#aab8c9}.note{min-height:55px;line-height:1.5}footer{margin-top:16px;color:#aab8c9;font-size:12px}.silhouette .render{object-fit:contain;padding:14px;background:#202c3a} @media(max-width:900px){main{grid-template-columns:repeat(2,minmax(0,1fr))}header{display:block}nav{margin-top:15px}}
  </style><header><div><h1>Новый дизайн оружия</h1><p>Реальные модели редактора · исходник и три самостоятельных направления</p></div><nav><button class="active" data-view="front">Спереди</button><button data-view="perspective">Три четверти</button><button data-view="silhouette">Силуэты</button></nav></header><main></main><footer>Концепт и 3D-модель созданы отдельно. Варианты ещё требуют твоей оценки; вид в Minecraft не проверен.</footer><script>
    const items=${safeData};const main=document.querySelector('main');let view='front';
    function render(){main.replaceChildren();for(const item of items){const card=document.createElement('article');card.className='item'+(view==='silhouette'?' silhouette':'');const title=document.createElement('h2');title.textContent=item.label;const image=new Image();image.className='render';image.src=item[view];image.alt=item.label;const small=document.createElement('div');small.className='small';for(const size of [32,64]){const figure=document.createElement('figure');const preview=new Image();preview.src=item['small'+size];preview.alt=size+' px';const caption=document.createElement('figcaption');caption.textContent=size+' px';figure.append(preview,caption);small.append(figure)}const note=document.createElement('p');note.className='note';note.textContent=item.note;card.append(title,image,small,note);main.append(card)}}
    for(const button of document.querySelectorAll('button'))button.onclick=()=>{view=button.dataset.view;for(const b of document.querySelectorAll('button'))b.classList.toggle('active',b===button);render()};render();
  </script></html>`;
  const sheetPath = join(output, "comparison.html");
  await writeFile(sheetPath, sheet);
  const compareWindowId = await application.evaluate(
    async ({ BrowserWindow }, url) => {
      const window = new BrowserWindow({
        width: 1440,
        height: 820,
        show: false,
        backgroundColor: "#10151d",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      await window.loadURL(url);
      return window.id;
    },
    new URL(`file:///${sheetPath.replaceAll("\\", "/")}`).href,
  );
  const sheetPage = application
    .windows()
    .find((p) => p.url().startsWith("file:"));
  await sheetPage.waitForFunction(
    () =>
      document.images.length === 12 &&
      [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  await sheetPage.evaluate(
    () =>
      new Promise((done) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(done)),
      ),
  );
  for (const view of ["front", "perspective", "silhouette"]) {
    await sheetPage.locator(`button[data-view="${view}"]`).click();
    await sheetPage.waitForFunction(() =>
      [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    );
    await sheetPage.evaluate(
      () =>
        new Promise((done) =>
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(done),
          ),
        ),
    );
    const png = await application.evaluate(
      async ({ BrowserWindow }, id) =>
        (
          await BrowserWindow.fromId(id).webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          })
        )
          .toPNG()
          .toString("base64"),
      compareWindowId,
    );
    await writeFile(
      join(output, `comparison-${view}.png`),
      Buffer.from(png, "base64"),
    );
  }
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((w) => !w.isVisible()),
    ),
    true,
  );
  const report = {
    date: "2026-10-04",
    author:
      "Codex, current session; authored data imported by the local runner",
    concept: {
      tool: "image_gen",
      modelVersion: "not exposed by tool",
      path: "concept-directions.png",
      sha256: hash(await readFile(join(output, "concept-directions.png"))),
      role: "Original concept exploration; geometry and texture authored separately",
    },
    project: projectPath,
    projectSha256: hash(await readFile(projectPath)),
    sourcePreserved: { path: sourcePath, sha256: sourceHash },
    executable,
    hidden,
    captures,
    renderFrames,
    comparison: sheetPath,
    reviewShots,
    exportedFiles,
    validation,
    variants: directions.map(({ key, id, label, note, project }) => ({
      key,
      id,
      label,
      note,
      cubes: cubes(project).length,
      texture: project.model.texture,
      palette: project.texturePlan.palette.length,
    })),
    selected: directions[selected].key,
    technical: "PASS",
    artisticStatus: "DRAFT",
    artisticAcceptance: "pending human acceptance",
    game: "not-verified",
    externalCliModelTurns: "not-run",
    automaticArtisticScore: false,
  };
  await writeFile(join(output, "review.json"), JSON.stringify(report, null, 2));
  process.stdout.write(
    JSON.stringify(
      {
        project: projectPath,
        report: join(output, "review.json"),
        technical: report.technical,
        reviewShots: reviewShots.length,
        captures: captures.length,
        hidden,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await client?.close();
  await application.close();
}
