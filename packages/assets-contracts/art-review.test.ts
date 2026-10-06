import assert from "node:assert/strict";
import { ART_CRITERIA, ART_CATEGORIES, ArtReviewCandidateV1Schema, ArtReviewScorecardV1Schema,
  ArtReviewCandidateV1JsonSchema, ArtReviewScorecardV1JsonSchema } from "./art-review.ts";
const hash = "0".repeat(64);
const candidate = { schemaVersion: 1, kind: "mcdev-art-review-candidate", assetId: "minemod:leaf",
  assetClass: "cuboid-model", rubricVersion: "0.1.0", rubricSha256: hash, artSpecSha256: hash,
  targetMatrix: [{ minecraft: "1.20.1", loader: "fabric", loaderVersion: "0.19.3", java: 17,
    runtime: { id: "java", version: "17" }, renderer: { id: "minecraft-native-item", version: "1.20.1" } }],
  files: [{ path: "source/model.bbmodel", role: "source", bytes: 1, sha256: hash }],
};
const scorecard = { schemaVersion: 1, kind: "mcdev-art-review-scorecard", rubricVersion: "0.1.0",
  rubricSha256: hash, artSpecSha256: hash, candidateManifestSha256: hash, reviewRequested: false,
  criteria: ART_CRITERIA.map(({ id }) => ({ id, assessment: { status: "not-rated" } })), blockers: [],
};
assert(ArtReviewCandidateV1Schema.safeParse(candidate).success);
assert(ArtReviewScorecardV1Schema.safeParse(scorecard).success);
assert.equal(ART_CRITERIA.length, 19); assert.equal(new Set(ART_CRITERIA.map(c => c.id)).size, 19);
assert(Object.isFrozen(ART_CATEGORIES.technical)); assert(Object.isFrozen(ART_CRITERIA)); assert(ART_CRITERIA.every(Object.isFrozen));
assert.equal(ArtReviewCandidateV1JsonSchema.additionalProperties, false);
assert.equal(ArtReviewScorecardV1JsonSchema.additionalProperties, false);
assert.equal(ArtReviewCandidateV1JsonSchema.$id, "https://mcdev.local/schemas/art-review-candidate-v1.json");
assert.equal(ArtReviewScorecardV1JsonSchema.$id, "https://mcdev.local/schemas/art-review-scorecard-v1.json");
const candidateRejects = [
  { ...candidate, approved: true }, { ...candidate, assetId: "..:leaf" }, { ...candidate, assetId: "mod:a/../b" },
  { ...candidate, rubricVersion: "0.2.0" }, { ...candidate, targetMatrix: [] },
  { ...candidate, targetMatrix: [...candidate.targetMatrix, ...candidate.targetMatrix] },
  { ...candidate, files: [...candidate.files, ...candidate.files] },
  { ...candidate, files: Array.from({ length: 65 }, (_, index) => ({ ...candidate.files[0], path: `source/${index}` })) },
  { ...candidate, files: Array.from({ length: 5 }, (_, index) => ({ ...candidate.files[0], path: `source/${index}`, bytes: 8_388_608 })) },
  { ...candidate, targetMatrix: [{ ...candidate.targetMatrix[0], runtime: undefined }] },
  ...["source/../secret", "source//file", "source/con.json", "source/file.", "qa/approval.json", "C:/file", "source/model.bbmodel:stream", "source/./file", "source/UPPER"].map(path => ({ ...candidate, files: [{ ...candidate.files[0], path }] })),
  ...[0, -1, 1.5, 8_388_609, NaN, Infinity].map(bytes => ({ ...candidate, files: [{ ...candidate.files[0], bytes }] })),
  { ...candidate, files: [{ ...candidate.files[0], role: "runtime" }] },
];
for (const value of candidateRejects) assert.equal(ArtReviewCandidateV1Schema.safeParse(value).success, false);
const scorecardRejects = [
  { ...scorecard, actor: "human" }, { ...scorecard, approval: { decision: "APPROVED" } },
  { ...scorecard, criteria: scorecard.criteria.slice(1) },
  { ...scorecard, criteria: scorecard.criteria.map(criterion => ({ ...criterion, id: "T1_FORMAT_REFERENCES" })) },
  ...[-1, 5, 2.5, NaN, Infinity].map(rating => ({ ...scorecard, criteria: scorecard.criteria.map(criterion => ({ ...criterion,
    assessment: { status: "rated", rating, rationale: "Проверено", evidence: ["source/model.bbmodel"] } })) })),
  { ...scorecard, criteria: scorecard.criteria.map(criterion => ({ ...criterion,
    assessment: { status: "rated", rating: 4, rationale: "  ", evidence: ["source/model.bbmodel"] } })) },
  { ...scorecard, criteria: scorecard.criteria.map(criterion => ({ ...criterion,
    assessment: { status: "rated", rating: 4, rationale: "Проверено", evidence: [] } })) },
  { ...scorecard, blockers: [{ id: "ART_HUMAN_APPROVAL_MISSING", message: "Ожидается человек", evidence: "source/model.bbmodel" }] },
];
for (const value of scorecardRejects) assert.equal(ArtReviewScorecardV1Schema.safeParse(value).success, false);
process.stdout.write(`Art review contracts: 19 immutable criteria, strict records, portable paths and ${candidateRejects.length + scorecardRejects.length} negative inputs PASS\n`);
