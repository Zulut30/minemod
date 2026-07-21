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

export const WORKSPACE_MANIFEST_CONTRACT = "mcdev.workspace-manifest/v1" as const;
export const WORKSPACE_JOURNAL_CONTRACT = "mcdev.workspace-journal/v1" as const;

export interface WorkspaceOwnedFile {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly size: number;
  readonly sha256: Sha256;
}

export interface WorkspaceManifest {
  readonly contract: typeof WORKSPACE_MANIFEST_CONTRACT;
  readonly planId: Sha256;
  readonly pack: CompatibilityPackRef;
  readonly files: readonly WorkspaceOwnedFile[];
}

export interface WorkspaceJournal {
  readonly contract: typeof WORKSPACE_JOURNAL_CONTRACT;
  readonly planId: Sha256;
  readonly state: "prepared" | "materializing" | "committed";
  readonly files: readonly WorkspaceOwnedFile[];
  readonly createdPaths: readonly PortableRelativePath[];
}

export function isWorkspaceOwnedFile(value: unknown): value is WorkspaceOwnedFile {
  return isPlainJsonObject(value) && hasExactKeys(value, ["path", "mode", "size", "sha256"]) &&
    isPortableRelativePath(value.path) && isFileMode(value.mode) && isPositiveSafeInteger(value.size) &&
    value.size <= CONTRACT_LIMITS.generatedFileBytes && isSha256(value.sha256);
}

export function isWorkspaceManifest(value: unknown): value is WorkspaceManifest {
  return isPlainJsonObject(value) && hasExactKeys(value, ["contract", "planId", "pack", "files"]) &&
    value.contract === WORKSPACE_MANIFEST_CONTRACT && isSha256(value.planId) &&
    isCompatibilityPackRef(value.pack) && isDenseJsonArray(value.files) &&
    value.files.length <= CONTRACT_LIMITS.generatedFiles && value.files.every(isWorkspaceOwnedFile) &&
    value.files.reduce((total, file) => total + file.size, 0) <= CONTRACT_LIMITS.generatedTotalBytes &&
    isBoundedJsonBytes(value, CONTRACT_LIMITS.buildPlanBytes) &&
    isStrictlySortedUnique(value.files.map((file) => file.path)) &&
    !hasPortableCaseCollision(value.files.map((file) => file.path));
}

export function isWorkspaceJournal(value: unknown): value is WorkspaceJournal {
  if (!isPlainJsonObject(value) ||
    !hasExactKeys(value, ["contract", "planId", "state", "files", "createdPaths"]) ||
    value.contract !== WORKSPACE_JOURNAL_CONTRACT || !isSha256(value.planId) ||
    typeof value.state !== "string" || !["prepared", "materializing", "committed"].includes(value.state) ||
    !isDenseJsonArray(value.files) || value.files.length > CONTRACT_LIMITS.generatedFiles ||
    !value.files.every(isWorkspaceOwnedFile) || !isStrictlySortedUnique(value.files.map((file) => file.path)) ||
    !isDenseJsonArray(value.createdPaths) || !value.createdPaths.every(isPortableRelativePath) ||
    !isStrictlySortedUnique(value.createdPaths) ||
    value.files.reduce((total, file) => total + file.size, 0) > CONTRACT_LIMITS.generatedTotalBytes ||
    !isBoundedJsonBytes(value, CONTRACT_LIMITS.logOrJournalRecordBytes)) return false;
  const filePaths = new Set(value.files.map((file) => file.path));
  return !hasPortableCaseCollision(value.files.map((file) => file.path)) &&
    !hasPortableCaseCollision(value.createdPaths) && value.createdPaths.every((path) => filePaths.has(path));
}
