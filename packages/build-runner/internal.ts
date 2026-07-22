import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  opendir as nodeOpendir,
  realpath as nodeRealpath,
  rmdir as nodeRmdir,
  unlink as nodeUnlink,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { isProxy, isSharedArrayBuffer, isUint8Array } from "node:util/types";
import {
  BUILTIN_FABRIC_1_20_1,
  BUILTIN_FABRIC_1_20_1_SELECTOR,
  BUILTIN_NEOFORGE_26_1_2,
  BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  BuiltinPackIntegrityError,
  loadBuiltinCompatibilityPack,
  type VerifiedCompatibilityPack,
} from "@mcdev/compatibility-packs";
import { FABRIC_1_20_1_ALLOWED_GRADLE_LIBRARY_BLOCKS } from "@mcdev/library-catalog";
import {
  CONTRACT_LIMITS,
  containsControlCharacters,
  isBuildPlan,
  isPortableRelativePath,
  isWorkspaceManifest,
  type BuildPlan,
  type DomainErrorCode,
  type PortableRelativePath,
  type Sha256,
  type WorkspaceManifest,
  type WorkspaceOwnedFile,
} from "@mcdev/contracts";

export const BUILD_RUNNER_LIMITS = Object.freeze({
  rawOutputBytes: 8 * 1024 * 1024,
  redactedTailBytes: 64 * 1024,
  buildTimeoutMilliseconds: 20 * 60 * 1_000,
  probeTimeoutMilliseconds: 10 * 1_000,
  termGraceMilliseconds: 10 * 1_000,
  killDrainMilliseconds: 5 * 1_000,
  jarBytes: CONTRACT_LIMITS.generatedFileBytes,
} as const);

const WORKSPACE_LOCK_FILE = ".mcdev-workspace.lock";
const WORKSPACE_STATE_DIRECTORY = ".mcdev";
const BUILD_STATE_DIRECTORY = "build";
const FILE_READ_CHUNK_BYTES = 65_536;
const PROBE_OUTPUT_BYTES = 1_048_576;
const MAX_SCAN_ENTRIES = 16_384;
const MAX_MOUNTINFO_BYTES = 1_048_576;
const MAX_MOUNTINFO_LINES = 16_384;
const MAX_MOUNTINFO_LINE_BYTES = 32_768;
const NEOFORGE_WRAPPER_SHA256 = "423cb469ccc0ecc31f0e4e1c309976198ccb734cdcbb7029d4bda0f18f57e8d9";
const FABRIC_WRAPPER_SHA256 = "cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8";
const FABRIC_GRADLE_DISTRIBUTION_SHA256 = "544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d";
const NEOFORGE_GRADLE_DISTRIBUTION_SHA256 = "72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f";
const EXPECTED_JAVA_17_RUNTIME = "17.0.19+10";
const EXPECTED_JAVA_21_RUNTIME = "21.0.11+10-LTS";
const EXPECTED_JAVA_25_RUNTIME = "25.0.3+9-LTS";

type RunnerPackSelector = Parameters<typeof loadBuiltinCompatibilityPack>[0];
type JavaConfigKey = "java17Home" | "java21Home" | "java25Home";

interface FixedRunnerPolicy {
  readonly buildPolicy: "fabric-1.20.1-phase1-v1" | "neoforge-phase1-v1";
  readonly pack: BuildPlan["pack"];
  readonly selector: RunnerPackSelector;
  readonly java: readonly {
    readonly configKey: JavaConfigKey;
    readonly environmentKey: "MCDEV_JAVA17_HOME" | "MCDEV_JAVA21_HOME" | "MCDEV_JAVA25_HOME";
    readonly expectedRuntime: string;
  }[];
  readonly buildJavaKey: JavaConfigKey;
  readonly wrapperSha256: Sha256;
  readonly wrapperLaunch: "jar" | "main-class";
  readonly distributionSha256: Sha256;
  readonly excludedGradleTasks: readonly string[];
  readonly discardDerivedDevJar: boolean;
  readonly projectPaths: readonly PortableRelativePath[];
  readonly contentSourceRoots: readonly string[];
  readonly reservedContentPaths: readonly PortableRelativePath[];
}

const COMMON_PROJECT_PATHS = Object.freeze([
  ".gitignore",
  "build.gradle",
  "gradle.properties",
  "gradle/verification-metadata.xml",
  "gradle/wrapper/gradle-wrapper.jar",
  "gradle/wrapper/gradle-wrapper.properties",
  "gradlew",
  "gradlew.bat",
  "settings.gradle",
] as const);

const NEOFORGE_PHASE1_POLICY: FixedRunnerPolicy = Object.freeze({
  buildPolicy: "neoforge-phase1-v1",
  pack: Object.freeze({
    packId: BUILTIN_NEOFORGE_26_1_2.packId,
    revision: BUILTIN_NEOFORGE_26_1_2.revision,
    treeSha256: BUILTIN_NEOFORGE_26_1_2.treeSha256,
  }),
  selector: BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  java: Object.freeze([
    Object.freeze({ configKey: "java21Home", environmentKey: "MCDEV_JAVA21_HOME", expectedRuntime: EXPECTED_JAVA_21_RUNTIME }),
    Object.freeze({ configKey: "java25Home", environmentKey: "MCDEV_JAVA25_HOME", expectedRuntime: EXPECTED_JAVA_25_RUNTIME }),
  ]),
  buildJavaKey: "java25Home",
  wrapperSha256: NEOFORGE_WRAPPER_SHA256,
  wrapperLaunch: "jar",
  distributionSha256: NEOFORGE_GRADLE_DISTRIBUTION_SHA256,
  excludedGradleTasks: Object.freeze([]),
  discardDerivedDevJar: false,
  projectPaths: Object.freeze([...COMMON_PROJECT_PATHS, "src/main/resources/META-INF/neoforge.mods.toml"]),
  contentSourceRoots: Object.freeze(["src/main/java/", "src/main/resources/"]),
  reservedContentPaths: Object.freeze(["src/main/resources/META-INF/neoforge.mods.toml"]),
});

const FABRIC_1_20_1_PHASE1_POLICY: FixedRunnerPolicy = Object.freeze({
  buildPolicy: "fabric-1.20.1-phase1-v1",
  pack: Object.freeze({
    packId: BUILTIN_FABRIC_1_20_1.packId,
    revision: BUILTIN_FABRIC_1_20_1.revision,
    treeSha256: BUILTIN_FABRIC_1_20_1.treeSha256,
  }),
  selector: BUILTIN_FABRIC_1_20_1_SELECTOR,
  java: Object.freeze([
    Object.freeze({ configKey: "java17Home", environmentKey: "MCDEV_JAVA17_HOME", expectedRuntime: EXPECTED_JAVA_17_RUNTIME }),
  ]),
  buildJavaKey: "java17Home",
  wrapperSha256: FABRIC_WRAPPER_SHA256,
  wrapperLaunch: "main-class",
  distributionSha256: FABRIC_GRADLE_DISTRIBUTION_SHA256,
  excludedGradleTasks: Object.freeze(["sourcesJar", "remapSourcesJar"]),
  discardDerivedDevJar: true,
  projectPaths: Object.freeze([...COMMON_PROJECT_PATHS, "src/main/resources/fabric.mod.json"]),
  contentSourceRoots: Object.freeze(["src/client/java/", "src/main/java/", "src/main/resources/"]),
  reservedContentPaths: Object.freeze(["src/main/resources/fabric.mod.json"]),
});

const typedArrayIntrinsics = (() => {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
  const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
  const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
  if (buffer === undefined || byteLength === undefined || byteOffset === undefined) {
    throw new Error("Uint8Array intrinsics are unavailable.");
  }
  return Object.freeze({ buffer, byteLength, byteOffset });
})();

function inspectBytes(value: unknown): { readonly view: Uint8Array; readonly byteLength: number } | undefined {
  if (!isUint8Array(value) || isProxy(value)) return undefined;
  try {
    const backing = Reflect.apply(typedArrayIntrinsics.buffer, value, []) as ArrayBufferLike;
    const byteLength = Reflect.apply(typedArrayIntrinsics.byteLength, value, []) as number;
    const byteOffset = Reflect.apply(typedArrayIntrinsics.byteOffset, value, []) as number;
    if (isSharedArrayBuffer(backing) || !Number.isSafeInteger(byteLength) || byteLength < 0 ||
      !Number.isSafeInteger(byteOffset) || byteOffset < 0) return undefined;
    return { view: new Uint8Array(backing, byteOffset, byteLength), byteLength };
  } catch {
    return undefined;
  }
}

export type BuildRunnerErrorCode = Extract<DomainErrorCode,
  | "PLAN_INVALID"
  | "WORKSPACE_INVALID"
  | "WORKSPACE_MANAGED_FILE_MODIFIED"
  | "WORKSPACE_BUSY"
  | "PACK_INTEGRITY_FAILED"
  | "BUILD_FAILED"
  | "BUILD_TIMEOUT"
  | "BUILD_OUTPUT_LIMIT"
  | "ARTIFACT_INTEGRITY_FAILED"
  | "INTERNAL_ERROR">;

interface ErrorTails {
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
}

export class BuildRunnerError extends Error {
  readonly code: BuildRunnerErrorCode;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;

  constructor(code: BuildRunnerErrorCode, message: string, tails: ErrorTails = {}) {
    super(message);
    this.name = "BuildRunnerError";
    this.code = code;
    if (tails.stdoutTail !== undefined) this.stdoutTail = tails.stdoutTail;
    if (tails.stderrTail !== undefined) this.stderrTail = tails.stderrTail;
    this.stack = `${this.name}: ${this.message}`;
  }
}

export interface BuildRunnerConfig {
  readonly java21Home: string;
  readonly java25Home: string;
  readonly artifactCacheRoot: string;
}

export interface FabricBuildRunnerConfig {
  readonly java17Home: string;
  readonly artifactCacheRoot: string;
}

export interface BuildRunnerRunInput {
  readonly workspaceRoot: string;
  readonly plan: BuildPlan;
  readonly manifest: WorkspaceManifest;
}

export interface BuildOutputEntry {
  readonly path: PortableRelativePath;
  readonly mode: 420;
  readonly size: number;
  readonly sha256: Sha256;
  readonly kind: "build-output";
  readonly provenance: "build";
}

export interface BuildRunnerOutputs {
  readonly entries: readonly BuildOutputEntry[];
  readFile(path: unknown): Uint8Array;
}

export interface BuildRunnerResult {
  readonly nodeId: "gradle-clean-build";
  readonly outputs: BuildRunnerOutputs;
}

export interface NeoForgePhase1BuildRunner {
  run(input: BuildRunnerRunInput): Promise<BuildRunnerResult>;
}

export interface FabricPhase1BuildRunner {
  run(input: BuildRunnerRunInput): Promise<BuildRunnerResult>;
}

export interface SpawnStream {
  on(event: "data", listener: (chunk: unknown) => void): this;
}

