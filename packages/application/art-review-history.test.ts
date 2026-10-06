import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, readdir, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { ART_CRITERIA } from "@mcdev/assets-contracts";
import { ArtReviewDraftHistory, ArtReviewHistoryError, type ArtReviewDocuments } from "./art-review-history.ts";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const artSpec = await readFile(new URL("../../fixtures/art/leaf-sword.artspec-v1.json", import.meta.url), "utf8"), spec = JSON.parse(artSpec);
const rubric = await readFile(new URL("../../docs/quality/art-quality-rubric-v0.md", import.meta.url), "utf8");
const candidate = JSON.stringify({ schemaVersion: 1, kind: "mcdev-art-review-candidate", assetId: spec.id, assetClass: spec.assetClass,
  rubricVersion: "0.1.0", rubricSha256: sha(rubric), artSpecSha256: sha(artSpec), targetMatrix: spec.targetMatrix,
  files: [["source/artspec.json", artSpec], ["source/rubric.md", rubric]].map(([path, text]) => ({ path, role: "source", bytes: Buffer.byteLength(text!), sha256: sha(text!) })) });
const card = { schemaVersion: 1, kind: "mcdev-art-review-scorecard", rubricVersion: "0.1.0", rubricSha256: sha(rubric), artSpecSha256: sha(artSpec),
  candidateManifestSha256: sha(candidate), reviewRequested: false, criteria: ART_CRITERIA.map(({ id }) => ({ id, assessment: { status: "not-rated" } })), blockers: [] };
const documents: ArtReviewDocuments = { candidate, scorecard: JSON.stringify(card), artSpec, rubric };
const root = await mkdtemp(join(tmpdir(), "mcdev-art-review-history-"));
const code = (expected: string) => (error: unknown) => error instanceof ArtReviewHistoryError && error.code === expected;
try {
  const directory = join(root, "history"), history = new ArtReviewDraftHistory(directory), id = sha(candidate);
  assert.equal(await history.load(id), null);
  await assert.rejects(history.save(documents, "0".repeat(64)), code("ART_REVIEW_HISTORY_CONFLICT"));
  assert.deepEqual(await readdir(root), []); // Отвергнутый CAS не создаёт storage.
  const first = await history.save(documents, null);
  assert.equal(first.sequence, 1); assert.equal(first.inspection.decision, "DRAFT"); assert.equal(first.inspection.releaseEligible, false);
  const requested = { ...documents, scorecard: JSON.stringify({ ...card, reviewRequested: true }) };
  const second = await history.save(requested, first.headSha256);
  assert.equal(second.inspection.reviewRequested, true); assert.equal(second.inspection.decision, "NEEDS_REPAIR");
  assert.equal((await new ArtReviewDraftHistory(directory).load(id))!.headSha256, second.headSha256);
  await assert.rejects(history.save(documents, second.headSha256), code("ART_REVIEW_REQUEST_ROLLBACK"));
  await assert.rejects(history.save(requested, first.headSha256), code("ART_REVIEW_HISTORY_CONFLICT"));
  const race = await Promise.allSettled([history.save(requested, second.headSha256), new ArtReviewDraftHistory(directory).save(requested, second.headSha256)]);
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
  assert(race.some(result => result.status === "rejected" && code("ART_REVIEW_HISTORY_CONFLICT")(result.reason)));
  const current = (await history.load(id))!; assert.equal(current.sequence, 3); assert.equal(current.authority, "draft-history-not-human-approval");
  assert.deepEqual(current.history.map(event => event.reviewRequested), [false, true, true]);
  assert.deepEqual(await readdir(join(directory, id)), ["000001.json", "000002.json", "000003.json"]);
  const immutable = await readFile(join(directory, id, "000001.json"), "utf8");
  const mutated = { ...documents }, pending = new ArtReviewDraftHistory(join(root, "copy")).save(mutated, null);
  mutated.scorecard = JSON.stringify({ ...card, reviewRequested: true });
  assert.equal((await pending).inspection.reviewRequested, false); // Caller mutation не меняет сохранённые документы.
  const broken = JSON.parse(immutable); broken.checkedAtUtc = "2026-01-01T00:00:00.000Z";
  await writeFile(join(directory, id, "000001.json"), JSON.stringify(broken));
  await assert.rejects(history.load(id), code("ART_REVIEW_HISTORY_INVALID"));
  await assert.rejects(history.save(requested, current.headSha256), code("ART_REVIEW_HISTORY_INVALID"));
  assert.equal(await readFile(join(directory, id, "000001.json"), "utf8"), JSON.stringify(broken));
  await writeFile(join(directory, id, "000001.json"), immutable);
  const lastBytes = await readFile(join(directory, id, "000003.json"), "utf8"), invalidDate = JSON.parse(lastBytes);
  invalidDate.checkedAtUtc = "2026-02-30T00:00:00.000Z";
  await writeFile(join(directory, id, "000003.json"), JSON.stringify(invalidDate));
  await assert.rejects(history.load(id), code("ART_REVIEW_HISTORY_INVALID"));
  await writeFile(join(directory, id, "000003.json"), "\uFEFF" + lastBytes);
  await assert.rejects(history.load(id), code("ART_REVIEW_HISTORY_INVALID")); // Нормализация BOM не скрывает изменение bytes.
  const last = JSON.parse(lastBytes); last.approval = "APPROVED";
  await writeFile(join(directory, id, "000003.json"), JSON.stringify(last));
  await assert.rejects(history.load(id), code("ART_REVIEW_HISTORY_INVALID"));
  assert.throws(() => new ArtReviewDraftHistory("relative"), code("ART_REVIEW_HISTORY_PATH"));
  await assert.rejects(history.load("../outside"), code("ART_REVIEW_HISTORY_INPUT"));
  const paths = join(root, "paths"); await mkdir(paths); await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), join(paths, id), "junction");
  await assert.rejects(new ArtReviewDraftHistory(paths).load(id), code("ART_REVIEW_HISTORY_PATH"));
  const limited = new ArtReviewDraftHistory(join(root, "limited")); let head: string | null = null;
  for (let index = 0; index < 32; index++) head = (await limited.save(documents, head)).headSha256;
  await assert.rejects(limited.save(documents, head), code("ART_REVIEW_HISTORY_LIMIT"));
  assert.equal((await limited.load(id))!.sequence, 32);
  process.stdout.write("Art review draft history: immutable atomic slots, restart, real CAS race, monotonic request, retained corruption, strict shape/path, caller snapshot and bounded history PASS\n");
} finally {
  if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("mcdev-art-review-history-")) await rm(root, { recursive: true, force: true });
  else process.stderr.write("Небезопасный test cleanup root; удаление отменено.\n");
}
