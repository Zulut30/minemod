import { createHash } from "node:crypto";
import { constants, type BigIntStats, type Dir } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { isProxy, isSharedArrayBuffer, isUint8Array } from "node:util/types";
import {
  CONTRACT_LIMITS,
  WORKSPACE_JOURNAL_CONTRACT,
  WORKSPACE_MANIFEST_CONTRACT,
  containsControlCharacters,
  hasPortableCaseCollision,
  isBoundedJsonBytes,
  isBuildPlan,
  isPortableRelativePath,
  isStrictlySortedUnique,
  isWorkspaceJournal,
  isWorkspaceManifest,
  mcdevError,
  type BuildPlan,
  type CompatibilityPackRef,
  type DomainErrorCode,
  type FileMode,
  type McdevError,
  type PortableRelativePath,
  type Sha256,
  type WorkspaceJournal,
  type WorkspaceManifest,
  type WorkspaceOwnedFile,
} from "@mcdev/contracts";

export const WORKSPACE_STATE_DIRECTORY = ".mcdev";
export const WORKSPACE_LOCK_FILE = ".mcdev-workspace.lock";

const MANIFEST_FILE = "workspace-manifest.json";
const JOURNAL_FILE = "workspace-journal.json";
const DIRECTORY_JOURNAL_FILE = "workspace-directories.json";
const CAS_DIRECTORY_PARTS = ["cas", "sha256"] as const;
const MANIFEST_JSON_LIMIT = CONTRACT_LIMITS.buildPlanBytes;
const JOURNAL_JSON_LIMIT = CONTRACT_LIMITS.logOrJournalRecordBytes;
const INTERNAL_FILE_MODE = 0o600;
const UNSAFE_SHARED_WRITE_BITS = 0o022n;
const CRASH_TEMP_SCAN_LIMIT = 4_096;
const RECOVERABLE_STATE_FILE_NAMES = new Set([MANIFEST_FILE, JOURNAL_FILE, DIRECTORY_JOURNAL_FILE]);

export type WorkspaceFaultPoint =
  | "lock-acquired"
  | "preflight-complete"
  | "cas-object-committed"
  | "journal-prepared"
  | "output-materialized"
  | "manifest-committed"
  | "transaction-cleared"
  | "recovery-output-removed"
  | "recovery-completed";

export interface WorkspaceFaultEvent {
  readonly sequence: number;
  readonly point: WorkspaceFaultPoint;
  readonly path?: PortableRelativePath;
}

export interface WorkspaceApplyDependencies {
  /** Test-only/deterministic fault boundary. Production callers omit it. */
  readonly checkpoint?: (event: WorkspaceFaultEvent) => void | Promise<void>;
}

export interface WorkspaceFileInput {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly content: Uint8Array;
}

export interface WorkspaceApplyInput {
  readonly workspaceRoot: string;
  readonly plan: BuildPlan;
  readonly files: readonly WorkspaceFileInput[];
}

export interface WorkspaceApplyResult {
  readonly status: "created" | "noop";
  readonly manifest: WorkspaceManifest;
}

export interface WorkspaceRecoveryInput {
  readonly workspaceRoot: string;
}

export interface WorkspaceRecoveryResult {
  readonly status: "noop" | "recovered" | "committed";
  readonly removedPaths: readonly PortableRelativePath[];
}

export class WorkspaceFaultInjectionError extends Error {
  readonly event: WorkspaceFaultEvent;

  constructor(event: WorkspaceFaultEvent) {
    super(`Injected workspace fault at checkpoint ${event.sequence}.`);
    this.name = "WorkspaceFaultInjectionError";
    this.event = event;
  }
}

export class WorkspaceApplyError extends Error {
  readonly code: DomainErrorCode;
  readonly error: McdevError;

  constructor(error: McdevError) {
    super(error.message);
    this.name = "WorkspaceApplyError";
    this.code = error.code;
    this.error = error;
  }
}

interface DesiredFile extends WorkspaceOwnedFile {
  readonly content: Buffer;
}

interface PreparedApply {
  readonly root: string;
  readonly files: readonly DesiredFile[];
  readonly manifest: WorkspaceManifest;
}

interface LockHandle {
  readonly path: string;
  readonly handle: FileHandle;
  readonly device: bigint;
  readonly inode: bigint;
}

interface DirectoryJournal {
  readonly contract: "mcdev.workspace-directories/v1";
  readonly planId: Sha256;
  readonly directories: readonly PortableRelativePath[];
}

interface CheckpointState {
  sequence: number;
}

interface InputBudget {
  bytes: number;
  nodes: number;
}

type WorkspaceTreeNodeKind = "directory" | "file";

const INPUT_MAXIMUM_DEPTH = 64;
const INPUT_MAXIMUM_NODES = 65_536;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;

function failure(code: DomainErrorCode, message: string, path?: PortableRelativePath): WorkspaceApplyError {
  return new WorkspaceApplyError(mcdevError(code, message, path));
}

function effectiveUid(code: DomainErrorCode): bigint {
  if (typeof process.geteuid !== "function") {
    throw failure(code, "Workspace ownership verification is unavailable on this platform.");
  }
  const uid = process.geteuid();
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw failure(code, "Workspace ownership verification returned an invalid identity.");
  }
  return BigInt(uid);
}

function isOwnedSafeDirectory(value: BigIntStats, uid: bigint): boolean {
  return !value.isSymbolicLink() && value.isDirectory() && value.uid === uid &&
    (value.mode & UNSAFE_SHARED_WRITE_BITS) === 0n;
}

function isOwnedInternalFile(value: BigIntStats, uid: bigint): boolean {
  return !value.isSymbolicLink() && value.isFile() && value.uid === uid &&
    Number(value.mode & 0o7777n) === INTERNAL_FILE_MODE;
}

function isCanonicalPositiveIntegerText(value: string): boolean {
  if (!/^[1-9][0-9]*$/u.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && String(parsed) === value;
}

function isRecoverablePublicationDestination(name: string): boolean {
  return RECOVERABLE_STATE_FILE_NAMES.has(name) || /^[a-f0-9]{64}$/u.test(name);
}

function isCrashPublicationTemporaryName(destinationName: string, candidateName: string): boolean {
  if (!isRecoverablePublicationDestination(destinationName)) return false;
  const prefix = `.${destinationName}.`;
  const suffix = ".tmp";
  if (!candidateName.startsWith(prefix) || !candidateName.endsWith(suffix)) return false;
  const identity = candidateName.slice(prefix.length, -suffix.length).split(".");
  return identity.length === 2 && identity.every(isCanonicalPositiveIntegerText);
}

function readClosedDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return undefined;
  const actualKeys = (ownKeys as string[]).sort(lexicalCompare);
  const sortedExpected = [...expectedKeys].sort(lexicalCompare);
  if (actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])) return undefined;
  const normalized: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    normalized[key] = descriptor.value;
  }
  return normalized;
}

function readDenseDataArray(value: unknown, maximumLength: number): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 || lengthDescriptor.value > maximumLength) return undefined;
  const length = lengthDescriptor.value;
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

