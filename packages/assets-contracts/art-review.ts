import { z } from "zod";

export const ART_REVIEW_LIMITS = Object.freeze({ documentBytes: 65_536, files: 64, fileBytes: 8_388_608, totalBytes: 33_554_432, nodes: 4096, depth: 12 });
export const ART_RUBRIC_VERSION = "0.1.0" as const;
export const ART_REVIEW_CANDIDATE_SCHEMA_ID = "https://mcdev.local/schemas/art-review-candidate-v1.json";
export const ART_REVIEW_SCORECARD_SCHEMA_ID = "https://mcdev.local/schemas/art-review-scorecard-v1.json";
export const ART_CRITERIA = Object.freeze(([
  { id: "T1_FORMAT_REFERENCES", category: "technical", weight: 7 },
  { id: "T2_GEOMETRY_UV_TEXTURE", category: "technical", weight: 7 },
  { id: "T3_RIG_ANIMATION", category: "technical", weight: 5 },
  { id: "T4_PERFORMANCE_BUDGET", category: "technical", weight: 6 },
  { id: "T5_SOURCE_RUNTIME_PARITY", category: "technical", weight: 5 },
  { id: "V1_SILHOUETTE_READABILITY", category: "visual", weight: 8 },
  { id: "V2_STYLE_PALETTE_MATERIAL", category: "visual", weight: 7 },
  { id: "V3_SURFACE_COHERENCE", category: "visual", weight: 6 },
  { id: "V4_MOTION_STATE_POLISH", category: "visual", weight: 5 },
  { id: "V5_SET_CONSISTENCY", category: "visual", weight: 4 },
  { id: "G1_RENDER_CONTEXTS", category: "inGame", weight: 7 },
  { id: "G2_LIGHTING_DISTANCE", category: "inGame", weight: 6 },
  { id: "G3_GUI_INVENTORY", category: "inGame", weight: 5 },
  { id: "G4_GAMEPLAY_TIMING", category: "inGame", weight: 4 },
  { id: "G5_TARGET_MATRIX_STABILITY", category: "inGame", weight: 3 },
  { id: "P1_IDENTITY_REPRODUCIBILITY", category: "provenance", weight: 5 },
  { id: "P2_GENERATION_HISTORY", category: "provenance", weight: 4 },
  { id: "P3_RIGHTS_EVIDENCE", category: "provenance", weight: 4 },
  { id: "P4_REVIEW_TRACE", category: "provenance", weight: 2 },
] as const).map(criterion => Object.freeze(criterion)));
export const ART_CATEGORIES = Object.freeze({
  technical: Object.freeze({ maximum: 30, minimum: 27 }), visual: Object.freeze({ maximum: 30, minimum: 24 }),
  inGame: Object.freeze({ maximum: 25, minimum: 21 }), provenance: Object.freeze({ maximum: 15, minimum: 13 }),
});
export const ART_HARD_BLOCKERS = Object.freeze([
  "ART_EVIDENCE_MISSING", "ART_SPEC_MISSING", "ART_HASH_MISMATCH", "ART_FORMAT_INVALID",
  "ART_RESOURCE_REFERENCE_INVALID", "ART_BUDGET_EXCEEDED", "ART_GEOMETRY_INVALID", "ART_UV_INVALID",
  "ART_TEXTURE_INVALID", "ART_RIG_ANIMATION_INVALID", "ART_RUNTIME_SMOKE_FAILED", "ART_MISSING_TEXTURE_VISIBLE",
  "ART_PROVENANCE_INCOMPLETE", "ART_LICENSE_UNRESOLVED", "ART_REFERENCE_RIGHTS_UNRESOLVED", "ART_SECRET_EXPOSED",
] as const);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = z.string().min(1).max(1024).refine(value => value.trim().length > 0);
const path = z.string().max(240).regex(/^(source|runtime|qa)\/[a-z0-9_./-]+$/u).refine(value =>
  value.split("/").every(part => part !== "" && part !== "." && part !== ".." && !part.endsWith(".") &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u.test(part)) &&
  !["qa/candidate.json", "qa/scorecard.json", "qa/approval.json"].includes(value));
