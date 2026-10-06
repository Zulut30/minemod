import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ART_CRITERIA, type ArtReviewCandidateV1, type ArtReviewScorecardV1 } from "@mcdev/assets-contracts";
import { inspectArtReviewInputs } from "./art-review.ts";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const specPayload = await readFile(new URL("../../fixtures/art/leaf-sword.artspec-v1.json", import.meta.url), "utf8");
const rubric = await readFile(new URL("../../docs/quality/art-quality-rubric-v0.md", import.meta.url), "utf8");
const spec = JSON.parse(specPayload);
function inputs(artSpec = specPayload, rubricPayload = rubric) {
  const candidate: ArtReviewCandidateV1 = { schemaVersion: 1, kind: "mcdev-art-review-candidate", assetId: spec.id,
    assetClass: spec.assetClass, rubricVersion: "0.1.0", rubricSha256: sha(rubricPayload), artSpecSha256: sha(artSpec), targetMatrix: spec.targetMatrix,
    files: [["source/artspec.json", artSpec], ["source/rubric.md", rubricPayload]].map(([path, text]) => ({ path: path!, role: "source", bytes: Buffer.byteLength(text!), sha256: sha(text!) })) };
  const payload = JSON.stringify(candidate);
  const scorecard: ArtReviewScorecardV1 = { schemaVersion: 1, kind: "mcdev-art-review-scorecard", rubricVersion: "0.1.0",
    rubricSha256: candidate.rubricSha256, artSpecSha256: candidate.artSpecSha256, candidateManifestSha256: sha(payload), reviewRequested: true,
    criteria: ART_CRITERIA.map(({ id }) => ({ id, assessment: { status: "not-rated" } })), blockers: [] };
  return { candidate, scorecard, candidatePayload: payload, artSpec, rubricPayload };
}
function inspect(i = inputs()) { return inspectArtReviewInputs(i.candidatePayload, JSON.stringify(i.scorecard), i.artSpec, i.rubricPayload); }
const accepted = inspect();
assert.equal(accepted.bindingsAccepted, true); assert.equal(accepted.artSpecVersion, 1);
assert.equal(accepted.artSpecSha256, sha(specPayload)); assert.equal(accepted.rubricSha256, sha(rubric));
assert.equal(accepted.decision, "NEEDS_REPAIR"); assert.equal(accepted.releaseEligible, false); assert.equal(accepted.modelMeasurements, "NOT_RUN");
function changeCandidate(change: (candidate: ArtReviewCandidateV1) => void) {
  const i = inputs(); change(i.candidate); i.candidatePayload = JSON.stringify(i.candidate); i.scorecard.candidateManifestSha256 = sha(i.candidatePayload); return inspect(i);
}
for (const [id, change] of [
  ["ART_RESOURCE_REFERENCE_INVALID", (candidate: ArtReviewCandidateV1) => { candidate.assetId = "minemod:other"; }],
  ["ART_SPEC_CLASS_MISMATCH", (candidate: ArtReviewCandidateV1) => { candidate.assetClass = "structure"; }],
  ["ART_TARGET_MATRIX_MISMATCH", (candidate: ArtReviewCandidateV1) => { candidate.targetMatrix[0]!.renderer.version = "other"; }],
  ["ART_TARGET_MATRIX_MISMATCH", (candidate: ArtReviewCandidateV1) => { candidate.targetMatrix[0]!.runtime.version = "21"; }],
  ["ART_EVIDENCE_MISSING", (candidate: ArtReviewCandidateV1) => { candidate.files[0]!.bytes++; }],
] as const) {
  const report = changeCandidate(change); assert.equal(report.bindingsAccepted, false); assert(report.diagnostics.some(d => d.id === id));
}
const extraByte = inputs(); extraByte.artSpec += "\n"; assert.equal(inspect(extraByte).bindingsAccepted, false);
const alteredRubric = inputs(); alteredRubric.rubricPayload += "\n"; assert.equal(inspect(alteredRubric).bindingsAccepted, false);
const invalid = inputs(JSON.stringify({ ...spec, style: { ...spec.style, palette: ["#123456"] } }));
assert(inspect(invalid).diagnostics.some(d => d.id === "ART_SPEC_INVALID"));
const wrongKind = inputs('{"kind":"mod"}'); assert.equal(inspect(wrongKind).bindingsAccepted, false);
const draft = inputs(); draft.scorecard.reviewRequested = false; draft.artSpec += "\n";
assert.equal(inspect(draft).decision, "DRAFT");
assert.throws(() => inspectArtReviewInputs(inputs().candidatePayload, JSON.stringify(inputs().scorecard), " ".repeat(262_145), rubric));
assert.throws(() => inspectArtReviewInputs(inputs().candidatePayload, JSON.stringify(inputs().scorecard), specPayload, " ".repeat(65_537)));
process.stdout.write("Art review bindings: real ArtSpec/rubric bytes, validated spec semantics, source descriptors, exact identity/class/runtime/renderer matrix and draft/repair limits PASS\n");