function copyBoundedPlanData(value: unknown, budget: InputBudget, depth = 0): unknown {
  budget.nodes += 1;
  if (budget.nodes > INPUT_MAXIMUM_NODES || depth > INPUT_MAXIMUM_DEPTH) {
    throw failure("WORKSPACE_INVALID", "Build plan input exceeds structural limits.");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw failure("WORKSPACE_INVALID", "Build plan contains invalid data.");
    return value;
  }
  if (typeof value === "string") {
    budget.bytes += Buffer.byteLength(value, "utf8");
    if (budget.bytes > CONTRACT_LIMITS.buildPlanBytes) {
      throw failure("WORKSPACE_INVALID", "Build plan input exceeds its byte limit.");
    }
    return value;
  }
  if (typeof value !== "object" || value === null || isProxy(value)) {
    throw failure("WORKSPACE_INVALID", "Build plan must contain closed JSON data only.");
  }
  if (Array.isArray(value)) {
    const entries = readDenseDataArray(value, INPUT_MAXIMUM_NODES - budget.nodes);
    if (entries === undefined) throw failure("WORKSPACE_INVALID", "Build plan arrays must contain data only.");
    const copied: unknown[] = [];
    for (const entry of entries) copied.push(copyBoundedPlanData(entry, budget, depth + 1));
    return copied;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw failure("WORKSPACE_INVALID", "Build plan objects must be plain data objects.");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string") ||
    ownKeys.length > INPUT_MAXIMUM_NODES - budget.nodes) {
    throw failure("WORKSPACE_INVALID", "Build plan objects exceed structural limits.");
  }
  const copied: Record<string, unknown> = {};
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw failure("WORKSPACE_INVALID", "Build plan objects must contain enumerable data properties only.");
    }
    budget.bytes += Buffer.byteLength(key, "utf8");
    if (budget.bytes > CONTRACT_LIMITS.buildPlanBytes) {
      throw failure("WORKSPACE_INVALID", "Build plan input exceeds its byte limit.");
    }
    Object.defineProperty(copied, key, {
      configurable: true,
      enumerable: true,
      value: copyBoundedPlanData(descriptor.value, budget, depth + 1),
      writable: true,
    });
  }
  return copied;
}

function safeByteLength(value: Uint8Array): number | undefined {
  if (typedArrayByteLengthGetter === undefined) return undefined;
  try {
    return Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
  } catch {
    return undefined;
  }
}

function hasSharedBackingStore(value: Uint8Array): boolean {
  if (typedArrayBufferGetter === undefined) return true;
  try {
    return isSharedArrayBuffer(Reflect.apply(typedArrayBufferGetter, value, []));
  } catch {
    return true;
  }
}