const criterionId = z.enum(ART_CRITERIA.map(criterion => criterion.id));
export const ArtReviewCandidateV1Schema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("mcdev-art-review-candidate"),
  assetId: z.string().max(193).regex(/^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,128}$/u).refine(value =>
    value.replace(":", "/").split("/").every(part => part && part !== "." && part !== "..")),
  assetClass: z.enum(["item-icon", "cuboid-model", "animated-model", "structure", "decorative-mesh", "ui-sprite", "wearable-set"]),
  rubricVersion: z.literal(ART_RUBRIC_VERSION), rubricSha256: hash, artSpecSha256: hash,
  targetMatrix: z.array(z.strictObject({ minecraft: z.string().min(1).max(32),
    loader: z.enum(["fabric", "neoforge", "forge", "paper"]), loaderVersion: z.string().min(1).max(64),
    java: z.number().int().min(17).max(25), runtime: z.strictObject({ id: z.literal("java"), version: z.string().min(1).max(32) }),
    renderer: z.strictObject({ id: z.string().min(1).max(64), version: z.string().min(1).max(64) }),
  })).min(1).max(4),
  files: z.array(z.strictObject({ path, role: z.enum(["source", "runtime", "technical", "provenance", "preview", "in-game"]),
    bytes: z.number().int().min(1).max(ART_REVIEW_LIMITS.fileBytes), sha256: hash,
  })).max(ART_REVIEW_LIMITS.files),
}).superRefine((candidate, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (new Set(candidate.files.map(file => file.path)).size !== candidate.files.length) issue("Пути evidence должны быть уникальны.");
  if (candidate.files.reduce((total, file) => total + file.bytes, 0) > ART_REVIEW_LIMITS.totalBytes) issue("Превышен суммарный бюджет evidence.");
  if (new Set(candidate.targetMatrix.map(target => JSON.stringify(target))).size !== candidate.targetMatrix.length) issue("Target matrix содержит повторения.");
  for (const file of candidate.files) {
    const prefix = file.role === "source" ? "source/" : file.role === "runtime" ? "runtime/" : "qa/";
    if (!file.path.startsWith(prefix)) issue("Роль evidence не соответствует пути.");
  }
});
const rating = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("rated"), rating: z.number().int().min(0).max(4), rationale: text, evidence: z.array(path).min(1).max(8) }),
  z.strictObject({ status: z.literal("not-rated") }),
  z.strictObject({ status: z.literal("not-applicable-requested"), rationale: text, evidence: z.array(path).min(1).max(8) }),
]);
export const ArtReviewScorecardV1Schema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("mcdev-art-review-scorecard"),
  rubricVersion: z.literal(ART_RUBRIC_VERSION), rubricSha256: hash, artSpecSha256: hash, candidateManifestSha256: hash,
  reviewRequested: z.boolean(),
  criteria: z.array(z.strictObject({ id: criterionId, assessment: rating })).length(ART_CRITERIA.length),
  blockers: z.array(z.strictObject({ id: z.enum(ART_HARD_BLOCKERS), message: text, evidence: path })).max(32),
}).superRefine((scorecard, context) => {
  if (new Set(scorecard.criteria.map(criterion => criterion.id)).size !== ART_CRITERIA.length)
    context.addIssue({ code: "custom", message: "Каждый критерий rubric должен встречаться ровно один раз." });
  if (scorecard.criteria.some(criterion => criterion.assessment.status !== "not-rated" &&
      new Set(criterion.assessment.evidence).size !== criterion.assessment.evidence.length))
    context.addIssue({ code: "custom", message: "Evidence одного rating не должно повторяться." });
});
export type ArtReviewCandidateV1 = z.infer<typeof ArtReviewCandidateV1Schema>;
export type ArtReviewScorecardV1 = z.infer<typeof ArtReviewScorecardV1Schema>;
export type ArtReviewCriterionId = typeof ART_CRITERIA[number]["id"];
export type ArtReviewCategory = keyof typeof ART_CATEGORIES;

export const ArtReviewCandidateV1JsonSchema = { ...z.toJSONSchema(ArtReviewCandidateV1Schema), $id: ART_REVIEW_CANDIDATE_SCHEMA_ID };
export const ArtReviewScorecardV1JsonSchema = { ...z.toJSONSchema(ArtReviewScorecardV1Schema), $id: ART_REVIEW_SCORECARD_SCHEMA_ID };
