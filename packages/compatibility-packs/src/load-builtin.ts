import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_LIMITS,
  isPortableRelativePath,
  type FileMode,
} from "@mcdev/contracts";
import {
  BUILTIN_NEOFORGE_26_1_2,
  selectBuiltinCompatibilityPack,
} from "./builtin-registry.ts";
import { BuiltinPackIntegrityError } from "./errors.ts";
import {
  verifyCompatibilityPackSnapshot,
  type CompatibilityPackSnapshotEntry,
  type VerifiedCompatibilityPack,
} from "./snapshot.ts";

const BUILTIN_RUNTIME_PACK_ROOT = fileURLToPath(
  new URL("../../../packs/neoforge-26.1.2/runtime/", import.meta.url),
);
const FILE_READ_CHUNK_BYTES = 65_536;
const MAX_TREE_ENTRIES = CONTRACT_LIMITS.generatedFiles + 4_096 + 1;

export interface SnapshotPathEvent {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface SnapshotFileChunkEvent extends SnapshotPathEvent {
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly limit: number;
}

type SnapshotCloseFault = (
  close: () => Promise<void>,
  event: SnapshotPathEvent,
) => void | Promise<void>;

export interface SnapshotReadFaults {
  readonly afterFileChunk?: (event: SnapshotFileChunkEvent) => void | Promise<void>;
  readonly beforeFilePostStat?: (event: SnapshotPathEvent) => void | Promise<void>;
  readonly beforeDirectoryPostStat?: (event: SnapshotPathEvent) => void | Promise<void>;
  readonly closeFile?: SnapshotCloseFault;
  readonly closeDirectory?: SnapshotCloseFault;
}

const NO_FAULTS: SnapshotReadFaults = Object.freeze({});

function integrity(message: string): never {
  throw new BuiltinPackIntegrityError("BUILTIN_PACK_INTEGRITY_FAILED", message);
}

function logicalMode(mode: number): FileMode {
  return (mode & 0o111) === 0 ? 420 : 493;
}

function isContainedPath(root: string, candidate: string): boolean {
  const displacement = relative(root, candidate);
  return displacement === "" ||
    (!isAbsolute(displacement) && displacement !== ".." && !displacement.startsWith(`..${sep}`));
}

function isSamePath(left: string, right: string): boolean {
  return relative(left, right) === "" && relative(right, left) === "";
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFileState(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function snapshotPathEvent(absolutePath: string, relativePath: string): SnapshotPathEvent {
  return Object.freeze({
    absolutePath,
    relativePath: relativePath === "" ? "." : relativePath,
  });
}

async function closeWithFault(
  close: () => Promise<void>,
  fault: SnapshotCloseFault | undefined,
  event: SnapshotPathEvent,
): Promise<void> {
  let closeInvoked = false;
  const guardedClose = async (): Promise<void> => {
    if (closeInvoked) return;
    closeInvoked = true;
    await close();
  };
  try {
    if (fault === undefined) {
      await guardedClose();
    } else {
      await fault(guardedClose, event);
    }
  } finally {
    if (!closeInvoked) await guardedClose();
  }
}

async function assertNoSymbolicLinkAncestors(absoluteRoot: string): Promise<void> {
  const parsed = parse(absoluteRoot);
  const pathParts = relative(parsed.root, absoluteRoot).split(sep).filter((part) => part.length > 0);
  let current = parsed.root;
  for (const part of pathParts.slice(0, -1)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) {
      return integrity("Built-in compatibility pack root contains a symbolic-link path component.");
    }
  }
}

async function readRegularFile(
  absolutePath: string,
  relativePath: string,
  pathBefore: Stats,
  realRoot: string,
  faults: SnapshotReadFaults,
): Promise<CompatibilityPackSnapshotEntry> {
  let handle: FileHandle | undefined;
  let primaryError: unknown;
  let result: CompatibilityPackSnapshotEntry | undefined;
  const event = snapshotPathEvent(absolutePath, relativePath);
  try {
    const realBefore = await realpath(absolutePath);
    if (!isContainedPath(realRoot, realBefore)) {
      return integrity(`Built-in compatibility pack file escapes its root: ${relativePath}`);
    }
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || !pathBefore.isFile() || !sameStableFileState(pathBefore, before)) {
      return integrity(`Built-in compatibility pack file changed before it could be read: ${relativePath}`);
    }
    const limit = relativePath === "manifest.json"
      ? CONTRACT_LIMITS.buildPlanBytes
      : CONTRACT_LIMITS.generatedFileBytes;
    if (before.size > limit) return integrity(`Built-in compatibility pack file is too large: ${relativePath}`);

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (totalBytes <= limit) {
      const chunkBytes = Math.min(FILE_READ_CHUNK_BYTES, limit + 1 - totalBytes);
      const chunk = new Uint8Array(chunkBytes);
      const { bytesRead } = await handle.read(chunk, 0, chunkBytes, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > chunkBytes) {
        return integrity(`Built-in compatibility pack file returned an invalid read length: ${relativePath}`);
      }
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
      await faults.afterFileChunk?.(Object.freeze({
        ...event,
        bytesRead,
        totalBytes,
        limit,
      }));
      if (totalBytes > limit) {
        return integrity(`Built-in compatibility pack file is too large: ${relativePath}`);
      }
    }

    await faults.beforeFilePostStat?.(event);
    const after = await handle.stat();
    const pathAfter = await lstat(absolutePath);
    const realAfter = await realpath(absolutePath);
    if (!after.isFile() || !pathAfter.isFile() || !sameStableFileState(before, after) ||
      !sameStableFileState(after, pathAfter) || before.size !== totalBytes ||
      realBefore !== realAfter || !isContainedPath(realRoot, realAfter)) {
      return integrity(`Built-in compatibility pack file changed while being read: ${relativePath}`);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    result = Object.freeze({
      path: relativePath,
      mode: logicalMode(after.mode),
      kind: "file" as const,
      bytes,
    });
  } catch (error) {
    primaryError = error;
  }

  let closeError: unknown;
  if (handle !== undefined) {
    try {
      await closeWithFault(() => handle.close(), faults.closeFile, event);
    } catch (error) {
      closeError = error;
    }
  }
  if (primaryError instanceof BuiltinPackIntegrityError) throw primaryError;
  if (primaryError !== undefined) {
    return integrity(`Built-in compatibility pack file could not be read safely: ${relativePath}`);
  }
  if (closeError !== undefined) {
    return integrity(`Built-in compatibility pack file could not be closed safely: ${relativePath}`);
  }
  if (result === undefined) {
    return integrity(`Built-in compatibility pack file did not produce a stable result: ${relativePath}`);
  }
  return result;
}

async function snapshotDirectory(
  absoluteDirectory: string,
  relativeDirectory: string,
  expectedIdentity: Stats,
  realRoot: string,
  entries: CompatibilityPackSnapshotEntry[],
  byteBudget: { total: number },
  entryLimit: number,
  faults: SnapshotReadFaults,
): Promise<void> {
  const before = await lstat(absoluteDirectory);
  const realBefore = await realpath(absoluteDirectory);
  if (!before.isDirectory() || before.isSymbolicLink() || !sameIdentity(expectedIdentity, before) ||
    !isContainedPath(realRoot, realBefore)) {
    return integrity(`Built-in compatibility pack directory is unsafe: ${relativeDirectory || "."}`);
  }
  const directory = await opendir(absoluteDirectory);
  const event = snapshotPathEvent(absoluteDirectory, relativeDirectory);
  const names = new Set<string>();
  let primaryError: unknown;
  try {
    while (true) {
      const directoryEntry = await directory.read();
      if (directoryEntry === null) break;
      const foldedName = directoryEntry.name.toLowerCase();
      if (names.has(foldedName)) {
        return integrity(`Built-in compatibility pack contains a case-colliding entry: ${directoryEntry.name}`);
      }
      names.add(foldedName);
      const relativePath = relativeDirectory === ""
        ? directoryEntry.name
        : `${relativeDirectory}/${directoryEntry.name}`;
      if (!isPortableRelativePath(relativePath)) {
        return integrity(`Built-in compatibility pack contains a non-portable path: ${relativePath}`);
      }
      if (entries.length >= entryLimit) {
        return integrity("Built-in compatibility pack contains too many tree entries.");
      }
      const absolutePath = join(absoluteDirectory, directoryEntry.name);
      const entryStats = await lstat(absolutePath);
      if (entryStats.isSymbolicLink()) {
        return integrity(`Built-in compatibility pack contains a symbolic link: ${relativePath}`);
      }
      if (entryStats.isDirectory()) {
        entries.push(Object.freeze({
          path: relativePath,
          mode: 493,
          kind: "directory" as const,
          bytes: new Uint8Array(),
        }));
        await snapshotDirectory(
          absolutePath,
          relativePath,
          entryStats,
          realRoot,
          entries,
          byteBudget,
          entryLimit,
          faults,
        );
        continue;
      }
      if (!entryStats.isFile()) {
        return integrity(`Built-in compatibility pack contains a non-regular entry: ${relativePath}`);
      }
      const entry = await readRegularFile(absolutePath, relativePath, entryStats, realRoot, faults);
      byteBudget.total += entry.bytes.byteLength;
      if (byteBudget.total > CONTRACT_LIMITS.generatedTotalBytes + CONTRACT_LIMITS.buildPlanBytes) {
        return integrity("Built-in compatibility pack exceeds its total byte limit.");
      }
      entries.push(entry);
    }
    await faults.beforeDirectoryPostStat?.(event);
  } catch (error) {
    primaryError = error;
  }

  let closeError: unknown;
  try {
    await closeWithFault(() => directory.close(), faults.closeDirectory, event);
  } catch (error) {
    closeError = error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (closeError !== undefined) {
    return integrity(
      `Built-in compatibility pack directory could not be closed safely: ${relativeDirectory || "."}`,
    );
  }
  const after = await lstat(absoluteDirectory);
  const realAfter = await realpath(absoluteDirectory);
  if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(before, after) ||
    realBefore !== realAfter || !isContainedPath(realRoot, realAfter)) {
    return integrity(`Built-in compatibility pack directory changed while being read: ${relativeDirectory || "."}`);
  }
}

export async function readCompatibilityPackSnapshotAtRoot(
  rootPath: string,
  entryLimit: number,
  faults: SnapshotReadFaults = NO_FAULTS,
): Promise<readonly CompatibilityPackSnapshotEntry[]> {
  try {
    if (!Number.isSafeInteger(entryLimit) || entryLimit < 1 || entryLimit > MAX_TREE_ENTRIES) {
      return integrity("Built-in compatibility pack has an invalid trusted tree entry limit.");
    }
    const absoluteRoot = resolve(rootPath);
    const root = await lstat(absoluteRoot);
    if (!root.isDirectory() || root.isSymbolicLink()) {
      return integrity("Built-in compatibility pack root must be a real directory.");
    }
    await assertNoSymbolicLinkAncestors(absoluteRoot);
    const realRoot = await realpath(absoluteRoot);
    if (!isSamePath(absoluteRoot, realRoot)) {
      return integrity("Built-in compatibility pack root failed its containment check.");
    }
    const entries: CompatibilityPackSnapshotEntry[] = [];
    await snapshotDirectory(
      absoluteRoot,
      "",
      root,
      realRoot,
      entries,
      { total: 0 },
      entryLimit,
      faults,
    );
    if (entries.length !== entryLimit) {
      return integrity("Built-in compatibility pack tree entry count does not match its trusted registry.");
    }
    return Object.freeze(entries);
  } catch (error) {
    if (error instanceof BuiltinPackIntegrityError) throw error;
    return integrity("Built-in compatibility pack could not be read safely from its fixed location.");
  }
}

export async function readBuiltinCompatibilityPackSnapshot(): Promise<readonly CompatibilityPackSnapshotEntry[]> {
  return readCompatibilityPackSnapshotAtRoot(
    BUILTIN_RUNTIME_PACK_ROOT,
    BUILTIN_NEOFORGE_26_1_2.treeEntries,
  );
}

export async function loadBuiltinCompatibilityPack(
  selector: unknown,
): Promise<VerifiedCompatibilityPack> {
  const registration = selectBuiltinCompatibilityPack(selector);
  if (registration === undefined) {
    throw new BuiltinPackIntegrityError(
      "BUILTIN_PACK_NOT_FOUND",
      "No trusted built-in compatibility pack matches the exact selector.",
    );
  }
  const snapshot = await readBuiltinCompatibilityPackSnapshot();
  return verifyCompatibilityPackSnapshot(snapshot, {
    packId: registration.packId,
    revision: registration.revision,
    selector: registration.target,
    treeSha256: registration.treeSha256,
  });
}