function registerWorkspaceTreePath(
  path: PortableRelativePath,
  exactNodes: Map<string, WorkspaceTreeNodeKind>,
  foldedNodes: Map<string, string>,
): void {
  const parts = path.split("/");
  let nodePath = "";
  for (let index = 0; index < parts.length; index += 1) {
    nodePath = nodePath === "" ? (parts[index] ?? "") : `${nodePath}/${parts[index] ?? ""}`;
    const kind: WorkspaceTreeNodeKind = index === parts.length - 1 ? "file" : "directory";
    const existingKind = exactNodes.get(nodePath);
    if (existingKind !== undefined && (existingKind === "file" || kind === "file")) {
      throw failure("WORKSPACE_INVALID", "Generated outputs contain a file/directory ancestor collision.", path);
    }
    const folded = nodePath.toLowerCase();
    const existingFolded = foldedNodes.get(folded);
    if (existingFolded !== undefined && existingFolded !== nodePath) {
      throw failure("WORKSPACE_INVALID", "Generated output tree collides under portable case folding.", path);
    }
    if (existingKind === undefined) exactNodes.set(nodePath, kind);
    if (existingFolded === undefined) foldedNodes.set(folded, nodePath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isMissing(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

async function maybeLstat(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function sha256(content: Uint8Array): Sha256 {
  return createHash("sha256").update(content).digest("hex");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function samePack(left: CompatibilityPackRef, right: CompatibilityPackRef): boolean {
  return left.packId === right.packId && left.revision === right.revision &&
    left.treeSha256 === right.treeSha256;
}

function sameOwnedFile(left: WorkspaceOwnedFile, right: WorkspaceOwnedFile): boolean {
  return left.path === right.path && left.mode === right.mode && left.size === right.size &&
    left.sha256 === right.sha256;
}

function sameManifest(left: WorkspaceManifest, right: WorkspaceManifest): boolean {
  return left.planId === right.planId && samePack(left.pack, right.pack) &&
    left.files.length === right.files.length &&
    left.files.every((file, index) => {
      const other = right.files[index];
      return other !== undefined && sameOwnedFile(file, other);
    });
}

function assertInternalNameNotRequested(path: string): void {
  const first = path.split("/")[0]?.toLowerCase();
  if (first === WORKSPACE_LOCK_FILE.toLowerCase()) {
    throw failure("WORKSPACE_INVALID", "Generated output targets a reserved workspace path.", path);
  }
}

function normalizeApplyInput(
  input: WorkspaceApplyInput,
): Omit<PreparedApply, "root"> & { readonly workspaceRoot: string } {
  const rawInput = readClosedDataObject(input, ["workspaceRoot", "plan", "files"]);
  if (rawInput === undefined || typeof rawInput.workspaceRoot !== "string") {
    throw failure("WORKSPACE_INVALID", "Workspace apply input does not satisfy the build-plan contract.");
  }
  const plan = copyBoundedPlanData(rawInput.plan, { bytes: 0, nodes: 0 });
  if (!isBuildPlan(plan)) {
    throw failure("WORKSPACE_INVALID", "Workspace apply input does not satisfy the build-plan contract.");
  }
  const rawFiles = readDenseDataArray(rawInput.files, CONTRACT_LIMITS.generatedFiles);
  if (rawFiles === undefined) {
    throw failure("WORKSPACE_INVALID", "Workspace files must be an ordinary bounded data array.");
  }
  const planned = plan.nodes
    .filter((node) => node.kind === "generate-project" || node.kind === "generate-content")
    .flatMap((node) => node.outputs)
    .sort((left, right) => lexicalCompare(left.path, right.path));
  if (planned.length !== rawFiles.length || planned.length > CONTRACT_LIMITS.generatedFiles) {
    throw failure("WORKSPACE_INVALID", "Workspace file content does not match planned generated outputs.");
  }

  let totalBytes = 0;
  const files: DesiredFile[] = [];
  for (const rawFile of rawFiles) {
    const file = readClosedDataObject(rawFile, ["path", "mode", "content"]);
    if (file === undefined || !isPortableRelativePath(file.path)) {
      throw failure("WORKSPACE_INVALID", "Generated output path is not portable and relative.");
    }
    assertInternalNameNotRequested(file.path);
    if (file.mode !== 420 && file.mode !== 493) {
      throw failure("WORKSPACE_INVALID", "Generated output mode is not allowlisted.", file.path);
    }
    if (isProxy(file.content) || !isUint8Array(file.content) || hasSharedBackingStore(file.content)) {
      throw failure("WORKSPACE_INVALID", "Generated output content must be bytes.", file.path);
    }
    const byteLength = safeByteLength(file.content);
    if (byteLength === undefined || byteLength > CONTRACT_LIMITS.generatedFileBytes) {
      throw failure("WORKSPACE_INVALID", "Generated output exceeds the per-file byte limit.", file.path);
    }
    totalBytes += byteLength;
    if (totalBytes > CONTRACT_LIMITS.generatedTotalBytes) {
      throw failure("WORKSPACE_INVALID", "Generated outputs exceed the total byte limit.");
    }
    let copied: Uint8Array;
    try {
      copied = new Uint8Array(file.content);
    } catch {
      throw failure("WORKSPACE_INVALID", "Generated output content is not accessible.", file.path);
    }
    if (safeByteLength(copied) !== byteLength) {
      throw failure("WORKSPACE_INVALID", "Generated output content changed while being copied.", file.path);
    }
    const content = Buffer.from(copied.buffer, copied.byteOffset, copied.byteLength);
    files.push(Object.freeze({
      path: file.path,
      mode: file.mode,
      size: content.byteLength,
      sha256: sha256(content),
      content,
    }));
  }
  files.sort((left, right) => lexicalCompare(left.path, right.path));

  const paths = files.map((file) => file.path);
  if (!isStrictlySortedUnique(paths) || hasPortableCaseCollision(paths)) {
    throw failure("WORKSPACE_INVALID", "Generated output paths must be unique under portable case folding.");
  }
  const exactNodes = new Map<string, WorkspaceTreeNodeKind>();
  const foldedNodes = new Map<string, string>();
  for (const path of paths) registerWorkspaceTreePath(path, exactNodes, foldedNodes);
  for (let index = 0; index < planned.length; index += 1) {
    const expected = planned[index];
    const actual = files[index];
    if (expected === undefined || actual === undefined || !sameOwnedFile(expected, actual)) {
      throw failure(
        "WORKSPACE_INVALID",
        "Generated output bytes do not match the exact planned digest, size, mode, and path.",
        actual?.path,
      );
    }
  }

  const manifest: WorkspaceManifest = Object.freeze({
    contract: WORKSPACE_MANIFEST_CONTRACT,
    planId: plan.planId,
    pack: Object.freeze({ ...plan.pack }),
    files: Object.freeze(files.map((file) => Object.freeze({
      path: file.path,
      mode: file.mode,
      size: file.size,
      sha256: file.sha256,
    }))),
  });
  if (!isWorkspaceManifest(manifest)) {
    throw failure("WORKSPACE_INVALID", "Generated workspace manifest exceeds contract bounds.");
  }
  return { workspaceRoot: rawInput.workspaceRoot, files, manifest };
}

async function canonicalRoot(rawRoot: string): Promise<string> {
  if (typeof rawRoot !== "string" || rawRoot.length === 0 || rawRoot.length > 4_096 ||
    containsControlCharacters(rawRoot) || !isAbsolute(rawRoot) || resolve(rawRoot) !== rawRoot ||
    parse(rawRoot).root === rawRoot) {
    throw failure("WORKSPACE_INVALID", "Workspace root must be an existing canonical absolute directory.");
  }
  try {
    const rootStat = await lstat(rawRoot, { bigint: true });
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || await realpath(rawRoot) !== rawRoot) {
      throw failure("WORKSPACE_INVALID", "Workspace root must be an existing canonical non-symlink directory.");
    }
  } catch (error) {
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure("WORKSPACE_INVALID", "Workspace root must be an existing canonical non-symlink directory.");
  }
  return rawRoot;
}

async function caseCollision(parent: string, requested: string): Promise<boolean> {
  const entries = await readdir(parent);
  const folded = requested.toLowerCase();
  return entries.some((entry) => entry !== requested && entry.toLowerCase() === folded);
}

async function assertSafeStateRoot(root: string): Promise<void> {
  const uid = effectiveUid("WORKSPACE_INVALID");
  if (await caseCollision(root, WORKSPACE_STATE_DIRECTORY)) {
    throw failure("WORKSPACE_INVALID", "Workspace contains a portable case collision with internal state.");
  }
  const state = await maybeLstat(join(root, WORKSPACE_STATE_DIRECTORY));
  if (state !== undefined && !isOwnedSafeDirectory(state, uid)) {
    throw failure("WORKSPACE_INVALID", "Workspace internal state directory has unsafe ownership or permissions.");
  }
}

async function assertSafeCasDirectories(root: string): Promise<void> {
  const uid = effectiveUid("CAS_INTEGRITY_FAILED");
  let current = join(root, WORKSPACE_STATE_DIRECTORY);
  const state = await maybeLstat(current);
  if (state === undefined || !isOwnedSafeDirectory(state, uid)) {
    throw failure("CAS_INTEGRITY_FAILED", "Workspace internal state directory is missing or unsafe.");
  }
  for (const part of CAS_DIRECTORY_PARTS) {
    if (await caseCollision(current, part)) {
      throw failure("CAS_INTEGRITY_FAILED", "CAS directory has a portable case collision.");
    }
    current = join(current, part);
    const directoryStat = await maybeLstat(current);
    if (directoryStat === undefined || !isOwnedSafeDirectory(directoryStat, uid)) {
      throw failure("CAS_INTEGRITY_FAILED", "CAS directory is missing or unsafe.");
    }
  }
}

async function acquireLock(root: string): Promise<LockHandle> {
  if (await caseCollision(root, WORKSPACE_LOCK_FILE)) {
    throw failure("WORKSPACE_BUSY", "Workspace is locked by another operation.");
  }
  const path = join(root, WORKSPACE_LOCK_FILE);
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (isNodeError(error) && ["EEXIST", "ELOOP"].includes(error.code ?? "")) {
      throw failure("WORKSPACE_BUSY", "Workspace is locked by another operation.");
    }
    throw failure("INTERNAL_ERROR", "Workspace lock could not be acquired.");
  }
  let device: bigint | undefined;
  let inode: bigint | undefined;
  try {
    const openedStat = await handle.stat({ bigint: true });
    if (!openedStat.isFile() || openedStat.nlink !== 1n) throw new Error("unsafe lock inode");
    device = openedStat.dev;
    inode = openedStat.ino;
    await handle.writeFile("mcdev workspace lock\n", "utf8");
    await handle.sync();
    const pathStat = await lstat(path, { bigint: true });
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1n ||
      pathStat.dev !== device || pathStat.ino !== inode) throw new Error("lock identity changed");
    return { path, handle, device, inode };
  } catch {
    await handle.close().catch(() => undefined);
    if (device !== undefined && inode !== undefined) {
      const current = await maybeLstat(path).catch(() => undefined);
      if (current !== undefined && !current.isSymbolicLink() && current.dev === device && current.ino === inode) {
        await unlink(path).catch(() => undefined);
      }
    }
    throw failure("INTERNAL_ERROR", "Workspace lock could not be initialized.");
  }
}

async function releaseLock(lock: LockHandle): Promise<void> {
  try {
    let pathStat: BigIntStats;
    try {
      pathStat = await lstat(lock.path, { bigint: true });
    } catch {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace lock identity changed during the operation.");
    }
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1n ||
      pathStat.dev !== lock.device || pathStat.ino !== lock.inode) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace lock identity changed during the operation.");
    }
    try {
      await unlink(lock.path);
    } catch {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace lock could not be safely released.");
    }
  } finally {
    await lock.handle.close().catch(() => undefined);
  }
}

function normalizeDependencies(value: WorkspaceApplyDependencies): WorkspaceApplyDependencies {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw failure("WORKSPACE_INVALID", "Workspace dependencies must use the closed data shape.");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length === 0) return Object.freeze({});
  if (ownKeys.length !== 1 || ownKeys[0] !== "checkpoint") {
    throw failure("WORKSPACE_INVALID", "Workspace dependencies must use the closed data shape.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "checkpoint");
  if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor) ||
    typeof descriptor.value !== "function") {
    throw failure("WORKSPACE_INVALID", "Workspace checkpoint dependency must be a data function.");
  }
  return Object.freeze({
    checkpoint: descriptor.value as NonNullable<WorkspaceApplyDependencies["checkpoint"]>,
  });
}