export interface SpawnedProcess {
  readonly pid: number | undefined;
  readonly stdout: SpawnStream | null;
  readonly stderr: SpawnStream | null;
  once(event: "error", listener: (error: unknown) => void): this;
  once(event: "close", listener: (code: unknown, signal: unknown) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface RunnerSpawnOptions {
  readonly cwd: string;
  readonly shell: false;
  readonly detached: boolean;
  readonly windowsHide: true;
  readonly stdio: readonly ["ignore", "pipe", "pipe"];
  readonly env: Readonly<Record<string, string>>;
}

export type RunnerSpawn = (
  command: string,
  args: readonly string[],
  options: RunnerSpawnOptions,
) => SpawnedProcess;

export interface RunnerFileSystem {
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number, mode?: number): Promise<FileHandle>;
  mkdir(path: string, mode: number): Promise<void>;
  openDirectory(path: string): Promise<RunnerDirectory>;
  removeDirectory(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface RunnerDirectoryEntry {
  readonly name: string;
}

export interface RunnerDirectory {
  read(): Promise<RunnerDirectoryEntry | null>;
  close(): Promise<void>;
}

export interface RunnerClock {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
  sleep(milliseconds: number): Promise<void>;
}

export interface ProcessGroups {
  signal(processGroupId: number, signal: NodeJS.Signals): void;
  isAlive(processGroupId: number): boolean;
}

export type RunnerFaultPoint =
  | "managed-file-chunk"
  | "managed-file-before-post-stat"
  | "jar-file-chunk"
  | "jar-file-before-post-stat"
  | "before-build-spawn"
  | "workspace-before-post-verify";

export interface RunnerDependencies {
  readonly platform: () => string;
  readonly architecture: () => string;
  readonly effectiveUserId: () => number;
  readonly spawn: RunnerSpawn;
  readonly fileSystem: RunnerFileSystem;
  readonly clock: RunnerClock;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly processGroups: ProcessGroups;
  readonly readMountInfo: () => Promise<Uint8Array>;
  readonly checkpoint?: (point: RunnerFaultPoint, path?: string) => void | Promise<void>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function processGroupSignal(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ESRCH") throw error;
  }
}

function processGroupIsAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") return false;
    throw error;
  }
}

async function readProcMountInfoBounded(): Promise<Uint8Array> {
  let handle: FileHandle | undefined;
  let primary: unknown;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    handle = await nodeOpen("/proc/self/mountinfo", constants.O_RDONLY | constants.O_NOFOLLOW);
    while (total <= MAX_MOUNTINFO_BYTES) {
      const chunk = new Uint8Array(Math.min(65_536, MAX_MOUNTINFO_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
  } catch (error) {
    primary = error;
  }
  let closeFailed = false;
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch {
      closeFailed = true;
    }
  }
  if (primary !== undefined || closeFailed || total > MAX_MOUNTINFO_BYTES) {
    throw new Error("mountinfo could not be read within its bound");
  }
  return concatenate(chunks);
}

export const DEFAULT_RUNNER_DEPENDENCIES: RunnerDependencies = Object.freeze({
  platform: () => process.platform,
  architecture: () => process.arch,
  effectiveUserId: () => {
    if (process.geteuid === undefined) throw new Error("effective uid is unavailable");
    return process.geteuid();
  },
  spawn: (command: string, args: readonly string[], options: RunnerSpawnOptions) => nodeSpawn(command, [...args], {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as SpawnedProcess,
  fileSystem: Object.freeze({
    lstat: (path: string) => nodeLstat(path, { bigint: true }),
    realpath: (path: string) => nodeRealpath(path),
    open: (path: string, flags: number, mode?: number) => mode === undefined
      ? nodeOpen(path, flags)
      : nodeOpen(path, flags, mode),
    mkdir: async (path: string, mode: number): Promise<void> => {
      await nodeMkdir(path, { mode });
    },
    openDirectory: (path: string) => nodeOpendir(path),
    removeDirectory: (path: string) => nodeRmdir(path),
    unlink: (path: string) => nodeUnlink(path),
  }),
  clock: Object.freeze({
    setTimeout: (callback: () => void, milliseconds: number): unknown => setTimeout(callback, milliseconds),
    clearTimeout: (handle: unknown): void => clearTimeout(handle as NodeJS.Timeout),
    sleep: (milliseconds: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  }),
  randomBytes: (size: number): Uint8Array => new Uint8Array(nodeRandomBytes(size)),
  processGroups: Object.freeze({
    signal: processGroupSignal,
    isAlive: processGroupIsAlive,
  }),
  readMountInfo: readProcMountInfoBounded,
});

function failure(code: BuildRunnerErrorCode, message: string, tails?: ErrorTails): never {
  throw new BuildRunnerError(code, message, tails);
}

async function listDirectoryBounded(
  path: string,
  maximumEntries: number,
  code: BuildRunnerErrorCode,
  message: string,
  dependencies: RunnerDependencies,
): Promise<readonly string[]> {
  let directory: RunnerDirectory | undefined;
  let primary: unknown;
  let result: readonly string[] | undefined;
  try {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0 || maximumEntries > MAX_SCAN_ENTRIES) {
      return failure(code, message);
    }
    directory = await dependencies.fileSystem.openDirectory(path);
    const names: string[] = [];
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      if (names.length >= maximumEntries) return failure(code, message);
      const descriptor = typeof entry === "object" && entry !== null
        ? Object.getOwnPropertyDescriptor(entry, "name")
        : undefined;
      const name = descriptor?.value;
      if (typeof name !== "string" || name.length < 1 || name === "." || name === ".." ||
        name.includes("/") || name.includes("\0")) {
        return failure(code, message);
      }
      names.push(name);
    }
    result = Object.freeze(names);
  } catch (error) {
    primary = error;
  }
  let closeFailed = false;
  if (directory !== undefined) {
    try {
      await directory.close();
    } catch {
      closeFailed = true;
    }
  }
  if (primary instanceof BuildRunnerError) throw primary;
  if (primary !== undefined || closeFailed || result === undefined) return failure(code, message);
  return result;
}

function exactDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string") ||
      !expectedKeys.every((key) => keys.includes(key))) return undefined;
    const copy: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        return undefined;
      }
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

interface JsonCopyBudget {
  bytes: number;
  nodes: number;
}

function copyJsonData(value: unknown, budget: JsonCopyBudget, depth: number): unknown {
  budget.nodes += 1;
  if (budget.nodes > 65_536 || depth > 64) return failure("PLAN_INVALID", "Build input exceeds its structural limit.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return failure("PLAN_INVALID", "Build input is not finite JSON data.");
    return value;
  }
  if (typeof value === "string") {
    if (budget.bytes + value.length > CONTRACT_LIMITS.buildPlanBytes * 2) {
      return failure("PLAN_INVALID", "Build input exceeds its byte limit.");
    }
    budget.bytes += Buffer.byteLength(value, "utf8");
    if (budget.bytes > CONTRACT_LIMITS.buildPlanBytes * 2) {
      return failure("PLAN_INVALID", "Build input exceeds its byte limit.");
    }
    return value;
  }
  if (typeof value !== "object" || value === null || isProxy(value)) {
    return failure("PLAN_INVALID", "Build input must contain closed JSON data only.");
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return failure("PLAN_INVALID", "Build input arrays must use the closed data shape.");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 65_536) {
      return failure("PLAN_INVALID", "Build input arrays exceed their structural limit.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string") || !keys.includes("length")) {
      return failure("PLAN_INVALID", "Build input arrays must be dense data arrays.");
    }
    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        return failure("PLAN_INVALID", "Build input arrays must be dense data arrays.");
      }
      copy.push(copyJsonData(descriptor.value, budget, depth + 1));
    }
    return copy;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return failure("PLAN_INVALID", "Build input objects must use the closed data shape.");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") || keys.length > 65_536) {
    return failure("PLAN_INVALID", "Build input objects exceed their structural limit.");
  }
  const copy: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    if (budget.bytes + key.length > CONTRACT_LIMITS.buildPlanBytes * 2) {
      return failure("PLAN_INVALID", "Build input exceeds its byte limit.");
    }
    budget.bytes += Buffer.byteLength(key, "utf8");
    if (budget.bytes > CONTRACT_LIMITS.buildPlanBytes * 2) {
      return failure("PLAN_INVALID", "Build input exceeds its byte limit.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      return failure("PLAN_INVALID", "Build input objects must contain enumerable data properties only.");
    }
    Object.defineProperty(copy, key, {
      value: copyJsonData(descriptor.value, budget, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

function copyBoundedDocument(value: unknown, code: "PLAN_INVALID" | "WORKSPACE_INVALID"): unknown {
  try {
    const copied = copyJsonData(value, { bytes: 0, nodes: 0 }, 0);
    if (Buffer.byteLength(JSON.stringify(copied), "utf8") > CONTRACT_LIMITS.buildPlanBytes) {
      return failure(code, code === "PLAN_INVALID"
        ? "Build plan exceeds its byte limit."
        : "Workspace manifest exceeds its byte limit.");
    }
    return copied;
  } catch (error) {
    if (error instanceof BuildRunnerError) {
      if (code === "WORKSPACE_INVALID" && error.code === "PLAN_INVALID") {
        return failure("WORKSPACE_INVALID", "Workspace manifest must use the closed v1 data shape.");
      }
      throw error;
    }
    return failure(code, code === "PLAN_INVALID"
      ? "Build plan must use the closed v1 data shape."
      : "Workspace manifest must use the closed v1 data shape.");
  }
}

function copyPath(value: unknown, code: "WORKSPACE_INVALID" | "INTERNAL_ERROR"): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096 || containsControlCharacters(value) ||
    Buffer.byteLength(value, "utf8") > 4_096) {
    return failure(code, code === "INTERNAL_ERROR"
      ? "Build runner configuration is invalid."
      : "Workspace root is invalid.");
  }
  return value;
}

interface NormalizedBuildRunnerConfig {
  readonly artifactCacheRoot: string;
  readonly javaHomes: ReadonlyMap<JavaConfigKey, string>;
}

function normalizeConfig(value: unknown, policy: FixedRunnerPolicy): NormalizedBuildRunnerConfig {
  const javaKeys = policy.java.map(({ configKey }) => configKey);
  const raw = exactDataObject(value, [...javaKeys, "artifactCacheRoot"]);
  if (raw === undefined) return failure("INTERNAL_ERROR", "Build runner configuration must use the closed data shape.");
  const javaHomes = new Map<JavaConfigKey, string>();
  for (const key of javaKeys) javaHomes.set(key, copyPath(raw[key], "INTERNAL_ERROR"));
  return Object.freeze({
    artifactCacheRoot: copyPath(raw.artifactCacheRoot, "INTERNAL_ERROR"),
    javaHomes,
  });
}

interface NormalizedRunInput {
  readonly workspaceRoot: string;
  readonly plan: BuildPlan;
  readonly manifest: WorkspaceManifest;
}

interface PriorBuildProvenance {
  readonly planId: string;
  readonly packTreeSha256: string;
  readonly workspaceDevice: bigint;
  readonly workspaceInode: bigint;
  readonly entry: BuildOutputEntry;
}

function normalizeRunInput(value: unknown): NormalizedRunInput {
  const raw = exactDataObject(value, ["workspaceRoot", "plan", "manifest"]);
  if (raw === undefined) return failure("PLAN_INVALID", "Build runner input must use the closed data shape.");
  const workspaceRoot = copyPath(raw.workspaceRoot, "WORKSPACE_INVALID");
  const plan = copyBoundedDocument(raw.plan, "PLAN_INVALID");
  if (!isBuildPlan(plan)) return failure("PLAN_INVALID", "Build plan does not satisfy mcdev.build-plan/v1.");
  const manifest = copyBoundedDocument(raw.manifest, "WORKSPACE_INVALID");
  if (!isWorkspaceManifest(manifest)) {
    return failure("WORKSPACE_INVALID", "Workspace manifest does not satisfy mcdev.workspace-manifest/v1.");
  }
  return Object.freeze({ workspaceRoot, plan, manifest });
}

function samePack(left: BuildPlan["pack"], right: BuildPlan["pack"]): boolean {
  return left.packId === right.packId && left.revision === right.revision && left.treeSha256 === right.treeSha256;
}

function assertFixedPlan(plan: BuildPlan, manifest: WorkspaceManifest, policy: FixedRunnerPolicy): void {
  if (plan.planId !== manifest.planId || !samePack(plan.pack, manifest.pack)) {
    return failure("PLAN_INVALID", "Build plan and workspace manifest identities do not match.");
  }
  if (!samePack(plan.pack, policy.pack)) {
    return failure("PACK_INTEGRITY_FAILED", "Build plan does not reference the exact trusted compatibility pack.");
  }
  const expectedKinds = new Map<string, string>([
    ["apply-workspace", "apply-workspace"],
    ["generate-content", "generate-content"],
    ["generate-project", "generate-project"],
    ["gradle-clean-build", "gradle-clean-build"],
    ["index-artifacts", "index-artifacts"],
  ] as const);
  if (plan.nodes.length !== expectedKinds.size || plan.nodes.some((node) => expectedKinds.get(node.nodeId) !== node.kind)) {
    return failure("PLAN_INVALID", "Build plan does not use the fixed Phase 1 node topology.");
  }
  const byId = new Map(plan.nodes.map((node) => [node.nodeId, node]));
  const exactDependencies = new Map<string, readonly string[]>([
    ["generate-content", []],
    ["generate-project", []],
    ["apply-workspace", ["generate-content", "generate-project"]],
    ["gradle-clean-build", ["apply-workspace"]],
    ["index-artifacts", ["gradle-clean-build"]],
  ]);
  for (const [nodeId, dependencies] of exactDependencies) {
    const node = byId.get(nodeId);
    if (node === undefined || node.dependsOn.length !== dependencies.length ||
      node.dependsOn.some((dependency, index) => dependency !== dependencies[index])) {
      return failure("PLAN_INVALID", "Build plan dependencies do not match the fixed Phase 1 policy.");
    }
  }
  for (const nodeId of ["apply-workspace", "gradle-clean-build", "index-artifacts"] as const) {
    if ((byId.get(nodeId)?.outputs.length ?? -1) !== 0) {
      return failure("PLAN_INVALID", "Downstream Phase 1 nodes must not claim compiler-owned workspace outputs.");
    }
  }
  const projectNode = byId.get("generate-project");
  const contentNode = byId.get("generate-content");
  const buildNode = byId.get("gradle-clean-build");
  if (projectNode === undefined || contentNode === undefined || contentNode.outputs.length === 0 ||
    buildNode?.kind !== "gradle-clean-build" || buildNode.policy !== policy.buildPolicy ||
    projectNode.outputs.length !== policy.projectPaths.length || projectNode.outputs.some((file, index) =>
      file.path !== policy.projectPaths[index])) {
    return failure("PLAN_INVALID", "Generator outputs do not match the fixed compiler ownership partition.");
  }
  if (contentNode.outputs.some((file) =>
    !policy.contentSourceRoots.some((root) => file.path.startsWith(root)) ||
    policy.reservedContentPaths.includes(file.path))) {
    return failure("PLAN_INVALID", "Generated content outputs do not match the fixed compiler topology.");
  }
  const manifestByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const outputsEqualManifest = (outputs: readonly WorkspaceOwnedFile[]): boolean => outputs.every((file) => {
    const owned = manifestByPath.get(file.path);
    return owned !== undefined && file.mode === owned.mode && file.size === owned.size && file.sha256 === owned.sha256;
  });
  if (!outputsEqualManifest(projectNode.outputs) || !outputsEqualManifest(contentNode.outputs) ||
    projectNode.outputs.length + contentNode.outputs.length !== manifest.files.length) {
    return failure("PLAN_INVALID", "Build plan outputs do not match the workspace manifest.");
  }
}

function sha256(bytes: Uint8Array): Sha256 {
  return createHash("sha256").update(bytes).digest("hex");
}

function samePath(left: string, right: string): boolean {
  return relative(left, right) === "" && relative(right, left) === "";
}

interface MountTable {
  readonly mountPoints: readonly string[];
  readonly records: readonly { readonly mountPoint: string; readonly fingerprint: Sha256 }[];
}

function decodeMountInfoPath(field: string, requireCanonicalAbsolute: boolean): string {
  let decoded = "";
  for (let index = 0; index < field.length; index += 1) {
    const character = field[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escape = field.slice(index, index + 4);
    const replacement = escape === "\\040" ? " "
      : escape === "\\011" ? "\t"
        : escape === "\\012" ? "\n"
          : escape === "\\134" ? "\\"
            : undefined;
    if (replacement === undefined) throw new Error("invalid mountinfo escape");
    decoded += replacement;
    index += 3;
  }
  if (decoded.includes("\0") || (requireCanonicalAbsolute && (!isAbsolute(decoded) || resolve(decoded) !== decoded))) {
    throw new Error("non-canonical mountinfo path");
  }
  return decoded;
}

function parseMountInfo(bytes: Uint8Array): MountTable {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_MOUNTINFO_BYTES) throw new Error("mountinfo size");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.endsWith("\n") || text.includes("\0")) throw new Error("mountinfo framing");
  const lines = text.slice(0, -1).split("\n");
  if (lines.length < 1 || lines.length > MAX_MOUNTINFO_LINES) throw new Error("mountinfo line count");
  const mountIds = new Set<string>();
  const mountPoints = new Set<string>();
  const records: { mountPoint: string; fingerprint: Sha256 }[] = [];
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > MAX_MOUNTINFO_LINE_BYTES) throw new Error("mountinfo line size");
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    if (fields.length < 10 || fields.some((field) => field.length === 0) || separator < 6 ||
      separator + 4 !== fields.length || !/^\d+$/u.test(fields[0] ?? "") ||
      !/^\d+$/u.test(fields[1] ?? "") || !/^\d+:\d+$/u.test(fields[2] ?? "")) {
      throw new Error("mountinfo record");
    }
    const mountId = fields[0];
    if (mountId === undefined || mountIds.has(mountId)) throw new Error("duplicate mount id");
    mountIds.add(mountId);
    decodeMountInfoPath(fields[3] ?? "", false);
    const mountPoint = decodeMountInfoPath(fields[4] ?? "", true);
    mountPoints.add(mountPoint);
    records.push({ mountPoint, fingerprint: sha256(Buffer.from(line, "utf8")) });
  }
  return Object.freeze({
    mountPoints: Object.freeze([...mountPoints].sort()),
    records: Object.freeze(records
      .sort((left, right) => left.mountPoint < right.mountPoint ? -1
        : left.mountPoint > right.mountPoint ? 1
          : left.fingerprint < right.fingerprint ? -1 : left.fingerprint > right.fingerprint ? 1 : 0)
      .map((record) => Object.freeze(record))),
  });
}

