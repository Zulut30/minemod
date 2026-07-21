import {
  CONTRACT_LIMITS,
  hasPortableCaseCollision,
  hasExactKeys,
  isBoundedJsonBytes,
  isDenseJsonArray,
  isFileMode,
  isPlainJsonObject,
  isPortableRelativePath,
  isPositiveSafeInteger,
  isSha256,
  isStrictlySortedUnique,
  type FileMode,
  type PortableRelativePath,
  type Sha256,
} from "./common.ts";
import { isCompatibilityPackRef, type CompatibilityPackRef } from "./pack.ts";

export const ARTIFACT_INDEX_CONTRACT = "mcdev.artifact-index/v1" as const;
export const ARTIFACT_KINDS = Object.freeze(["build-output", "metadata", "resource", "source", "template"] as const);
export type ArtifactKind = typeof ARTIFACT_KINDS[number];

export interface ArtifactIndexEntry {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly size: number;
  readonly sha256: Sha256;
  readonly kind: ArtifactKind;
  readonly provenance: "generator" | "pack" | "build";
}

export interface ArtifactIndex {
  readonly contract: typeof ARTIFACT_INDEX_CONTRACT;
  readonly planId: Sha256;
  readonly pack: CompatibilityPackRef;
  readonly entries: readonly ArtifactIndexEntry[];
}

export function isArtifactIndexEntry(value: unknown): value is ArtifactIndexEntry {
  return isPlainJsonObject(value) &&
    hasExactKeys(value, ["path", "mode", "size", "sha256", "kind", "provenance"]) &&
    isPortableRelativePath(value.path) && isFileMode(value.mode) &&
    isPositiveSafeInteger(value.size) && value.size <= CONTRACT_LIMITS.generatedFileBytes &&
    isSha256(value.sha256) && typeof value.kind === "string" &&
    (ARTIFACT_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.provenance === "string" && ["generator", "pack", "build"].includes(value.provenance);
}

export function isArtifactIndex(value: unknown): value is ArtifactIndex {
  return isPlainJsonObject(value) && hasExactKeys(value, ["contract", "planId", "pack", "entries"]) &&
    value.contract === ARTIFACT_INDEX_CONTRACT && isSha256(value.planId) &&
    isCompatibilityPackRef(value.pack) && isDenseJsonArray(value.entries) &&
    value.entries.length <= CONTRACT_LIMITS.generatedFiles && value.entries.every(isArtifactIndexEntry) &&
    value.entries.reduce((total, entry) => total + entry.size, 0) <= CONTRACT_LIMITS.generatedTotalBytes &&
    isBoundedJsonBytes(value, CONTRACT_LIMITS.buildPlanBytes) &&
    isStrictlySortedUnique(value.entries.map((entry) => entry.path)) &&
    !hasPortableCaseCollision(value.entries.map((entry) => entry.path));
}