async function checkpoint(
  dependencies: WorkspaceApplyDependencies,
  state: CheckpointState,
  point: WorkspaceFaultPoint,
  path?: PortableRelativePath,
): Promise<void> {
  state.sequence += 1;
  if (dependencies.checkpoint === undefined) return;
  const event: WorkspaceFaultEvent = Object.freeze({
    sequence: state.sequence,
    point,
    ...(path === undefined ? {} : { path }),
  });
  await dependencies.checkpoint(event);
}

async function readBoundedHandle(
  handle: FileHandle,
  maximumBytes: number,
  code: DomainErrorCode,
  message: string,
  path?: PortableRelativePath,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const remaining = maximumBytes + 1 - total;
    if (remaining <= 0) throw failure(code, message, path);
    const chunk = Buffer.allocUnsafe(Math.min(65_536, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximumBytes) throw failure(code, message, path);
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

function sameFileSnapshot(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mode === right.mode && left.nlink === right.nlink && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function isSameOwnedInternalFile(
  candidate: BigIntStats,
  expected: BigIntStats,
  uid: bigint,
  links: bigint,
): boolean {
  return isOwnedInternalFile(candidate, uid) && candidate.dev === expected.dev &&
    candidate.ino === expected.ino && candidate.size === expected.size && candidate.nlink === links;
}

async function findCrashPublicationSibling(
  destination: string,
  destinationStat: BigIntStats,
  uid: bigint,
  code: DomainErrorCode,
  message: string,
): Promise<string> {
  const directoryPath = dirname(destination);
  const destinationName = basename(destination);
  if (!isRecoverablePublicationDestination(destinationName)) throw failure(code, message);
  let directory: Dir;
  try {
    directory = await opendir(directoryPath);
  } catch {
    throw failure(code, message);
  }
  let sibling: string | undefined;
  let inspected = 0;
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      inspected += 1;
      if (inspected > CRASH_TEMP_SCAN_LIMIT) throw failure(code, message);
      if (!isCrashPublicationTemporaryName(destinationName, entry.name)) continue;
      const candidate = join(directoryPath, entry.name);
      let candidateHandle: FileHandle;
      try {
        candidateHandle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch {
        throw failure(code, message);
      }
      try {
        const candidateStat = await candidateHandle.stat({ bigint: true });
        if (!isSameOwnedInternalFile(candidateStat, destinationStat, uid, 2n)) continue;
        if (sibling !== undefined) throw failure(code, message);
        sibling = candidate;
      } finally {
        await candidateHandle.close().catch(() => undefined);
      }
    }
  } catch (error) {
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure(code, message);
  } finally {
    await directory.close().catch(() => undefined);
  }
  if (sibling === undefined) throw failure(code, message);
  return sibling;
}

async function collapseCrashPublicationSibling(
  destination: string,
  destinationHandle: FileHandle,
  destinationStat: BigIntStats,
  uid: bigint,
  code: DomainErrorCode,
  message: string,
): Promise<void> {
  const sibling = await findCrashPublicationSibling(destination, destinationStat, uid, code, message);
  let siblingHandle: FileHandle;
  try {
    siblingHandle = await open(sibling, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw failure(code, message);
  }
  try {
    const siblingStat = await siblingHandle.stat({ bigint: true });
    if (!isSameOwnedInternalFile(siblingStat, destinationStat, uid, 2n)) throw failure(code, message);
    const [currentDestinationHandle, currentDestinationPath, currentSiblingPath] = await Promise.all([
      destinationHandle.stat({ bigint: true }),
      lstat(destination, { bigint: true }),
      lstat(sibling, { bigint: true }),
    ]);
    if (!isSameOwnedInternalFile(currentDestinationHandle, destinationStat, uid, 2n) ||
      !isSameOwnedInternalFile(currentDestinationPath, destinationStat, uid, 2n) ||
      !isSameOwnedInternalFile(currentSiblingPath, destinationStat, uid, 2n)) {
      throw failure(code, message);
    }
    await unlink(sibling);
    await fsyncDirectory(dirname(destination));
    const [afterHandle, afterPath, afterSiblingHandle, recreatedSibling] = await Promise.all([
      destinationHandle.stat({ bigint: true }),
      lstat(destination, { bigint: true }),
      siblingHandle.stat({ bigint: true }),
      maybeLstat(sibling),
    ]);
    if (!isSameOwnedInternalFile(afterHandle, destinationStat, uid, 1n) ||
      !isSameOwnedInternalFile(afterPath, destinationStat, uid, 1n) ||
      !isSameOwnedInternalFile(afterSiblingHandle, destinationStat, uid, 1n) ||
      recreatedSibling !== undefined) {
      throw failure(code, message);
    }
  } catch (error) {
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure(code, message);
  } finally {
    await siblingHandle.close().catch(() => undefined);
  }
}

async function openTrustedInternalFile(
  path: string,
  maximumBytes: number,
  code: DomainErrorCode,
  message: string,
): Promise<FileHandle> {
  const uid = effectiveUid(code);
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw failure(code, message);
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!isOwnedInternalFile(opened, uid) || opened.size > BigInt(maximumBytes) ||
      (opened.nlink !== 1n && opened.nlink !== 2n)) {
      throw failure(code, message);
    }
    if (opened.nlink === 2n) {
      await collapseCrashPublicationSibling(path, handle, opened, uid, code, message);
    }
    const [currentHandle, currentPath] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (!isSameOwnedInternalFile(currentHandle, opened, uid, 1n) ||
      !isSameOwnedInternalFile(currentPath, opened, uid, 1n) ||
      currentHandle.size > BigInt(maximumBytes)) {
      throw failure(code, message);
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure(code, message);
  }
}

async function readBoundedJson(path: string, maximumBytes: number): Promise<unknown> {
  const handle = await openTrustedInternalFile(
    path,
    maximumBytes,
    "WORKSPACE_RECOVERY_REQUIRED",
    "Workspace state file is not a bounded trusted internal file.",
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!isOwnedInternalFile(before, effectiveUid("WORKSPACE_RECOVERY_REQUIRED")) ||
      before.nlink !== 1n || before.size > BigInt(maximumBytes)) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace state file is not a bounded trusted internal file.");
    }
    const bytes = await readBoundedHandle(
      handle,
      maximumBytes,
      "WORKSPACE_RECOVERY_REQUIRED",
      "Workspace state file is not a bounded regular file.",
    );
    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after) || BigInt(bytes.byteLength) !== after.size) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace state file changed while being read.");
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace state file is not valid bounded JSON.");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readManifest(root: string): Promise<WorkspaceManifest | undefined> {
  const path = join(root, WORKSPACE_STATE_DIRECTORY, MANIFEST_FILE);
  if (await maybeLstat(path) === undefined) return undefined;
  const value = await readBoundedJson(path, MANIFEST_JSON_LIMIT);
  if (!isWorkspaceManifest(value)) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace manifest does not satisfy its contract.");
  }
  return value;
}