async function loadMountTable(dependencies: RunnerDependencies): Promise<MountTable> {
  try {
    const inspected = inspectBytes(await dependencies.readMountInfo());
    if (inspected === undefined || inspected.byteLength > MAX_MOUNTINFO_BYTES) throw new Error("invalid mountinfo bytes");
    return parseMountInfo(new Uint8Array(inspected.view));
  } catch {
    return failure("INTERNAL_ERROR", "Linux mount topology could not be verified safely.");
  }
}

function assertNoNestedMountPoints(
  root: string,
  mounts: MountTable,
  code: "WORKSPACE_INVALID" | "PACK_INTEGRITY_FAILED",
): void {
  if (mounts.mountPoints.some((mountPoint) => {
    const nested = relative(root, mountPoint);
    return nested !== "" && nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested);
  })) {
    return failure(code, code === "WORKSPACE_INVALID"
      ? "Workspace contains a nested mount point."
      : "Trusted tool tree contains a nested mount point.");
  }
}

interface MountTrustRoot {
  readonly root: string;
  readonly code: "WORKSPACE_INVALID" | "PACK_INTEGRITY_FAILED";
}

function mountContainsPath(mountPoint: string, path: string): boolean {
  const nested = relative(mountPoint, path);
  return nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested));
}

function verifyMountTrust(
  roots: readonly MountTrustRoot[],
  mounts: MountTable,
  expected?: ReadonlyMap<string, Sha256>,
): ReadonlyMap<string, Sha256> {
  const contexts = new Map<string, Sha256>();
  for (const trust of roots) {
    assertNoNestedMountPoints(trust.root, mounts, trust.code);
    const relevant = mounts.records
      .filter((record) => mountContainsPath(record.mountPoint, trust.root) || mountContainsPath(trust.root, record.mountPoint))
      .map((record) => `${record.mountPoint}\0${record.fingerprint}`);
    const context = sha256(Buffer.from(relevant.join("\n"), "utf8"));
    if (expected !== undefined && expected.get(trust.root) !== context) {
      return failure(trust.code, trust.code === "WORKSPACE_INVALID"
        ? "Workspace mount topology changed during the build."
        : "Trusted tool mount topology changed during the build.");
    }
    contexts.set(trust.root, context);
  }
  return contexts;
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mode === right.mode && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

interface CanonicalDirectory {
  readonly path: string;
  readonly identity: BigIntStats;
  readonly effectiveUserId: bigint;
  readonly ownerPolicy: "effective-user" | "root-or-effective";
}

type DirectoryErrorCode = "WORKSPACE_INVALID" | "INTERNAL_ERROR" | "PACK_INTEGRITY_FAILED";

function hasTrustedOwner(
  stats: BigIntStats,
  effectiveUserId: bigint,
  ownerPolicy: CanonicalDirectory["ownerPolicy"],
): boolean {
  return stats.uid === effectiveUserId || (ownerPolicy === "root-or-effective" && stats.uid === 0n);
}

function hasTrustedPermissions(stats: BigIntStats): boolean {
  return (stats.mode & 0o022n) === 0n;
}

function isTrustedDirectoryMetadata(
  stats: BigIntStats,
  effectiveUserId: bigint,
  ownerPolicy: CanonicalDirectory["ownerPolicy"],
  expectedDevice?: bigint,
): boolean {
  return stats.isDirectory() && !stats.isSymbolicLink() && hasTrustedOwner(stats, effectiveUserId, ownerPolicy) &&
    hasTrustedPermissions(stats) && (expectedDevice === undefined || stats.dev === expectedDevice);
}

function directoryFailure(code: DirectoryErrorCode, changed: boolean): never {
  if (code === "WORKSPACE_INVALID") {
    return failure(code, changed
      ? "Workspace directory identity or trust changed during the build."
      : "Workspace directory is unavailable or unsafe.");
  }
  if (code === "PACK_INTEGRITY_FAILED") {
    return failure(code, changed
      ? "Trusted tool directory identity or ownership changed during verification."
      : "Trusted tool directory configuration is unavailable or unsafe.");
  }
  return failure(code, changed
    ? "Build runner directory identity changed during the build."
    : "Build runner directory configuration is invalid.");
}

async function canonicalDirectory(
  rawPath: string,
  code: DirectoryErrorCode,
  effectiveUserId: bigint,
  ownerPolicy: CanonicalDirectory["ownerPolicy"],
  dependencies: RunnerDependencies,
  expectedDevice?: bigint,
): Promise<CanonicalDirectory> {
  if (!isAbsolute(rawPath)) {
    return directoryFailure(code, false);
  }
  const absolute = resolve(rawPath);
  try {
    const before = await dependencies.fileSystem.lstat(absolute);
    const real = await dependencies.fileSystem.realpath(absolute);
    const after = await dependencies.fileSystem.lstat(absolute);
    if (!isTrustedDirectoryMetadata(before, effectiveUserId, ownerPolicy, expectedDevice) ||
      !isTrustedDirectoryMetadata(after, effectiveUserId, ownerPolicy, expectedDevice) ||
      !sameIdentity(before, after) || !samePath(absolute, real)) {
      return directoryFailure(code, false);
    }
    return Object.freeze({ path: absolute, identity: after, effectiveUserId, ownerPolicy });
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return directoryFailure(code, false);
  }
}

async function assertDirectoryIdentity(
  directory: CanonicalDirectory,
  code: DirectoryErrorCode,
  dependencies: RunnerDependencies,
): Promise<void> {
  try {
    const current = await dependencies.fileSystem.lstat(directory.path);
    const real = await dependencies.fileSystem.realpath(directory.path);
    if (!isTrustedDirectoryMetadata(current, directory.effectiveUserId, directory.ownerPolicy, directory.identity.dev) ||
      !sameIdentity(directory.identity, current) ||
      !samePath(directory.path, real)) {
      return directoryFailure(code, true);
    }
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return directoryFailure(code, true);
  }
}

async function maybeLstat(path: string, dependencies: RunnerDependencies): Promise<BigIntStats | undefined> {
  try {
    return await dependencies.fileSystem.lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function ensureSafeDirectory(
  path: string,
  code: "WORKSPACE_INVALID" | "PACK_INTEGRITY_FAILED",
  effectiveUserId: bigint,
  expectedDevice: bigint,
  dependencies: RunnerDependencies,
): Promise<CanonicalDirectory> {
  try {
    let stats = await maybeLstat(path, dependencies);
    if (stats === undefined) {
      await dependencies.fileSystem.mkdir(path, 0o700);
      stats = await dependencies.fileSystem.lstat(path);
    }
    return await canonicalDirectory(path, code, effectiveUserId, "effective-user", dependencies, expectedDevice);
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return directoryFailure(code, false);
  }
}

async function prepareBuildDirectories(
  workspace: CanonicalDirectory,
  artifactCache: CanonicalDirectory,
  packTreeSha256: string,
  dependencies: RunnerDependencies,
): Promise<{
  readonly toolHome: string;
  readonly temporaryDirectory: string;
  readonly projectCacheDirectory: string;
  readonly gradleUserHome: string;
  readonly buildState: CanonicalDirectory;
  readonly packCache: CanonicalDirectory;
  readonly gradleUserHomeDirectory: CanonicalDirectory;
  readonly trustedDirectories: readonly CanonicalDirectory[];
}> {
  try {
    const workspaceState = join(workspace.path, WORKSPACE_STATE_DIRECTORY);
    const stateStats = await maybeLstat(workspaceState, dependencies);
    if (stateStats === undefined) return failure("WORKSPACE_INVALID", "Workspace state directory is missing or unsafe.");
    const workspaceStateDirectory = await canonicalDirectory(
      workspaceState,
      "WORKSPACE_INVALID",
      workspace.effectiveUserId,
      "effective-user",
      dependencies,
      workspace.identity.dev,
    );
    const buildState = join(workspaceState, BUILD_STATE_DIRECTORY);
    const toolHome = join(buildState, "home");
    const temporaryDirectory = join(buildState, "tmp");
    const projectCacheDirectory = join(buildState, "gradle-project-cache");
    const workspaceDirectories: CanonicalDirectory[] = [workspaceStateDirectory];
    let buildStateDirectory: CanonicalDirectory | undefined;
    for (const path of [buildState, toolHome, temporaryDirectory, projectCacheDirectory]) {
      const directory = await ensureSafeDirectory(
        path,
        "WORKSPACE_INVALID",
        workspace.effectiveUserId,
        workspace.identity.dev,
        dependencies,
      );
      if (path === buildState) buildStateDirectory = directory;
      workspaceDirectories.push(directory);
    }
    if (buildStateDirectory === undefined) return failure("INTERNAL_ERROR", "Build state directory was not prepared.");
    const packCachePath = join(artifactCache.path, packTreeSha256);
    const packCache = await ensureSafeDirectory(
      packCachePath,
      "PACK_INTEGRITY_FAILED",
      artifactCache.effectiveUserId,
      artifactCache.identity.dev,
      dependencies,
    );
    const gradleUserHome = join(packCache.path, "gradle-user-home");
    const gradleUserHomeDirectory = await ensureSafeDirectory(
      gradleUserHome,
      "PACK_INTEGRITY_FAILED",
      artifactCache.effectiveUserId,
      artifactCache.identity.dev,
      dependencies,
    );
    return Object.freeze({
      toolHome,
      temporaryDirectory,
      projectCacheDirectory,
      gradleUserHome,
      buildState: buildStateDirectory,
      packCache,
      gradleUserHomeDirectory,
      trustedDirectories: Object.freeze([...workspaceDirectories, packCache, gradleUserHomeDirectory]),
    });
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure("WORKSPACE_INVALID", "Build state directories could not be prepared safely.");
  }
}

interface LockHandle {
  readonly path: string;
  readonly handle: FileHandle;
  readonly device: bigint;
  readonly inode: bigint;
}

async function hasCaseCollision(parent: string, requested: string, dependencies: RunnerDependencies): Promise<boolean> {
  const entries = await listDirectoryBounded(
    parent,
    MAX_SCAN_ENTRIES,
    "WORKSPACE_INVALID",
    "Workspace contains too many entries or could not be listed safely.",
    dependencies,
  );
  const folded = requested.toLowerCase();
  return entries.some((entry) => entry !== requested && entry.toLowerCase() === folded);
}

async function acquireWorkspaceLock(root: string, dependencies: RunnerDependencies): Promise<LockHandle> {
  try {
    if (await hasCaseCollision(root, WORKSPACE_LOCK_FILE, dependencies)) {
      return failure("WORKSPACE_BUSY", "Workspace is locked by another operation.");
    }
    const path = join(root, WORKSPACE_LOCK_FILE);
    let handle: FileHandle;
    try {
      handle = await dependencies.fileSystem.open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (isNodeError(error) && ["EEXIST", "ELOOP"].includes(error.code ?? "")) {
        return failure("WORKSPACE_BUSY", "Workspace is locked by another operation.");
      }
      return failure("INTERNAL_ERROR", "Workspace lock could not be acquired.");
    }
    let device: bigint | undefined;
    let inode: bigint | undefined;
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || Number(opened.mode & 0o777n) !== 0o600) {
        throw new Error("unsafe lock");
      }
      device = opened.dev;
      inode = opened.ino;
      await handle.writeFile("mcdev workspace lock\n", "utf8");
      await handle.sync();
      const pathStats = await dependencies.fileSystem.lstat(path);
      if (pathStats.isSymbolicLink() || !pathStats.isFile() || pathStats.nlink !== 1n ||
        pathStats.dev !== device || pathStats.ino !== inode) throw new Error("unsafe lock");
      return Object.freeze({ path, handle, device, inode });
    } catch {
      await handle.close().catch(() => undefined);
      if (device !== undefined && inode !== undefined) {
        const current = await maybeLstat(path, dependencies).catch(() => undefined);
        if (current !== undefined && !current.isSymbolicLink() && current.dev === device && current.ino === inode) {
          await dependencies.fileSystem.unlink(path).catch(() => undefined);
        }
      }
      return failure("INTERNAL_ERROR", "Workspace lock could not be initialized.");
    }
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure("INTERNAL_ERROR", "Workspace lock could not be acquired safely.");
  }
}

async function releaseWorkspaceLock(lock: LockHandle, dependencies: RunnerDependencies): Promise<void> {
  try {
    const current = await dependencies.fileSystem.lstat(lock.path);
    if (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1n ||
      current.dev !== lock.device || current.ino !== lock.inode) {
      return failure("INTERNAL_ERROR", "Workspace lock identity changed during the build.");
    }
    await dependencies.fileSystem.unlink(lock.path);
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure("INTERNAL_ERROR", "Workspace lock could not be safely released.");
  } finally {
    await lock.handle.close().catch(() => undefined);
  }
}

async function readHandleBounded(
  handle: FileHandle,
  maximumBytes: number,
  dependencies: RunnerDependencies,
  faultPoint: "managed-file-chunk" | "jar-file-chunk",
  relativePath: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total <= maximumBytes) {
    const requested = Math.min(FILE_READ_CHUNK_BYTES, maximumBytes + 1 - total);
    const chunk = new Uint8Array(requested);
    const { bytesRead } = await handle.read(chunk, 0, requested, null);
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > requested) throw new Error("invalid read");
    if (bytesRead === 0) break;
    total += bytesRead;
    chunks.push(chunk.subarray(0, bytesRead));
    await dependencies.checkpoint?.(faultPoint, relativePath);
    if (total > maximumBytes) throw new Error("oversize read");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function assertCanonicalContainedFilePath(
  root: string,
  relativePath: string,
  effectiveUserId: bigint,
  expectedDevice: bigint,
  code: "WORKSPACE_INVALID" | "ARTIFACT_INTEGRITY_FAILED",
  dependencies: RunnerDependencies,
): Promise<string> {
  const parts = relativePath.split("/");
  const absolutePath = resolve(root, ...parts);
  if (!absolutePath.startsWith(`${root}${sep}`)) throw new Error("path escape");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const before = await dependencies.fileSystem.lstat(current);
    const real = await dependencies.fileSystem.realpath(current);
    const after = await dependencies.fileSystem.lstat(current);
    if (!isTrustedDirectoryMetadata(before, effectiveUserId, "effective-user", expectedDevice) ||
      !isTrustedDirectoryMetadata(after, effectiveUserId, "effective-user", expectedDevice) ||
      !sameStableFile(before, after) || !samePath(current, real)) {
      return failure(code, code === "WORKSPACE_INVALID"
        ? "Managed workspace path has an unsafe ancestor directory."
        : "Build artifact path has an unsafe ancestor directory.");
    }
  }
  const realFile = await dependencies.fileSystem.realpath(absolutePath);
  if (!samePath(absolutePath, realFile)) throw new Error("unsafe file path");
  return absolutePath;
}

