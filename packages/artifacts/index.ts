import { createHash } from "node:crypto";
import { isProxy, isSharedArrayBuffer, isUint8Array } from "node:util/types";
import {
  ARTIFACT_INDEX_CONTRACT,
  ARTIFACT_KINDS,
  CONTRACT_LIMITS,
  isArtifactIndex,
  isCompatibilityPackRef,
  isFileMode,
  isPlainJsonObject,
  isPortableRelativePath,
  isSha256,
  type ArtifactIndex,
  type ArtifactKind,
  type CompatibilityPackRef,
  type FileMode,
} from "@mcdev/contracts";

export interface ArtifactSource {
  readonly path: string;
  readonly mode: FileMode;
  readonly bytes: Uint8Array;
  readonly kind: ArtifactKind;
  readonly provenance: "generator" | "pack" | "build";
}

export interface CreateArtifactIndexInput {
  readonly planId: string;
  readonly pack: CompatibilityPackRef;
  readonly sources: readonly ArtifactSource[];
}

export interface VerifyArtifactIndexInput {
  readonly index: unknown;
  readonly planId: string;
  readonly pack: CompatibilityPackRef;
  readonly sources: readonly ArtifactSource[];
}

export class ArtifactIndexError extends Error {
  readonly code = "ARTIFACT_INTEGRITY_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "ArtifactIndexError";
  }
}

function fail(message: string): never {
  throw new ArtifactIndexError(message);
}

const typedArrayIntrinsics = (() => {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
  const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
  if (byteLength === undefined || buffer === undefined) {
    throw new Error("The Uint8Array intrinsics are unavailable.");
  }
  return Object.freeze({ byteLength, buffer });
})();

function safeByteLength(value: Uint8Array): number {
  return Reflect.apply(typedArrayIntrinsics.byteLength, value, []) as number;
}

function safeBuffer(value: Uint8Array): ArrayBufferLike {
  return Reflect.apply(typedArrayIntrinsics.buffer, value, []) as ArrayBufferLike;
}

function readClosedDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | undefined {
  if (isProxy(value) || !isPlainJsonObject(value)) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return undefined;
  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const normalized: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    normalized[key] = descriptor.value;
  }
  return normalized;
}

function readDenseDataArray(value: unknown, maximumLength: number): readonly unknown[] | undefined {
  if (isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength) return undefined;
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string") || ownKeys.length !== length + 1) return undefined;
  const normalized: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    normalized.push(descriptor.value);
  }
  return normalized;
}

function normalizePack(value: unknown): CompatibilityPackRef | undefined {
  const raw = readClosedDataObject(value, ["packId", "revision", "treeSha256"]);
  if (raw === undefined) return undefined;
  const candidate = {
    packId: raw.packId,
    revision: raw.revision,
    treeSha256: raw.treeSha256,
  };
  if (!isCompatibilityPackRef(candidate)) return undefined;
  return Object.freeze(candidate);
}

interface NormalizedArtifactSource {
  readonly path: string;
  readonly mode: FileMode;
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly kind: ArtifactKind;
  readonly provenance: ArtifactSource["provenance"];
}

