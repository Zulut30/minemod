import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isOperationEvidence, EVIDENCE_INPUT_BYTES, type ArtifactIndex } from "@mcdev/contracts";
import { assetOperationWithEvidence, fabricBuildEvidence, operationFailureEvidence, FabricBuildOperationError } from "./evidence.ts";
import { compileItemAssetBundleV1 } from "./asset-bundles.ts";

const payload = await readFile(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8");
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const context = { kind: "editor" as const, projectId: randomUUID(), revision: 17 };
const result = assetOperationWithEvidence(payload, "asset-bundle-export", context);
assert(result.ok);
assert(isOperationEvidence(result.evidence));
assert.deepEqual(result.bundle, compileItemAssetBundleV1(payload), "New evidence must not change bundle/source bytes or manifest.");
assert.deepEqual(result.evidence.input, { sha256: hash(payload), bytes: Buffer.byteLength(payload) });
assert.deepEqual(result.evidence.revision, context);
assert.equal(Object.isFrozen(context), false, "Caller revision metadata must not be frozen as a side effect.");
assert.equal(result.evidence.pack, null, "Export format does not resolve a trusted build pack.");
assert.equal(result.evidence.technical.status, "pass");
assert.equal(result.evidence.artistic.status, "requires-human-review");
assert.equal(result.evidence.game.status, "not-run");
assert.equal(Object.isFrozen(result.evidence.artifacts[0]), true);
for (const file of result.bundle.files) {
  const bytes = Buffer.from(file.content, file.encoding);
  assert.deepEqual(result.evidence.artifacts.find(entry => entry.path === file.path),
    { path: file.path, bytes: bytes.length, sha256: hash(bytes) });
}
assert.deepEqual(assetOperationWithEvidence(payload, "asset-bundle-export", context), result, "Report must be deterministic.");
const changedInput = assetOperationWithEvidence(payload + "\n", "asset-bundle-export", context);
assert(changedInput.ok);assert.notEqual(changedInput.evidence.input.sha256, result.evidence.input.sha256);
const legacy = assetOperationWithEvidence(payload, "asset-item-export");
assert(legacy.ok);assert.equal(legacy.evidence.artifacts.length, 3);
const verified = assetOperationWithEvidence(JSON.stringify(result.bundle), "asset-bundle-verify");
assert(verified.ok);assert.equal(verified.evidence.technical.scope, "asset-bundle-integrity");
const damaged = structuredClone(result.bundle);damaged.files[0]!.content += " ";
const rejected = assetOperationWithEvidence(JSON.stringify(damaged), "asset-bundle-verify");
assert(!rejected.ok);assert(isOperationEvidence(rejected.evidence));assert.equal(rejected.evidence.technical.status, "fail");
assert.equal(rejected.evidence.artifacts.length, 0);
assert.equal(rejected.evidence.game.status, "not-run");
assert.equal(rejected.evidence.technical.error?.code, "SPEC_UNSUPPORTED");
const invalid = assetOperationWithEvidence('{"русский":"текст"}', "asset-bundle-export", context);
assert(!invalid.ok);assert.equal(invalid.evidence.input.bytes, Buffer.byteLength('{"русский":"текст"}'));
assert.deepEqual(invalid.evidence.revision, context);
const oversized = assetOperationWithEvidence("x".repeat(EVIDENCE_INPUT_BYTES + 1), "asset-bundle-export");
assert(!oversized.ok);assert.equal(oversized.evidence.input.sha256, null);assert.equal(oversized.evidence.input.bytes, EVIDENCE_INPUT_BYTES + 1);

const mutations: ((e: Record<string, unknown>) => void)[] = [
  e => { e.command = "shell"; }, e => { e.args = ["arbitrary"]; },
  e => { e.artistic = { status: "approved" }; }, e => { e.game = { status: "pass" }; },
  e => { e.technical = { ...result.evidence.technical, error: { code: "fake" } }; },
  e => { e.input = { bytes: -1, sha256: hash(payload) }; },
  e => { e.input = { bytes: 0, sha256: null }; },
  e => { e.input = { bytes: 10, sha256: "not-a-hash" }; },
  e => { e.artifacts = []; },
  e => { e.revision = { kind: "input", sha256: "1".repeat(64) }; },
  e => { e.revision = { ...context, revision: -1 }; },
  e => { e.revision = { ...context, revision: Number.MAX_SAFE_INTEGER + 1 }; },
  e => { e.pack = { packId: "unresolved", revision: 1, treeSha256: "1".repeat(64) }; },
  e => { e.artifacts = [{ path: "../escape", bytes: 1, sha256: "1".repeat(64) }]; },
  e => { e.artifacts = [{ path: "assets/a.json", bytes: 0, sha256: "1".repeat(64) }]; },
  e => { e.artifacts = [result.evidence.artifacts[0], result.evidence.artifacts[0]]; },
  e => { e.artifacts = [{ path: "assets/A.json", bytes: 1, sha256: "1".repeat(64) }, { path: "assets/a.json", bytes: 1, sha256: "1".repeat(64) }]; },
  e => { e.artifacts = Array.from({ length: 2049 }, (_, i) => ({ path: `assets/${i}.json`, bytes: 1, sha256: "1".repeat(64) })); },
];
for (const mutate of mutations) {
  const value = structuredClone(result.evidence) as unknown as Record<string, unknown>;mutate(value);
  assert.equal(isOperationEvidence(value), false, "Malformed evidence must not pass transport validation.");
}
let getterCalled = false;
const privateError = Object.assign(new Error("secret /workspace/private"), { code: "BUILD_FAILED" });
const failure = operationFailureEvidence(payload, "fabric-build", privateError);
assert(isOperationEvidence(failure));assert.equal(failure.technical.error?.code, "BUILD_FAILED");
assert(!JSON.stringify(failure).includes("/workspace"));assert(!JSON.stringify(failure).includes("secret"));
const getterError = Object.defineProperty({}, "code", { get() { getterCalled = true; throw new Error("never execute"); } });
assert.equal(operationFailureEvidence(payload, "fabric-build", getterError).technical.error?.code, "INTERNAL_ERROR");
assert.equal(getterCalled, false);

// Synthetic transport/index test; this does not claim a native Gradle/JAR run.
const index: ArtifactIndex = { contract: "mcdev.artifact-index/v1", planId: "1".repeat(64),
  pack: { packId: "fabric-1.20.1-java-17", revision: 5, treeSha256: "2".repeat(64) },
  entries: [{ path: "build/libs/example.jar", mode: 420, size: 123, sha256: "3".repeat(64), kind: "build-output", provenance: "build" }] };
const built = fabricBuildEvidence(payload, index);
assert(isOperationEvidence(built));assert.deepEqual(built.pack, index.pack);assert.deepEqual(built.revision, { kind: "plan", planId: index.planId });
assert.equal(built.game.status, "not-run");assert.equal(built.artistic.status, "requires-human-review");
assert.equal(Object.isFrozen(index.pack), false, "Report construction must not freeze the caller's index.");
const contextualError = new FabricBuildOperationError(payload, privateError, { planId: index.planId, pack: index.pack });
const contextualFailure = operationFailureEvidence(payload, "fabric-build", contextualError);
assert(isOperationEvidence(contextualFailure));assert.equal(contextualError.cause, privateError);
assert.deepEqual(contextualFailure.pack, index.pack);assert.deepEqual(contextualFailure.revision, { kind: "plan", planId: index.planId });
assert.equal(contextualFailure.technical.error?.code, "BUILD_FAILED");assert.equal(contextualFailure.artifacts.length, 0);
assert(!JSON.stringify(contextualFailure).includes("/workspace"));
const differentRequest = operationFailureEvidence("{}", "fabric-build", contextualError);
assert(isOperationEvidence(differentRequest));assert.equal(differentRequest.pack, null);
assert.equal(differentRequest.input.sha256, hash("{}"));assert.equal(differentRequest.revision.kind, "input");
const oversizedContext = new FabricBuildOperationError("a".repeat(EVIDENCE_INPUT_BYTES + 1), privateError, { planId: index.planId, pack: index.pack });
const unboundContext = operationFailureEvidence("b".repeat(EVIDENCE_INPUT_BYTES + 1), "fabric-build", oversizedContext);
assert.equal(unboundContext.input.sha256, null);assert.equal(unboundContext.pack, null);assert.equal(unboundContext.revision.kind, "input");
assert.equal(Object.isFrozen(index.pack), false);
assert.equal(isOperationEvidence({ ...contextualFailure, revision: { kind: "input", sha256: hash(payload) } }), false);
assert.throws(() => fabricBuildEvidence(payload, { ...index, entries: [] }), /build JAR/);
assert.throws(() => fabricBuildEvidence(payload, { ...index, entries: [{ ...index.entries[0]!, path: "../escape" }] }), /build JAR/);
process.stdout.write(`Operation evidence: exact input/revision/artifacts, preserved bundle, three statuses, errors/privacy/limits and ${mutations.length} rejected shapes PASS\n`);
