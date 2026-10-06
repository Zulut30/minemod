import { open, mkdir, readdir, lstat, realpath, link, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { inspectArtReviewInputs, type ArtReviewInputInspection } from "./art-review.ts";

export const ART_REVIEW_HISTORY_LIMITS = Object.freeze({ events: 32, candidates: 64, eventBytes: 1_048_576, candidateBytes: 8_388_608, pendingFiles: 8 });
export interface ArtReviewDocuments { readonly candidate: string; readonly scorecard: string; readonly artSpec: string; readonly rubric: string }
interface HistoryEvent {
  readonly schemaVersion: 1;
  readonly kind: "mcdev-art-review-draft-history";
  readonly candidateManifestSha256: string;
  readonly sequence: number;
  readonly previousEventSha256: string | null;
  readonly checkedAtUtc: string;
  readonly documents: ArtReviewDocuments;
}
export interface ArtReviewHistorySnapshot {
  readonly candidateManifestSha256: string;
  readonly headSha256: string;
  readonly sequence: number;
  readonly documents: ArtReviewDocuments;
  readonly inspection: ArtReviewInputInspection;
  readonly history: readonly { readonly sequence: number; readonly sha256: string; readonly reviewRequested: boolean }[];
  readonly storageBytes: number;
  readonly authority: "draft-history-not-human-approval";
}
export class ArtReviewHistoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ArtReviewHistoryError"; this.code = code; }
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function fail(code: string, message: string): never { throw new ArtReviewHistoryError(code, message); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).every(key => typeof key === "string") && Object.keys(descriptors).sort().join(",") === [...keys].sort().join(",") &&
    Object.values(descriptors).every(descriptor => descriptor.enumerable && descriptor.get === undefined && descriptor.set === undefined);
}
function inspect(documents: ArtReviewDocuments): ArtReviewInputInspection {
  if (!exact(documents, ["candidate", "scorecard", "artSpec", "rubric"]) || Object.values(documents).some(value => typeof value !== "string"))
    fail("ART_REVIEW_HISTORY_INPUT", "Журнал принимает только четыре ограниченных review documents.");
  return inspectArtReviewInputs(documents.candidate, documents.scorecard, documents.artSpec, documents.rubric);
}
async function boundedFile(path: string): Promise<string> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) fail("ART_REVIEW_HISTORY_PATH", "Запись должна быть обычным файлом.");
  const file = await open(path, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > ART_REVIEW_HISTORY_LIMITS.eventBytes) fail("ART_REVIEW_HISTORY_LIMIT", "Запись превышает лимит.");
    const bytes = Buffer.alloc(ART_REVIEW_HISTORY_LIMITS.eventBytes + 1); let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead;
    }
    if (length > ART_REVIEW_HISTORY_LIMITS.eventBytes) fail("ART_REVIEW_HISTORY_LIMIT", "Запись выросла за предел допустимого размера.");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { fail("ART_REVIEW_HISTORY_INVALID", "Запись содержит повреждённый UTF-8."); }
  } finally { await file.close(); }
}