async function readJournal(root: string): Promise<WorkspaceJournal | undefined> {
  const path = join(root, WORKSPACE_STATE_DIRECTORY, JOURNAL_FILE);
  if (await maybeLstat(path) === undefined) return undefined;
  const value = await readBoundedJson(path, JOURNAL_JSON_LIMIT);
  if (!isWorkspaceJournal(value)) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace journal does not satisfy its contract.");
  }
  return value;
}

function isDirectoryJournal(value: unknown): value is DirectoryJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (keys.join("\0") !== ["contract", "directories", "planId"].sort().join("\0") ||
    candidate.contract !== "mcdev.workspace-directories/v1" ||
    typeof candidate.planId !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.planId) ||
    !Array.isArray(candidate.directories) ||
    !candidate.directories.every(isPortableRelativePath) ||
    !isBoundedJsonBytes(value, JOURNAL_JSON_LIMIT)) return false;
  return isStrictlySortedUnique(candidate.directories) && !hasPortableCaseCollision(candidate.directories);
}

async function readDirectoryJournal(root: string): Promise<DirectoryJournal | undefined> {
  const path = join(root, WORKSPACE_STATE_DIRECTORY, DIRECTORY_JOURNAL_FILE);
  if (await maybeLstat(path) === undefined) return undefined;
  const value = await readBoundedJson(path, JOURNAL_JSON_LIMIT);
  if (!isDirectoryJournal(value)) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace directory journal is invalid.");
  }
  return value;
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

let temporarySequence = 0;

async function verifyPublishedState(
  path: string,
  expected: Buffer,
  device: bigint,
  inode: bigint,
): Promise<void> {
  const handle = await openTrustedInternalFile(
    path,
    expected.byteLength,
    "WORKSPACE_RECOVERY_REQUIRED",
    "Published workspace state is not safely readable.",
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!isOwnedInternalFile(before, effectiveUid("WORKSPACE_RECOVERY_REQUIRED")) ||
      before.nlink !== 1n || before.dev !== device || before.ino !== inode ||
      before.size !== BigInt(expected.byteLength)) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Published workspace state changed during publication.");
    }
    const bytes = await readBoundedHandle(
      handle,
      expected.byteLength,
      "WORKSPACE_RECOVERY_REQUIRED",
      "Published workspace state changed during publication.",
    );
    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after) || !bytes.equals(expected)) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Published workspace state changed during publication.");
    }
  } catch (error) {
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Published workspace state could not be verified.");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function writeAtomicJson(directory: string, name: string, value: unknown, replace: boolean): Promise<void> {
  temporarySequence += 1;
  const destination = join(directory, name);
  const temporary = join(directory, `.${name}.${process.pid}.${temporarySequence}.tmp`);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw failure("WORKSPACE_INVALID", "Workspace state must be serializable JSON data.");
  }
  const bytes = Buffer.from(serialized, "utf8");
  let handle: FileHandle | undefined;
  let device: bigint | undefined;
  let inode: bigint | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (!isOwnedInternalFile(written, effectiveUid("WORKSPACE_RECOVERY_REQUIRED")) ||
      written.nlink !== 1n || written.size !== BigInt(bytes.byteLength)) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace state temporary file is unsafe.");
    }
    device = written.dev;
    inode = written.ino;
    await handle.close();
    handle = undefined;
    if (replace) {
      const existing = await maybeLstat(destination);
      if (existing === undefined || existing.isSymbolicLink() || !existing.isFile()) {
        throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace state destination is not replaceable.");
      }
      await rename(temporary, destination);
    } else {
      try {
        // link(2) is the portable Node primitive that publishes a fully synced
        // inode while atomically refusing to replace a raced destination.
        await link(temporary, destination);
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace state destination already exists.");
        }
        throw error;
      }
      await unlink(temporary);
    }
    await fsyncDirectory(directory);
    await verifyPublishedState(destination, bytes, device, inode);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function ensureDirectory(path: string, mode: number): Promise<void> {
  const existing = await maybeLstat(path);
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw failure("WORKSPACE_INVALID", "Workspace path component is not a regular directory.");
    }
    return;
  }
  try {
    await mkdir(path, { mode });
    await chmod(path, mode);
    await fsyncDirectory(dirname(path));
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      const raced = await maybeLstat(path);
      if (raced !== undefined && !raced.isSymbolicLink() && raced.isDirectory()) return;
    }
    throw failure("WORKSPACE_CONFLICT", "Workspace directory could not be created exclusively.");
  }
}

async function createOwnedDirectory(path: string, mode: number): Promise<void> {
  const parent = dirname(path);
  const name = path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1));
  if (await caseCollision(parent, name)) {
    throw failure("WORKSPACE_CONFLICT", "Workspace directory appeared after preflight.");
  }
  try {
    await mkdir(path, { mode });
    await chmod(path, mode);
    await fsyncDirectory(path);
    await fsyncDirectory(parent);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw failure("WORKSPACE_CONFLICT", "Workspace directory appeared after preflight.");
    }
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure("INTERNAL_ERROR", "Workspace directory could not be created.");
  }
}

