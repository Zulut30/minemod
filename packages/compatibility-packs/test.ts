import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type {
  CompatibilityPackFile,
  CompatibilityPackManifest,
  CompatibilitySelector,
} from "@mcdev/contracts";
import { COMPATIBILITY_PACK_CONTRACT } from "@mcdev/contracts";
import {
  BUILTIN_NEOFORGE_26_1_2,
  BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  BuiltinPackIntegrityError,
  loadBuiltinCompatibilityPack,
  selectBuiltinCompatibilityPack,
} from "./index.ts";
import {
  calculateCompatibilityPackTreeSha256,
  type CompatibilityPackSnapshotEntry,
  type TrustedPackExpectation,
  verifyCompatibilityPackSnapshot,
} from "./src/snapshot.ts";

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function file(
  path: string,
  text: string,
  mode: 420 | 493 = 420,
  role: CompatibilityPackFile["role"] = "template",
): { readonly descriptor: CompatibilityPackFile; readonly snapshot: CompatibilityPackSnapshotEntry } {
  const bytes = encoder.encode(text);
  return {
    descriptor: { path, mode, size: bytes.byteLength, sha256: sha256(bytes), role },
    snapshot: { path, mode, kind: "file", bytes },
  };
}

function directory(path: string): CompatibilityPackSnapshotEntry {
  return { path, mode: 493, kind: "directory", bytes: new Uint8Array() };
}