async function verifyManagedFile(
  root: string,
  expected: WorkspaceOwnedFile,
  effectiveUserId: bigint,
  workspaceDevice: bigint,
  dependencies: RunnerDependencies,
): Promise<Uint8Array> {
  let handle: FileHandle | undefined;
  let primary: unknown;
  let result: Uint8Array | undefined;
  try {
    const absolutePath = await assertCanonicalContainedFilePath(
      root,
      expected.path,
      effectiveUserId,
      workspaceDevice,
      "WORKSPACE_INVALID",
      dependencies,
    );
    const pathBefore = await dependencies.fileSystem.lstat(absolutePath);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n ||
      pathBefore.uid !== effectiveUserId || pathBefore.dev !== workspaceDevice ||
      pathBefore.size !== BigInt(expected.size) || Number(pathBefore.mode & 0o7777n) !== expected.mode) {
      return failure("WORKSPACE_MANAGED_FILE_MODIFIED", "Managed file metadata no longer matches its manifest.");
    }
    handle = await dependencies.fileSystem.open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== effectiveUserId ||
      before.dev !== workspaceDevice || !sameStableFile(pathBefore, before)) {
      return failure("WORKSPACE_MANAGED_FILE_MODIFIED", "Managed file identity no longer matches its manifest.");
    }
    const bytes = await readHandleBounded(handle, expected.size, dependencies, "managed-file-chunk", expected.path);
    await dependencies.checkpoint?.("managed-file-before-post-stat", expected.path);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await dependencies.fileSystem.lstat(absolutePath);
    const realAfter = await dependencies.fileSystem.realpath(absolutePath);
    if (!sameStableFile(before, after) || !sameStableFile(after, pathAfter) || after.uid !== effectiveUserId ||
      after.dev !== workspaceDevice ||
      !samePath(absolutePath, realAfter) || bytes.byteLength !== expected.size || sha256(bytes) !== expected.sha256) {
      return failure("WORKSPACE_MANAGED_FILE_MODIFIED", "Managed file content no longer matches its manifest.");
    }
    result = bytes;
  } catch (error) {
    primary = error;
  }
  let closeFailed = false;
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch {
      closeFailed = true;
    }
  }
  if (primary instanceof BuildRunnerError) throw primary;
  if (primary !== undefined || closeFailed || result === undefined) {
    return failure("WORKSPACE_MANAGED_FILE_MODIFIED", "Managed file could not be safely verified.");
  }
  return result;
}

async function verifyManagedFiles(
  root: string,
  manifest: WorkspaceManifest,
  effectiveUserId: bigint,
  workspaceDevice: bigint,
  dependencies: RunnerDependencies,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const expected of manifest.files) {
    files.set(expected.path, await verifyManagedFile(root, expected, effectiveUserId, workspaceDevice, dependencies));
  }
  return files;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function requireManagedBytes(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const bytes = files.get(path);
  if (bytes === undefined) return failure("PACK_INTEGRITY_FAILED", "Required compatibility-pack build input is missing.");
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return failure("PACK_INTEGRITY_FAILED", "Compatibility-pack text input is not canonical UTF-8.");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildTemplatePattern(template: string, policy: FixedRunnerPolicy): RegExp {
  const tokenPattern = /@@MCDEV_(MOD_ID|PROJECT_VERSION)@@/gu;
  let pattern = "^";
  let offset = 0;
  for (const match of template.matchAll(tokenPattern)) {
    const index = match.index;
    const token = match[1];
    pattern += escapeRegExp(template.slice(offset, index));
    pattern += token === "MOD_ID" ? "([a-z][a-z0-9_]{1,63})" : "([0-9A-Za-z][0-9A-Za-z.+-]{0,63})";
    offset = index + match[0].length;
  }
  pattern += escapeRegExp(template.slice(offset));
  if (policy.buildPolicy === "fabric-1.20.1-phase1-v1") {
    const libraryBlocks = FABRIC_1_20_1_ALLOWED_GRADLE_LIBRARY_BLOCKS
      .filter((block) => block.length > 0)
      .map(escapeRegExp);
    pattern += `(?:${libraryBlocks.join("|")})?`;
  }
  pattern += "$";
  return new RegExp(pattern, "u");
}

function settingsTemplatePattern(template: string): RegExp {
  return new RegExp(`^${escapeRegExp(template).replace(escapeRegExp("@@MCDEV_MOD_ID@@"), "([a-z][a-z0-9_]{1,63})")}$`, "u");
}

function assertPackBuildInputs(
  policy: FixedRunnerPolicy,
  pack: VerifiedCompatibilityPack,
  files: ReadonlyMap<string, Uint8Array>,
): void {
  const exactMappings = [
    ["gradle.properties", "templates/gradle.properties"],
    ["gradle/verification-metadata.xml", "templates/gradle/verification-metadata.xml"],
    ["gradle/wrapper/gradle-wrapper.jar", "templates/gradle/wrapper/gradle-wrapper.jar"],
    ["gradle/wrapper/gradle-wrapper.properties", "templates/gradle/wrapper/gradle-wrapper.properties"],
    ["gradlew", "templates/gradlew"],
    ["gradlew.bat", "templates/gradlew.bat"],
  ] as const;
  for (const [workspacePath, packPath] of exactMappings) {
    if (!bytesEqual(requireManagedBytes(files, workspacePath), pack.readFile(packPath))) {
      return failure("PACK_INTEGRITY_FAILED", "Workspace build input does not match the trusted compatibility pack.");
    }
  }
  const wrapper = requireManagedBytes(files, "gradle/wrapper/gradle-wrapper.jar");
  if (sha256(wrapper) !== policy.wrapperSha256) {
    return failure("PACK_INTEGRITY_FAILED", "Gradle wrapper integrity verification failed.");
  }
  const properties = decodeUtf8(requireManagedBytes(files, "gradle.properties"));
  if (!properties.includes("org.gradle.java.installations.auto-detect=false\n") ||
    !properties.includes("org.gradle.java.installations.auto-download=false\n") ||
    !properties.includes(`org.gradle.java.installations.fromEnv=${
      policy.java.map(({ environmentKey }) => environmentKey).join(",")
    }\n`)) {
    return failure("PACK_INTEGRITY_FAILED", "Gradle toolchain policy is not fail closed.");
  }
  const wrapperProperties = decodeUtf8(requireManagedBytes(files, "gradle/wrapper/gradle-wrapper.properties"));
  if (!wrapperProperties.includes(`distributionSha256Sum=${policy.distributionSha256}\n`)) {
    return failure("PACK_INTEGRITY_FAILED", "Gradle distribution integrity policy is missing.");
  }
  const buildTemplate = decodeUtf8(pack.readFile("templates/build.gradle.tpl"));
  const settingsTemplate = decodeUtf8(pack.readFile("templates/settings.gradle.tpl"));
  const buildMatch = buildTemplatePattern(buildTemplate, policy).exec(
    decodeUtf8(requireManagedBytes(files, "build.gradle")),
  );
  const settingsMatch = settingsTemplatePattern(settingsTemplate).exec(
    decodeUtf8(requireManagedBytes(files, "settings.gradle")),
  );
  if (buildMatch === null || settingsMatch === null || buildMatch[2] !== buildMatch[3] ||
    buildMatch[2] !== settingsMatch[1]) {
    return failure("PACK_INTEGRITY_FAILED", "Gradle scripts do not match the trusted compatibility-pack templates.");
  }
}

function isExecutionSurface(relativePath: string, stats: BigIntStats): boolean {
  const folded = relativePath.toLowerCase();
  const name = basename(folded);
  if (Number(stats.mode & 0o111n) !== 0) return true;
  if (folded === "build.gradle" || folded === "build.gradle.kts" || folded === "settings.gradle" ||
    folded === "settings.gradle.kts" || folded === "gradle.properties" || folded === "gradlew" ||
    folded === "gradlew.bat" || folded.startsWith("buildsrc/") || folded.startsWith("build-logic/") ||
    folded.startsWith(".gradle/") || folded.startsWith("src/test/")) return true;
  return name.endsWith(".gradle") || name.endsWith(".gradle.kts") || name.endsWith(".groovy") ||
    name.endsWith(".jar") || name.endsWith(".class") || name.endsWith(".sh") || name.endsWith(".bash") ||
    name.endsWith(".cmd") || name.endsWith(".bat") || name.endsWith(".ps1");
}

async function assertNoUnmanagedExecutionSurfaces(
  root: string,
  manifest: WorkspaceManifest,
  priorBuild: PriorBuildProvenance | undefined,
  effectiveUserId: bigint,
  workspaceDevice: bigint,
  dependencies: RunnerDependencies,
): Promise<void> {
  const managed = new Set<string>(manifest.files.map((file) => file.path));
  const pending: string[] = [""];
  let entriesSeen = 0;
  try {
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) break;
      const absoluteDirectory = directory === "" ? root : join(root, ...directory.split("/"));
      const directoryBefore = await dependencies.fileSystem.lstat(absoluteDirectory);
      const realDirectory = await dependencies.fileSystem.realpath(absoluteDirectory);
      if (!isTrustedDirectoryMetadata(
        directoryBefore,
        effectiveUserId,
        "effective-user",
        workspaceDevice,
      ) || !samePath(absoluteDirectory, realDirectory)) {
        return failure("WORKSPACE_INVALID", "Workspace contains an unsafe directory.");
      }
      const names = await listDirectoryBounded(
        absoluteDirectory,
        MAX_SCAN_ENTRIES - entriesSeen,
        "WORKSPACE_INVALID",
        "Workspace tree exceeds the build safety limit or could not be listed safely.",
        dependencies,
      );
      entriesSeen += names.length;
      const foldedNames = new Set<string>();
      for (const name of names) {
        const folded = name.toLocaleLowerCase("en-US");
        if (foldedNames.has(folded)) {
          return failure("WORKSPACE_INVALID", "Workspace contains case-colliding sibling paths.");
        }
        foldedNames.add(folded);
      }
      for (const name of names) {
        const relativePath = directory === "" ? name : `${directory}/${name}`;
        if (relativePath === WORKSPACE_LOCK_FILE || relativePath === ".git" || relativePath.startsWith(".git/") ||
          relativePath === WORKSPACE_STATE_DIRECTORY || relativePath.startsWith(`${WORKSPACE_STATE_DIRECTORY}/`)) {
          continue;
        }
        if (!isPortableRelativePath(relativePath)) {
          return failure("WORKSPACE_INVALID", "Workspace contains a non-portable build input path.");
        }
        const stats = await dependencies.fileSystem.lstat(join(root, ...relativePath.split("/")));
        if (stats.isSymbolicLink()) return failure("WORKSPACE_INVALID", "Workspace contains a symbolic link.");
        if (stats.isDirectory()) {
          if (relativePath === "build" && priorBuild !== undefined) {
            await verifyPriorBuildTree(root, priorBuild, effectiveUserId, dependencies);
            continue;
          }
          pending.push(relativePath);
        } else if (!stats.isFile()) {
          return failure("WORKSPACE_INVALID", "Workspace contains an unsupported filesystem entry.");
        } else if (!managed.has(relativePath) &&
          (relativePath === "src" || relativePath.startsWith("src/") ||
            relativePath === "gradle" || relativePath.startsWith("gradle/") ||
            isExecutionSurface(relativePath, stats))) {
          return failure("WORKSPACE_INVALID", "Workspace contains an unmanaged execution surface.");
        }
      }
      const directoryAfter = await dependencies.fileSystem.lstat(absoluteDirectory);
      const realDirectoryAfter = await dependencies.fileSystem.realpath(absoluteDirectory);
      if (!sameStableFile(directoryBefore, directoryAfter) || !samePath(absoluteDirectory, realDirectoryAfter) ||
        !isTrustedDirectoryMetadata(directoryAfter, effectiveUserId, "effective-user", workspaceDevice)) {
        return failure("WORKSPACE_INVALID", "Workspace directory changed during its safety scan.");
      }
    }
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure("WORKSPACE_INVALID", "Workspace execution surfaces could not be verified safely.");
  }
}