async function assertContainedPath(root: string, relativePath: PortableRelativePath): Promise<readonly PortableRelativePath[]> {
  if (!isPortableRelativePath(relativePath)) {
    throw failure("WORKSPACE_INVALID", "Generated output path is not portable and relative.");
  }
  assertInternalNameNotRequested(relativePath);
  const target = resolve(root, ...relativePath.split("/"));
  const prefix = `${root}${sep}`;
  if (!target.startsWith(prefix) || relative(root, target).split(sep).includes("..")) {
    throw failure("WORKSPACE_INVALID", "Generated output escapes the workspace.", relativePath);
  }
  const parts = relativePath.split("/");
  const missingDirectories: PortableRelativePath[] = [];
  let current = root;
  let missingAncestor = false;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (part === undefined) throw failure("WORKSPACE_INVALID", "Generated output path is invalid.");
    const next = join(current, part);
    const pathSoFar = parts.slice(0, index + 1).join("/") as PortableRelativePath;
    if (!missingAncestor) {
      if (await caseCollision(current, part)) {
        throw failure("WORKSPACE_CONFLICT", "Workspace contains a portable case collision.", pathSoFar);
      }
      const component = await maybeLstat(next);
      if (component === undefined) {
        missingAncestor = true;
        missingDirectories.push(pathSoFar);
      } else if (component.isSymbolicLink() || !component.isDirectory()) {
        throw failure("WORKSPACE_INVALID", "Generated output has a symlink or non-directory ancestor.", pathSoFar);
      }
    } else {
      missingDirectories.push(pathSoFar);
    }
    current = next;
  }
  if (!missingAncestor) {
    const targetName = parts.at(-1);
    if (targetName === undefined) throw failure("WORKSPACE_INVALID", "Generated output path is invalid.");
    if (await caseCollision(current, targetName)) {
      throw failure("WORKSPACE_CONFLICT", "Workspace contains a portable case collision.", relativePath);
    }
    const targetStat = await maybeLstat(target);
    if (targetStat?.isSymbolicLink()) {
      throw failure("WORKSPACE_INVALID", "Generated output target must not be a symlink.", relativePath);
    }
  }
  return missingDirectories;
}

async function preflightOutputs(
  root: string,
  files: readonly DesiredFile[],
  existingManifest: WorkspaceManifest | undefined,
): Promise<readonly PortableRelativePath[]> {
  const directories = new Set<PortableRelativePath>();
  for (const file of files) {
    for (const directory of await assertContainedPath(root, file.path)) directories.add(directory);
    const target = join(root, ...file.path.split("/"));
    const targetStat = await maybeLstat(target);
    if (existingManifest === undefined && targetStat !== undefined) {
      throw failure("WORKSPACE_CONFLICT", "Unmanaged workspace target already exists.", file.path);
    }
  }
  return [...directories].sort(lexicalCompare);
}

interface VerifiedFileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

