import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import {
  CONTRACT_LIMITS,
  hasPortableCaseCollision,
  isCompatibilityPackManifest,
  isCompatibilityPackManifestV2,
  isCompatibilityPackManifestV3,
  isCompatibilityPackRef,
  isFileMode,
  isPortableRelativePath,
  isSha256,
  type CompatibilityPackManifest,
  type CompatibilityPackManifestV2,
  type CompatibilityPackManifestV3,
  type CompatibilityPackRef,
  type CompatibilityPackTarget,
  type CompatibilityPackTargetV2,
  type CompatibilityPackTargetV3,
  type FileMode,
} from "@mcdev/contracts";
import { BuiltinPackIntegrityError } from "./errors.ts";

export interface CompatibilityPackSnapshotEntry {
  readonly path: string;
  readonly mode: FileMode;
  readonly kind: "directory" | "file" | "symlink" | "other";
  readonly bytes: Uint8Array;
}

export interface TrustedPackExpectation {
  readonly packId: string;
  readonly revision: number;
  readonly selector: SupportedCompatibilityPackTarget;
  readonly treeSha256: string;
}

export interface VerifiedCompatibilityPack<
  Manifest extends SupportedCompatibilityPackManifest = SupportedCompatibilityPackManifest,
> {
  readonly ref: CompatibilityPackRef;
  readonly manifest: Manifest;
  listFiles(): readonly string[];
  readFile(path: unknown): Uint8Array;
}

type SupportedCompatibilityPackManifest =
  | CompatibilityPackManifest
  | CompatibilityPackManifestV2
  | CompatibilityPackManifestV3;
type SupportedCompatibilityPackTarget =
  | CompatibilityPackTarget
  | CompatibilityPackTargetV2
  | CompatibilityPackTargetV3;

interface TreeRecord {
  readonly path: string;
  readonly kind: CompatibilityPackSnapshotEntry["kind"];
  readonly mode: FileMode;
  readonly size: number;
  readonly sha256: string;
}

const TREE_DIGEST_DOMAIN = "mcdev.compatibility-pack.tree/v1";
const MANIFEST_PATH = "manifest.json";
const MAX_DIRECTORY_ENTRIES = 4_096;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;

function integrity(message: string): never {
  throw new BuiltinPackIntegrityError("BUILTIN_PACK_INTEGRITY_FAILED", message);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactDataValues(value: unknown, expectedKeys: readonly string[]): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null || utilTypes.isProxy(value) || Array.isArray(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const actualKeys = Reflect.ownKeys(value);
    if (actualKeys.length !== expectedKeys.length || !expectedKeys.every((key) => actualKeys.includes(key))) {
      return undefined;
    }
    const values: unknown[] = [];
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        return undefined;
      }
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

function copyDenseDataArray(value: unknown, maximumLength: number): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null || utilTypes.isProxy(value) || !Array.isArray(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1 || length > maximumLength) {
      return undefined;
    }
    const actualKeys = Reflect.ownKeys(value);
    if (actualKeys.length !== length + 1 || !actualKeys.includes("length")) return undefined;
    const copied: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        return undefined;
      }
      copied.push(descriptor.value);
    }
    return copied;
  } catch {
    return undefined;
  }
}

