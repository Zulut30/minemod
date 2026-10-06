/* global window, document, Image */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export async function checkArtReviewDesktop(options, output) {
  const root = join(output, "art-review"), data = join(root, "user-data"); await mkdir(root, { recursive: true });
  const launch = { ...options, args: options.args.filter(value => !value.startsWith("--editor-data=")).concat(`--editor-data=${data}`) };
  const artSpecPath = join(repo, "fixtures/art/leaf-sword.artspec-v1.json"), originalArtSpec = await readFile(artSpecPath);
  const version = JSON.parse(await readFile(join(repo, "apps/model-editor/package.json"), "utf8")).version;
  let app; const errors = [], events = [], stderr = [];
  const start = async () => {
    app = await electron.launch(launch); app.process().stderr?.on("data", chunk => stderr.push(String(chunk)));
    const page = await app.firstWindow(); page.on("pageerror", error => errors.push(error.message));
    await page.locator('[data-testid^="part-"]').first().waitFor();
    assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible())));
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    return page;
  };
  try {
    let page = await start();
    const inspect = () => page.evaluate(() => window.studio.request({ kind: "inspect" }));
    const initial = await inspect(); assert(initial.ok); const reference = { projectId: initial.state.project.projectId, expectedRevision: initial.state.revision };
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, artSpecPath);
    for (const control of [{ action: "approve" }, { action: "prepare", ...reference, path: artSpecPath }, { action: "get", approved: true }]) {
      const result = await page.evaluate(control => window.studio.request({ kind: "artReview", control }), control);
      assert.equal(result.ok, false); assert.equal(result.error.code, "INVALID_REQUEST");
    }
    await page.getByTestId("mode-review").click(); await page.locator(".art-review-panel > summary").click();
    await page.getByTestId("art-review-prepare").click();
    await page.getByTestId("art-review-status").waitFor({ timeout: 120_000 });
    assert.match(await page.getByTestId("art-review-status").innerText(), /17 файлов/u);
    assert.match(await page.getByTestId("art-review-status").innerText(), /19 из 19 ещё без оценки/u);
    assert.match(await page.getByTestId("art-review-diagnostics").innerText(), /ID модели не совпадает с заданием/u);
    assert.doesNotMatch(await page.getByTestId("art-review-diagnostics").innerText(), /ART_SCORE_|Критерий ещё не оценён/u);
    const draft = await page.evaluate(() => window.studio.request({ kind: "artReview", control: { action: "get" } })); assert(draft.ok && draft.artReview);
    const review = draft.artReview; assert.equal(review.sequence, 1); assert.equal(review.decision, "DRAFT"); assert.equal(review.releaseEligible, false);
    assert.equal(review.matchesCurrentProject, true); assert.equal(review.bindingsAccepted, false); assert.equal(review.unratedCriteria, 19);
    assert.deepEqual((await inspect()).state, initial.state); assert.deepEqual(await readFile(artSpecPath), originalArtSpec);
    const folder = join(data, "art-review/candidates", review.candidateSha256), history = join(data, "art-review/history", review.candidateSha256);
    const firstBytes = await readFile(join(history, "000001.json")), event = JSON.parse(firstBytes), candidate = JSON.parse(event.documents.candidate), hashes = [];
    for (const file of candidate.files) {
      const bytes = await readFile(join(folder, file.path)); assert.equal(bytes.length, file.bytes); assert.equal(digest(bytes), file.sha256); hashes.push({ path: file.path, sha256: digest(bytes) });
      if (file.role === "preview") {
        const dimensions = await page.evaluate(async encoded => {
          const image = new Image(); image.src = "data:image/png;base64," + encoded; await image.decode(); return [image.naturalWidth, image.naturalHeight];
        }, bytes.toString("base64")); assert.deepEqual(dimensions, [1024, 768]);
      }
    }
    assert.equal(candidate.files.filter(file => file.role === "preview").length, 8);
    assert.deepEqual(JSON.parse(await readFile(join(folder, "source/editor.json"), "utf8")), initial.state.project);
    assert(!candidate.files.some(file => ["provenance", "in-game"].includes(file.role)));
    await page.getByTestId("art-review-request").waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="art-review-request"]').disabled);
    await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
    const screenshot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === "studio://app/index.html").webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
    await writeFile(join(root, "panel.png"), Buffer.from(screenshot, "base64"));
    await page.getByTestId("art-review-request").click();
    await page.waitForFunction(() => document.querySelector(".art-review-identity")?.textContent.includes("запись 2"));
    const requested = await page.evaluate(() => window.studio.request({ kind: "artReview", control: { action: "get" } })); assert(requested.ok && requested.artReview);
    assert.equal(requested.artReview.decision, "NEEDS_REPAIR"); assert.equal(requested.artReview.reviewRequested, true); assert.equal(requested.artReview.releaseEligible, false);
    const stale = await page.evaluate(control => window.studio.request({ kind: "artReview", control }), { action: "request", ...reference, expectedHeadSha256: review.headSha256 });
    assert.equal(stale.ok, false); assert.equal(stale.error.code, "ART_REVIEW_HISTORY_CONFLICT");
    assert.deepEqual(await readFile(join(history, "000001.json")), firstBytes); assert.deepEqual(await readdir(history), ["000001.json", "000002.json"]);
    const badCapture = join(folder, "qa/views/front.png"), originalCapture = await readFile(badCapture); await writeFile(badCapture, Buffer.from("corrupt"));
    const corrupted = await page.evaluate(() => window.studio.request({ kind: "artReview", control: { action: "get" } })); assert.equal(corrupted.ok, false);
    assert.equal((await readFile(badCapture)).toString(), "corrupt"); await writeFile(badCapture, originalCapture);
    await app.close(); app = undefined; page = await start();
    const reopened = await page.evaluate(() => window.studio.request({ kind: "artReview", control: { action: "get" } })); assert(reopened.ok && reopened.artReview);
    assert.deepEqual(reopened.artReview, requested.artReview); assert.deepEqual((await inspect()).state.project, initial.state.project);
    const updated = await page.evaluate(mutation => window.studio.request({ kind: "apply", mutation }), { ...reference, key: randomUUID(), commands: [{ type: "renamePart", partId: initial.state.project.parts[0].id, label: "изменённая модель" }] });
    assert(updated.ok);
    const mismatch = await page.evaluate(() => window.studio.request({ kind: "artReview", control: { action: "get" } })); assert(mismatch.ok && mismatch.artReview && !mismatch.artReview.matchesCurrentProject);
    const rejected = await page.evaluate(control => window.studio.request({ kind: "artReview", control }), { action: "request", projectId: updated.state.project.projectId, expectedRevision: updated.state.revision, expectedHeadSha256: requested.artReview.headSha256 });
    assert.equal(rejected.ok, false); assert.equal(rejected.error.code, "ART_REVIEW_STALE");
    for (const file of hashes) assert.equal(digest(await readFile(join(folder, file.path))), file.sha256);
    assert.deepEqual(await readFile(artSpecPath), originalArtSpec); assert.deepEqual(errors, []);
    assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible())));
    events.push("actual packaged dark panel", "17 actual hash-bound files", "8 decoded hidden captures", "unchanged model and ArtSpec", "request with no approval", "stale head rejected", "corrupted evidence retained", "restart", "changed model rejected", "strict IPC", "all windows hidden");
    const report = { status: "PASS", version, candidateSha256: review.candidateSha256, files: hashes, draft: review, requested: requested.artReview,
      events, humanApproval: "NOT_PERFORMED", inGame: "NOT_RUN", screenshot: "panel.png" };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } catch (error) {
    let body = ""; if (app) { try { body = await (await app.firstWindow()).locator("body").innerText(); } catch { /* Диагностика не должна скрывать исходную ошибку. */ } }
    await writeFile(join(root, "failure.json"), JSON.stringify({ error: String(error), errors, events, stderr, body }, null, 2)); throw error;
  }
  finally { if (app) await app.close(); }
}