function isForbiddenPriorBuildFile(relativePath: string, stats: BigIntStats): boolean {
  const folded = relativePath.toLowerCase();
  if (Number(stats.mode & 0o111n) !== 0) return true;
  return folded.endsWith(".gradle") || folded.endsWith(".gradle.kts") || folded.endsWith(".groovy") ||
    folded.endsWith(".kts") || folded.endsWith(".sh") || folded.endsWith(".bash") ||
    folded.endsWith(".cmd") || folded.endsWith(".bat") || folded.endsWith(".ps1");
}

async function verifyPriorBuildTree(
  root: string,
  priorBuild: PriorBuildProvenance,
  effectiveUserId: bigint,
  dependencies: RunnerDependencies,
): Promise<void> {
  if (!priorBuild.entry.path.startsWith("build/") || !priorBuild.entry.path.endsWith(".jar")) {
    return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build provenance is invalid.");
  }
  const pending = ["build"];
  const jars: string[] = [];
  let entriesSeen = 0;
  try {
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) break;
      const absoluteDirectory = join(root, ...directory.split("/"));
      const directoryStats = await dependencies.fileSystem.lstat(absoluteDirectory);
      const realDirectory = await dependencies.fileSystem.realpath(absoluteDirectory);
      if (!isTrustedDirectoryMetadata(
        directoryStats,
        effectiveUserId,
        "effective-user",
        priorBuild.workspaceDevice,
      ) ||
        !samePath(absoluteDirectory, realDirectory)) {
        return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output tree is unsafe.");
      }
      const names = await listDirectoryBounded(
        absoluteDirectory,
        MAX_SCAN_ENTRIES - entriesSeen,
        "ARTIFACT_INTEGRITY_FAILED",
        "Prior build output tree exceeds its safety limit or could not be listed safely.",
        dependencies,
      );
      entriesSeen += names.length;
      const foldedNames = new Set<string>();
      for (const name of names) {
        const folded = name.toLocaleLowerCase("en-US");
        if (foldedNames.has(folded)) {
          return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output tree contains case-colliding entries.");
        }
        foldedNames.add(folded);
      }
      for (const name of names) {
        const relativePath = `${directory}/${name}`;
        if (!isPortableRelativePath(relativePath)) {
          return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output path is not portable.");
        }
        const absolutePath = join(root, ...relativePath.split("/"));
        const stats = await dependencies.fileSystem.lstat(absolutePath);
        if (stats.isSymbolicLink()) {
          return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output tree contains a symbolic link.");
        }
        if (stats.isDirectory()) {
          pending.push(relativePath);
          continue;
        }
        if (!stats.isFile() || stats.nlink !== 1n || stats.dev !== priorBuild.workspaceDevice ||
          !hasTrustedOwner(stats, effectiveUserId, "effective-user") || !hasTrustedPermissions(stats) ||
          isForbiddenPriorBuildFile(relativePath, stats)) {
          return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output tree contains an unsafe entry.");
        }
        const statsAfter = await dependencies.fileSystem.lstat(absolutePath);
        if (!sameStableFile(stats, statsAfter)) {
          return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output tree changed during verification.");
        }
        if (relativePath.toLowerCase().endsWith(".jar")) jars.push(relativePath);
      }
      const directoryAfter = await dependencies.fileSystem.lstat(absoluteDirectory);
      const realDirectoryAfter = await dependencies.fileSystem.realpath(absoluteDirectory);
      if (!sameStableFile(directoryStats, directoryAfter) || !samePath(absoluteDirectory, realDirectoryAfter) ||
        !isTrustedDirectoryMetadata(directoryAfter, effectiveUserId, "effective-user", priorBuild.workspaceDevice)) {
        return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output directory changed during verification.");
      }
    }
    if (jars.length !== 1 || jars[0] !== priorBuild.entry.path) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output tree does not match runner provenance.");
    }
    const bytes = await verifyManagedFile(root, {
      path: priorBuild.entry.path,
      mode: priorBuild.entry.mode,
      size: priorBuild.entry.size,
      sha256: priorBuild.entry.sha256,
    }, effectiveUserId, priorBuild.workspaceDevice, dependencies);
    if (bytes.byteLength !== priorBuild.entry.size || sha256(bytes) !== priorBuild.entry.sha256) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output does not match runner provenance.");
    }
  } catch (error) {
    if (error instanceof BuildRunnerError && error.code === "ARTIFACT_INTEGRITY_FAILED") throw error;
    return failure("ARTIFACT_INTEGRITY_FAILED", "Prior build output could not be verified safely.");
  }
}

async function assertTrustedTree(
  root: CanonicalDirectory,
  code: "WORKSPACE_INVALID" | "PACK_INTEGRITY_FAILED",
  dependencies: RunnerDependencies,
): Promise<Sha256> {
  const pending = [root.path];
  const records = new Map<string, string>();
  let entriesSeen = 0;
  const record = (path: string, stats: BigIntStats): void => {
    const relativePath = relative(root.path, path) || ".";
    records.set(relativePath, [relativePath, stats.dev, stats.ino, stats.mode, stats.uid, stats.gid, stats.nlink,
      stats.size, stats.mtimeNs, stats.ctimeNs].join(":"));
  };
  try {
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) break;
      const directoryBefore = await dependencies.fileSystem.lstat(directory);
      const realDirectory = await dependencies.fileSystem.realpath(directory);
      if (!isTrustedDirectoryMetadata(
        directoryBefore,
        root.effectiveUserId,
        root.ownerPolicy,
        root.identity.dev,
      ) || !samePath(directory, realDirectory)) {
        return failure(code, "Trusted filesystem tree contains an unsafe directory.");
      }
      record(directory, directoryBefore);
      const names = await listDirectoryBounded(
        directory,
        MAX_SCAN_ENTRIES - entriesSeen,
        code,
        "Trusted filesystem tree exceeds its recursive safety limit or could not be listed safely.",
        dependencies,
      );
      entriesSeen += names.length;
      const foldedNames = new Set<string>();
      for (const name of names) {
        const folded = name.toLocaleLowerCase("en-US");
        if (foldedNames.has(folded)) {
          return failure(code, "Trusted filesystem tree contains case-colliding entries.");
        }
        foldedNames.add(folded);
        const path = join(directory, name);
        const before = await dependencies.fileSystem.lstat(path);
        record(path, before);
        if (before.isSymbolicLink() || before.dev !== root.identity.dev ||
          !hasTrustedOwner(before, root.effectiveUserId, root.ownerPolicy) || !hasTrustedPermissions(before)) {
          return failure(code, "Trusted filesystem tree contains an unsafe entry.");
        }
        if (before.isDirectory()) {
          const real = await dependencies.fileSystem.realpath(path);
          if (!samePath(path, real)) {
            return failure(code, "Trusted filesystem tree contains a non-canonical directory.");
          }
          pending.push(path);
        } else if (!before.isFile() || before.nlink !== 1n) {
          return failure(code, "Trusted filesystem tree contains an unsupported entry.");
        }
        const after = await dependencies.fileSystem.lstat(path);
        if (!sameStableFile(before, after)) {
          return failure(code, "Trusted filesystem tree changed during its trust scan.");
        }
      }
      const directoryAfter = await dependencies.fileSystem.lstat(directory);
      if (!sameStableFile(directoryBefore, directoryAfter) ||
        !isTrustedDirectoryMetadata(
          directoryAfter,
          root.effectiveUserId,
          root.ownerPolicy,
          root.identity.dev,
        )) {
        return failure(code, "Trusted filesystem tree directory changed during its trust scan.");
      }
    }
    await assertDirectoryIdentity(root, code, dependencies);
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure(code, "Trusted filesystem tree could not be recursively verified.");
  }
  // Node has no portable descriptor-relative recursive walk. These identity rechecks narrow, but cannot
  // eliminate, a malicious same-UID pathname replacement race; effective-UID ownership is the trust boundary.
  return sha256(Buffer.from([...records.values()].sort().join("\n"), "utf8"));
}

async function assertNoGradleUserHomeInjection(path: string, dependencies: RunnerDependencies): Promise<void> {
  try {
    const entries = await listDirectoryBounded(
      path,
      MAX_SCAN_ENTRIES,
      "PACK_INTEGRITY_FAILED",
      "Gradle artifact cache could not be listed safely.",
      dependencies,
    );
    if (entries.some((entry) => ["init.d", "init.gradle", "init.gradle.kts", "gradle.properties"]
      .includes(entry.toLowerCase()))) {
      return failure("PACK_INTEGRITY_FAILED", "Gradle artifact cache contains an execution surface.");
    }
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure("PACK_INTEGRITY_FAILED", "Gradle artifact cache could not be verified safely.");
  }
}

function tailUtf8(bytes: Uint8Array, limit: number): string {
  let start = Math.max(0, bytes.byteLength - limit);
  while (start < bytes.byteLength && (bytes[start] ?? 0) >= 0x80 && (bytes[start] ?? 0) < 0xc0) start += 1;
  return Buffer.from(bytes.subarray(start)).toString("utf8");
}

function redactText(text: string, secrets: readonly string[]): string {
  let redacted = text;
  const sortedSecrets = [...new Set(secrets.filter((secret) => secret.length > 0))]
    .sort((left, right) => right.length - left.length);
  for (const secret of sortedSecrets) redacted = redacted.split(secret).join("[REDACTED]");
  redacted = redacted
    .replace(/\b((?:https?|ftp):\/\/)[^\s/@:]{1,256}:[^\s/@]{1,256}@/giu, "$1[REDACTED]@")
    .replace(/\b(token|password|secret|authorization|credential)=([^\s]+)/giu, "$1=[REDACTED]")
    .replace(/(^|[\s"'=(])\/(?:[^\s"'<>)]*)/gmu, "$1[REDACTED_PATH]");
  return redacted;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function redactedTails(
  stdout: readonly Uint8Array[],
  stderr: readonly Uint8Array[],
  secrets: readonly string[],
): ErrorTails {
  const redact = (chunks: readonly Uint8Array[]): string => {
    const raw = concatenate(chunks);
    const maximumSecretBytes = secrets.reduce(
      (maximum, secret) => Math.max(maximum, Buffer.byteLength(secret, "utf8")),
      0,
    );
    const contextBytes = BUILD_RUNNER_LIMITS.redactedTailBytes + maximumSecretBytes + 4_096;
    const rawTail = raw.subarray(Math.max(0, raw.byteLength - contextBytes));
    const redacted = Buffer.from(redactText(Buffer.from(rawTail).toString("utf8"), secrets), "utf8");
    return tailUtf8(redacted, BUILD_RUNNER_LIMITS.redactedTailBytes);
  };
  return Object.freeze({ stdoutTail: redact(stdout), stderrTail: redact(stderr) });
}

interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: RunnerSpawnOptions;
  readonly timeoutMilliseconds: number;
  readonly maximumOutputBytes: number;
  readonly detached: boolean;
  readonly timeoutCode: "BUILD_TIMEOUT" | "PACK_INTEGRITY_FAILED";
  readonly outputCode: "BUILD_OUTPUT_LIMIT" | "PACK_INTEGRITY_FAILED";
  readonly spawnCode: "BUILD_FAILED" | "PACK_INTEGRITY_FAILED";
  readonly secrets: readonly string[];
}

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

function normalizedExitCode(value: unknown): number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value)) ? value : null;
}