function copyUint8Array(value: unknown): Uint8Array | undefined {
  if (typeof value !== "object" || value === null || utilTypes.isProxy(value) ||
    !utilTypes.isUint8Array(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype ||
    typedArrayBufferGetter === undefined || typedArrayByteLengthGetter === undefined ||
    typedArrayByteOffsetGetter === undefined) {
    return undefined;
  }
  try {
    const buffer = typedArrayBufferGetter.call(value) as unknown;
    if (utilTypes.isSharedArrayBuffer(buffer) || !utilTypes.isArrayBuffer(buffer)) return undefined;
    const byteLength = typedArrayByteLengthGetter.call(value) as unknown;
    const byteOffset = typedArrayByteOffsetGetter.call(value) as unknown;
    if (typeof byteLength !== "number" || typeof byteOffset !== "number") return undefined;
    return new Uint8Array(new Uint8Array(buffer, byteOffset, byteLength));
  } catch {
    return undefined;
  }
}

function copySnapshotEntry(value: unknown): CompatibilityPackSnapshotEntry | undefined {
  const values = exactDataValues(value, ["path", "mode", "kind", "bytes"]);
  if (values === undefined) return undefined;
  const [path, mode, kind, rawBytes] = values;
  const bytes = copyUint8Array(rawBytes);
  if (!isPortableRelativePath(path) || !isFileMode(mode) ||
    typeof kind !== "string" || !["directory", "file", "symlink", "other"].includes(kind) ||
    bytes === undefined) {
    return undefined;
  }
  return { path, mode, kind: kind as CompatibilityPackSnapshotEntry["kind"], bytes };
}

function copyAndValidateSnapshot(
  snapshot: readonly CompatibilityPackSnapshotEntry[],
): readonly CompatibilityPackSnapshotEntry[] {
  const candidates = copyDenseDataArray(
    snapshot,
    CONTRACT_LIMITS.generatedFiles + MAX_DIRECTORY_ENTRIES + 1,
  );
  if (candidates === undefined) {
    return integrity("Compatibility pack snapshot has an invalid tree entry count.");
  }
  const copied: CompatibilityPackSnapshotEntry[] = [];
  let directoryCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  for (const rawCandidate of candidates) {
    const candidate = copySnapshotEntry(rawCandidate);
    if (candidate === undefined) {
      return integrity("Compatibility pack snapshot contains an invalid entry.");
    }
    if (candidate.kind === "directory") {
      directoryCount += 1;
      if (directoryCount > MAX_DIRECTORY_ENTRIES || candidate.mode !== 493 || candidate.bytes.byteLength !== 0) {
        return integrity(`Compatibility pack contains an invalid directory entry: ${candidate.path}`);
      }
    } else if (candidate.kind !== "file") {
      return integrity(`Compatibility pack entry is not a regular file: ${candidate.path}`);
    } else {
      fileCount += 1;
      if (fileCount > CONTRACT_LIMITS.generatedFiles + 1) {
        return integrity("Compatibility pack snapshot has too many files.");
      }
    }
    const perFileLimit = candidate.path === MANIFEST_PATH
      ? CONTRACT_LIMITS.buildPlanBytes
      : CONTRACT_LIMITS.generatedFileBytes;
    if (candidate.bytes.byteLength > perFileLimit) {
      return integrity(`Compatibility pack file exceeds its byte limit: ${candidate.path}`);
    }
    totalBytes += candidate.bytes.byteLength;
    if (totalBytes > CONTRACT_LIMITS.generatedTotalBytes + CONTRACT_LIMITS.buildPlanBytes) {
      return integrity("Compatibility pack snapshot exceeds its total byte limit.");
    }
    copied.push(Object.freeze({
      path: candidate.path,
      mode: candidate.mode,
      kind: candidate.kind,
      bytes: candidate.bytes,
    }));
  }
  copied.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const paths = copied.map(({ path }) => path);
  if (new Set(paths).size !== paths.length || hasPortableCaseCollision(paths)) {
    return integrity("Compatibility pack snapshot contains duplicate or case-colliding paths.");
  }
  return Object.freeze(copied);
}

function treeRecords(snapshot: readonly CompatibilityPackSnapshotEntry[]): readonly TreeRecord[] {
  const copied = copyAndValidateSnapshot(snapshot);
  return copied.map((entry) => Object.freeze({
    path: entry.path,
    kind: entry.kind,
    mode: entry.mode,
    size: entry.bytes.byteLength,
    sha256: sha256(entry.bytes),
  }));
}

export function calculateCompatibilityPackTreeSha256(
  snapshot: readonly CompatibilityPackSnapshotEntry[],
): string {
  const hash = createHash("sha256");
  hash.update(`${TREE_DIGEST_DOMAIN}\n`, "utf8");
  for (const record of treeRecords(snapshot)) {
    hash.update(`${JSON.stringify(record)}\n`, "utf8");
  }
  return hash.digest("hex");
}

function parseManifest(entry: CompatibilityPackSnapshotEntry): SupportedCompatibilityPackManifest {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(entry.bytes)) as unknown;
  } catch {
    return integrity("Compatibility pack manifest is not canonical UTF-8 JSON.");
  }
  if (isCompatibilityPackManifest(value) || isCompatibilityPackManifestV2(value) ||
    isCompatibilityPackManifestV3(value)) return value;
  return integrity("Compatibility pack manifest does not satisfy a supported versioned contract.");
}

