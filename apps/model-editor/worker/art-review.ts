import { open, lstat, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname, resolve, sep } from "node:path";
import { z } from "zod";
import { EditorError, assetRequest, type EditorState } from "@mcdev/editor-core";
import { ArtReviewDraftHistory, type ArtReviewHistorySnapshot } from "../../../packages/application/art-review-history.ts";
import { ART_REVIEW_VIEWS, prepareArtReviewExport, prepareArtReviewCandidate, verifyArtReviewContents } from "../../../packages/application/art-review-candidate.ts";
import { ArtReviewControlSchema, type ArtReviewSummary } from "../shared/art-review.ts";
import type { View } from "../shared/bridge.ts";
import { renameWithRetry } from "./persistence.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const projectText = (state: EditorState) => JSON.stringify(state.project, null, 2) + "\n";
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const pointerSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: z.uuid(), projectSha256: hash, candidateSha256: hash });
async function plainDirectory(path: string, create = false) {
  if (create) await mkdir(path, { recursive: true });
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new EditorError("ART_REVIEW_PATH", "Папка review должна быть обычной локальной папкой.");
}
async function bytes(path: string, maximum: number): Promise<Buffer> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new EditorError("ART_REVIEW_PATH", "Review source должен быть обычным файлом.");
  const file = await open(path, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maximum) throw new EditorError("ART_REVIEW_LIMIT", "Review source превышает предел.");
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    while (length < buffer.length) { const result = await file.read(buffer, length, buffer.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
    if (length > maximum) throw new EditorError("ART_REVIEW_LIMIT", "Review source вырос за предел размера.");
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}
async function text(path: string, maximum: number) {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await bytes(path, maximum)); }
  catch (error) { if (error instanceof TypeError) throw new EditorError("ART_REVIEW_UTF8", "Review source содержит некорректный UTF-8."); throw error; }
}

