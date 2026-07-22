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
} from "../v1/common.ts";

export const COMPATIBILITY_PACK_V3_CONTRACT = "mcdev.compatibility-pack/v3" as const;

export interface FabricCompatibilitySelectorV3 {
  readonly minecraft: string;
  readonly loader: "fabric";
  readonly java: 17;
}

export type CompatibilitySelectorV3 = FabricCompatibilitySelectorV3;

export interface FabricCompatibilityPackTargetV3 extends FabricCompatibilitySelectorV3 {
  readonly fabricLoader: string;
}

export type CompatibilityPackTargetV3 = FabricCompatibilityPackTargetV3;

export interface CompatibilityPackFileV3 {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly size: number;
  readonly sha256: Sha256;
  readonly role: "metadata" | "template" | "executable";
}

export interface CompatibilityPackManifestV3 {
  readonly contract: typeof COMPATIBILITY_PACK_V3_CONTRACT;
  readonly packId: string;
  readonly revision: number;
  readonly target: CompatibilityPackTargetV3;
  readonly files: readonly CompatibilityPackFileV3[];
}

function hasBoundedMinecraftVersion(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 32;
}

function hasBoundedLoaderVersion(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64;
}

export function isCompatibilitySelectorV3(value: unknown): value is CompatibilitySelectorV3 {
  return isPlainJsonObject(value) && hasExactKeys(value, ["minecraft", "loader", "java"]) &&
    hasBoundedMinecraftVersion(value.minecraft) && value.loader === "fabric" && value.java === 17;
}

function isCompatibilityPackTargetV3(value: unknown): value is CompatibilityPackTargetV3 {
  return isPlainJsonObject(value) &&
    hasExactKeys(value, ["minecraft", "loader", "java", "fabricLoader"]) &&
    hasBoundedMinecraftVersion(value.minecraft) && value.loader === "fabric" && value.java === 17 &&
    hasBoundedLoaderVersion(value.fabricLoader);
}

function isCompatibilityPackFileV3(value: unknown): value is CompatibilityPackFileV3 {
  return isPlainJsonObject(value) && hasExactKeys(value, ["path", "mode", "size", "sha256", "role"]) &&
    isPortableRelativePath(value.path) && isFileMode(value.mode) &&
    isPositiveSafeInteger(value.size) && value.size <= CONTRACT_LIMITS.generatedFileBytes &&
    isSha256(value.sha256) &&
    typeof value.role === "string" && ["metadata", "template", "executable"].includes(value.role);
}

export function isCompatibilityPackManifestV3(value: unknown): value is CompatibilityPackManifestV3 {
  if (!isPlainJsonObject(value) || !hasExactKeys(value, ["contract", "packId", "revision", "target", "files"])) {
    return false;
  }
  if (value.contract !== COMPATIBILITY_PACK_V3_CONTRACT ||
    typeof value.packId !== "string" || !/^[a-z0-9][a-z0-9.-]{0,95}$/u.test(value.packId) ||
    !isPositiveSafeInteger(value.revision) || value.revision < 1 ||
    !isCompatibilityPackTargetV3(value.target) || !isDenseJsonArray(value.files) ||
    value.files.length === 0 || value.files.length > CONTRACT_LIMITS.generatedFiles ||
    !value.files.every(isCompatibilityPackFileV3)) {
    return false;
  }
  const paths = value.files.map((file) => file.path);
  return isStrictlySortedUnique(paths) && !hasPortableCaseCollision(paths) &&
    value.files.reduce((total, file) => total + file.size, 0) <= CONTRACT_LIMITS.generatedTotalBytes &&
    isBoundedJsonBytes(value, CONTRACT_LIMITS.buildPlanBytes) &&
    value.files.every((file) => (file.role === "executable") === (file.mode === 493));
}