function parentDirectories(paths: readonly string[]): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    parts.pop();
    let parent = "";
    for (const part of parts) {
      parent = parent === "" ? part : `${parent}/${part}`;
      directories.add(parent);
    }
  }
  return directories;
}

function copyExactTarget(value: unknown): SupportedCompatibilityPackTarget | undefined {
  const neoForgeValues = exactDataValues(value, ["minecraft", "loader", "java", "neoForge"]);
  if (neoForgeValues !== undefined) {
    const [minecraft, loader, java, neoForge] = neoForgeValues;
    if (typeof minecraft === "string" && minecraft.length >= 1 && minecraft.length <= 32 &&
      loader === "neoforge" && java === 25 &&
      typeof neoForge === "string" && neoForge.length >= 1 && neoForge.length <= 64) {
      return Object.freeze({ minecraft, loader, java, neoForge });
    }
    return undefined;
  }
  const fabricValues = exactDataValues(value, ["minecraft", "loader", "java", "fabricLoader"]);
  if (fabricValues === undefined) return undefined;
  const [minecraft, loader, java, fabricLoader] = fabricValues;
  if (typeof minecraft !== "string" || minecraft.length < 1 || minecraft.length > 32 ||
    loader !== "fabric" || (java !== 17 && java !== 25) ||
    typeof fabricLoader !== "string" || fabricLoader.length < 1 || fabricLoader.length > 64) {
    return undefined;
  }
  return Object.freeze({ minecraft, loader, java, fabricLoader });
}

function copyAndValidateExpectation(expected: TrustedPackExpectation): TrustedPackExpectation {
  const values = exactDataValues(expected, ["packId", "revision", "selector", "treeSha256"]);
  if (values === undefined) return integrity("Trusted compatibility pack registry entry is invalid.");
  const [packId, revision, rawSelector, treeSha256] = values;
  const selector = copyExactTarget(rawSelector);
  const ref = { packId, revision, treeSha256 };
  if (!isCompatibilityPackRef(ref) || selector === undefined || !isSha256(treeSha256)) {
    return integrity("Trusted compatibility pack registry entry is invalid.");
  }
  return Object.freeze({ ...ref, selector });
}

function sameTarget(left: SupportedCompatibilityPackTarget, right: SupportedCompatibilityPackTarget): boolean {
  if (left.minecraft !== right.minecraft || left.loader !== right.loader || left.java !== right.java) return false;
  if (left.loader === "fabric" && right.loader === "fabric") {
    return left.fabricLoader === right.fabricLoader;
  }
  return left.loader === "neoforge" && right.loader === "neoforge" && left.neoForge === right.neoForge;
}

function frozenManifest(manifest: SupportedCompatibilityPackManifest): SupportedCompatibilityPackManifest {
  const files = manifest.files.map((file) => Object.freeze({ ...file }));
  if (manifest.contract === "mcdev.compatibility-pack/v1") {
    return Object.freeze({
      ...manifest,
      target: Object.freeze({ ...manifest.target }),
      files: Object.freeze(files),
    });
  }
  if (manifest.contract === "mcdev.compatibility-pack/v2") {
    return Object.freeze({
      ...manifest,
      target: Object.freeze({ ...manifest.target }),
      files: Object.freeze(files),
    });
  }
  return Object.freeze({
    ...manifest,
    target: Object.freeze({ ...manifest.target }),
    files: Object.freeze(files),
  });
}