function manifestBytes(manifest: CompatibilityPackManifest | Record<string, unknown>): Uint8Array {
  return encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

function fixtureSnapshot(): {
  readonly manifest: CompatibilityPackManifest;
  readonly snapshot: readonly CompatibilityPackSnapshotEntry[];
  readonly expected: TrustedPackExpectation;
} {
  const buildTemplate = file("templates/build.gradle.tpl", "plugins {}\n");
  const wrapper = file("templates/gradlew", "#!/bin/sh\n", 493, "executable");
  const manifest: CompatibilityPackManifest = {
    contract: COMPATIBILITY_PACK_CONTRACT,
    packId: "neoforge-26.1.2-java-25",
    revision: 1,
    target: {
      minecraft: "26.1.2",
      loader: "neoforge",
      java: 25,
      neoForge: "26.1.2.80",
    },
    files: [buildTemplate.descriptor, wrapper.descriptor],
  };
  const snapshot = [
    { path: "manifest.json", mode: 420 as const, kind: "file" as const, bytes: manifestBytes(manifest) },
    directory("templates"),
    buildTemplate.snapshot,
    wrapper.snapshot,
  ];
  return {
    manifest,
    snapshot,
    expected: {
      packId: manifest.packId,
      revision: manifest.revision,
      selector: manifest.target,
      treeSha256: calculateCompatibilityPackTreeSha256(snapshot),
    },
  };
}

function replaceManifest(
  snapshot: readonly CompatibilityPackSnapshotEntry[],
  manifest: CompatibilityPackManifest | Record<string, unknown>,
): readonly CompatibilityPackSnapshotEntry[] {
  return snapshot.map((entry) => entry.path === "manifest.json"
    ? { ...entry, bytes: manifestBytes(manifest) }
    : entry);
}

function expectIntegrityFailure(
  snapshot: readonly CompatibilityPackSnapshotEntry[],
  expected: TrustedPackExpectation,
  label: string,
): void {
  assert.throws(
    () => verifyCompatibilityPackSnapshot(snapshot, expected),
    (error: unknown) => error instanceof BuiltinPackIntegrityError,
    label,
  );
}

const fixture = fixtureSnapshot();
const verifiedFixture = verifyCompatibilityPackSnapshot(fixture.snapshot, fixture.expected);
assert.equal(verifiedFixture.manifest.packId, fixture.expected.packId);
assert.equal(verifiedFixture.ref.revision, fixture.expected.revision);
assert.equal(verifiedFixture.ref.treeSha256, fixture.expected.treeSha256);
assert.deepEqual(verifiedFixture.listFiles(), fixture.manifest.files.map(({ path }) => path));
const firstRead = verifiedFixture.readFile("templates/build.gradle.tpl");
firstRead[0] = 0;
assert.equal(new TextDecoder().decode(verifiedFixture.readFile("templates/build.gradle.tpl")), "plugins {}\n");
assert.throws(() => verifiedFixture.readFile("manifest.json"), BuiltinPackIntegrityError);
const unavailableFileMessage = "Compatibility pack payload file is unavailable.";
let hostileReadPathCalls = 0;
const hostileReadPath = Object.defineProperties({}, {
  toString: {
    get: () => {
      hostileReadPathCalls += 1;
      return () => {
        hostileReadPathCalls += 1;
        return "templates/build.gradle.tpl";
      };
    },
  },
});
for (const invalidPath of [hostileReadPath, null, 1, "../../escape", "templates/\u0000escape", "manifest.json"]) {
  assert.throws(
    () => verifiedFixture.readFile(invalidPath as never),
    (error: unknown) => error instanceof BuiltinPackIntegrityError &&
      error.code === "BUILTIN_PACK_FILE_NOT_FOUND" && error.message === unavailableFileMessage,
  );
}
assert.equal(hostileReadPathCalls, 0, "readFile must not coerce or inspect hostile path objects");

const fixturePayloadEntry = fixture.snapshot.find(({ path }) => path === "templates/build.gradle.tpl");
assert.ok(fixturePayloadEntry);
let snapshotEntryGetterCalls = 0;
const accessorSnapshotEntry = Object.defineProperties({}, {
  path: {
    enumerable: true,
    get: () => {
      snapshotEntryGetterCalls += 1;
      return fixturePayloadEntry.path;
    },
  },
  mode: { enumerable: true, value: fixturePayloadEntry.mode },
  kind: { enumerable: true, value: fixturePayloadEntry.kind },
  bytes: { enumerable: true, value: fixturePayloadEntry.bytes },
}) as CompatibilityPackSnapshotEntry;
expectIntegrityFailure(
  fixture.snapshot.map((entry) => entry === fixturePayloadEntry ? accessorSnapshotEntry : entry),
  fixture.expected,
  "snapshot entry accessors must be rejected",
);
assert.equal(snapshotEntryGetterCalls, 0, "snapshot entry accessors must never execute");

let snapshotEntryProxyTrapCalls = 0;
const proxySnapshotEntry = new Proxy({ ...fixturePayloadEntry }, {
  get: (target, property, receiver) => {
    snapshotEntryProxyTrapCalls += 1;
    return Reflect.get(target, property, receiver);
  },
  getOwnPropertyDescriptor: (target, property) => {
    snapshotEntryProxyTrapCalls += 1;
    return Reflect.getOwnPropertyDescriptor(target, property);
  },
  getPrototypeOf: (target) => {
    snapshotEntryProxyTrapCalls += 1;
    return Reflect.getPrototypeOf(target);
  },
  ownKeys: (target) => {
    snapshotEntryProxyTrapCalls += 1;
    return Reflect.ownKeys(target);
  },
});
expectIntegrityFailure(
  fixture.snapshot.map((entry) => entry === fixturePayloadEntry ? proxySnapshotEntry : entry),
  fixture.expected,
  "snapshot entry proxies must be rejected",
);
assert.equal(snapshotEntryProxyTrapCalls, 0, "snapshot entry proxy traps must never execute");
const revokedSnapshotEntry = Proxy.revocable({ ...fixturePayloadEntry }, {});
revokedSnapshotEntry.revoke();
expectIntegrityFailure(
  fixture.snapshot.map((entry) => entry === fixturePayloadEntry ? revokedSnapshotEntry.proxy : entry),
  fixture.expected,
  "revoked snapshot entry proxies must be rejected as integrity failures",
);

let expectedGetterCalls = 0;
const accessorExpected = Object.defineProperties({}, {
  packId: {
    enumerable: true,
    get: () => {
      expectedGetterCalls += 1;
      return fixture.expected.packId;
    },
  },
  revision: { enumerable: true, value: fixture.expected.revision },
  selector: { enumerable: true, value: fixture.expected.selector },
  treeSha256: { enumerable: true, value: fixture.expected.treeSha256 },
}) as TrustedPackExpectation;
expectIntegrityFailure(fixture.snapshot, accessorExpected, "trusted expectation accessors must be rejected");
assert.equal(expectedGetterCalls, 0, "trusted expectation accessors must never execute");

let expectedProxyTrapCalls = 0;
const proxyExpected = new Proxy({ ...fixture.expected }, {
  get: (target, property, receiver) => {
    expectedProxyTrapCalls += 1;
    return Reflect.get(target, property, receiver);
  },
  getOwnPropertyDescriptor: (target, property) => {
    expectedProxyTrapCalls += 1;
    return Reflect.getOwnPropertyDescriptor(target, property);
  },
  getPrototypeOf: (target) => {
    expectedProxyTrapCalls += 1;
    return Reflect.getPrototypeOf(target);
  },
  ownKeys: (target) => {
    expectedProxyTrapCalls += 1;
    return Reflect.ownKeys(target);
  },
});
expectIntegrityFailure(fixture.snapshot, proxyExpected, "trusted expectation proxies must be rejected");
assert.equal(expectedProxyTrapCalls, 0, "trusted expectation proxy traps must never execute");

let hostileBytesCalls = 0;
const hostileBytes = new Uint8Array(fixturePayloadEntry.bytes);
Object.defineProperty(hostileBytes, "byteLength", {
  get: () => {
    hostileBytesCalls += 1;
    return fixturePayloadEntry.bytes.byteLength;
  },
});
Object.defineProperty(hostileBytes, Symbol.iterator, {
  get: () => {
    hostileBytesCalls += 1;
    throw new Error("hostile iterator executed");
  },
});
verifyCompatibilityPackSnapshot(
  fixture.snapshot.map((entry) => entry === fixturePayloadEntry ? { ...entry, bytes: hostileBytes } : entry),
  fixture.expected,
);
assert.equal(hostileBytesCalls, 0, "Uint8Array accessors and iterators must never execute");

const sharedBytes = new Uint8Array(new SharedArrayBuffer(fixturePayloadEntry.bytes.byteLength));
sharedBytes.set(fixturePayloadEntry.bytes);
expectIntegrityFailure(
  fixture.snapshot.map((entry) => entry === fixturePayloadEntry ? { ...entry, bytes: sharedBytes } : entry),
  fixture.expected,
  "SharedArrayBuffer-backed snapshot bytes must be rejected",
);

assert.deepEqual(BUILTIN_NEOFORGE_26_1_2_SELECTOR, {
  minecraft: "26.1.2",
  loader: "neoforge",
  java: 25,
});
assert.equal(selectBuiltinCompatibilityPack(BUILTIN_NEOFORGE_26_1_2_SELECTOR), BUILTIN_NEOFORGE_26_1_2);
assert.equal(BUILTIN_NEOFORGE_26_1_2.trust, "builtin-reviewed");
assert.equal(BUILTIN_NEOFORGE_26_1_2.releaseStatus, "candidate");
assert.equal(Object.isFrozen(BUILTIN_NEOFORGE_26_1_2), true);
for (const selector of [
  { ...BUILTIN_NEOFORGE_26_1_2_SELECTOR, minecraft: "26.1.2.0" },
  { ...BUILTIN_NEOFORGE_26_1_2_SELECTOR, loader: "fabric" },
  { ...BUILTIN_NEOFORGE_26_1_2_SELECTOR, java: 21 },
  { ...BUILTIN_NEOFORGE_26_1_2_SELECTOR, packId: "attacker-pack" },
  null,
]) {
  assert.equal(selectBuiltinCompatibilityPack(selector), undefined, JSON.stringify(selector));
}
const selectorWithHiddenPath = { ...BUILTIN_NEOFORGE_26_1_2_SELECTOR };
Object.defineProperty(selectorWithHiddenPath, "packPath", { value: "../../fixtures/basic-content" });
assert.equal(selectBuiltinCompatibilityPack(selectorWithHiddenPath), undefined);
assert.equal(selectBuiltinCompatibilityPack({
  ...BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  [Symbol("packPath")]: "../../fixtures/basic-content",
}), undefined);

let selectorGetterCalls = 0;
const accessorSelector = Object.defineProperties({}, {
  minecraft: {
    enumerable: true,
    get: () => {
      selectorGetterCalls += 1;
      return "26.1.2";
    },
  },
  loader: { enumerable: true, value: "neoforge" },
  java: { enumerable: true, value: 25 },
});
assert.equal(selectBuiltinCompatibilityPack(accessorSelector), undefined);
await assert.rejects(
  loadBuiltinCompatibilityPack(accessorSelector),
  (error: unknown) => error instanceof BuiltinPackIntegrityError && error.code === "BUILTIN_PACK_NOT_FOUND",
);
assert.equal(selectorGetterCalls, 0, "selector accessors must never execute");

let selectorProxyTrapCalls = 0;
const proxySelector = new Proxy({ ...BUILTIN_NEOFORGE_26_1_2_SELECTOR }, {
  get: (target, property, receiver) => {
    selectorProxyTrapCalls += 1;
    return Reflect.get(target, property, receiver);
  },
  getOwnPropertyDescriptor: (target, property) => {
    selectorProxyTrapCalls += 1;
    return Reflect.getOwnPropertyDescriptor(target, property);
  },
  getPrototypeOf: (target) => {
    selectorProxyTrapCalls += 1;
    return Reflect.getPrototypeOf(target);
  },
  ownKeys: (target) => {
    selectorProxyTrapCalls += 1;
    return Reflect.ownKeys(target);
  },
});
assert.equal(selectBuiltinCompatibilityPack(proxySelector), undefined);
await assert.rejects(
  loadBuiltinCompatibilityPack(proxySelector),
  (error: unknown) => error instanceof BuiltinPackIntegrityError && error.code === "BUILTIN_PACK_NOT_FOUND",
);
assert.equal(selectorProxyTrapCalls, 0, "selector proxy traps must never execute");
const revokedSelector = Proxy.revocable({ ...BUILTIN_NEOFORGE_26_1_2_SELECTOR }, {});
revokedSelector.revoke();
assert.equal(selectBuiltinCompatibilityPack(revokedSelector.proxy), undefined);
await assert.rejects(
  loadBuiltinCompatibilityPack(revokedSelector.proxy),
  (error: unknown) => error instanceof BuiltinPackIntegrityError && error.code === "BUILTIN_PACK_NOT_FOUND",
);

const loaded = await loadBuiltinCompatibilityPack(BUILTIN_NEOFORGE_26_1_2_SELECTOR);
assert.deepEqual(loaded.ref, {
  packId: BUILTIN_NEOFORGE_26_1_2.packId,
  revision: BUILTIN_NEOFORGE_26_1_2.revision,
  treeSha256: BUILTIN_NEOFORGE_26_1_2.treeSha256,
});
assert.deepEqual(loaded.manifest.target, {
  ...BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  neoForge: "26.1.2.80",
});
assert.ok(loaded.listFiles().length >= 10);
assert.deepEqual(loaded.listFiles(), [...loaded.listFiles()].sort());
assert.equal(loaded.listFiles().includes("templates/gradle/wrapper/gradle-wrapper.jar"), true);
assert.equal(loaded.listFiles().includes("manifest.json"), false);
assert.equal("trusted" in loaded.manifest, false);
assert.equal("status" in loaded.manifest, false);
await assert.rejects(
  loadBuiltinCompatibilityPack({
    ...BUILTIN_NEOFORGE_26_1_2_SELECTOR,
    packPath: "../../fixtures/basic-content",
  }),
  BuiltinPackIntegrityError,
);

expectIntegrityFailure(
  fixture.snapshot.filter((entry) => entry.path !== "templates/gradlew"),
  fixture.expected,
  "missing files must fail",
);
expectIntegrityFailure(
  [...fixture.snapshot, file("templates/extra.txt", "extra\n").snapshot],
  fixture.expected,
  "extra files must fail",
);
expectIntegrityFailure(
  [...fixture.snapshot, directory("empty")],
  fixture.expected,
  "extra empty directories must fail",
);
assert.notEqual(
  calculateCompatibilityPackTreeSha256([...fixture.snapshot, directory("empty")]),
  fixture.expected.treeSha256,
  "empty directories must participate in the tree digest",
);
expectIntegrityFailure(
  fixture.snapshot.filter((entry) => entry.path !== "templates"),
  fixture.expected,
  "missing manifest-derived directories must fail",
);
expectIntegrityFailure(
  fixture.snapshot.map((entry) => entry.path === "templates/gradlew"
    ? { ...entry, bytes: encoder.encode("tampered\n") }
    : entry),
  fixture.expected,
  "tampered bytes must fail",
);
expectIntegrityFailure(
  fixture.snapshot.map((entry) => entry.path === "templates/gradlew"
    ? { ...entry, kind: "symlink" as const, bytes: new Uint8Array() }
    : entry),
  fixture.expected,
  "symlinks must fail",
);

const reversedManifest = { ...fixture.manifest, files: [...fixture.manifest.files].reverse() };
expectIntegrityFailure(
  replaceManifest(fixture.snapshot, reversedManifest),
  fixture.expected,
  "manifest files must be strictly sorted",
);

const upperFile = file("templates/BUILD.gradle.tpl", "upper\n");
const caseCollisionManifest = {
  ...fixture.manifest,
  files: [upperFile.descriptor, ...fixture.manifest.files],
};
expectIntegrityFailure(
  [
    ...replaceManifest(fixture.snapshot, caseCollisionManifest),
    upperFile.snapshot,
  ],
  fixture.expected,
  "portable case collisions must fail",
);

const traversalFile = file("../../fixture", "escape\n");
const traversalManifest = {
  ...fixture.manifest,
  files: [traversalFile.descriptor, ...fixture.manifest.files],
};
expectIntegrityFailure(
  [
    ...replaceManifest(fixture.snapshot, traversalManifest),
    traversalFile.snapshot,
  ],
  fixture.expected,
  "parent traversal must fail",
);

for (const promotion of [
  { status: "production" },
  { trusted: true },
  { productionTarget: true },
]) {
  const promotedManifest = { ...fixture.manifest, ...promotion };
  expectIntegrityFailure(
    replaceManifest(fixture.snapshot, promotedManifest),
    fixture.expected,
    `manifest self-promotion must fail: ${Object.keys(promotion)[0] ?? "unknown"}`,
  );
}

for (const mismatch of [
  { ...fixture.expected, packId: "neoforge-26.1.2-java-25-other" },
  { ...fixture.expected, revision: 2 },
  { ...fixture.expected, treeSha256: "f".repeat(64) },
  {
    ...fixture.expected,
    selector: { ...fixture.expected.selector, neoForge: "26.1.2.81" },
  },
]) {
  expectIntegrityFailure(fixture.snapshot, mismatch, "external registry identity must be exact");
}

const shuffledSnapshot = [...fixture.snapshot].reverse();
assert.equal(
  calculateCompatibilityPackTreeSha256(shuffledSnapshot),
  calculateCompatibilityPackTreeSha256(fixture.snapshot),
  "tree digest must be independent of filesystem enumeration order",
);

const typedSelector: CompatibilitySelector = BUILTIN_NEOFORGE_26_1_2_SELECTOR;
assert.equal(selectBuiltinCompatibilityPack(typedSelector)?.packId, "neoforge-26.1.2-java-25");
