import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ART_CRITERIA, type ArtReviewCandidateV1, type ArtReviewScorecardV1 } from "@mcdev/assets-contracts";
import { previewArtScorecard, verifyArtCandidateContents } from "./index.ts";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const contents = ["source", "runtime", "technical", "provenance", "preview", "in-game"].map((role, index) => ({
  path: `${role === "source" || role === "runtime" ? role : "qa"}/${index}.bin`, bytes: Buffer.from(`exact-${index}`),
}));
const candidate: ArtReviewCandidateV1 = { schemaVersion: 1, kind: "mcdev-art-review-candidate", assetId: "minemod:leaf",
  assetClass: "cuboid-model", rubricVersion: "0.1.0", rubricSha256: sha("rubric"), artSpecSha256: sha("spec"),
  targetMatrix: [{ minecraft: "1.20.1", loader: "fabric", loaderVersion: "0.19.3", java: 17, runtime: { id: "java", version: "17" }, renderer: { id: "minecraft-native-item", version: "1.20.1" } }],
  files: contents.map((file, index) => ({ path: file.path, bytes: file.bytes.length, sha256: sha(file.bytes),
    role: (["source", "runtime", "technical", "provenance", "preview", "in-game"] as const)[index]! })),
};
const payload = JSON.stringify(candidate);
function scorecard(rating = 4): ArtReviewScorecardV1 {
  return { schemaVersion: 1, kind: "mcdev-art-review-scorecard", rubricVersion: "0.1.0", rubricSha256: candidate.rubricSha256,
    artSpecSha256: candidate.artSpecSha256, candidateManifestSha256: sha(payload), reviewRequested: true,
    criteria: ART_CRITERIA.map(({ id }) => ({ id, assessment: { status: "rated", rating, rationale: "Тестовое предложение, не оценка человека", evidence: [contents[0]!.path] } })), blockers: [] };
}
const perfect = previewArtScorecard(payload, JSON.stringify(scorecard()));
assert.deepEqual(perfect.scores, { technical: 30, visual: 30, inGame: 25, provenance: 15, total: 100 });
assert.equal(perfect.decision, "DRAFT"); assert.equal(perfect.releaseEligible, false);
assert.equal(perfect.decisionScope, "proposal-preview-not-persisted-formal-state");
assert.deepEqual(perfect.diagnostics.map(d => d.id), ["ART_REVIEW_REQUIRED", "ART_HUMAN_APPROVAL_MISSING"]);
assert.equal(perfect.ratingsSource, "caller-proposal-not-human-verified");
const threes = previewArtScorecard(payload, JSON.stringify(scorecard(3)));
assert.deepEqual(threes.scores, { technical: 22.5, visual: 22.5, inGame: 18.8, provenance: 11.3, total: 75.1 });
assert.equal(threes.decision, "NEEDS_REPAIR"); assert.equal(threes.diagnostics.length, 7);
const high = scorecard(); high.criteria[0]!.assessment = { status: "rated", rating: 0, rationale: "Сломан экспорт", evidence: [contents[0]!.path] };
const categoryFailure = previewArtScorecard(payload, JSON.stringify(high));
assert.equal(categoryFailure.scores.total, 93); assert.equal(categoryFailure.decision, "NEEDS_REPAIR");
assert(categoryFailure.diagnostics.some(d => d.id === "ART_SCORE_TECHNICAL_BELOW_THRESHOLD"));
const round = scorecard(); round.criteria.find(c => c.id === "G1_RENDER_CONTEXTS")!.assessment = { status: "rated", rating: 3, rationale: "Предложение", evidence: [contents[0]!.path] };
assert.equal(previewArtScorecard(payload, JSON.stringify(round)).scores.inGame, 23.3);
const na = scorecard(); na.criteria.find(c => c.id === "T3_RIG_ANIMATION")!.assessment = { status: "not-applicable-requested", rationale: "Неанимированный меч", evidence: [contents[0]!.path] };
const requested = previewArtScorecard(payload, JSON.stringify(na));
assert.equal(requested.scores.technical, 25); assert(requested.diagnostics.some(d => d.id === "ART_NA_REVIEW_REQUIRED"));
assert.equal(requested.diagnostics.find(d => d.id === "ART_NA_REVIEW_REQUIRED")!.artifact, "qa/scorecard.json#/criteria/2/assessment");
const unscored = scorecard(); unscored.reviewRequested = false; unscored.criteria.forEach(c => { c.assessment = { status: "not-rated" }; });
assert.equal(previewArtScorecard(payload, JSON.stringify(unscored)).decision, "DRAFT");
for (const changed of [payload + "\n", JSON.stringify({ ...candidate, artSpecSha256: sha("changed spec") }), JSON.stringify({ ...candidate, rubricSha256: sha("changed rubric") })]) {
  assert(previewArtScorecard(changed, JSON.stringify(scorecard())).diagnostics.some(d => d.id === "ART_HASH_MISMATCH"));
}
const blocked = scorecard(); blocked.blockers.push({ id: "ART_UV_INVALID", message: "UV за границей", evidence: contents[0]!.path });
assert.equal(previewArtScorecard(payload, JSON.stringify(blocked)).decision, "NEEDS_REPAIR");
const missing = scorecard(); missing.criteria[0]!.assessment = { status: "rated", rating: 4, rationale: "Нет файла", evidence: ["qa/missing.png"] };
assert(previewArtScorecard(payload, JSON.stringify(missing)).diagnostics.some(d => d.artifact === "qa/missing.png"));
const emptyPayload = JSON.stringify({ ...candidate, files: [] }), emptyScorecard = scorecard(); emptyScorecard.candidateManifestSha256 = sha(emptyPayload);
assert.equal(previewArtScorecard(emptyPayload, JSON.stringify(emptyScorecard)).decision, "NEEDS_REPAIR");
assert.deepEqual(verifyArtCandidateContents(payload, contents), { kind: "mcdev-art-candidate-integrity/v1", candidateManifestSha256: sha(payload), verifiedFiles: 6, verifiedBytes: 42, artisticApproval: "NOT_PERFORMED" });
assert.throws(() => verifyArtCandidateContents(payload, contents.slice(1)));
assert.throws(() => verifyArtCandidateContents(payload, [...contents.slice(0, 5), contents[0]!]));
assert.throws(() => verifyArtCandidateContents(payload, contents.map((c, index) => index ? c : { ...c, bytes: Buffer.from("wrong-0") })));
assert.throws(() => verifyArtCandidateContents(payload, contents.map((c, index) => index ? c : { ...c, bytes: Buffer.from("longer-0") })));
for (const invalid of ["{", " ".repeat(65_537), JSON.stringify({ ...candidate, human: true }), JSON.stringify({ a: Array.from({ length: 65 }, () => 0) }), '{"a":' + '['.repeat(14) + '0' + ']'.repeat(14) + '}'])
  assert.throws(() => previewArtScorecard(invalid, JSON.stringify(scorecard())));
assert.throws(() => previewArtScorecard(payload, JSON.stringify({ ...scorecard(), approval: "APPROVED" })));
assert.throws(() => previewArtScorecard(JSON.stringify({ nodes: Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0)) }), JSON.stringify(scorecard())), /лимит структуры/u);
assert.equal(JSON.stringify(candidate), payload); // Исходные данные не изменяются.
process.stdout.write("Art review preview: weighted scores, per-category gates, rounding, pending N/A, exact byte bindings, strict limits and no forged approval PASS\n");