function normalizedSignal(value: unknown): NodeJS.Signals | null {
  return value === null || typeof value !== "string" ? null : value as NodeJS.Signals;
}

async function ensureNoResidualProcessGroup(
  pid: number,
  dependencies: RunnerDependencies,
): Promise<"absent" | "reaped" | "unreaped"> {
  try {
    // A negative process-group probe is the portable proof used here. We intentionally do not scan /proc
    // for the nonce: doing so would add Linux process-table races without establishing stronger ownership.
    if (!dependencies.processGroups.isAlive(pid)) return "absent";
    dependencies.processGroups.signal(pid, "SIGTERM");
    await dependencies.clock.sleep(BUILD_RUNNER_LIMITS.termGraceMilliseconds);
    if (!dependencies.processGroups.isAlive(pid)) return "reaped";
    dependencies.processGroups.signal(pid, "SIGKILL");
    await dependencies.clock.sleep(BUILD_RUNNER_LIMITS.killDrainMilliseconds);
    return dependencies.processGroups.isAlive(pid) ? "unreaped" : "reaped";
  } catch {
    return "unreaped";
  }
}

function executeProcess(request: ProcessRequest, dependencies: RunnerDependencies): Promise<ProcessResult> {
  return new Promise((resolveProcess, rejectProcess) => {
    let child: SpawnedProcess;
    try {
      child = dependencies.spawn(request.command, request.args, request.options);
    } catch {
      rejectProcess(new BuildRunnerError(request.spawnCode, request.detached
        ? "Build worker could not be started."
        : "Java runtime probe could not be started."));
      return;
    }
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let totalOutput = 0;
    let stopReason: "timeout" | "output" | "spawn" | "invalid-output" | undefined;
    let closed = false;
    let settled = false;
    const timers: { timeout?: unknown; force?: unknown; drain?: unknown } = {};

    const clearTimers = (): void => {
      if (timers.timeout !== undefined) dependencies.clock.clearTimeout(timers.timeout);
      if (timers.force !== undefined) dependencies.clock.clearTimeout(timers.force);
      if (timers.drain !== undefined) dependencies.clock.clearTimeout(timers.drain);
    };

    const tails = (): ErrorTails => redactedTails(stdoutChunks, stderrChunks, request.secrets);

    const rejectStopped = (): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (stopReason === "timeout") {
        rejectProcess(new BuildRunnerError(request.timeoutCode, request.detached
          ? "Build exceeded the fixed time limit."
          : "Java runtime probe exceeded its time limit.", tails()));
      } else if (stopReason === "output") {
        rejectProcess(new BuildRunnerError(request.outputCode, request.detached
          ? "Build output exceeded the fixed byte limit."
          : "Java runtime probe output exceeded its byte limit.", tails()));
      } else {
        rejectProcess(new BuildRunnerError(request.spawnCode, request.detached
          ? "Build worker failed before it could be reaped."
          : "Java runtime probe failed before it could be reaped.", tails()));
      }
    };

    const rejectUnreaped = (): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      rejectProcess(new BuildRunnerError(request.detached ? "BUILD_FAILED" : "PACK_INTEGRITY_FAILED",
        request.detached
          ? "Build worker process group could not be reaped."
          : "Java runtime probe process could not be reaped.",
        tails()));
    };

    const sendSignal = (signal: NodeJS.Signals): void => {
      try {
        if (request.detached) {
          const pid = child.pid;
          if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) throw new Error("invalid pid");
          dependencies.processGroups.signal(pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        stopReason ??= "spawn";
      }
    };

    const beginStop = (reason: typeof stopReason): void => {
      if (stopReason !== undefined) return;
      stopReason = reason;
      sendSignal("SIGTERM");
      if (closed) return;
      timers.force = dependencies.clock.setTimeout(() => {
        if (closed) return;
        sendSignal("SIGKILL");
        timers.drain = dependencies.clock.setTimeout(() => {
          if (!closed) rejectUnreaped();
        }, request.detached ? BUILD_RUNNER_LIMITS.killDrainMilliseconds : 0);
      }, request.detached ? BUILD_RUNNER_LIMITS.termGraceMilliseconds : 0);
    };

    const onChunk = (target: Uint8Array[], value: unknown): void => {
      const inspected = inspectBytes(value);
      if (inspected === undefined) {
        beginStop("invalid-output");
        return;
      }
      const remaining = Math.max(0, request.maximumOutputBytes - totalOutput);
      if (remaining > 0) target.push(new Uint8Array(inspected.view.subarray(0, remaining)));
      totalOutput = Math.min(request.maximumOutputBytes + 1, totalOutput + inspected.byteLength);
      if (totalOutput > request.maximumOutputBytes) beginStop("output");
    };

    child.stdout?.on("data", (chunk) => onChunk(stdoutChunks, chunk));
    child.stderr?.on("data", (chunk) => onChunk(stderrChunks, chunk));
    child.once("error", () => beginStop("spawn"));
    child.once("close", (rawCode, rawSignal) => {
      closed = true;
      void (async (): Promise<void> => {
        if (settled) return;
        clearTimers();
        if (request.detached) {
          const pid = child.pid;
          if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) {
            settled = true;
            rejectProcess(new BuildRunnerError("BUILD_FAILED", "Build worker process group could not be reaped.", tails()));
            return;
          }
          const cleanup = await ensureNoResidualProcessGroup(pid, dependencies);
          if (cleanup === "unreaped") {
            settled = true;
            rejectProcess(new BuildRunnerError("BUILD_FAILED", "Build worker process group could not be reaped.", tails()));
            return;
          }
          if (cleanup === "reaped" && stopReason === undefined) {
            settled = true;
            rejectProcess(new BuildRunnerError(
              "BUILD_FAILED",
              "Build worker exited while its process group remained live.",
              tails(),
            ));
            return;
          }
        }
        if (stopReason !== undefined) {
          rejectStopped();
          return;
        }
        settled = true;
        resolveProcess(Object.freeze({
          code: normalizedExitCode(rawCode),
          signal: normalizedSignal(rawSignal),
          stdout: concatenate(stdoutChunks),
          stderr: concatenate(stderrChunks),
        }));
      })().catch(() => {
        if (!settled) {
          settled = true;
          rejectProcess(new BuildRunnerError("INTERNAL_ERROR", "Build worker lifecycle verification failed."));
        }
      });
    });
    timers.timeout = dependencies.clock.setTimeout(() => beginStop("timeout"), request.timeoutMilliseconds);
    if (closed || settled) dependencies.clock.clearTimeout(timers.timeout);
  });
}

interface TrustedRegularFile {
  readonly path: string;
  readonly identity: BigIntStats;
  readonly directory: CanonicalDirectory;
  readonly executable: boolean;
}

interface TrustedJavaTree {
  readonly directory: CanonicalDirectory;
  readonly fingerprint: Sha256;
}

interface TrustedJavaRuntime {
  readonly home: CanonicalDirectory;
  readonly criticalTrees: readonly TrustedJavaTree[];
  readonly executable: TrustedRegularFile;
  readonly releaseFile: TrustedRegularFile;
}

async function captureTrustedRegularFile(
  path: string,
  directory: CanonicalDirectory,
  executable: boolean,
  dependencies: RunnerDependencies,
): Promise<TrustedRegularFile> {
  let handle: FileHandle | undefined;
  let primary: unknown;
  let identity: BigIntStats | undefined;
  try {
    const pathBefore = await dependencies.fileSystem.lstat(path);
    const real = await dependencies.fileSystem.realpath(path);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n ||
      pathBefore.dev !== directory.identity.dev ||
      !hasTrustedOwner(pathBefore, directory.effectiveUserId, "root-or-effective") ||
      !hasTrustedPermissions(pathBefore) || (pathBefore.mode & 0o7000n) !== 0n ||
      (executable && Number(pathBefore.mode & 0o111n) === 0) || !samePath(path, real)) {
      return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime contains an unsafe critical file.");
    }
    handle = await dependencies.fileSystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    const pathAfter = await dependencies.fileSystem.lstat(path);
    if (!sameStableFile(pathBefore, opened) || !sameStableFile(opened, pathAfter)) {
      return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime critical file identity is unstable.");
    }
    identity = pathAfter;
  } catch (error) {
    primary = error;
  }
  let closeFailed = false;
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch {
      closeFailed = true;
    }
  }
  if (primary instanceof BuildRunnerError) throw primary;
  if (primary !== undefined || closeFailed || identity === undefined) {
    return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime critical file could not be verified safely.");
  }
  return Object.freeze({ path, identity, directory, executable });
}

async function assertTrustedRegularFileIdentity(
  file: TrustedRegularFile,
  dependencies: RunnerDependencies,
): Promise<void> {
  const current = await captureTrustedRegularFile(file.path, file.directory, file.executable, dependencies);
  if (!sameStableFile(file.identity, current.identity)) {
    return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime critical file changed during the build.");
  }
}

async function captureJavaRuntimeTree(
  directory: CanonicalDirectory,
  dependencies: RunnerDependencies,
): Promise<TrustedJavaRuntime> {
  const rootNames = await listDirectoryBounded(
    directory.path,
    MAX_SCAN_ENTRIES,
    "PACK_INTEGRITY_FAILED",
    "Configured Java runtime root exceeds its safety limit or could not be listed safely.",
    dependencies,
  );
  const foldedRootNames = new Set<string>();
  for (const name of rootNames) {
    const folded = name.toLocaleLowerCase("en-US");
    if (foldedRootNames.has(folded)) {
      return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime root contains case-colliding entries.");
    }
    foldedRootNames.add(folded);
  }
  const criticalTrees: TrustedJavaTree[] = [];
  for (const name of ["bin", "lib", "conf"] as const) {
    const criticalDirectory = await canonicalDirectory(
      join(directory.path, name),
      "PACK_INTEGRITY_FAILED",
      directory.effectiveUserId,
      "root-or-effective",
      dependencies,
      directory.identity.dev,
    );
    criticalTrees.push(Object.freeze({
      directory: criticalDirectory,
      fingerprint: await assertTrustedTree(criticalDirectory, "PACK_INTEGRITY_FAILED", dependencies),
    }));
  }
  const bin = criticalTrees[0]?.directory;
  if (bin === undefined) return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime bin directory is missing.");
  const executable = await captureTrustedRegularFile(join(bin.path, "java"), bin, true, dependencies);
  const releaseFile = await captureTrustedRegularFile(join(directory.path, "release"), directory, false, dependencies);
  return Object.freeze({
    home: directory,
    criticalTrees: Object.freeze(criticalTrees),
    executable,
    releaseFile,
  });
}

async function assertJavaRuntimeIdentity(
  runtime: TrustedJavaRuntime,
  dependencies: RunnerDependencies,
): Promise<void> {
  await assertDirectoryIdentity(runtime.home, "PACK_INTEGRITY_FAILED", dependencies);
  for (const tree of runtime.criticalTrees) {
    await assertDirectoryIdentity(tree.directory, "PACK_INTEGRITY_FAILED", dependencies);
    if (await assertTrustedTree(tree.directory, "PACK_INTEGRITY_FAILED", dependencies) !== tree.fingerprint) {
      return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime critical tree changed during the build.");
    }
  }
  await assertTrustedRegularFileIdentity(runtime.releaseFile, dependencies);
  await assertTrustedRegularFileIdentity(runtime.executable, dependencies);
}

