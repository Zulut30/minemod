import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ART_REVIEW_VIEWS, prepareArtReviewExport, prepareArtReviewCandidate, verifyArtReviewContents } from "./art-review-candidate.ts";
const payload = await readFile(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8");
const artSpec = await readFile(new URL("../../fixtures/art/leaf-sword.artspec-v1.json", import.meta.url), "utf8");
const rubric = await readFile(new URL("../../docs/quality/art-quality-rubric-v0.md", import.meta.url), "utf8");
const png = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(png); png.write("IHDR", 12); png.writeUInt32BE(1024, 16); png.writeUInt32BE(768, 20);
// Намеренно только header: helper не выдаёт полный capture codec PASS.
const captures = ART_REVIEW_VIEWS.map(view => ({ view, bytes: png }));
const result = prepareArtReviewCandidate("{}\n", payload, artSpec, rubric, captures);
assert.equal(result.contents.length, 17); assert.equal(result.integrity.verifiedFiles, 17);
assert.equal(result.inspection.reviewRequested, false); assert.equal(result.inspection.releaseEligible, false);
assert.equal(result.inspection.bindingsAccepted, false); // Leaf ArtSpec не относится к Aurora.
assert(result.inspection.diagnostics.some(item => item.id === "ART_RESOURCE_REFERENCE_INVALID"));
assert.equal(JSON.parse(result.documents.scorecard).criteria.filter((item: { assessment: { status: string } }) => item.assessment.status === "not-rated").length, 19);
const exported = prepareArtReviewExport(payload, artSpec);
for (const file of exported.bundle.files) {
  const evidence = result.contents.find(content => content.path.endsWith(file.path)); assert(evidence);
  assert.deepEqual(evidence.bytes, Buffer.from(file.content, file.encoding));
}
const technical = JSON.parse(result.contents.find(file => file.path === "qa/technical.json")!.bytes.toString("utf8"));
assert.equal(technical.captureCheck, "bounded-png-header-only"); assert.equal(technical.inGame, "NOT_RUN");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
assert.notEqual(digest(Buffer.from(result.documents.candidate)), digest(Buffer.from(result.documents.candidate + "\n")));
assert.throws(() => verifyArtReviewContents(result.documents.candidate, result.contents.map((file, index) => ({ ...file, bytes: index === 0 ? Buffer.from("bad") : file.bytes }))));
assert.throws(() => prepareArtReviewCandidate("{}", payload, artSpec, rubric, captures.slice(1)));
assert.throws(() => prepareArtReviewCandidate("{}", payload, artSpec, rubric, captures.map(() => captures[0]!)));
assert.throws(() => prepareArtReviewCandidate("{}", payload, artSpec, rubric, captures.map(file => ({ ...file, bytes: Buffer.alloc(1_572_865) }))));
assert.throws(() => prepareArtReviewExport(payload, "{}")); assert.throws(() => prepareArtReviewExport("{}", artSpec));
const unsupported = JSON.parse(artSpec); unsupported.targetMatrix[0].loaderVersion = "0.19.2";
assert.throws(() => prepareArtReviewExport(payload, JSON.stringify(unsupported)), /один native Fabric/u);
process.stdout.write("Art review candidate: 17 bound files, exact exporter parity, 8 required captures, honest header scope, unrated identity mismatch and corruption rejection PASS\n");