/** Только private worker queue. Snapshot и журнал не являются человеческой приёмкой. */
export class StudioArtReview {
  private readonly history: ArtReviewDraftHistory;
  constructor(private readonly root: string, private readonly rubricPath: string) { this.history = new ArtReviewDraftHistory(join(root, "history")); }
  private pointer(state: EditorState) { return join(this.root, "pointers", `${state.project.projectId}.json`); }
  private async retained(state: EditorState) {
    let pointer;
    try {
      await plainDirectory(this.root); await plainDirectory(join(this.root, "pointers"));
      pointer = pointerSchema.parse(JSON.parse(await text(this.pointer(state), 1024)));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if (pointer.projectId !== state.project.projectId) throw new EditorError("ART_REVIEW_ID", "Указатель review относится к другому проекту.");
    const snapshot = await this.history.load(pointer.candidateSha256);
    if (!snapshot) throw new EditorError("ART_REVIEW_MISSING", "Сохранённый review отсутствует; предыдущие файлы сохранены.");
    const candidate = JSON.parse(snapshot.documents.candidate) as { files: { path: string; bytes: number }[] };
    const directory = join(this.root, "candidates", pointer.candidateSha256);
    await plainDirectory(join(this.root, "candidates")); await plainDirectory(directory);
    const contents = [];
    for (const file of candidate.files) {
      let parent = directory;
      for (const part of file.path.split("/").slice(0, -1)) { parent = join(parent, part); await plainDirectory(parent); }
      contents.push({ path: file.path, bytes: await bytes(join(directory, file.path), file.bytes) });
    }
    verifyArtReviewContents(snapshot.documents.candidate, contents);
    const source = contents.find(file => file.path === "source/editor.json");
    if (!source || sha(source.bytes.toString("utf8")) !== pointer.projectSha256) throw new EditorError("ART_REVIEW_HASH", "Исходник snapshot и указатель расходятся.");
    return { pointer, snapshot };
  }
  private summary(state: EditorState, snapshot: ArtReviewHistorySnapshot, projectSha256: string): ArtReviewSummary {
    const inspection = snapshot.inspection, candidate = JSON.parse(snapshot.documents.candidate), scorecard = JSON.parse(snapshot.documents.scorecard);
    return { candidateSha256: snapshot.candidateManifestSha256, headSha256: snapshot.headSha256, sequence: snapshot.sequence,
      decision: inspection.decision, reviewRequested: inspection.reviewRequested, matchesCurrentProject: sha(projectText(state)) === projectSha256,
      bindingsAccepted: inspection.bindingsAccepted, fileCount: candidate.files.length,
      unratedCriteria: scorecard.criteria.filter((criterion: { assessment: { status: string } }) => criterion.assessment.status === "not-rated").length,
      artSpecSha256: inspection.artSpecSha256, diagnostics: inspection.diagnostics.slice(0, 64).map(({ id, message }) => ({ id, message })),
      history: snapshot.history.map(({ sequence, reviewRequested }) => ({ sequence, reviewRequested })), releaseEligible: false };
  }
  async run(controlValue: unknown, state: EditorState, artSpecPath: string | undefined, capture: (view: View) => Promise<string>): Promise<ArtReviewSummary | null> {
    const control = ArtReviewControlSchema.parse(controlValue);
    if (control.action !== "get" && (control.projectId !== state.project.projectId || control.expectedRevision !== state.revision))
      throw new EditorError("REVISION_CONFLICT", "Модель изменилась. Подготовьте review для текущей версии.");
    if (control.action === "get" || control.action === "request") {
      const retained = await this.retained(state);
      if (control.action === "get") return retained ? this.summary(state, retained.snapshot, retained.pointer.projectSha256) : null;
      if (!retained || retained.pointer.projectSha256 !== sha(projectText(state))) throw new EditorError("ART_REVIEW_STALE", "Материалы относятся к прежней модели. Подготовьте их заново.");
      const scorecard = JSON.parse(retained.snapshot.documents.scorecard); scorecard.reviewRequested = true;
      const next = await this.history.save({ ...retained.snapshot.documents, scorecard: JSON.stringify(scorecard, null, 2) + "\n" }, control.expectedHeadSha256);
      return this.summary(state, next, retained.pointer.projectSha256);
    }
    if (!artSpecPath) throw new EditorError("ART_SPEC_MISSING", "Выберите ArtSpec для модели.");
    const artSpec = await text(artSpecPath, 262_144), rubric = await text(this.rubricPath, 65_536), payload = JSON.stringify(assetRequest(state.project));
    prepareArtReviewExport(payload, artSpec); // Экспорт проверяется до создания снимков.
    const captures = [];
    for (const view of ART_REVIEW_VIEWS) captures.push({ view, bytes: Buffer.from(await capture(view), "base64") });
    const prepared = prepareArtReviewCandidate(projectText(state), payload, artSpec, rubric, captures), id = prepared.inspection.candidateManifestSha256;
    await plainDirectory(this.root, true); await plainDirectory(join(this.root, "candidates"), true); await plainDirectory(join(this.root, "pointers"), true);
    const entries = await readdir(join(this.root, "candidates"));
    if (entries.some(entry => !/^[a-f0-9]{64}$/u.test(entry)) || entries.length >= 64 && !entries.includes(id)) throw new EditorError("ART_REVIEW_LIMIT", "Достигнут предел review snapshots.");
    const destination = join(this.root, "candidates", id);
    if (!entries.includes(id)) {
      const stage = join(this.root, `.pending-${randomUUID()}`); await mkdir(stage);
      try {
        for (const file of prepared.contents) { const target = resolve(stage, file.path);
          if (!target.startsWith(resolve(stage) + sep)) throw new EditorError("ART_REVIEW_PATH", "Путь выходит за snapshot.");
          await mkdir(dirname(target), { recursive: true }); await writeFile(target, file.bytes, { flag: "wx", mode: 0o600 }); }
        await renameWithRetry(stage, destination);
      } finally { if (resolve(stage).startsWith(resolve(this.root) + sep)) await rm(stage, { recursive: true, force: true }).catch(() => undefined); }
    }
    const previous = await this.history.load(id), snapshot = previous ?? await this.history.save(prepared.documents, null);
    const pointer = { schemaVersion: 1, projectId: state.project.projectId, projectSha256: sha(projectText(state)), candidateSha256: id };
    const temporary = join(this.root, "pointers", `.pending-${randomUUID()}`);
    try { await writeFile(temporary, JSON.stringify(pointer) + "\n", { flag: "wx", mode: 0o600 }); await renameWithRetry(temporary, this.pointer(state)); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
    // Повторная проверка actual files также обнаруживает ранее повреждённый snapshot.
    const retained = (await this.retained(state))!;
    return this.summary(state, snapshot, retained.pointer.projectSha256);
  }
}