async function verifyJavaHome(
  directory: CanonicalDirectory,
  expectedRuntime: string,
  dependencies: RunnerDependencies,
): Promise<TrustedJavaRuntime> {
  const runtime = await captureJavaRuntimeTree(directory, dependencies);
  const executable = runtime.executable.path;
  const result = await executeProcess({
    command: executable,
    args: Object.freeze(["-XshowSettings:properties", "-version"]),
    options: Object.freeze({
      cwd: directory.path,
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: Object.freeze(["ignore", "pipe", "pipe"] as const),
      env: Object.freeze({ LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" }),
    }),
    timeoutMilliseconds: BUILD_RUNNER_LIMITS.probeTimeoutMilliseconds,
    maximumOutputBytes: PROBE_OUTPUT_BYTES,
    detached: false,
    timeoutCode: "PACK_INTEGRITY_FAILED",
    outputCode: "PACK_INTEGRITY_FAILED",
    spawnCode: "PACK_INTEGRITY_FAILED",
    secrets: [directory.path],
  }, dependencies);
  if (result.code !== 0 || result.signal !== null) {
    return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime probe failed.");
  }
  const output = `${Buffer.from(result.stdout).toString("utf8")}\n${Buffer.from(result.stderr).toString("utf8")}`;
  const javaHome = /^\s*java\.home\s*=\s*(.*?)\s*$/mu.exec(output)?.[1];
  const runtimeVersion = /^\s*java\.runtime\.version\s*=\s*(.*?)\s*$/mu.exec(output)?.[1];
  if (javaHome === undefined || runtimeVersion !== expectedRuntime || !samePath(resolve(javaHome), directory.path)) {
    return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime identity does not match the fixed build policy.");
  }
  await assertJavaRuntimeIdentity(runtime, dependencies);
  return runtime;
}

function copyRandomNonce(dependencies: RunnerDependencies): string {
  let candidate: Uint8Array;
  try {
    const raw = dependencies.randomBytes(16);
    const inspected = inspectBytes(raw);
    if (inspected === undefined || inspected.byteLength !== 16) throw new Error("invalid random bytes");
    candidate = new Uint8Array(inspected.view);
  } catch {
    return failure("INTERNAL_ERROR", "Build nonce generation failed.");
  }
  if (candidate.byteLength !== 16) return failure("INTERNAL_ERROR", "Build nonce generation failed.");
  return Buffer.from(candidate).toString("hex");
}

function fixedBuildArguments(
  workspaceRoot: string,
  toolHome: string,
  temporaryDirectory: string,
  projectCacheDirectory: string,
  policy: FixedRunnerPolicy,
): readonly string[] {
  const wrapper = join(workspaceRoot, "gradle", "wrapper", "gradle-wrapper.jar");
  const wrapperLaunch = policy.wrapperLaunch === "jar"
    ? ["-jar", wrapper]
    : ["-classpath", wrapper, "org.gradle.wrapper.GradleWrapperMain"];
  return Object.freeze([
    "-Xms64m",
    "-Xmx64m",
    "-Dfile.encoding=UTF-8",
    "-Duser.language=en",
    "-Duser.country=US",
    "-Duser.timezone=UTC",
    `-Duser.home=${toolHome}`,
    `-Djava.io.tmpdir=${temporaryDirectory}`,
    "-Dorg.gradle.appname=gradlew",
    ...wrapperLaunch,
    "--no-daemon",
    "--console=plain",
    "--no-configuration-cache",
    "--no-watch-fs",
    "--max-workers=2",
    "--project-cache-dir",
    projectCacheDirectory,
    "--dependency-verification",
    "strict",
    "clean",
    "build",
    ...policy.excludedGradleTasks.flatMap((task) => ["-x", task]),
  ]);
}

interface JarSnapshot {
  readonly entry: BuildOutputEntry;
  readonly bytes: Uint8Array;
}

async function discardDerivedDevJar(
  root: string,
  release: BuildOutputEntry,
  workspaceDevice: bigint,
  effectiveUserId: bigint,
  dependencies: RunnerDependencies,
): Promise<void> {
  const releaseName = basename(release.path);
  if (!releaseName.endsWith(".jar")) {
    return failure("ARTIFACT_INTEGRITY_FAILED", "Release JAR name is invalid.");
  }
  const expectedName = `${releaseName.slice(0, -4)}-dev.jar`;
  const relativeDirectory = "build/devlibs";
  const directory = join(root, "build", "devlibs");
  try {
    const before = await dependencies.fileSystem.lstat(directory);
    const real = await dependencies.fileSystem.realpath(directory);
    if (!isTrustedDirectoryMetadata(before, effectiveUserId, "effective-user", workspaceDevice) ||
      !samePath(directory, real)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Derived Fabric JAR directory is unsafe.");
    }
    const names = await listDirectoryBounded(
      directory,
      2,
      "ARTIFACT_INTEGRITY_FAILED",
      "Derived Fabric JAR directory does not match the fixed policy.",
      dependencies,
    );
    if (names.length !== 1 || names[0] !== expectedName) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Derived Fabric JAR does not match the release artifact.");
    }
    const relativePath = `${relativeDirectory}/${expectedName}`;
    const absolutePath = await assertCanonicalContainedFilePath(
      root,
      relativePath,
      effectiveUserId,
      workspaceDevice,
      "ARTIFACT_INTEGRITY_FAILED",
      dependencies,
    );
    const stats = await dependencies.fileSystem.lstat(absolutePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n ||
      stats.uid !== effectiveUserId || stats.dev !== workspaceDevice || !hasTrustedPermissions(stats)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Derived Fabric JAR metadata is unsafe.");
    }
    await dependencies.fileSystem.unlink(absolutePath);
    if ((await listDirectoryBounded(
      directory,
      1,
      "ARTIFACT_INTEGRITY_FAILED",
      "Derived Fabric JAR directory could not be verified after cleanup.",
      dependencies,
    )).length !== 0) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Derived Fabric JAR cleanup was incomplete.");
    }
    const after = await dependencies.fileSystem.lstat(directory);
    const realAfter = await dependencies.fileSystem.realpath(directory);
    if (!sameIdentity(before, after) || !samePath(directory, realAfter) ||
      !isTrustedDirectoryMetadata(after, effectiveUserId, "effective-user", workspaceDevice)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Derived Fabric JAR directory changed during cleanup.");
    }
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure("ARTIFACT_INTEGRITY_FAILED", "Derived Fabric JAR could not be cleaned safely.");
  }
}

async function discardFabricProjectCache(
  root: string,
  workspaceDevice: bigint,
  effectiveUserId: bigint,
  dependencies: RunnerDependencies,
): Promise<void> {
  const cacheRoot = join(root, ".gradle");
  const pending = [cacheRoot];
  const directories: string[] = [];
  const files: string[] = [];
  let entriesSeen = 0;
  try {
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) break;
      const before = await dependencies.fileSystem.lstat(directory);
      const real = await dependencies.fileSystem.realpath(directory);
      if (!isTrustedDirectoryMetadata(before, effectiveUserId, "effective-user", workspaceDevice) ||
        !samePath(directory, real)) {
        return failure("WORKSPACE_INVALID", "Fabric project cache contains an unsafe directory.");
      }
      directories.push(directory);
      const names = await listDirectoryBounded(
        directory,
        MAX_SCAN_ENTRIES - entriesSeen,
        "WORKSPACE_INVALID",
        "Fabric project cache exceeds its cleanup safety limit.",
        dependencies,
      );
      entriesSeen += names.length;
      const foldedNames = new Set<string>();
      for (const name of names) {
        const folded = name.toLocaleLowerCase("en-US");
        if (foldedNames.has(folded)) {
          return failure("WORKSPACE_INVALID", "Fabric project cache contains case-colliding entries.");
        }
        foldedNames.add(folded);
        if (name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
          return failure("WORKSPACE_INVALID", "Fabric project cache contains an unsafe entry name.");
        }
        const path = join(directory, name);
        const stats = await dependencies.fileSystem.lstat(path);
        if (stats.isSymbolicLink() || stats.dev !== workspaceDevice || stats.uid !== effectiveUserId ||
          !hasTrustedPermissions(stats)) {
          return failure("WORKSPACE_INVALID", "Fabric project cache contains an unsafe entry.");
        }
        if (stats.isDirectory()) pending.push(path);
        else if (stats.isFile() && stats.nlink === 1n) files.push(path);
        else return failure("WORKSPACE_INVALID", "Fabric project cache contains an unsupported entry.");
      }
      const after = await dependencies.fileSystem.lstat(directory);
      const realAfter = await dependencies.fileSystem.realpath(directory);
      if (!sameStableFile(before, after) || !samePath(directory, realAfter)) {
        return failure("WORKSPACE_INVALID", "Fabric project cache changed during cleanup verification.");
      }
    }
    for (const file of files) await dependencies.fileSystem.unlink(file);
    for (const directory of directories.reverse()) await dependencies.fileSystem.removeDirectory(directory);
    if (await maybeLstat(cacheRoot, dependencies) !== undefined) {
      return failure("WORKSPACE_INVALID", "Fabric project cache cleanup was incomplete.");
    }
  } catch (error) {
    if (error instanceof BuildRunnerError) throw error;
    return failure("WORKSPACE_INVALID", "Fabric project cache could not be cleaned safely.");
  }
}

async function snapshotJar(
  root: string,
  workspaceDevice: bigint,
  effectiveUserId: bigint,
  dependencies: RunnerDependencies,
): Promise<JarSnapshot> {
  const build = join(root, "build");
  const libs = join(root, "build", "libs");
  let handle: FileHandle | undefined;
  let primary: unknown;
  let result: JarSnapshot | undefined;
  try {
    const buildBefore = await dependencies.fileSystem.lstat(build);
    const realBuild = await dependencies.fileSystem.realpath(build);
    const directoryBefore = await dependencies.fileSystem.lstat(libs);
    const realDirectory = await dependencies.fileSystem.realpath(libs);
    if (!isTrustedDirectoryMetadata(buildBefore, effectiveUserId, "effective-user", workspaceDevice) ||
      !samePath(build, realBuild) ||
      !isTrustedDirectoryMetadata(directoryBefore, effectiveUserId, "effective-user", workspaceDevice) ||
      !samePath(libs, realDirectory)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build output directory is missing or unsafe.");
    }
    const names = await listDirectoryBounded(
      libs,
      2,
      "ARTIFACT_INTEGRITY_FAILED",
      "Build output directory could not be listed within its safety bound.",
      dependencies,
    );
    const jars = names.filter((name) => name.endsWith(".jar"));
    if (names.length !== 1 || jars.length !== 1) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build must produce exactly one JAR artifact.");
    }
    const name = jars[0];
    if (name === undefined) return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR artifact is missing.");
    const relativePath = `build/libs/${name}`;
    if (!isPortableRelativePath(relativePath)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR path is not portable.");
    }
    const absolutePath = await assertCanonicalContainedFilePath(
      root,
      relativePath,
      effectiveUserId,
      workspaceDevice,
      "ARTIFACT_INTEGRITY_FAILED",
      dependencies,
    );
    const pathBefore = await dependencies.fileSystem.lstat(absolutePath);
    const initialMode = Number(pathBefore.mode & 0o7777n);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n || pathBefore.size < 1n ||
      pathBefore.size > BigInt(BUILD_RUNNER_LIMITS.jarBytes) || pathBefore.dev !== workspaceDevice ||
      pathBefore.uid !== effectiveUserId || ![0o600, 0o640, 0o644].includes(initialMode)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR metadata failed integrity verification.");
    }
    handle = await dependencies.fileSystem.open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== effectiveUserId ||
      !sameStableFile(pathBefore, before)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR identity failed integrity verification.");
    }
    await handle.chmod(0o644);
    const normalized = await handle.stat({ bigint: true });
    const normalizedPath = await dependencies.fileSystem.lstat(absolutePath);
    if (!sameIdentity(before, normalized) || before.size !== normalized.size || normalized.nlink !== 1n ||
      normalized.uid !== effectiveUserId || normalized.dev !== workspaceDevice ||
      Number(normalized.mode & 0o7777n) !== 0o644 || !sameStableFile(normalized, normalizedPath)) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR permissions could not be safely normalized.");
    }
    const bytes = await readHandleBounded(
      handle,
      BUILD_RUNNER_LIMITS.jarBytes,
      dependencies,
      "jar-file-chunk",
      relativePath,
    );
    await dependencies.checkpoint?.("jar-file-before-post-stat", relativePath);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await dependencies.fileSystem.lstat(absolutePath);
    const realFileAfter = await dependencies.fileSystem.realpath(absolutePath);
    const buildAfter = await dependencies.fileSystem.lstat(build);
    const realBuildAfter = await dependencies.fileSystem.realpath(build);
    const directoryAfter = await dependencies.fileSystem.lstat(libs);
    const realDirectoryAfter = await dependencies.fileSystem.realpath(libs);
    const namesAfter = await listDirectoryBounded(
      libs,
      2,
      "ARTIFACT_INTEGRITY_FAILED",
      "Build output directory could not be re-listed within its safety bound.",
      dependencies,
    );
    if (!sameStableFile(normalized, after) || !sameStableFile(after, pathAfter) ||
      !samePath(absolutePath, realFileAfter) || bytes.byteLength !== Number(after.size) ||
      !sameIdentity(buildBefore, buildAfter) ||
      !isTrustedDirectoryMetadata(buildAfter, effectiveUserId, "effective-user", workspaceDevice) ||
      !samePath(build, realBuildAfter) || !sameStableFile(directoryBefore, directoryAfter) ||
      !samePath(libs, realDirectoryAfter) || namesAfter.length !== 1 || namesAfter[0] !== name) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR changed while being read.");
    }
    result = Object.freeze({
      entry: Object.freeze({
        path: relativePath as PortableRelativePath,
        mode: 420 as const,
        size: bytes.byteLength,
        sha256: sha256(bytes),
        kind: "build-output" as const,
        provenance: "build" as const,
      }),
      bytes,
    });
  } catch (error) {
    primary = error;
  }
  let closeFailed = false;
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch {
      closeFailed = true;
    }
  }
  if (primary instanceof BuildRunnerError) throw primary;
  if (primary !== undefined || closeFailed || result === undefined) {
    return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR could not be safely snapshotted.");
  }
  return result;
}

function immutableResult(snapshot: JarSnapshot): BuildRunnerResult {
  const stored = new Uint8Array(snapshot.bytes);
  const entries = Object.freeze([snapshot.entry]);
  const outputs: BuildRunnerOutputs = Object.freeze({
    entries,
    readFile: (path: unknown): Uint8Array => {
      if (typeof path !== "string" || path !== snapshot.entry.path) {
        return failure("ARTIFACT_INTEGRITY_FAILED", "Build output is unavailable.");
      }
      return new Uint8Array(stored);
    },
  });
  return Object.freeze({ nodeId: "gradle-clean-build" as const, outputs });
}

async function loadTrustedPack(policy: FixedRunnerPolicy): Promise<VerifiedCompatibilityPack> {
  try {
    return await loadBuiltinCompatibilityPack(policy.selector);
  } catch (error) {
    if (error instanceof BuiltinPackIntegrityError) {
      return failure("PACK_INTEGRITY_FAILED", "Trusted compatibility pack failed integrity verification.");
    }
    return failure("PACK_INTEGRITY_FAILED", "Trusted compatibility pack could not be loaded safely.");
  }
}

