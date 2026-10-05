/* global window, document, getComputedStyle */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";

export async function checkAccessibilityDesktop(options, output) {
  const root = join(output, "accessibility"); await mkdir(root, { recursive: true });
  const app = await electron.launch({ ...options, args: options.args.filter(a => !a.startsWith("--editor-data=") && a !== "--editor-test-close")
    .concat(`--editor-data=${join(root, "user-data")}`) });
  try {
    const page = await app.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const inspect = async () => { const r = await page.evaluate(() => window.studio.request({ kind: "inspect" })); assert(r.ok); return r.state; };
    const before = await inspect();
    const size = page.getByLabel("Размер X", { exact: true });
    assert.equal(await size.inputValue(), "9.1");
    await size.focus(); assert.equal(Number(await size.inputValue()), 9.100000000000001);
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const field = document.activeElement, style = getComputedStyle(field.parentElement);
      return { label: field.getAttribute("aria-label"), keyboard: field.matches(":focus-visible"),
        outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), color: style.outlineColor };
    });
    assert.equal(focus.label, "Размер Y"); assert(focus.keyboard && focus.outlineStyle === "solid" && focus.outlineWidth >= 2);
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    assert.deepEqual(await inspect(), before, "Focus/blur must not round actual geometry or create history");
    await size.focus(); await size.fill("60");
    assert.equal(await size.inputValue(), "60");
    await size.press("Tab");
    await page.waitForFunction(() => document.querySelector('[data-testid="status-message"]')?.textContent.includes("BOUNDS"))
      .catch(async error => {
        await writeFile(join(root, "failure.json"), JSON.stringify({ status: "FAIL", message: error.message,
          field: await size.inputValue(), statusText: await page.getByTestId("status-message").textContent(),
          state: await inspect() }, null, 2) + "\n"); throw error;
      });
    assert.equal(await page.getByTestId("status-message").getAttribute("role"), "alert");
    assert.equal(await page.getByTestId("status-message").getAttribute("aria-live"), "assertive");
    assert.deepEqual(await inspect(), before, "Invalid keyboard input must preserve the exact document");
    for (const mode of ["texture", "variants", "review", "model"]) {
      const button = page.getByTestId(`mode-${mode}`); await button.focus(); await page.keyboard.press("Enter");
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('.editor-mode button[aria-pressed="true"]').count(), 1);
    }
    const contrast = await page.evaluate(() => {
      const channels = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = color => channels(color).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const background = element => { for (let current = element; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor; if (!color.startsWith("rgba") || !color.endsWith(", 0)")) return color;
      } return getComputedStyle(document.documentElement).backgroundColor; };
      const result = [];
      for (const selector of ['.document-bar strong', '.hint', '.panel-heading', '.part-editor input', '.tool-button.primary',
        '.editor-mode button.active', '[data-testid="status-message"]', '.axis-field input']) {
        const element = document.querySelector(selector); if (!element) continue;
        const fg = luminance(getComputedStyle(element).color), bg = luminance(background(element));
        result.push({ selector, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) });
      } return result;
    });
    assert.equal(contrast.length, 8, "Every sampled important state must exist");
    for (const item of contrast) assert(item.ratio >= 4.5, `Text contrast below 4.5: ${item.selector} = ${item.ratio}`);
    const layouts = [];
    for (const [width, height] of [[1120, 760], [1440, 960]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      await page.getByTestId("part-label").scrollIntoViewIfNeeded();
      const layout = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="part-label"]'), panel = document.querySelector('.inspector');
        const rect = input.getBoundingClientRect(), parent = panel.getBoundingClientRect();
        return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio,
          noBodyOverflow: document.body.scrollWidth <= window.innerWidth && document.body.scrollHeight <= window.innerHeight,
          fieldAccessible: rect.left >= parent.left && rect.right <= parent.right && rect.top >= parent.top && rect.bottom <= parent.bottom };
      });
      assert(layout.noBodyOverflow && layout.fieldAccessible);
      layouts.push({ width, height, ...layout });
    }
    assert.deepEqual((await inspect()).project, before.project);
    const environment = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0]; return { hidden: !w.isVisible(), displayScale: screen.getDisplayMatching(w.getBounds()).scaleFactor,
        zoomFactor: w.webContents.getZoomFactor() };
    }); assert(environment.hidden);
    await size.focus(); await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Размер Y");
    await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,
      { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
    await writeFile(join(root, "keyboard-focus.png"), Buffer.from(png, "base64"));
    const report = { status: "PASS", ...environment, focus, contrast, layouts,
      checks: ["visible keyboard numeric focus", "unfocused compact numbers without precision loss on focus/blur",
        "keyboard mode switching and pressed state", "invalid input announces alert without changing document",
        "important text/error contrast at least 4.5", "two actual window sizes with scrollable controls",
        "document/geometry unchanged by accessibility checks"],
      scope: "Actual current display scale only; forced zoom and per-monitor DPI transfer are separate checks" };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await app.close(); }
}