async function verifyRegularFile(
  path: string,
  expected: WorkspaceOwnedFile,
  code: DomainErrorCode,
): Promise<VerifiedFileIdentity> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw failure(code, "Managed file is missing or unreadable.", expected.path);
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expected.size) ||
      Number(before.mode & 0o777n) !== expected.mode) {
      throw failure(code, "Managed file metadata no longer matches its manifest.", expected.path);
    }
    const bytes = await readBoundedHandle(
      handle,
      expected.size,
      code,
      "Managed file content no longer matches its manifest.",
      expected.path,
    );
    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after) || BigInt(bytes.byteLength) !== after.size ||
      sha256(bytes) !== expected.sha256) {
      throw failure(code, "Managed file content no longer matches its manifest.", expected.path);
    }
    return { device: after.dev, inode: after.ino };
  } catch (error) {
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure(code, "Managed file could not be safely verified.", expected.path);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function casPath(root: string, digest: Sha256): string {
  return join(root, WORKSPACE_STATE_DIRECTORY, ...CAS_DIRECTORY_PARTS, digest);
}

async function verifyCasObject(root: string, expected: WorkspaceOwnedFile): Promise<void> {
  const path = casPath(root, expected.sha256);
  const handle = await openTrustedInternalFile(
    path,
    expected.size,
    "CAS_INTEGRITY_FAILED",
    "CAS object is missing or not a trusted internal file.",
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!isOwnedInternalFile(before, effectiveUid("CAS_INTEGRITY_FAILED")) ||
      before.nlink !== 1n || before.size !== BigInt(expected.size)) {
      throw failure("CAS_INTEGRITY_FAILED", "CAS object metadata failed integrity verification.");
    }
    const bytes = await readBoundedHandle(
      handle,
      expected.size,
      "CAS_INTEGRITY_FAILED",
      "CAS object content failed integrity verification.",
    );
    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after) || BigInt(bytes.byteLength) !== after.size ||
      sha256(bytes) !== expected.sha256) {
      throw failure("CAS_INTEGRITY_FAILED", "CAS object content failed integrity verification.");
    }
  } catch (error) {
    if (error instanceof WorkspaceApplyError) throw error;
    throw failure("CAS_INTEGRITY_FAILED", "CAS object could not be safely verified.");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function ensureCasObject(root: string, file: DesiredFile): Promise<boolean> {
  const destination = casPath(root, file.sha256);
  if (await maybeLstat(destination) !== undefined) {
    await verifyCasObject(root, file);
    return false;
  }
  temporarySequence += 1;
  const parent = dirname(destination);
  const temporary = join(parent, `.${file.sha256}.${process.pid}.${temporarySequence}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(file.content);
    await handle.chmod(0o600);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (!isOwnedInternalFile(written, effectiveUid("CAS_INTEGRITY_FAILED")) ||
      written.nlink !== 1n || written.size !== BigInt(file.size)) {
      throw failure("CAS_INTEGRITY_FAILED", "CAS temporary object is unsafe.");
    }
    await handle.close();
    handle = undefined;
    try {
      // Publish without replacement. A second existence check followed by
      // rename(2) is not create-only because rename replaces a raced path.
      await link(temporary, destination);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        await verifyCasObject(root, file);
        await unlink(temporary);
        await fsyncDirectory(parent);
        return false;
      }
      throw error;
    }
    await unlink(temporary);
    await fsyncDirectory(parent);
    await verifyCasObject(root, file);
    return true;
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function createTarget(
  root: string,
  file: DesiredFile,
  recordExclusiveCreate: () => Promise<void>,
): Promise<void> {
  await assertContainedPath(root, file.path);
  const target = join(root, ...file.path.split("/"));
  let handle: FileHandle;
  try {
    handle = await open(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      file.mode,
    );
  } catch (error) {
    if (isNodeError(error) && ["EEXIST", "ELOOP"].includes(error.code ?? "")) {
      throw failure("WORKSPACE_CONFLICT", "Workspace target appeared after preflight.", file.path);
    }
    throw failure("INTERNAL_ERROR", "Workspace target could not be created.", file.path);
  }
  try {
    // The exclusive target inode is journal-owned before its content is
    // materialized. A partial write is therefore never silently deleted:
    // recovery requires the exact final hash and mode before unlinking it.
    await recordExclusiveCreate();
    await handle.writeFile(file.content);
    await handle.chmod(file.mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsyncDirectory(dirname(target));
  await verifyRegularFile(target, file, "WORKSPACE_RECOVERY_REQUIRED");
  const casStat = await stat(casPath(root, file.sha256), { bigint: true });
  const outputStat = await stat(target, { bigint: true });
  if (casStat.dev === outputStat.dev && casStat.ino === outputStat.ino) {
    throw failure("CAS_INTEGRITY_FAILED", "Workspace outputs must not hardlink CAS objects.", file.path);
  }
}

function preparedJournal(manifest: WorkspaceManifest): WorkspaceJournal {
  const journal: WorkspaceJournal = {
    contract: WORKSPACE_JOURNAL_CONTRACT,
    planId: manifest.planId,
    state: "prepared",
    files: manifest.files,
    createdPaths: [],
  };
  if (!isWorkspaceJournal(journal)) {
    throw failure("WORKSPACE_INVALID", "Workspace journal exceeds contract bounds.");
  }
  return journal;
}

function progressedJournal(journal: WorkspaceJournal, path: PortableRelativePath): WorkspaceJournal {
  const next: WorkspaceJournal = {
    ...journal,
    state: "materializing",
    createdPaths: [...journal.createdPaths, path].sort(lexicalCompare),
  };
  if (!isWorkspaceJournal(next)) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace journal progress is invalid.");
  }
  return next;
}

async function removeTransactionState(root: string): Promise<void> {
  const state = join(root, WORKSPACE_STATE_DIRECTORY);
  // Persist removal of the auxiliary record first. The primary journal is the
  // transaction-presence marker, so every crash-visible intermediate state is
  // either both records or the recoverable primary journal by itself.
  await unlink(join(state, DIRECTORY_JOURNAL_FILE)).catch((error: unknown) => {
    if (!isMissing(error)) throw error;
  });
  await fsyncDirectory(state);
  await unlink(join(state, JOURNAL_FILE)).catch((error: unknown) => {
    if (!isMissing(error)) throw error;
  });
  await fsyncDirectory(state);
}

async function applyLocked(
  prepared: PreparedApply,
  dependencies: WorkspaceApplyDependencies,
  checkpointState: CheckpointState,
): Promise<WorkspaceApplyResult> {
  const { root, files, manifest } = prepared;
  await assertSafeStateRoot(root);
  const stateDirectory = join(root, WORKSPACE_STATE_DIRECTORY);
  const journal = await readJournal(root);
  const directoryJournal = await readDirectoryJournal(root);
  if (journal !== undefined || directoryJournal !== undefined) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace has an incomplete transaction; recover it first.");
  }
  const existingManifest = await readManifest(root);
  const missingDirectories = await preflightOutputs(root, files, existingManifest);

  if (existingManifest !== undefined) {
    if (!sameManifest(existingManifest, manifest)) {
      throw failure("WORKSPACE_CONFLICT", "Workspace is already managed by a different exact plan or pack.");
    }
    await assertSafeCasDirectories(root);
    for (const file of files) {
      await assertContainedPath(root, file.path);
      await verifyRegularFile(
        join(root, ...file.path.split("/")),
        file,
        "WORKSPACE_MANAGED_FILE_MODIFIED",
      );
      await verifyCasObject(root, file);
    }
    await checkpoint(dependencies, checkpointState, "preflight-complete");
    return { status: "noop", manifest: existingManifest };
  }

  let currentJournal = preparedJournal(manifest);
  const completeDirectoryRecord: DirectoryJournal = {
    contract: "mcdev.workspace-directories/v1",
    planId: manifest.planId,
    directories: missingDirectories,
  };
  if (!isDirectoryJournal(completeDirectoryRecord)) {
    throw failure("WORKSPACE_INVALID", "Workspace directory journal is invalid.");
  }
  let currentDirectoryRecord: DirectoryJournal = {
    ...completeDirectoryRecord,
    directories: [],
  };
  await checkpoint(dependencies, checkpointState, "preflight-complete");
  await ensureDirectory(stateDirectory, 0o700);
  let current = stateDirectory;
  for (const part of CAS_DIRECTORY_PARTS) {
    current = join(current, part);
    await ensureDirectory(current, 0o700);
  }
  await assertSafeCasDirectories(root);
  for (const file of files) {
    if (await ensureCasObject(root, file)) {
      await checkpoint(dependencies, checkpointState, "cas-object-committed", file.path);
    }
  }

  await writeAtomicJson(stateDirectory, JOURNAL_FILE, currentJournal, false);
  await writeAtomicJson(stateDirectory, DIRECTORY_JOURNAL_FILE, currentDirectoryRecord, false);
  await checkpoint(dependencies, checkpointState, "journal-prepared");

  for (const directory of [...missingDirectories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth === 0 ? lexicalCompare(left, right) : depth;
  })) {
    await createOwnedDirectory(join(root, ...directory.split("/")), 0o755);
    currentDirectoryRecord = {
      ...currentDirectoryRecord,
      directories: [...currentDirectoryRecord.directories, directory].sort(lexicalCompare),
    };
    if (!isDirectoryJournal(currentDirectoryRecord)) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace directory journal progress is invalid.");
    }
    await writeAtomicJson(stateDirectory, DIRECTORY_JOURNAL_FILE, currentDirectoryRecord, true);
  }

  for (const file of files) {
    await createTarget(root, file, async () => {
      currentJournal = progressedJournal(currentJournal, file.path);
      await writeAtomicJson(stateDirectory, JOURNAL_FILE, currentJournal, true);
    });
    await checkpoint(dependencies, checkpointState, "output-materialized", file.path);
  }

  await writeAtomicJson(stateDirectory, MANIFEST_FILE, manifest, false);
  const committedManifest = await readManifest(root);
  if (committedManifest === undefined || !sameManifest(committedManifest, manifest)) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Committed workspace manifest failed read verification.");
  }
  currentJournal = { ...currentJournal, state: "committed" };
  if (!isWorkspaceJournal(currentJournal)) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Committed workspace journal is invalid.");
  }
  await writeAtomicJson(stateDirectory, JOURNAL_FILE, currentJournal, true);
  await checkpoint(dependencies, checkpointState, "manifest-committed");
  await removeTransactionState(root);
  await checkpoint(dependencies, checkpointState, "transaction-cleared");
  return { status: "created", manifest };
}

export async function applyWorkspacePlan(
  input: WorkspaceApplyInput,
  dependencies: WorkspaceApplyDependencies = {},
): Promise<WorkspaceApplyResult> {
  const normalized = normalizeApplyInput(input);
  const safeDependencies = normalizeDependencies(dependencies);
  const root = await canonicalRoot(normalized.workspaceRoot);
  const lock = await acquireLock(root);
  const checkpointState: CheckpointState = { sequence: 0 };
  let result: WorkspaceApplyResult | undefined;
  let operationError: unknown;
  try {
    await checkpoint(safeDependencies, checkpointState, "lock-acquired");
    result = await applyLocked({
      root,
      files: normalized.files,
      manifest: normalized.manifest,
    }, safeDependencies, checkpointState);
  } catch (error) {
    operationError = error instanceof WorkspaceApplyError || error instanceof WorkspaceFaultInjectionError
      ? error
      : failure("INTERNAL_ERROR", "Workspace apply failed without exposing host details.");
  }
  let releaseError: unknown;
  try {
    await releaseLock(lock);
  } catch (error) {
    releaseError = error;
  }
  if (operationError !== undefined) throw operationError;
  if (releaseError !== undefined) throw releaseError;
  if (result === undefined) throw failure("INTERNAL_ERROR", "Workspace apply produced no result.");
  return result;
}

async function removeOwnedOutput(
  root: string,
  expected: WorkspaceOwnedFile,
): Promise<boolean> {
  await assertContainedPath(root, expected.path);
  const target = join(root, ...expected.path.split("/"));
  const targetStat = await maybeLstat(target);
  if (targetStat === undefined) return false;
  const identity = await verifyRegularFile(target, expected, "WORKSPACE_RECOVERY_REQUIRED");
  let current: BigIntStats;
  try {
    current = await lstat(target, { bigint: true });
  } catch {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Recovery found a modified journal-owned file.", expected.path);
  }
  if (current.isSymbolicLink() || !current.isFile() || current.dev !== identity.device ||
    current.ino !== identity.inode) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Recovery found a modified journal-owned file.", expected.path);
  }
  try {
    await unlink(target);
    await fsyncDirectory(dirname(target));
  } catch {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Recovery could not safely remove an owned file.", expected.path);
  }
  return true;
}

async function removeOwnedDirectories(root: string, journal: DirectoryJournal | undefined): Promise<void> {
  if (journal === undefined) return;
  const ordered = [...journal.directories].sort((left, right) => {
    const depth = right.split("/").length - left.split("/").length;
    return depth === 0 ? lexicalCompare(right, left) : depth;
  });
  for (const directory of ordered) {
    const components = directory.split("/");
    let checked = root;
    for (const component of components) {
      if (await caseCollision(checked, component)) {
        throw failure("WORKSPACE_RECOVERY_REQUIRED", "Recovery found a directory case collision.", directory);
      }
      checked = join(checked, component);
      const componentStat = await maybeLstat(checked);
      if (componentStat === undefined) break;
      if (componentStat.isSymbolicLink() || !componentStat.isDirectory()) {
        throw failure("WORKSPACE_RECOVERY_REQUIRED", "Recovery found a modified journal-owned directory.", directory);
      }
    }
    const path = join(root, ...directory.split("/"));
    const directoryStat = await maybeLstat(path);
    if (directoryStat === undefined) continue;
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Recovery found a modified journal-owned directory.", directory);
    }
    try {
      await rmdir(path);
      await fsyncDirectory(dirname(path));
    } catch (error) {
      if (isNodeError(error) && ["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code ?? "")) continue;
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Recovery could not safely remove an owned directory.", directory);
    }
  }
}

async function recoverLocked(
  root: string,
  dependencies: WorkspaceApplyDependencies,
  checkpointState: CheckpointState,
): Promise<WorkspaceRecoveryResult> {
  await assertSafeStateRoot(root);
  const journal = await readJournal(root);
  const directoryJournal = await readDirectoryJournal(root);
  if (journal === undefined) {
    if (directoryJournal !== undefined) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace directory journal has no matching transaction journal.");
    }
    return { status: "noop", removedPaths: [] };
  }
  if (directoryJournal !== undefined && directoryJournal.planId !== journal.planId) {
    throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace recovery journals identify different plans.");
  }
  const manifest = await readManifest(root);
  if (manifest !== undefined) {
    const journalMatchesManifest = manifest.planId === journal.planId &&
      manifest.files.length === journal.files.length && manifest.files.every((file, index) => {
        const expected = journal.files[index];
        return expected !== undefined && sameOwnedFile(file, expected);
      });
    if (!journalMatchesManifest) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Committed manifest does not match the incomplete journal.");
    }
    await assertSafeCasDirectories(root);
    for (const file of manifest.files) {
      await assertContainedPath(root, file.path);
      await verifyRegularFile(
        join(root, ...file.path.split("/")),
        file,
        "WORKSPACE_RECOVERY_REQUIRED",
      );
      await verifyCasObject(root, file);
    }
    await removeTransactionState(root);
    await checkpoint(dependencies, checkpointState, "recovery-completed");
    return { status: "committed", removedPaths: [] };
  }

  const filesByPath = new Map(journal.files.map((file) => [file.path, file]));
  const recordedPaths = new Set(journal.createdPaths);
  for (const file of journal.files) {
    if (recordedPaths.has(file.path)) continue;
    await assertContainedPath(root, file.path);
    if (await maybeLstat(join(root, ...file.path.split("/"))) !== undefined) {
      // An inode can be created between O_EXCL and durable WAL progress if the
      // host crashes at exactly that boundary. It is never safe to infer
      // ownership from matching bytes, so recovery requires human inspection.
      throw failure(
        "WORKSPACE_RECOVERY_REQUIRED",
        "Recovery found an unrecorded target at a planned path.",
        file.path,
      );
    }
  }
  const removed: PortableRelativePath[] = [];
  let remaining = [...journal.createdPaths];
  for (const path of [...journal.createdPaths].reverse()) {
    const expected = filesByPath.get(path);
    if (expected === undefined) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace journal references an unknown owned file.", path);
    }
    if (await removeOwnedOutput(root, expected)) removed.push(path);
    remaining = remaining.filter((candidate) => candidate !== path);
    const progressed: WorkspaceJournal = { ...journal, state: "materializing", createdPaths: remaining };
    if (!isWorkspaceJournal(progressed)) {
      throw failure("WORKSPACE_RECOVERY_REQUIRED", "Workspace recovery progress is invalid.");
    }
    await writeAtomicJson(join(root, WORKSPACE_STATE_DIRECTORY), JOURNAL_FILE, progressed, true);
    await checkpoint(dependencies, checkpointState, "recovery-output-removed", path);
  }
  await removeOwnedDirectories(root, directoryJournal);
  await removeTransactionState(root);
  await checkpoint(dependencies, checkpointState, "recovery-completed");
  return { status: "recovered", removedPaths: Object.freeze(removed.sort()) };
}

export async function recoverWorkspace(
  input: WorkspaceRecoveryInput,
  dependencies: WorkspaceApplyDependencies = {},
): Promise<WorkspaceRecoveryResult> {
  const normalized = readClosedDataObject(input, ["workspaceRoot"]);
  if (normalized === undefined || typeof normalized.workspaceRoot !== "string") {
    throw failure("WORKSPACE_INVALID", "Workspace recovery input must use the closed data shape.");
  }
  const safeDependencies = normalizeDependencies(dependencies);
  const root = await canonicalRoot(normalized.workspaceRoot);
  const lock = await acquireLock(root);
  const checkpointState: CheckpointState = { sequence: 0 };
  let result: WorkspaceRecoveryResult | undefined;
  let operationError: unknown;
  try {
    await checkpoint(safeDependencies, checkpointState, "lock-acquired");
    result = await recoverLocked(root, safeDependencies, checkpointState);
  } catch (error) {
    operationError = error instanceof WorkspaceApplyError || error instanceof WorkspaceFaultInjectionError
      ? error
      : failure("INTERNAL_ERROR", "Workspace recovery failed without exposing host details.");
  }
  let releaseError: unknown;
  try {
    await releaseLock(lock);
  } catch (error) {
    releaseError = error;
  }
  if (operationError !== undefined) throw operationError;
  if (releaseError !== undefined) throw releaseError;
  if (result === undefined) throw failure("INTERNAL_ERROR", "Workspace recovery produced no result.");
  return result;
}
