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

export const COMPATIBILITY_PACK_CONTRACT = "mcdev.compatibility-pack/v1" as const;

export interface CompatibilitySelector {
  readonly minecraft: string;
  readonly loader: "neoforge";
  readonly java: 25;
}

export interface CompatibilityPackRef {
  readonly packId: string;
  readonly revision: number;
  readonly treeSha256: Sha256;
}

export interface CompatibilityPackTarget extends CompatibilitySelector {
  readonly neoForge: string;
}

export interface CompatibilityPackFile {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly size: number;
  readonly sha256: Sha256;
  readonly role: "metadata" | "template" | "executable";
}

export interface CompatibilityPackManifest {
  readonly contract: typeof COMPATIBILITY_PACK_CONTRACT;
  readonly packId: string;
  readonly revision: number;
  readonly target: CompatibilityPackTarget;
  readonly files: readonly CompatibilityPackFile[];
}

export function isCompatibilityPackRef(value: unknown): value is CompatibilityPackRef {
  return isPlainJsonObject(value) && hasExactKeys(value, ["packId", "revision", "treeSha256"]) &&
    typeof value.packId === "string" && /^[a-z0-9][a-z0-9.-]{0,95}$/u.test(value.packId) &&
    isPositiveSafeInteger(value.revision) && value.revision >= 1 && isSha256(value.treeSha256);
}

function isCompatibilityPackTarget(value: unknown): value is CompatibilityPackTarget {
  return isPlainJsonObject(value) && hasExactKeys(value, ["minecraft", "loader", "java", "neoForge"]) &&
    typeof value.minecraft === "string" && value.minecraft.length >= 1 && value.minecraft.length <= 32 &&
    value.loader === "neoforge" && value.java === 25 &&
    typeof value.neoForge === "string" && value.neoForge.length >= 1 && value.neoForge.length <= 64;
}

function isCompatibilityPackFile(value: unknown): value is CompatibilityPackFile {
  return isPlainJsonObject(value) && hasExactKeys(value, ["path", "mode", "size", "sha256", "role"]) &&
    isPortableRelativePath(value.path) && isFileMode(value.mode) &&
    isPositiveSafeInteger(value.size) && value.size <= CONTRACT_LIMITS.generatedFileBytes &&
    isSha256(value.sha256) && typeof value.role === "string" &&
    ["metadata", "template", "executable"].includes(value.role);
}

export function isCompatibilityPackManifest(value: unknown): value is CompatibilityPackManifest {
  if (!isPlainJsonObject(value) || !hasExactKeys(value, ["contract", "packId", "revision", "target", "files"])) {
    return false;
  }
  if (value.contract !== COMPATIBILITY_PACK_CONTRACT ||
    typeof value.packId !== "string" || !/^[a-z0-9][a-z0-9.-]{0,95}$/u.test(value.packId) ||
    !isPositiveSafeInteger(value.revision) || value.revision < 1 ||
    !isCompatibilityPackTarget(value.target) || !isDenseJsonArray(value.files) ||
    value.files.length === 0 || value.files.length > CONTRACT_LIMITS.generatedFiles ||
    !value.files.every(isCompatibilityPackFile)) {
    return false;
  }
  const paths = value.files.map((file) => file.path);
  return isStrictlySortedUnique(paths) && !hasPortableCaseCollision(paths) &&
    value.files.reduce((total, file) => total + file.size, 0) <= CONTRACT_LIMITS.generatedTotalBytes &&
    isBoundedJsonBytes(value, CONTRACT_LIMITS.buildPlanBytes) &&
    value.files.every((file) => (file.role === "executable") === (file.mode === 493));
}