async function runBuild(
  config: NormalizedBuildRunnerConfig,
  input: NormalizedRunInput,
  dependencies: RunnerDependencies,
  priorBuild: PriorBuildProvenance | undefined,
  policy: FixedRunnerPolicy,
): Promise<{ readonly result: BuildRunnerResult; readonly workspaceRoot: string; readonly provenance: PriorBuildProvenance }> {
  if (dependencies.platform() !== "linux" || dependencies.architecture() !== "x64") {
    return failure("INTERNAL_ERROR", "Phase 1 build runner supports Linux x64 only.");
  }
  let effectiveUserId: bigint;
  try {
    const rawEffectiveUserId = dependencies.effectiveUserId();
    if (!Number.isSafeInteger(rawEffectiveUserId) || rawEffectiveUserId < 0) throw new Error("invalid euid");
    effectiveUserId = BigInt(rawEffectiveUserId);
  } catch {
    return failure("INTERNAL_ERROR", "Effective build-runner identity is unavailable.");
  }
  assertFixedPlan(input.plan, input.manifest, policy);
  const initialMounts = await loadMountTable(dependencies);
  const [workspace, artifactCache, ...javaDirectories] = await Promise.all([
    canonicalDirectory(input.workspaceRoot, "WORKSPACE_INVALID", effectiveUserId, "effective-user", dependencies),
    canonicalDirectory(config.artifactCacheRoot, "PACK_INTEGRITY_FAILED", effectiveUserId, "effective-user", dependencies),
    ...policy.java.map(({ configKey }) => {
      const path = config.javaHomes.get(configKey);
      if (path === undefined) return failure("INTERNAL_ERROR", "Configured Java runtime is unavailable.");
      return canonicalDirectory(path, "PACK_INTEGRITY_FAILED", effectiveUserId, "root-or-effective", dependencies);
    }),
  ]);
  const verifiedPriorBuild = priorBuild !== undefined &&
    priorBuild.workspaceDevice === workspace.identity.dev && priorBuild.workspaceInode === workspace.identity.ino
    ? priorBuild
    : undefined;
  if (javaDirectories.some((directory, index) =>
    javaDirectories.slice(index + 1).some((other) => samePath(directory.path, other.path)))) {
    return failure("PACK_INTEGRITY_FAILED", "Configured Java runtime homes must be distinct.");
  }
  const mountTrustRoots = Object.freeze([
    Object.freeze({ root: workspace.path, code: "WORKSPACE_INVALID" as const }),
    Object.freeze({ root: artifactCache.path, code: "PACK_INTEGRITY_FAILED" as const }),
    ...javaDirectories.map((directory) =>
      Object.freeze({ root: directory.path, code: "PACK_INTEGRITY_FAILED" as const })),
  ]);
  const mountTrust = verifyMountTrust(mountTrustRoots, initialMounts);
  const pack = await loadTrustedPack(policy);
  if (!samePack(input.plan.pack, pack.ref)) {
    return failure("PACK_INTEGRITY_FAILED", "Loaded compatibility pack identity does not match the build plan.");
  }
  const javaRuntimes = await Promise.all(policy.java.map(async (javaPolicy, index) => {
    const directory = javaDirectories[index];
    if (directory === undefined) return failure("INTERNAL_ERROR", "Configured Java runtime is unavailable.");
    return Object.freeze({
      configKey: javaPolicy.configKey,
      environmentKey: javaPolicy.environmentKey,
      directory,
      runtime: await verifyJavaHome(directory, javaPolicy.expectedRuntime, dependencies),
    });
  }));
  const buildJava = javaRuntimes.find(({ configKey }) => configKey === policy.buildJavaKey);
  if (buildJava === undefined) return failure("INTERNAL_ERROR", "Build Java runtime is unavailable.");

  const lock = await acquireWorkspaceLock(workspace.path, dependencies);
  let primaryError: unknown;
  let result: BuildRunnerResult | undefined;
  let completedProvenance: PriorBuildProvenance | undefined;
  try {
    await assertDirectoryIdentity(workspace, "WORKSPACE_INVALID", dependencies);
    await assertDirectoryIdentity(artifactCache, "PACK_INTEGRITY_FAILED", dependencies);
    const beforeFiles = await verifyManagedFiles(
      workspace.path,
      input.manifest,
      effectiveUserId,
      workspace.identity.dev,
      dependencies,
    );
    assertPackBuildInputs(policy, pack, beforeFiles);
    await assertNoUnmanagedExecutionSurfaces(
      workspace.path,
      input.manifest,
      verifiedPriorBuild,
      effectiveUserId,
      workspace.identity.dev,
      dependencies,
    );
    const directories = await prepareBuildDirectories(
      workspace,
      artifactCache,
      pack.ref.treeSha256,
      dependencies,
    );
    await assertTrustedTree(directories.buildState, "WORKSPACE_INVALID", dependencies);
    await assertTrustedTree(directories.packCache, "PACK_INTEGRITY_FAILED", dependencies);
    await assertNoGradleUserHomeInjection(directories.gradleUserHome, dependencies);
    await dependencies.checkpoint?.("before-build-spawn");
    verifyMountTrust(mountTrustRoots, await loadMountTable(dependencies), mountTrust);
    await Promise.all(javaRuntimes.map(({ runtime }) => assertJavaRuntimeIdentity(runtime, dependencies)));
    await assertDirectoryIdentity(workspace, "WORKSPACE_INVALID", dependencies);
    await assertDirectoryIdentity(artifactCache, "PACK_INTEGRITY_FAILED", dependencies);
    for (const directory of directories.trustedDirectories) {
      await assertDirectoryIdentity(
        directory,
        directory.path.startsWith(`${workspace.path}${sep}`) ? "WORKSPACE_INVALID" : "PACK_INTEGRITY_FAILED",
        dependencies,
      );
    }
    await assertTrustedTree(directories.buildState, "WORKSPACE_INVALID", dependencies);
    await assertTrustedTree(directories.packCache, "PACK_INTEGRITY_FAILED", dependencies);
    const nonce = copyRandomNonce(dependencies);
    const javaEnvironment = Object.fromEntries(javaRuntimes.map(({ environmentKey, directory }) =>
      [environmentKey, directory.path]));
    const env = Object.freeze({
      HOME: directories.toolHome,
      JAVA_HOME: buildJava.directory.path,
      ...javaEnvironment,
      GRADLE_USER_HOME: directories.gradleUserHome,
      TMPDIR: directories.temporaryDirectory,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      SOURCE_DATE_EPOCH: "0",
      MCDEV_BUILD_NONCE: nonce,
    });
    const command = buildJava.runtime.executable.path;
    const args = fixedBuildArguments(
      workspace.path,
      directories.toolHome,
      directories.temporaryDirectory,
      directories.projectCacheDirectory,
      policy,
    );
    const processResult = await executeProcess({
      command,
      args,
      options: Object.freeze({
        cwd: workspace.path,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: Object.freeze(["ignore", "pipe", "pipe"] as const),
        env,
      }),
      timeoutMilliseconds: BUILD_RUNNER_LIMITS.buildTimeoutMilliseconds,
      maximumOutputBytes: BUILD_RUNNER_LIMITS.rawOutputBytes,
      detached: true,
      timeoutCode: "BUILD_TIMEOUT",
      outputCode: "BUILD_OUTPUT_LIMIT",
      spawnCode: "BUILD_FAILED",
      secrets: [workspace.path, ...javaDirectories.map(({ path }) => path), artifactCache.path, nonce],
    }, dependencies);
    if (processResult.code !== 0 || processResult.signal !== null) {
      return failure("BUILD_FAILED", "Gradle clean build failed.", redactedTails(
        [processResult.stdout],
        [processResult.stderr],
        [workspace.path, ...javaDirectories.map(({ path }) => path), artifactCache.path, nonce],
      ));
    }
    await dependencies.checkpoint?.("workspace-before-post-verify");
    verifyMountTrust(mountTrustRoots, await loadMountTable(dependencies), mountTrust);
    await assertDirectoryIdentity(workspace, "WORKSPACE_INVALID", dependencies);
    await Promise.all(javaRuntimes.map(({ runtime }) => assertJavaRuntimeIdentity(runtime, dependencies)));
    await assertDirectoryIdentity(artifactCache, "PACK_INTEGRITY_FAILED", dependencies);
    for (const directory of directories.trustedDirectories) {
      await assertDirectoryIdentity(
        directory,
        directory.path.startsWith(`${workspace.path}${sep}`) ? "WORKSPACE_INVALID" : "PACK_INTEGRITY_FAILED",
        dependencies,
      );
    }
    await verifyManagedFiles(
      workspace.path,
      input.manifest,
      effectiveUserId,
      workspace.identity.dev,
      dependencies,
    );
    const firstSnapshot = await snapshotJar(workspace.path, workspace.identity.dev, effectiveUserId, dependencies);
    const firstEntry = firstSnapshot.entry;
    if (policy.discardDerivedDevJar) {
      await discardDerivedDevJar(
        workspace.path,
        firstEntry,
        workspace.identity.dev,
        effectiveUserId,
        dependencies,
      );
      await discardFabricProjectCache(
        workspace.path,
        workspace.identity.dev,
        effectiveUserId,
        dependencies,
      );
    }
    const currentProvenance = Object.freeze({
      planId: input.plan.planId,
      packTreeSha256: input.plan.pack.treeSha256,
      workspaceDevice: workspace.identity.dev,
      workspaceInode: workspace.identity.ino,
      entry: firstEntry,
    });
    await assertNoUnmanagedExecutionSurfaces(
      workspace.path,
      input.manifest,
      currentProvenance,
      effectiveUserId,
      workspace.identity.dev,
      dependencies,
    );
    await assertTrustedTree(directories.buildState, "WORKSPACE_INVALID", dependencies);
    await assertTrustedTree(directories.packCache, "PACK_INTEGRITY_FAILED", dependencies);
    await assertNoGradleUserHomeInjection(directories.gradleUserHome, dependencies);
    const secondSnapshot = await snapshotJar(workspace.path, workspace.identity.dev, effectiveUserId, dependencies);
    if (!bytesEqual(firstSnapshot.bytes, secondSnapshot.bytes) ||
      firstSnapshot.entry.path !== secondSnapshot.entry.path ||
      firstSnapshot.entry.mode !== secondSnapshot.entry.mode ||
      firstSnapshot.entry.size !== secondSnapshot.entry.size ||
      firstSnapshot.entry.sha256 !== secondSnapshot.entry.sha256) {
      return failure("ARTIFACT_INTEGRITY_FAILED", "Build JAR changed across final workspace verification.");
    }
    completedProvenance = currentProvenance;
    result = immutableResult(secondSnapshot);
  } catch (error) {
    primaryError = error;
  }
  let releaseError: unknown;
  try {
    await releaseWorkspaceLock(lock, dependencies);
  } catch (error) {
    releaseError = error;
  }
  if (releaseError !== undefined) {
    if (releaseError instanceof BuildRunnerError) throw releaseError;
    return failure("INTERNAL_ERROR", "Workspace lock could not be safely released.");
  }
  if (primaryError instanceof BuildRunnerError) throw primaryError;
  if (primaryError !== undefined || result === undefined) {
    return failure("INTERNAL_ERROR", "Build runner failed at an internal safety boundary.");
  }
  if (completedProvenance === undefined) return failure("INTERNAL_ERROR", "Build output provenance could not be recorded.");
  return Object.freeze({
    result,
    workspaceRoot: workspace.path,
    provenance: completedProvenance,
  });
}

function createFixedPhase1BuildRunnerWithDependencies(
  configValue: unknown,
  dependencies: RunnerDependencies,
  policy: FixedRunnerPolicy,
): NeoForgePhase1BuildRunner | FabricPhase1BuildRunner {
  const config = normalizeConfig(configValue, policy);
  // Retry provenance is deliberately process-local. A restarted runner cannot prove ownership of an existing
  // build tree and therefore fails closed until a future CLI-level recovery policy supplies durable provenance.
  const priorBuilds = new Map<string, PriorBuildProvenance>();
  return Object.freeze({
    run: async (inputValue: BuildRunnerRunInput): Promise<BuildRunnerResult> => {
      const input = normalizeRunInput(inputValue);
      const key = resolve(input.workspaceRoot);
      const candidate = priorBuilds.get(key);
      const priorBuild = candidate !== undefined && candidate.planId === input.plan.planId &&
        candidate.packTreeSha256 === input.plan.pack.treeSha256
        ? candidate
        : undefined;
      const completed = await runBuild(config, input, dependencies, priorBuild, policy);
      priorBuilds.set(completed.workspaceRoot, completed.provenance);
      return completed.result;
    },
  });
}

export function createNeoForgePhase1BuildRunnerWithDependencies(
  configValue: unknown,
  dependencies: RunnerDependencies,
): NeoForgePhase1BuildRunner {
  return createFixedPhase1BuildRunnerWithDependencies(
    configValue,
    dependencies,
    NEOFORGE_PHASE1_POLICY,
  );
}

export function createFabricPhase1BuildRunnerWithDependencies(
  configValue: unknown,
  dependencies: RunnerDependencies,
): FabricPhase1BuildRunner {
  return createFixedPhase1BuildRunnerWithDependencies(
    configValue,
    dependencies,
    FABRIC_1_20_1_PHASE1_POLICY,
  );
}
