import { createHash } from "node:crypto";
import {
  ART_CATEGORIES, ART_CRITERIA, ART_REVIEW_LIMITS, ArtReviewCandidateV1Schema, ArtReviewScorecardV1Schema,
  type ArtReviewCategory, type ArtReviewCandidateV1, type ArtReviewScorecardV1,
} from "@mcdev/assets-contracts";

export interface ArtReviewDiagnostic { readonly id: string; readonly artifact: string; readonly message: string }
export interface ArtReviewPreview {
  readonly kind: "mcdev-art-review-preview/v1";
  readonly candidateManifestSha256: string;
  readonly scorecardSha256: string;
  readonly decision: "DRAFT" | "NEEDS_REPAIR";
  readonly decisionScope: "proposal-preview-not-persisted-formal-state";
  readonly releaseEligible: false;
  readonly ratingsSource: "caller-proposal-not-human-verified";
  readonly evidenceVerification: "references-only-content-and-game-not-verified";
  readonly scores: Readonly<Record<ArtReviewCategory | "total", number>>;
  readonly diagnostics: readonly ArtReviewDiagnostic[];
}
const digest = (payload: string | Uint8Array) => createHash("sha256").update(payload).digest("hex");
function document(payload: string): unknown {
  if (typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > ART_REVIEW_LIMITS.documentBytes)
    throw new Error("Art review: превышен лимит документа.");
  let value: unknown;
  try { value = JSON.parse(payload); } catch { throw new Error("Art review: некорректный JSON."); }
  const pending = [{ value, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++nodes > ART_REVIEW_LIMITS.nodes || node.depth > ART_REVIEW_LIMITS.depth)
      throw new Error("Art review: превышен лимит структуры.");
    if (typeof node.value === "object" && node.value !== null) {
      const children = Object.values(node.value);
      if (children.length > ART_REVIEW_LIMITS.files) throw new Error("Art review: превышен лимит контейнера.");
      for (const child of children) pending.push({ value: child, depth: node.depth + 1 });
    }
  }
  return value;
}
function parseCandidate(payload: string): ArtReviewCandidateV1 {
  const result = ArtReviewCandidateV1Schema.safeParse(document(payload));
  if (!result.success) throw new Error("Art review: candidate не соответствует контракту v1.");
  return result.data;
}
function parseScorecard(payload: string): ArtReviewScorecardV1 {
  const result = ArtReviewScorecardV1Schema.safeParse(document(payload));
  if (!result.success) throw new Error("Art review: scorecard не соответствует контракту v1.");
  return result.data;
}
/** Расчёт предложения. Обычный JSON не удостоверяет оценки человека и не разрешает release. */
export function previewArtScorecard(candidatePayload: string, scorecardPayload: string): ArtReviewPreview {
  const candidate = parseCandidate(candidatePayload), scorecard = parseScorecard(scorecardPayload);
  const candidateHash = digest(candidatePayload), diagnostics: ArtReviewDiagnostic[] = [];
  let repair = false;
  const add = (id: string, artifact: string, message: string, requiresRepair = true) => {
    diagnostics.push({ id, artifact, message }); if (requiresRepair) repair = true;
  };
  if (candidateHash !== scorecard.candidateManifestSha256 || candidate.artSpecSha256 !== scorecard.artSpecSha256 || candidate.rubricSha256 !== scorecard.rubricSha256)
    add("ART_HASH_MISMATCH", "qa/scorecard.json", "Ведомость относится к другим bytes candidate, ArtSpec или rubric.");
  const files = new Set(candidate.files.map(file => file.path));
  for (const role of ["source", "runtime", "technical", "provenance", "preview", "in-game"] as const) {
    if (!candidate.files.some(file => file.role === role)) add("ART_EVIDENCE_MISSING", "qa/candidate.json", `Отсутствует evidence с ролью ${role}.`);
  }
  const assessments = new Map(scorecard.criteria.map(criterion => [criterion.id, criterion.assessment]));
  const scores = { technical: 0, visual: 0, inGame: 0, provenance: 0, total: 0 };
  for (const category of Object.keys(ART_CATEGORIES) as ArtReviewCategory[]) {
    let weighted = 0, applicable = 0;
    for (const criterion of ART_CRITERIA.filter(criterion => criterion.category === category)) {
      const assessment = assessments.get(criterion.id)!;
      const assessmentPath = `qa/scorecard.json#/criteria/${scorecard.criteria.findIndex(entry => entry.id === criterion.id)}/assessment`;
      if (assessment.status === "not-applicable-requested") {
        // Предложение N/A не исключает вес без подтверждённой человеческой применимости.
        add("ART_NA_REVIEW_REQUIRED", assessmentPath, "N/A требует проверки класса/ArtSpec и решения человека.");
      } else if (assessment.status === "not-rated") {
        add("ART_EVIDENCE_MISSING", assessmentPath, "Критерий ещё не оценён.");
      } else weighted += assessment.rating * criterion.weight;
      applicable += criterion.weight;
      if (assessment.status !== "not-rated") {
        for (const reference of assessment.evidence) if (!files.has(reference))
          add("ART_EVIDENCE_MISSING", reference, "Rating ссылается на файл вне candidate manifest.");
      }
    }
    scores[category] = Math.round(ART_CATEGORIES[category].maximum * weighted / (4 * applicable) * 10) / 10;
    if (scores[category] < ART_CATEGORIES[category].minimum)
      add(`ART_SCORE_${category === "inGame" ? "INGAME" : category.toUpperCase()}_BELOW_THRESHOLD`, "qa/scorecard.json", `Категория ${category}: ${scores[category]} < ${ART_CATEGORIES[category].minimum}.`);
  }
  scores.total = Math.round((scores.technical + scores.visual + scores.inGame + scores.provenance) * 10) / 10;
  if (scores.total < 85) add("ART_SCORE_TOTAL_BELOW_THRESHOLD", "qa/scorecard.json", `Общая оценка ${scores.total} < 85.`);
  for (const blocker of scorecard.blockers) {
    add(blocker.id, blocker.evidence, blocker.message);
    if (!files.has(blocker.evidence)) add("ART_EVIDENCE_MISSING", blocker.evidence, "Blocker ссылается на файл вне candidate manifest.");
  }
  add("ART_REVIEW_REQUIRED", "qa/scorecard.json", "Ratings, N/A, технические и игровые evidence должны пройти formal review.", false);
  add("ART_HUMAN_APPROVAL_MISSING", "qa/approval.json", "Подтверждённое решение человека для точных hashes отсутствует.", false);
  return { kind: "mcdev-art-review-preview/v1", candidateManifestSha256: candidateHash, scorecardSha256: digest(scorecardPayload),
    decision: scorecard.reviewRequested && repair ? "NEEDS_REPAIR" : "DRAFT", decisionScope: "proposal-preview-not-persisted-formal-state", releaseEligible: false,
    ratingsSource: "caller-proposal-not-human-verified", evidenceVerification: "references-only-content-and-game-not-verified", scores, diagnostics };
}
/** Только сравнение переданных bytes. Не читает paths, не парсит codec и не удостоверяет provenance. */
export function verifyArtCandidateContents(candidatePayload: string, contents: readonly { readonly path: string; readonly bytes: Uint8Array }[]): { readonly kind: "mcdev-art-candidate-integrity/v1"; readonly candidateManifestSha256: string; readonly verifiedFiles: number; readonly verifiedBytes: number; readonly artisticApproval: "NOT_PERFORMED" } {
  const candidate = parseCandidate(candidatePayload);
  if (!Array.isArray(contents) || contents.length !== candidate.files.length || contents.length > ART_REVIEW_LIMITS.files)
    throw new Error("Art review: содержимое не совпадает с manifest files.");
  const files = new Map(candidate.files.map(file => [file.path, file])); let total = 0;
  for (const content of contents) {
    const file = content !== null && typeof content === "object" ? files.get(content.path) : undefined;
    if (!file || !(content.bytes instanceof Uint8Array) || content.bytes.byteLength !== file.bytes)
      throw new Error("Art review: неверный path, bytes или повторный файл.");
    total += content.bytes.byteLength;
    if (total > ART_REVIEW_LIMITS.totalBytes || digest(content.bytes) !== file.sha256)
      throw new Error("Art review: SHA-256 или суммарный бюджет не совпадает.");
    files.delete(content.path);
  }
  return { kind: "mcdev-art-candidate-integrity/v1", candidateManifestSha256: digest(candidatePayload), verifiedFiles: contents.length, verifiedBytes: total, artisticApproval: "NOT_PERFORMED" };
}