export function verifyCompatibilityPackSnapshot(
  snapshot: readonly CompatibilityPackSnapshotEntry[],
  expected: TrustedPackExpectation,
): VerifiedCompatibilityPack {
  const trusted = copyAndValidateExpectation(expected);
  const copied = copyAndValidateSnapshot(snapshot);
  const fileEntries = copied.filter(({ kind }) => kind === "file");
  const directoryEntries = copied.filter(({ kind }) => kind === "directory");
  const manifestEntries = fileEntries.filter(({ path }) => path === MANIFEST_PATH);
  if (manifestEntries.length !== 1) {
    return integrity("Compatibility pack snapshot must contain exactly one manifest.json.");
  }
  const manifestEntry = manifestEntries[0];
  if (manifestEntry === undefined || manifestEntry.mode !== 420) {
    return integrity("Compatibility pack manifest must be a non-executable regular file.");
  }
  const manifest = parseManifest(manifestEntry);
  if (manifest.packId !== trusted.packId || manifest.revision !== trusted.revision ||
    !sameTarget(manifest.target, trusted.selector)) {
    return integrity("Compatibility pack identity does not match the trusted built-in registry.");
  }

  const payloadEntries = fileEntries.filter(({ path }) => path !== MANIFEST_PATH);
  if (payloadEntries.length !== manifest.files.length) {
    return integrity("Compatibility pack payload file count does not match its manifest.");
  }
  const payloadByPath = new Map(payloadEntries.map((entry) => [entry.path, entry]));
  for (const descriptor of manifest.files) {
    const entry = payloadByPath.get(descriptor.path);
    if (entry === undefined || entry.mode !== descriptor.mode || entry.bytes.byteLength !== descriptor.size ||
      sha256(entry.bytes) !== descriptor.sha256) {
      return integrity(`Compatibility pack payload does not match its manifest: ${descriptor.path}`);
    }
  }
  if (payloadByPath.size !== manifest.files.length) {
    return integrity("Compatibility pack contains unmanifested payload files.");
  }

  const expectedDirectories = parentDirectories([MANIFEST_PATH, ...manifest.files.map(({ path }) => path)]);
  if (directoryEntries.length !== expectedDirectories.size ||
    directoryEntries.some(({ path }) => !expectedDirectories.has(path))) {
    return integrity("Compatibility pack directory tree does not exactly match its manifest.");
  }

  const treeSha256 = calculateCompatibilityPackTreeSha256(copied);
  if (treeSha256 !== trusted.treeSha256) {
    return integrity("Compatibility pack tree digest does not match the trusted built-in registry.");
  }

  const payload = new Map(payloadEntries.map((entry) => [entry.path, new Uint8Array(entry.bytes)]));
  const filePaths = Object.freeze(manifest.files.map(({ path }) => path));
  const immutableManifest = frozenManifest(manifest);
  const ref = Object.freeze({
    packId: trusted.packId,
    revision: trusted.revision,
    treeSha256,
  });
  return Object.freeze({
    ref,
    manifest: immutableManifest,
    listFiles: (): readonly string[] => filePaths,
    readFile: (path: unknown): Uint8Array => {
      if (!isPortableRelativePath(path)) {
        throw new BuiltinPackIntegrityError(
          "BUILTIN_PACK_FILE_NOT_FOUND",
          "Compatibility pack payload file is unavailable.",
        );
      }
      const bytes = payload.get(path);
      if (bytes === undefined) {
        throw new BuiltinPackIntegrityError(
          "BUILTIN_PACK_FILE_NOT_FOUND",
          "Compatibility pack payload file is unavailable.",
        );
      }
      return new Uint8Array(bytes);
    },
  });
}
