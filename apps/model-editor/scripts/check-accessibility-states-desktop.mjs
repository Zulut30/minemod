/* global window, document, getComputedStyle, NodeFilter */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";

// Собственная скрытая сцена; recovery fault затрагивает только её временный каталог.
export async function checkAccessibilityStatesDesktop(options, output) {
  const root = join(output, "accessibility-states"), data = join(root, "user-data");
  await mkdir(root, { recursive: true });
  const app = await electron.launch({ ...options, args: options.args.filter(a => !a.startsWith("--editor-data=") && a !== "--editor-test-close")
    .concat(`--editor-data=${data}`) });
  try {
    const page = await app.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const inspect = async () => { const r = await page.evaluate(() => window.studio.request({ kind: "inspect" })); assert(r.ok); return r.state; };
    const initial = await inspect(), samples = [];
    const contrast = async state => {
      await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      const text = await page.evaluate(() => {
        const parse = c => { const v = c.match(/[\d.]+/g).map(Number); return [...v.slice(0, 3), v[3] ?? 1]; };
        const mix = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
        const lum = c => c.map(v => { const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; })
          .reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
        const background = el => { const chain = []; for (let p = el; p; p = p.parentElement) chain.push(p);
          return chain.reverse().reduce((bg, p) => mix(parse(getComputedStyle(p).backgroundColor), bg), [16, 21, 29]); };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), result = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement, label = node.textContent.trim(), rect = el.getBoundingClientRect(), style = getComputedStyle(el);
          if (!label || !rect.width || !rect.height || rect.right <= 0 || rect.left >= window.innerWidth || rect.bottom <= 0 || rect.top >= window.innerHeight ||
            style.visibility !== "visible" || el.closest("button:disabled,input:disabled,select:disabled")) continue;
          let opaque = true; for (let p = el; p; p = p.parentElement) if (Number(getComputedStyle(p).opacity) < 1) opaque = false;
          if (!opaque) continue; // Отдельная проверка disabled/opacity не получает text PASS.
          const bg = background(el), a = lum(mix(parse(style.color), bg)), b = lum(bg);
          result.push({ label: label.slice(0, 120), tag: el.tagName, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) });
        } return result;
      });
      assert(text.length >= 20, `No meaningful visible text for ${state}`);
      assert(text.every(x => Number.isFinite(x.ratio)), `Unsupported color in ${state}`);
      const failures = text.filter(x => x.ratio < 4.5);
      samples.push({ state, text });
      await writeFile(join(root, "contrast.json"), JSON.stringify(samples, null, 2) + "\n");
      assert.deepEqual(failures, [], `Visible text contrast below 4.5 in ${state}`);
    };
    await contrast("model/normal/selected");
    assert.equal(await page.getByTestId("part-guard").getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByTestId("lock-guard").getAttribute("aria-pressed"), "false");
    assert.equal(await page.getByTestId("lock-grip").getAttribute("aria-pressed"), String(initial.project.parts.find(p => p.id === "grip").locked));
    const expand = page.locator('.part-row').filter({ has: page.getByTestId("part-guard") }).locator('.expand-button');
    for (const expanded of ["true", "false"]) {
      await expand.focus(); await page.keyboard.press("Enter"); assert.equal(await expand.getAttribute("aria-expanded"), expanded);
    }
    const hide = page.getByTestId("hide-guard");
    for (const hidden of ["true", "false"]) {
      await hide.focus(); await page.keyboard.press("Enter"); assert.equal(await hide.getAttribute("aria-pressed"), hidden);
    }
    for (const toggle of ["toggle-grid", "toggle-wire"]) {
      const button = page.getByTestId(toggle), original = await button.getAttribute("aria-pressed");
      assert(["true", "false"].includes(original)); await button.focus(); await page.keyboard.press("Enter");
      assert.equal(await button.getAttribute("aria-pressed"), String(original !== "true"));
      await page.keyboard.press("Enter"); assert.equal(await button.getAttribute("aria-pressed"), original);
    }
    for (const view of ["front", "side", "back", "perspective"]) {
      const button = page.getByTestId(`view-${view}`); await button.focus(); await page.keyboard.press("Enter");
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('.view-tabs button[aria-pressed="true"]').count(), 1);
    }
    await page.getByTestId("export-assets").hover(); await contrast("model/export-hover");
    for (const mode of ["texture", "variants", "review", "model"]) {
      const button = page.getByTestId(`mode-${mode}`); await button.focus(); await page.keyboard.press("Enter");
      assert.equal(await button.getAttribute("aria-pressed"), "true"); await contrast(`${mode}/keyboard-selected`);
      if (mode === "texture") for (const tool of ["eraser", "fill", "pick", "brush"]) {
        const paint = page.getByTestId(`paint-${tool}`); await paint.focus(); await page.keyboard.press("Enter");
        assert.equal(await paint.getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator('.paint-tools button[aria-pressed="true"]').count(), 1);
      }
    }
    assert.deepEqual(await inspect(), initial);
    assert.match(await page.getByTestId("save-project").getAttribute("title"), /Ctrl\+S/u);
    assert.equal(await page.getByTestId("save-as").getAttribute("aria-label"), "Сохранить как…");
    const name = page.getByTestId("part-label"); await name.fill("");
    await page.getByTestId("rename-part").focus(); await page.keyboard.press("Enter");
    await page.locator('.part-error[role="alert"]').waitFor(); await contrast("part/invalid-name-alert");
    assert.deepEqual(await inspect(), initial);
    await name.fill("Проверка клавиатуры");
    // Реальная недоступность autosave, без изменения чужих файлов или исходника модели.
    await mkdir(join(data, "recovery.mmeditor.json"));
    await name.press("Tab"); assert.equal(await page.locator(":focus").getAttribute("data-testid"), "rename-part");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-testid="status-message"]').textContent.includes("копия недоступна"));
    assert.equal(await page.getByTestId("status-message").getAttribute("role"), "status");
    assert.equal(await page.getByTestId("status-message").getAttribute("aria-live"), "polite");
    const renamed = await inspect(); assert.equal(renamed.revision, initial.revision + 1);
    assert.deepEqual(renamed.project.model, initial.project.model); assert.deepEqual(renamed.project.texturePlan, initial.project.texturePlan);
    await contrast("recovery/warning/keyboard-rename");
    const saved = join(root, "клавиатурное сохранение.mmeditor.json");
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, saved);
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !document.querySelector('.unsaved') && !document.querySelector('[data-testid="save-project"]').disabled);
    assert.deepEqual(JSON.parse(await readFile(saved, "utf8")), renamed.project);
    await contrast("recovery/warning/saved-clean");
    const gripLock = page.getByTestId("lock-grip"), previousLock = renamed.project.parts.find(p => p.id === "grip").locked;
    for (const locked of [!previousLock, previousLock]) {
      await gripLock.focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(value => document.querySelector('[data-testid="lock-grip"]').getAttribute("aria-pressed") === String(value), locked);
      await contrast(`part/keyboard-lock-${locked}`);
    }
    const restored = await inspect(); assert.deepEqual(restored.project, renamed.project);
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !document.querySelector('.unsaved') && !document.querySelector('[data-testid="save-project"]').disabled);
    assert.deepEqual(JSON.parse(await readFile(saved, "utf8")), renamed.project);
    const environment = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0];
      return { hidden: !w.isVisible(), displayScale: screen.getDisplayMatching(w.getBounds()).scaleFactor, zoomFactor: w.webContents.getZoomFactor() }; });
    assert(environment.hidden);
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,
      { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
    await writeFile(join(root, "warning-keyboard-save.png"), Buffer.from(png, "base64"));
    const report = { status: "PASS", ...environment, states: samples.map(s => ({ state: s.state, textCount: s.text.length, minContrast: Math.min(...s.text.map(x => x.ratio)) })),
      keyboardRename: true, keyboardSave: true, keyboardViewAndPaintTools: true, keyboardExpandAndHide: true, keyboardLockRestored: true,
      geometryAndTexturePreserved: true, warningVisibleAfterSave: true,
      scope: "Visible opaque text in real states; disabled/opacity controls and raster/canvas text excluded, not complete WCAG certification" };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await app.close(); }
}