function normalizeArtifactSource(value: unknown): NormalizedArtifactSource | undefined {
  const raw = readClosedDataObject(value, ["path", "mode", "bytes", "kind", "provenance"]);
  if (raw === undefined || !isPortableRelativePath(raw.path) || !isFileMode(raw.mode) ||
    isProxy(raw.bytes) || !isUint8Array(raw.bytes) || typeof raw.kind !== "string" ||
    !(ARTIFACT_KINDS as readonly string[]).includes(raw.kind) || typeof raw.provenance !== "string" ||
    !["generator", "pack", "build"].includes(raw.provenance)) return undefined;
  let bytes: Uint8Array;
  let sourceSize: number;
  try {
    if (isSharedArrayBuffer(safeBuffer(raw.bytes))) return undefined;
    sourceSize = safeByteLength(raw.bytes);
    if (sourceSize > CONTRACT_LIMITS.generatedFileBytes) return undefined;
    bytes = new Uint8Array(raw.bytes);
  } catch {
    return undefined;
  }
  const size = safeByteLength(bytes);
  if (size !== sourceSize || size > CONTRACT_LIMITS.generatedFileBytes) return undefined;
  return {
    path: raw.path,
    mode: raw.mode,
    bytes,
    size,
    kind: raw.kind as ArtifactKind,
    provenance: raw.provenance as ArtifactSource["provenance"],
  };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type TreeNodeKind = "directory" | "file";

function registerPortableTreePath(
  path: string,
  exactNodes: Map<string, TreeNodeKind>,
  foldedNodes: Map<string, string>,
): void {
  const parts = path.split("/");
  let nodePath = "";
  for (let index = 0; index < parts.length; index += 1) {
    nodePath = nodePath === "" ? (parts[index] ?? "") : `${nodePath}/${parts[index] ?? ""}`;
    const kind: TreeNodeKind = index === parts.length - 1 ? "file" : "directory";
    const existingKind = exactNodes.get(nodePath);
    if (existingKind !== undefined && (existingKind === "file" || kind === "file")) {
      return fail(existingKind === "file" && kind === "file"
        ? `Artifact source path is duplicated: ${path}`
        : `Artifact source path has a file/directory collision: ${path}`);
    }
    const folded = nodePath.toLowerCase();
    const colliding = foldedNodes.get(folded);
    if (colliding !== undefined && colliding !== nodePath) {
      return fail(`Artifact source paths collide under the portable case policy: ${colliding} and ${nodePath}`);
    }
    if (existingKind === undefined) exactNodes.set(nodePath, kind);
    if (colliding === undefined) foldedNodes.set(folded, nodePath);
  }
}

function createArtifactIndexFromUnknown(input: unknown): ArtifactIndex {
  const rawInput = readClosedDataObject(input, ["planId", "pack", "sources"]);
  if (rawInput === undefined) return fail("Artifact index input must use the closed v1 shape.");
  if (!isSha256(rawInput.planId)) return fail("Artifact index planId must be a SHA-256 digest.");
  const pack = normalizePack(rawInput.pack);
  if (pack === undefined) return fail("Artifact index pack reference is invalid.");
  const rawSources = readDenseDataArray(rawInput.sources, CONTRACT_LIMITS.generatedFiles);
  if (rawSources === undefined) return fail("Artifact source count exceeds the v1 limit.");
  const normalizedSources: NormalizedArtifactSource[] = [];
  const exactNodes = new Map<string, TreeNodeKind>();
  const foldedNodes = new Map<string, string>();
  let totalBytes = 0;
  for (const rawSource of rawSources) {
    const source = normalizeArtifactSource(rawSource);
    if (source === undefined) return fail("Artifact source metadata is invalid.");
    totalBytes += source.size;
    if (totalBytes > CONTRACT_LIMITS.generatedTotalBytes) {
      return fail("Artifact source bytes exceed the v1 total limit.");
    }
    registerPortableTreePath(source.path, exactNodes, foldedNodes);
    normalizedSources.push(source);
  }

  const entries = normalizedSources
    .map((source) => Object.freeze({
      path: source.path,
      mode: source.mode,
      size: source.size,
      sha256: digest(source.bytes),
      kind: source.kind,
      provenance: source.provenance,
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const index: ArtifactIndex = Object.freeze({
    contract: ARTIFACT_INDEX_CONTRACT,
    planId: rawInput.planId,
    pack,
    entries: Object.freeze(entries),
  });
  if (!isArtifactIndex(index)) return fail("Constructed artifact index violated its v1 contract.");
  return index;
}

export function createArtifactIndex(input: CreateArtifactIndexInput): ArtifactIndex {
  return createArtifactIndexFromUnknown(input);
}

function normalizeArtifactIndex(value: unknown): ArtifactIndex | undefined {
  const raw = readClosedDataObject(value, ["contract", "planId", "pack", "entries"]);
  if (raw === undefined || raw.contract !== ARTIFACT_INDEX_CONTRACT || !isSha256(raw.planId)) return undefined;
  const pack = normalizePack(raw.pack);
  const rawEntries = readDenseDataArray(raw.entries, CONTRACT_LIMITS.generatedFiles);
  if (pack === undefined || rawEntries === undefined) return undefined;
  const entries = rawEntries.map((entry) => {
    const fields = readClosedDataObject(entry, ["path", "mode", "size", "sha256", "kind", "provenance"]);
    if (fields === undefined) return undefined;
    return Object.freeze({
      path: fields.path,
      mode: fields.mode,
      size: fields.size,
      sha256: fields.sha256,
      kind: fields.kind,
      provenance: fields.provenance,
    });
  });
  if (entries.some((entry) => entry === undefined)) return undefined;
  const candidate = Object.freeze({
    contract: ARTIFACT_INDEX_CONTRACT,
    planId: raw.planId,
    pack,
    entries: Object.freeze(entries),
  });
  return isArtifactIndex(candidate) ? candidate : undefined;
}

export function verifyArtifactIndex(input: VerifyArtifactIndexInput): boolean {
  const rawInput = readClosedDataObject(input, ["index", "planId", "pack", "sources"]);
  if (rawInput === undefined || !isSha256(rawInput.planId)) return false;
  const normalizedIndex = normalizeArtifactIndex(rawInput.index);
  const expectedPack = normalizePack(rawInput.pack);
  if (normalizedIndex === undefined || expectedPack === undefined ||
    normalizedIndex.planId !== rawInput.planId ||
    normalizedIndex.pack.packId !== expectedPack.packId ||
    normalizedIndex.pack.revision !== expectedPack.revision ||
    normalizedIndex.pack.treeSha256 !== expectedPack.treeSha256) return false;
  try {
    const expected = createArtifactIndexFromUnknown({
      planId: rawInput.planId,
      pack: expectedPack,
      sources: rawInput.sources,
    });
    return JSON.stringify(expected) === JSON.stringify(normalizedIndex);
  } catch (error) {
    if (error instanceof ArtifactIndexError) return false;
    throw error;
  }
}
