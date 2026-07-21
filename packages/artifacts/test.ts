import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONTRACT_LIMITS,
  isArtifactIndex,
  type CompatibilityPackRef,
} from "@mcdev/contracts";
import {
  ArtifactIndexError,
  createArtifactIndex,
  verifyArtifactIndex,
  type ArtifactSource,
} from "./index.ts";

const planId = "1111111111111111111111111111111111111111111111111111111111111111";
const pack: CompatibilityPackRef = {
  packId: "neoforge-26.1.2-java-25",
  revision: 1,
  treeSha256: "2222222222222222222222222222222222222222222222222222222222222222",
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function source(
  path: string,
  text: string,
  kind: ArtifactSource["kind"] = "source",
  provenance: ArtifactSource["provenance"] = "generator",
): ArtifactSource {
  return { path, mode: 420, bytes: new TextEncoder().encode(text), kind, provenance };
}

const sources = [
  source("src/main/resources/data/example.json", "{\"ok\":true}\n", "resource"),
  source("build.gradle", "plugins {}\n", "template", "pack"),
];
const index = createArtifactIndex({ planId, pack, sources });
assert.equal(isArtifactIndex(index), true);
assert.deepEqual(index.entries.map((entry) => entry.path), [
  "build.gradle",
  "src/main/resources/data/example.json",
]);
assert.equal(index.entries[0]?.sha256, sha256(sources[1]?.bytes ?? new Uint8Array()));
assert.equal(index.entries[1]?.sha256, sha256(sources[0]?.bytes ?? new Uint8Array()));
assert.equal(verifyArtifactIndex({
  index,
  planId,
  pack,
  sources: [...sources].reverse(),
}), true);
assert.deepEqual(
  createArtifactIndex({ planId, pack, sources: [...sources].reverse() }),
  index,
  "input ordering must not affect artifact bytes",
);
assert.doesNotMatch(JSON.stringify(index), /plugins|absolute|workspace/u);

const identityTamperingCases = [
  {
    label: "planId",
    candidate: { ...index, planId: "3333333333333333333333333333333333333333333333333333333333333333" },
  },
  {
    label: "packId",
    candidate: { ...index, pack: { ...index.pack, packId: "different-pack" } },
  },
  {
    label: "pack revision",
    candidate: { ...index, pack: { ...index.pack, revision: index.pack.revision + 1 } },
  },
  {
    label: "pack tree digest",
    candidate: {
      ...index,
      pack: {
        ...index.pack,
        treeSha256: "4444444444444444444444444444444444444444444444444444444444444444",
      },
    },
  },
] as const;
for (const { label, candidate } of identityTamperingCases) {
  assert.equal(verifyArtifactIndex({ index: candidate, planId, pack, sources }), false, label);
}

const originalDigest = index.entries[0]?.sha256;
sources[1]?.bytes.fill(0);
assert.equal(index.entries[0]?.sha256, originalDigest, "index must not retain mutable content");
assert.equal(verifyArtifactIndex({ index, planId, pack, sources }), false, "content mutation must be detected");

function expectIntegrityFailure(candidate: readonly ArtifactSource[], label: string): void {
  assert.throws(
    () => createArtifactIndex({ planId, pack, sources: candidate }),
    (error: unknown) => error instanceof ArtifactIndexError &&
      error.code === "ARTIFACT_INTEGRITY_FAILED" && !error.message.includes("/tmp"),
    label,
  );
}

expectIntegrityFailure([
  source("Data.json", "a"),
  source("data.json", "b"),
], "case-fold collision");
expectIntegrityFailure([source("../escape", "a")], "traversal");
expectIntegrityFailure([source(".mcdev/state.json", "a")], "reserved state");
expectIntegrityFailure([
  source("same", "a"),
  source("same", "b"),
], "exact collision");
expectIntegrityFailure([
  source("tree", "a"),
  source("tree/child", "b"),
], "file/directory ancestor collision");
expectIntegrityFailure([
  source("Assets/first", "a"),
  source("assets/second", "b"),
], "case-folded directory collision");

const tooMany = Array.from({ length: CONTRACT_LIMITS.generatedFiles + 1 }, (_, position) =>
  source(`generated/${String(position).padStart(4, "0")}`, ""));
expectIntegrityFailure(tooMany, "file count cap");

const oversizedBytes = new Uint8Array(CONTRACT_LIMITS.generatedFileBytes + 1);
expectIntegrityFailure([{
  path: "oversized.bin",
  mode: 420,
  bytes: oversizedBytes,
  kind: "resource",
  provenance: "generator",
}], "single file cap");

const sharedLargeBytes = new Uint8Array(CONTRACT_LIMITS.generatedFileBytes);
const excessiveTotal = Array.from({ length: 9 }, (_, position): ArtifactSource => ({
  path: `large/${String(position).padStart(2, "0")}`,
  mode: 420,
  bytes: sharedLargeBytes,
  kind: "resource",
  provenance: "generator",
}));
const unreachableAfterTotal = new Uint8Array([1]);
structuredClone(unreachableAfterTotal.buffer, { transfer: [unreachableAfterTotal.buffer] });
assert.throws(
  () => createArtifactIndex({
    planId,
    pack,
    sources: [...excessiveTotal, {
      path: "large/unreachable",
      mode: 420,
      bytes: unreachableAfterTotal,
      kind: "resource",
      provenance: "generator",
    }],
  }),
  (error: unknown) => error instanceof ArtifactIndexError &&
    error.code === "ARTIFACT_INTEGRITY_FAILED" && error.message.includes("total"),
  "total byte cap must stop before later sources are copied",
);

expectIntegrityFailure([{
  ...source("invalid-kind", "a"),
  kind: "shell" as ArtifactSource["kind"],
}], "closed artifact kind");
expectIntegrityFailure([{
  ...source("invalid-provenance", "a"),
  provenance: "network" as ArtifactSource["provenance"],
}], "closed provenance");

assert.throws(
  () => createArtifactIndex({
    planId: "not-a-digest",
    pack,
    sources: [source("valid", "a")],
  }),
  ArtifactIndexError,
);

let inputGetterCalls = 0;
const inputWithAccessor = Object.defineProperty({ pack, sources }, "planId", {
  enumerable: true,
  get(): string {
    inputGetterCalls += 1;
    return planId;
  },
});
assert.throws(
  () => createArtifactIndex(inputWithAccessor as unknown as Parameters<typeof createArtifactIndex>[0]),
  ArtifactIndexError,
);
assert.equal(inputGetterCalls, 0, "artifact input validation must not invoke accessors");

let inputProxyTrapCalls = 0;
const proxiedInput = new Proxy({}, {
  getPrototypeOf(): object {
    inputProxyTrapCalls += 1;
    return Object.prototype;
  },
  ownKeys(): never {
    inputProxyTrapCalls += 1;
    throw new Error("artifact proxy trap executed");
  },
});
assert.throws(
  () => createArtifactIndex(proxiedInput as unknown as Parameters<typeof createArtifactIndex>[0]),
  ArtifactIndexError,
);
assert.equal(inputProxyTrapCalls, 0, "artifact input proxies must be rejected before reflection");

let sourceGetterCalls = 0;
const sourceWithAccessor = Object.defineProperty({
  mode: 420,
  bytes: new Uint8Array(),
  kind: "resource",
  provenance: "generator",
}, "path", {
  enumerable: true,
  get(): string {
    sourceGetterCalls += 1;
    return "accessor-source";
  },
});
expectIntegrityFailure([sourceWithAccessor as unknown as ArtifactSource], "source accessor");
assert.equal(sourceGetterCalls, 0, "artifact source validation must not invoke accessors");

let byteIteratorCalls = 0;
const bytesWithHostileIterator = new Uint8Array([1, 2, 3]);
Object.defineProperty(bytesWithHostileIterator, Symbol.iterator, {
  value(): never {
    byteIteratorCalls += 1;
    throw new Error("artifact byte iterator executed");
  },
});
let byteLengthGetterCalls = 0;
Object.defineProperty(bytesWithHostileIterator, "byteLength", {
  get(): number {
    byteLengthGetterCalls += 1;
    throw new Error("artifact byteLength getter executed");
  },
});
let byteBufferGetterCalls = 0;
Object.defineProperty(bytesWithHostileIterator, "buffer", {
  get(): ArrayBuffer {
    byteBufferGetterCalls += 1;
    throw new Error("artifact buffer getter executed");
  },
});
const hostileByteIndex = createArtifactIndex({
  planId,
  pack,
  sources: [{
    path: "safe-bytes.bin",
    mode: 420,
    bytes: bytesWithHostileIterator,
    kind: "resource",
    provenance: "generator",
  }],
});
assert.equal(hostileByteIndex.entries[0]?.size, 3);
assert.equal(hostileByteIndex.entries[0]?.sha256, sha256(new Uint8Array([1, 2, 3])));
assert.equal(byteIteratorCalls, 0, "artifact byte copying must not invoke caller iterators");
assert.equal(byteLengthGetterCalls, 0, "artifact sizing must use typed-array intrinsics");
assert.equal(byteBufferGetterCalls, 0, "artifact backing-store checks must use typed-array intrinsics");

const sharedBytes = new Uint8Array(new SharedArrayBuffer(3));
sharedBytes.set([1, 2, 3]);
expectIntegrityFailure([{
  path: "shared-bytes.bin",
  mode: 420,
  bytes: sharedBytes,
  kind: "resource",
  provenance: "generator",
}], "shared artifact bytes");

let byteProxyTrapCalls = 0;
const proxiedBytes = new Proxy(new Uint8Array(), {
  getPrototypeOf(): object {
    byteProxyTrapCalls += 1;
    throw new Error("artifact byte proxy trap executed");
  },
});
expectIntegrityFailure([{
  path: "proxied-bytes.bin",
  mode: 420,
  bytes: proxiedBytes,
  kind: "resource",
  provenance: "generator",
}], "proxied artifact bytes");
assert.equal(byteProxyTrapCalls, 0, "artifact byte proxies must be rejected before reflection");

const detachedBytes = new Uint8Array([1]);
structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] });
expectIntegrityFailure([{
  path: "detached-bytes.bin",
  mode: 420,
  bytes: detachedBytes,
  kind: "resource",
  provenance: "generator",
}], "detached artifact bytes");

let candidateGetterCalls = 0;
const candidateWithAccessor = Object.defineProperty({
  planId: index.planId,
  pack: index.pack,
  entries: index.entries,
}, "contract", {
  enumerable: true,
  get(): string {
    candidateGetterCalls += 1;
    return "mcdev.artifact-index/v1";
  },
});
assert.equal(verifyArtifactIndex({ index: candidateWithAccessor, planId, pack, sources }), false);
assert.equal(candidateGetterCalls, 0, "artifact verification must not invoke candidate accessors");
assert.throws(
  () => createArtifactIndex({
    planId,
    pack: { ...pack, treeSha256: "not-a-digest" },
    sources: [source("valid", "a")],
  }),
  ArtifactIndexError,
);
