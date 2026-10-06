import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ART_REVIEW_LIMITS, ArtReviewCandidateV1Schema, ArtReviewScorecardV1Schema } from "@mcdev/assets-contracts";
import { previewArtScorecard, type ArtReviewPreview, type ArtReviewDiagnostic } from "@mcdev/assets-core";
import { MAX_INLINE_SPEC_BYTES, validateInlineSpec } from "@mcdev/validation";

export interface ArtReviewInputInspection {
  readonly kind: "mcdev-art-review-inputs/v1";
  readonly candidateManifestSha256: string;
  readonly scorecardSha256: string;
  readonly artSpecSha256: string;
  readonly rubricSha256: string;
  readonly reviewRequested: boolean;
  readonly bindingsAccepted: boolean;
  readonly artSpecVersion: 0 | 1 | null;
  readonly decision: "DRAFT" | "NEEDS_REPAIR";
  readonly releaseEligible: false;
  readonly preview: ArtReviewPreview;
  readonly diagnostics: readonly ArtReviewDiagnostic[];
  readonly modelMeasurements: "NOT_RUN";
  readonly rubricPolicySource: "compiled-table-0.1.0";
}
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function bounded(text: string, limit: number): void {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > limit)
    throw new Error("Art review: превышен предел входного документа.");
}
/** Проверяет реальные bytes задания и его связи. Не измеряет модель и не удостоверяет человека. */
export function inspectArtReviewInputs(candidatePayload: string, scorecardPayload: string, artSpecPayload: string, rubricPayload: string): ArtReviewInputInspection {
  bounded(artSpecPayload, MAX_INLINE_SPEC_BYTES); bounded(rubricPayload, ART_REVIEW_LIMITS.documentBytes);
  // Preview первым применяет strict schema и структурные ограничения обоих review documents.
  const preview = previewArtScorecard(candidatePayload, scorecardPayload);
  const candidate = ArtReviewCandidateV1Schema.parse(JSON.parse(candidatePayload)), scorecard = ArtReviewScorecardV1Schema.parse(JSON.parse(scorecardPayload));
  const artSpecSha256 = digest(artSpecPayload), rubricSha256 = digest(rubricPayload), diagnostics: ArtReviewDiagnostic[] = [];
  const add = (id: string, artifact: string, message: string) => diagnostics.push({ id, artifact, message });
  if (candidate.artSpecSha256 !== artSpecSha256 || scorecard.artSpecSha256 !== artSpecSha256)
    add("ART_HASH_MISMATCH", "source/artspec.json", "SHA-256 прочитанного ArtSpec не совпадает с candidate/scorecard.");
  if (candidate.rubricSha256 !== rubricSha256 || scorecard.rubricSha256 !== rubricSha256)
    add("ART_HASH_MISMATCH", "source/rubric.md", "SHA-256 прочитанной rubric не совпадает с candidate/scorecard.");
  for (const [name, payload, sha256] of [["ArtSpec", artSpecPayload, artSpecSha256], ["rubric", rubricPayload, rubricSha256]] as const) {
    if (!candidate.files.some(file => file.role === "source" && file.sha256 === sha256 && file.bytes === Buffer.byteLength(payload, "utf8")))
      add("ART_EVIDENCE_MISSING", "qa/candidate.json#/files", `Прочитанный ${name} отсутствует в source manifest с точным размером и hash.`);
  }
  const validation = validateInlineSpec(artSpecPayload, "art");
  const spec = validation.valid && validation.value?.kind === "art" ? validation.value : undefined;
  if (!spec) {
    for (const error of validation.diagnostics.slice(0, 32))
      add("ART_SPEC_INVALID", `source/artspec.json#${error.path}`, `ArtSpec: ${error.code}. ${error.message}`);
    if (validation.diagnostics.length === 0) add("ART_SPEC_MISSING", "source/artspec.json", "Отсутствует валидный ArtSpec.");
  } else {
    if (spec.id !== candidate.assetId) add("ART_RESOURCE_REFERENCE_INVALID", "source/artspec.json#/id", "Asset ID ArtSpec не совпадает с candidate.");
    if (spec.assetClass !== candidate.assetClass) add("ART_SPEC_CLASS_MISMATCH", "source/artspec.json#/assetClass", "Класс ArtSpec не совпадает с candidate.");
    if (!isDeepStrictEqual(spec.targetMatrix, candidate.targetMatrix))
      add("ART_TARGET_MATRIX_MISMATCH", "source/artspec.json#/targetMatrix", "Target matrix ArtSpec и candidate должна совпадать полностью, включая runtime и renderer.");
  }
  const bindingsAccepted = diagnostics.length === 0;
  return { kind: "mcdev-art-review-inputs/v1", candidateManifestSha256: preview.candidateManifestSha256, scorecardSha256: preview.scorecardSha256,
    artSpecSha256, rubricSha256, reviewRequested: scorecard.reviewRequested, bindingsAccepted, artSpecVersion: spec?.schemaVersion ?? null,
    decision: scorecard.reviewRequested && !bindingsAccepted ? "NEEDS_REPAIR" : preview.decision, releaseEligible: false,
    preview, diagnostics: [...diagnostics, ...preview.diagnostics], modelMeasurements: "NOT_RUN", rubricPolicySource: "compiled-table-0.1.0" };
}