/** Private application storage. Записи сохраняют draft, не являются полномочиями человека. */
export class ArtReviewDraftHistory {
  readonly directory: string;
  constructor(directory: string) {
    if (!isAbsolute(directory)) fail("ART_REVIEW_HISTORY_PATH", "Root журнала должен быть абсолютным.");
    this.directory = resolve(directory);
  }
  private async folder(candidate: string, create: boolean): Promise<string | null> {
    if (!hash(candidate)) fail("ART_REVIEW_HISTORY_INPUT", "Требуется точный SHA-256 candidate.");
    if (create) await mkdir(this.directory, { recursive: true });
    let root;
    try { root = await lstat(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return null; throw error; }
    if (!root.isDirectory() || root.isSymbolicLink()) fail("ART_REVIEW_HISTORY_PATH", "Root журнала не должен быть symlink.");
    const entries = await readdir(this.directory);
    if (entries.length > ART_REVIEW_HISTORY_LIMITS.candidates || entries.some(entry => !hash(entry)))
      fail("ART_REVIEW_HISTORY_LIMIT", "Root содержит неизвестные записи или превышает предел candidates.");
    if (create && !entries.includes(candidate) && entries.length >= ART_REVIEW_HISTORY_LIMITS.candidates)
      fail("ART_REVIEW_HISTORY_LIMIT", "Достигнут предел сохранённых candidates.");
    const folder = join(this.directory, candidate); if (create) await mkdir(folder, { recursive: true });
    let metadata;
    try { metadata = await lstat(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return null; throw error; }
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || relative(await realpath(this.directory), await realpath(folder)) !== candidate)
      fail("ART_REVIEW_HISTORY_PATH", "Candidate directory выходит за root или является symlink.");
    return folder;
  }
  async load(candidate: string): Promise<ArtReviewHistorySnapshot | null> {
    const folder = await this.folder(candidate, false); if (!folder) return null;
    const names = await readdir(folder), files = names.filter(name => /^\d{6}\.json$/u.test(name)).sort();
    const pending = names.filter(name => /^\.pending-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(name));
    if (files.length > ART_REVIEW_HISTORY_LIMITS.events || pending.length > ART_REVIEW_HISTORY_LIMITS.pendingFiles || files.length + pending.length !== names.length)
      fail("ART_REVIEW_HISTORY_INVALID", "Журнал содержит неизвестные записи или превышает лимит событий.");
    let snapshot: ArtReviewHistorySnapshot | null = null, storageBytes = 0;
    const history: { sequence: number; sha256: string; reviewRequested: boolean }[] = [];
    for (const [index, name] of files.entries()) {
      if (name !== `${String(index + 1).padStart(6, "0")}.json`) fail("ART_REVIEW_HISTORY_INVALID", "В последовательности журнала есть пропуск.");
      const text = await boundedFile(join(folder, name)); storageBytes += Buffer.byteLength(text);
      if (storageBytes > ART_REVIEW_HISTORY_LIMITS.candidateBytes) fail("ART_REVIEW_HISTORY_LIMIT", "Журнал превышает суммарный предел.");
      let value: unknown; try { value = JSON.parse(text); } catch { fail("ART_REVIEW_HISTORY_INVALID", "Запись журнала содержит некорректный JSON."); }
      if (!exact(value, ["schemaVersion", "kind", "candidateManifestSha256", "sequence", "previousEventSha256", "checkedAtUtc", "documents"]) ||
        value.schemaVersion !== 1 || value.kind !== "mcdev-art-review-draft-history" || value.candidateManifestSha256 !== candidate || value.sequence !== index + 1 ||
        value.previousEventSha256 !== (snapshot?.headSha256 ?? null) || typeof value.checkedAtUtc !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.checkedAtUtc) || !Number.isFinite(Date.parse(value.checkedAtUtc)) || new Date(value.checkedAtUtc).toISOString() !== value.checkedAtUtc)
        fail("ART_REVIEW_HISTORY_INVALID", "Shape, версия или hash-chain записи повреждены.");
      const documents = value.documents as ArtReviewDocuments;
      let inspection: ArtReviewInputInspection;
      try { inspection = inspect(documents); } catch { fail("ART_REVIEW_HISTORY_INVALID", "Сохранённые документы не проходят проверку; исходный журнал сохранён."); }
      if (inspection.candidateManifestSha256 !== candidate) fail("ART_REVIEW_HISTORY_INVALID", "Candidate bytes изменились внутри журнала.");
      if (snapshot?.inspection.reviewRequested && !inspection.reviewRequested)
        fail("ART_REVIEW_REQUEST_ROLLBACK", "Запрос formal review нельзя вернуть в false для тех же candidate bytes.");
      const headSha256 = digest(text); history.push({ sequence: index + 1, sha256: headSha256, reviewRequested: inspection.reviewRequested });
      snapshot = { candidateManifestSha256: candidate, headSha256, sequence: index + 1, documents, inspection, history: [...history], storageBytes, authority: "draft-history-not-human-approval" };
    }
    return snapshot;
  }
  async save(documents: ArtReviewDocuments, expectedHeadSha256: string | null): Promise<ArtReviewHistorySnapshot> {
    if (expectedHeadSha256 !== null && !hash(expectedHeadSha256)) fail("ART_REVIEW_HISTORY_INPUT", "Expected head должен быть SHA-256 или null.");
    const inspection = inspect(documents), candidate = inspection.candidateManifestSha256;
    const retained = Object.freeze({ ...documents });
    const previous = await this.load(candidate);
    if (expectedHeadSha256 !== (previous?.headSha256 ?? null)) fail("ART_REVIEW_HISTORY_CONFLICT", "История изменилась. Прочитайте новый head перед сохранением.");
    if (previous?.inspection.reviewRequested && !inspection.reviewRequested) fail("ART_REVIEW_REQUEST_ROLLBACK", "Запрос review уже сохранён для этого candidate.");
    const sequence = (previous?.sequence ?? 0) + 1;
    const event: HistoryEvent = { schemaVersion: 1, kind: "mcdev-art-review-draft-history", candidateManifestSha256: candidate, sequence,
      previousEventSha256: previous?.headSha256 ?? null, checkedAtUtc: new Date().toISOString(), documents: retained };
    const text = JSON.stringify(event) + "\n", bytes = Buffer.byteLength(text);
    if (sequence > ART_REVIEW_HISTORY_LIMITS.events || bytes > ART_REVIEW_HISTORY_LIMITS.eventBytes || bytes + (previous?.storageBytes ?? 0) > ART_REVIEW_HISTORY_LIMITS.candidateBytes)
      fail("ART_REVIEW_HISTORY_LIMIT", "Следующая запись превышает предел истории.");
    const folder = (await this.folder(candidate, true))!;
    const temp = join(folder, `.pending-${randomUUID()}`), target = join(folder, `${String(sequence).padStart(6, "0")}.json`);
    try {
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      // link публикует готовый файл одним действием и не перезаписывает занятую CAS-позицию.
      try { await link(temp, target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("ART_REVIEW_HISTORY_CONFLICT", "Другой writer уже занял следующую запись.");
        throw error;
      }
    } finally { await rm(temp, { force: true }).catch(() => undefined); }
    return { candidateManifestSha256: candidate, headSha256: digest(text), sequence, documents: { ...retained },
      inspection, history: [...(previous?.history ?? []), { sequence, sha256: digest(text), reviewRequested: inspection.reviewRequested }],
      storageBytes: bytes + (previous?.storageBytes ?? 0), authority: "draft-history-not-human-approval" };
  }
}
