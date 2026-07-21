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

export const COMPATIBILITY_PACK_V2_CONTRACT = "mcdev.compatibility-pack/v2" as const;

export interface CompatibilitySelectorV2 {
  readonly minecraft: string;
  readonly loader: "fabric" | "neoforge";
  readonly java: 25;
}

interface CompatibilityPackTargetBaseV2 extends CompatibilitySelectorV2 {
  readonly minecraft: string;
  readonly java: 25;
}

export interface FabricCompatibilityPackTargetV2 extends CompatibilityPackTargetBaseV2 {
  readonly loader: "fabric";
  readonly fabricLoader: string;
}

export interface NeoForgeCompatibilityPackTargetV2 extends CompatibilityPackTargetBaseV2 {
  readonly loader: "neoforge";
  readonly neoForge: string;
}

export type CompatibilityPackTargetV2 =
  | FabricCompatibilityPackTargetV2
  | NeoForgeCompatibilityPackTargetV2;

export interface CompatibilityPackFileV2 {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly size: number;
  readonly sha256: Sha256;
  readonly role: "metadata" | "template" | "executable";
}

export interface CompatibilityPackManifestV2 {
  readonly contract: typeof COMPATIBILITY_PACK_V2_CONTRACT;
  readonly packId: string;
  readonly revision: number;
  readonly target: CompatibilityPackTargetV2;
  readonly files: readonly CompatibilityPackFileV2[];
}

function hasBoundedMinecraftVersion(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 32;
}

function hasBoundedLoaderVersion(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64;
}

export function isCompatibilitySelectorV2(value: unknown): value is CompatibilitySelectorV2 {
  return isPlainJsonObject(value) && hasExactKeys(value, ["minecraft", "loader", "java"]) &&
    hasBoundedMinecraftVersion(value.minecraft) &&
    (value.loader === "fabric" || value.loader === "neoforge") && value.java === 25;
}

function isCompatibilityPackTargetV2(value: unknown): value is CompatibilityPackTargetV2 {
  if (!isPlainJsonObject(value) || !hasBoundedMinecraftVersion(value.minecraft) || value.java !== 25) {
    return false;
  }
  if (value.loader === "fabric") {
    return hasExactKeys(value, ["minecraft", "loader", "java", "fabricLoader"]) &&
      hasBoundedLoaderVersion(value.fabricLoader);
  }
  return value.loader === "neoforge" &&
    hasExactKeys(value, ["minecraft", "loader", "java", "neoForge"]) &&
    hasBoundedLoaderVersion(value.neoForge);
}

function isCompatibilityPackFileV2(value: unknown): value is CompatibilityPackFileV2 {
  return isPlainJsonObject(value) && hasExactKeys(value, ["path", "mode", "size", "sha256", "role"]) &&
    isPortableRelativePath(value.path) && isFileMode(value.mode) &&
    isPositiveSafeInteger(value.size) && value.size <= CONTRACT_LIMITS.generatedFileBytes &&
    isSha256(value.sha256) &&
    typeof value.role === "string" && ["metadata", "template", "executable"].includes(value.role);
}

export function isCompatibilityPackManifestV2(value: unknown): value is CompatibilityPackManifestV2 {
  if (!isPlainJsonObject(value) || !hasExactKeys(value, ["contract", "packId", "revision", "target", "files"])) {
    return false;
  }
  if (value.contract !== COMPATIBILITY_PACK_V2_CONTRACT ||
    typeof value.packId !== "string" || !/^[a-z0-9][a-z0-9.-]{0,95}$/u.test(value.packId) ||
    !isPositiveSafeInteger(value.revision) || value.revision < 1 ||
    !isCompatibilityPackTargetV2(value.target) || !isDenseJsonArray(value.files) ||
    value.files.length === 0 || value.files.length > CONTRACT_LIMITS.generatedFiles ||
    !value.files.every(isCompatibilityPackFileV2)) {
    return false;
  }
  const paths = value.files.map((file) => file.path);
  return isStrictlySortedUnique(paths) && !hasPortableCaseCollision(paths) &&
    value.files.reduce((total, file) => total + file.size, 0) <= CONTRACT_LIMITS.generatedTotalBytes &&
    isBoundedJsonBytes(value, CONTRACT_LIMITS.buildPlanBytes) &&
    value.files.every((file) => (file.role === "executable") === (file.mode === 493));
}
