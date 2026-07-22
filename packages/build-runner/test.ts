import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmod,
  chown,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { BUILTIN_FABRIC_1_20_1, BUILTIN_NEOFORGE_26_1_2 } from "@mcdev/compatibility-packs";
import {
  isBuildPlan,
  isWorkspaceManifest,
  type BuildPlan,
  type WorkspaceManifest,
  type WorkspaceOwnedFile,
} from "@mcdev/contracts";
import {
  BUILD_RUNNER_LIMITS,
  BuildRunnerError,
  createFabricPhase1BuildRunner,
  createNeoForgePhase1BuildRunner,
} from "./index.ts";
import {
  DEFAULT_RUNNER_DEPENDENCIES,
  createFabricPhase1BuildRunnerWithDependencies,
  createNeoForgePhase1BuildRunnerWithDependencies,
  type ProcessGroups,
  type RunnerClock,
  type RunnerDependencies,
  type RunnerSpawn,
  type RunnerSpawnOptions,
  type SpawnedProcess,
} from "./internal.ts";

assert.equal(BUILD_RUNNER_LIMITS.rawOutputBytes, 8 * 1024 * 1024);
assert.equal(BUILD_RUNNER_LIMITS.redactedTailBytes, 64 * 1024);
assert.equal(BUILD_RUNNER_LIMITS.buildTimeoutMilliseconds, 20 * 60 * 1_000);
assert.equal(typeof createNeoForgePhase1BuildRunner, "function");
assert.equal(typeof createFabricPhase1BuildRunner, "function");
assert.equal(new BuildRunnerError("BUILD_FAILED", "Build failed.").code, "BUILD_FAILED");

const runtimePackRoot = fileURLToPath(new URL("../../packs/neoforge-26.1.2/runtime/", import.meta.url));
const fabricRuntimePackRoot = fileURLToPath(new URL("../../packs/fabric-1.20.1/runtime/", import.meta.url));
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

interface TestFixture {
  readonly root: string;
  readonly workspace: string;
  readonly java17: string;
  readonly java21: string;
  readonly java25: string;
  readonly artifactCache: string;
  readonly config: {
    readonly java21Home: string;
    readonly java25Home: string;
    readonly artifactCacheRoot: string;
  };
  readonly fabricConfig: {
    readonly java17Home: string;
    readonly artifactCacheRoot: string;
  };
  readonly plan: BuildPlan;
  readonly manifest: WorkspaceManifest;
  cleanup(): Promise<void>;
}

function render(source: Uint8Array, replacements: Readonly<Record<string, string>>): Uint8Array {
  let text = Buffer.from(source).toString("utf8");
  for (const [token, value] of Object.entries(replacements)) text = text.split(token).join(value);
  return new Uint8Array(Buffer.from(text, "utf8"));
}

async function makeFixture(loader: "fabric" | "neoforge" = "neoforge"): Promise<TestFixture> {
  const root = await mkdtemp(join(tmpdir(), "mcdev-runner-test-"));
  const workspace = join(root, "workspace");
  const java17 = join(root, "jdk-17");
  const java21 = join(root, "jdk-21");
  const java25 = join(root, "jdk-25");
  const artifactCache = join(root, "artifact-cache");
  await Promise.all([
    mkdir(join(workspace, ".mcdev"), { recursive: true, mode: 0o700 }),
    mkdir(join(java17, "bin"), { recursive: true, mode: 0o755 }),
    mkdir(join(java17, "lib"), { recursive: true, mode: 0o755 }),
    mkdir(join(java17, "conf"), { recursive: true, mode: 0o755 }),
    mkdir(join(java21, "bin"), { recursive: true, mode: 0o755 }),
    mkdir(join(java21, "lib"), { recursive: true, mode: 0o755 }),
    mkdir(join(java21, "conf"), { recursive: true, mode: 0o755 }),
    mkdir(join(java25, "bin"), { recursive: true, mode: 0o755 }),
    mkdir(join(java25, "lib"), { recursive: true, mode: 0o755 }),
    mkdir(join(java25, "conf"), { recursive: true, mode: 0o755 }),
    mkdir(artifactCache, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([
    writeFile(join(java17, "bin", "java"), "fake java 17\n", { mode: 0o755 }),
    writeFile(join(java17, "release"), "JAVA_VERSION=\"17.0.19\"\n", { mode: 0o644 }),
    writeFile(join(java21, "bin", "java"), "fake java 21\n", { mode: 0o755 }),
    writeFile(join(java21, "release"), "JAVA_VERSION=\"21.0.11\"\n", { mode: 0o644 }),
    writeFile(join(java25, "bin", "java"), "fake java 25\n", { mode: 0o755 }),
    writeFile(join(java25, "release"), "JAVA_VERSION=\"25.0.3\"\n", { mode: 0o644 }),
  ]);
  await Promise.all([
    chmod(join(java17, "bin", "java"), 0o755),
    chmod(join(java21, "bin", "java"), 0o755),
    chmod(join(java25, "bin", "java"), 0o755),
  ]);

  const selectedPackRoot = loader === "fabric" ? fabricRuntimePackRoot : runtimePackRoot;
  const packFile = (path: string): Promise<Uint8Array> => readFile(join(selectedPackRoot, ...path.split("/")));
  const replacements = {
    "@@MCDEV_CLIENT_CLASS@@": "dev.mcdev.generated.m_runnerfixture.client.GeneratedClient",
    "@@MCDEV_MAIN_CLASS@@": "dev.mcdev.generated.m_runnerfixture.GeneratedMod",
    "@@MCDEV_MOD_ID@@": "runnerfixture",
    "@@MCDEV_PROJECT_AUTHOR@@": "Minecraft AI Mod Studio",
    "@@MCDEV_PROJECT_LICENSE@@": "MIT",
    "@@MCDEV_PROJECT_NAME@@": "Runner Fixture",
    "@@MCDEV_PROJECT_VERSION@@": "1.0.0",
  };
  const projectSourceFiles = new Map<string, Uint8Array>([
    [".gitignore", await packFile("templates/.gitignore")],
    ["build.gradle", render(await packFile("templates/build.gradle.tpl"), replacements)],
    ["settings.gradle", render(await packFile("templates/settings.gradle.tpl"), replacements)],
    ["gradle.properties", await packFile("templates/gradle.properties")],
    ["gradle/verification-metadata.xml", await packFile("templates/gradle/verification-metadata.xml")],
    ["gradle/wrapper/gradle-wrapper.jar", await packFile("templates/gradle/wrapper/gradle-wrapper.jar")],
    ["gradle/wrapper/gradle-wrapper.properties", await packFile("templates/gradle/wrapper/gradle-wrapper.properties")],
    ["gradlew", await packFile("templates/gradlew")],
    ["gradlew.bat", await packFile("templates/gradlew.bat")],
    loader === "fabric"
      ? ["src/main/resources/fabric.mod.json",
          render(await packFile("templates/fabric.mod.json.tpl"), replacements)]
      : ["src/main/resources/META-INF/neoforge.mods.toml",
          render(await packFile("templates/META-INF/neoforge.mods.toml.tpl"), replacements)],
  ]);
  const contentSourceFiles = new Map<string, Uint8Array>([
    ["src/main/java/dev/mcdev/generated/m_runnerfixture/GeneratedContent.java",
      Buffer.from("package dev.mcdev.generated.m_runnerfixture; public final class GeneratedContent {}\n")],
    ["src/main/java/dev/mcdev/generated/m_runnerfixture/GeneratedMod.java",
      Buffer.from("package dev.mcdev.generated.m_runnerfixture; public final class GeneratedMod {}\n")],
    ["src/main/resources/assets/runnerfixture/lang/en_us.json", Buffer.from("{}\n")],
    ...(loader === "fabric" ? [[
      "src/client/java/dev/mcdev/generated/m_runnerfixture/client/GeneratedClient.java",
      Buffer.from("package dev.mcdev.generated.m_runnerfixture.client; public final class GeneratedClient {}\n"),
    ] as const] : []),
  ]);
  const writeOwnedFiles = async (sourceFiles: ReadonlyMap<string, Uint8Array>): Promise<WorkspaceOwnedFile[]> => {
    const owned: WorkspaceOwnedFile[] = [];
    for (const [path, bytes] of [...sourceFiles].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      const target = join(workspace, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      const mode = path === "gradlew" ? 493 as const : 420 as const;
      await writeFile(target, bytes, { mode });
      await chmod(target, mode);
      owned.push(Object.freeze({ path, mode, size: bytes.byteLength, sha256: sha(bytes) }));
    }
    return owned;
  };
  const projectFiles = await writeOwnedFiles(projectSourceFiles);
  const contentFiles = await writeOwnedFiles(contentSourceFiles);
  const files = [...projectFiles, ...contentFiles]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const selectedPack = loader === "fabric" ? BUILTIN_FABRIC_1_20_1 : BUILTIN_NEOFORGE_26_1_2;
  const pack = Object.freeze({
    packId: selectedPack.packId,
    revision: selectedPack.revision,
    treeSha256: selectedPack.treeSha256,
  });
  const plan = {
    contract: "mcdev.build-plan/v1",
    planId: "1".repeat(64),
    specDigest: "2".repeat(64),
    pack,
    nodes: [
      {
        nodeId: "apply-workspace",
        kind: "apply-workspace",
        dependsOn: ["generate-content", "generate-project"],
        inputDigest: "3".repeat(64),
        cacheKey: "4".repeat(64),
        outputs: [],
        retryPolicy: "never",
        logPolicy: "structured-redacted-v1",
        validatorPolicy: "workspace-manifest-v1",
        provenance: "workspace-transaction",
        policy: "create-only-cas-wal-v1",
      },
      {
        nodeId: "generate-content",
        kind: "generate-content",
        dependsOn: [],
        inputDigest: "5".repeat(64),
        cacheKey: "6".repeat(64),
        outputs: contentFiles,
        retryPolicy: "never",
        logPolicy: "structured-redacted-v1",
        validatorPolicy: "sha256-outputs-v1",
        provenance: "compiler",
      },
      {
        nodeId: "generate-project",
        kind: "generate-project",
        dependsOn: [],
        inputDigest: "7".repeat(64),
        cacheKey: "8".repeat(64),
        outputs: projectFiles,
        retryPolicy: "never",
        logPolicy: "structured-redacted-v1",
        validatorPolicy: "sha256-outputs-v1",
        provenance: "compiler-and-pack",
      },
      {
        nodeId: "gradle-clean-build",
        kind: "gradle-clean-build",
        dependsOn: ["apply-workspace"],
        inputDigest: "9".repeat(64),
        cacheKey: "a".repeat(64),
        outputs: [],
        retryPolicy: "never",
        logPolicy: "structured-redacted-v1",
        validatorPolicy: "sha256-outputs-v1",
        provenance: "fixed-build-runner",
        policy: loader === "fabric" ? "fabric-1.20.1-phase1-v1" : "neoforge-phase1-v1",
      },
      {
        nodeId: "index-artifacts",
        kind: "index-artifacts",
        dependsOn: ["gradle-clean-build"],
        inputDigest: "b".repeat(64),
        cacheKey: "c".repeat(64),
        outputs: [],
        retryPolicy: "never",
        logPolicy: "structured-redacted-v1",
        validatorPolicy: "artifact-index-v1",
        provenance: "artifact-indexer",
        policy: "sha256-v1",
      },
    ],
    warnings: [],
  } as const;
  const manifest = {
    contract: "mcdev.workspace-manifest/v1",
    planId: plan.planId,
    pack,
    files,
  } as const;
  assert.equal(isBuildPlan(plan), true, "test plan must satisfy the public contract");
  assert.equal(isWorkspaceManifest(manifest), true, "test manifest must satisfy the public contract");
  return {
    root,
    workspace,
    java17,
    java21,
    java25,
    artifactCache,
    config: { java21Home: java21, java25Home: java25, artifactCacheRoot: artifactCache },
    fabricConfig: { java17Home: java17, artifactCacheRoot: artifactCache },
    plan,
    manifest,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];
  readonly pid: number;
  closed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }

  fail(): void {
    if (this.closed) return;
    this.emit("error", new Error("raw child failure /must/not/leak"));
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    this.finish(null, signal);
    return true;
  }
}

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: RunnerSpawnOptions;
}

type BuildAction = (child: FakeChild, call: SpawnCall) => Promise<void>;

interface FakeRuntime {
  readonly calls: SpawnCall[];
  readonly signals: { readonly pid: number; readonly signal: NodeJS.Signals }[];
  readonly spawn: RunnerSpawn;
  readonly processGroups: ProcessGroups;
}

function fakeRuntime(
  fixture: TestFixture,
  buildAction: BuildAction,
  versions: { readonly java17?: string; readonly java21: string; readonly java25: string } = {
    java17: "17.0.19+10",
    java21: "21.0.11+10-LTS",
    java25: "25.0.3+9-LTS",
  },
): FakeRuntime {
  const calls: SpawnCall[] = [];
  const signals: { pid: number; signal: NodeJS.Signals }[] = [];
  const children = new Map<number, FakeChild>();
  let nextPid = 10_000;
  const spawn: RunnerSpawn = (command, args, options): SpawnedProcess => {
    const call = Object.freeze({ command, args: Object.freeze([...args]), options });
    calls.push(call);
    nextPid += 1;
    const child = new FakeChild(nextPid);
    children.set(child.pid, child);
    queueMicrotask(() => {
      if (args[0] === "-XshowSettings:properties") {
        const is17 = command === join(fixture.java17, "bin", "java");
        const is21 = command === join(fixture.java21, "bin", "java");
        const home = is17 ? fixture.java17 : is21 ? fixture.java21 : fixture.java25;
        const version = is17 ? versions.java17 ?? "17.0.19+10" : is21 ? versions.java21 : versions.java25;
        child.stderr.write(`Property settings:\n    java.home = ${home}\n    java.runtime.version = ${version}\n`);
        child.finish(0, null);
        return;
      }
      void buildAction(child, call).catch(() => child.fail());
    });
    return child as unknown as SpawnedProcess;
  };
  return {
    calls,
    signals,
    spawn,
    processGroups: {
      signal: (pid, signal): void => {
        signals.push({ pid, signal });
        children.get(pid)?.finish(null, signal);
      },
      isAlive: (pid): boolean => children.get(pid)?.closed === false,
    },
  };
}

async function writeOrdinaryJar(
  workspace: string,
  name = "runnerfixture-1.0.0.jar",
  bytes = Buffer.from("jar"),
  mode = 0o644,
): Promise<void> {
  const libs = join(workspace, "build", "libs");
  await mkdir(libs, { recursive: true });
  const jar = join(libs, name);
  await writeFile(jar, bytes, { mode });
  await chmod(jar, mode);
}

function fixtureGradleUserHome(fixture: TestFixture): string {
  return join(fixture.artifactCache, BUILTIN_NEOFORGE_26_1_2.treeSha256, "gradle-user-home");
}

function syntheticMountInfo(nestedMountPoint?: string): Uint8Array {
  const encode = (path: string): string => path
    .replaceAll("\\", "\\134")
    .replaceAll(" ", "\\040")
    .replaceAll("\t", "\\011")
    .replaceAll("\n", "\\012");
  const lines = ["1 0 0:1 / / rw - rootfs rootfs rw"];
  if (nestedMountPoint !== undefined) {
    lines.push(`2 1 0:1 / ${encode(nestedMountPoint)} rw - tmpfs tmpfs rw`);
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function runnerDependencies(
  runtime: FakeRuntime,
  overrides: Partial<RunnerDependencies> = {},
): RunnerDependencies {
  return {
    ...DEFAULT_RUNNER_DEPENDENCIES,
    spawn: runtime.spawn,
    processGroups: runtime.processGroups,
    randomBytes: () => new Uint8Array(16).fill(0xab),
    ...overrides,
  };
}

async function expectRunnerError(promise: Promise<unknown>, code: BuildRunnerError["code"]): Promise<BuildRunnerError> {
  try {
    await promise;
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.equal(error instanceof BuildRunnerError, true);
    const runnerError = error as BuildRunnerError;
    assert.equal(runnerError.code, code);
    const containsAbsolutePath = (value: string): boolean => /\/(?:home|tmp|root|var|etc)\//u.test(value);
    assert.equal(containsAbsolutePath(runnerError.message), false, "public error messages contain no absolute paths");
    assert.equal(containsAbsolutePath(runnerError.stack ?? ""), false, "sanitized error stacks contain no absolute paths");
    return runnerError;
  }
}

async function withFixture(test: (fixture: TestFixture) => Promise<void>): Promise<void> {
  const fixture = await makeFixture();
  try {
    await test(fixture);
  } finally {
    await fixture.cleanup();
  }
}

async function withFabricFixture(test: (fixture: TestFixture) => Promise<void>): Promise<void> {
  const fixture = await makeFixture("fabric");
  try {
    await test(fixture);
  } finally {
    await fixture.cleanup();
  }
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.stdout.write("build ok\n");
    child.finish(0, null);
  });
  const poison = process.env.JAVA_TOOL_OPTIONS;
  process.env.JAVA_TOOL_OPTIONS = "-javaagent:/poison.jar";
  try {
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(
      fixture.config,
      runnerDependencies(runtime),
    );
    const result = await runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest });
    assert.equal(result.nodeId, "gradle-clean-build");
    assert.equal(result.outputs.entries.length, 1);
    assert.deepEqual(result.outputs.entries[0], {
      path: "build/libs/runnerfixture-1.0.0.jar",
      mode: 420,
      size: 3,
      sha256: sha(Buffer.from("jar")),
      kind: "build-output",
      provenance: "build",
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.outputs), true);
    assert.equal(Object.isFrozen(result.outputs.entries), true);
    const firstRead = result.outputs.readFile("build/libs/runnerfixture-1.0.0.jar");
    firstRead.fill(0);
    assert.equal(Buffer.from(result.outputs.readFile("build/libs/runnerfixture-1.0.0.jar")).toString(), "jar");
    let hostilePathGetterCalls = 0;
    const hostilePath = Object.defineProperty({}, "toString", {
      get(): () => string {
        hostilePathGetterCalls += 1;
        return () => "build/libs/runnerfixture-1.0.0.jar";
      },
    });
    assert.throws(() => result.outputs.readFile(hostilePath), BuildRunnerError);
    assert.equal(hostilePathGetterCalls, 0);

    const buildCall = runtime.calls.find((call) => call.options.detached);
    assert.notEqual(buildCall, undefined);
    assert.equal(buildCall?.command, join(fixture.java25, "bin", "java"));
    const buildState = join(fixture.workspace, ".mcdev", "build");
    assert.deepEqual(buildCall?.args, [
      "-Xms64m",
      "-Xmx64m",
      "-Dfile.encoding=UTF-8",
      "-Duser.language=en",
      "-Duser.country=US",
      "-Duser.timezone=UTC",
      `-Duser.home=${join(buildState, "home")}`,
      `-Djava.io.tmpdir=${join(buildState, "tmp")}`,
      "-Dorg.gradle.appname=gradlew",
      "-jar",
      join(fixture.workspace, "gradle", "wrapper", "gradle-wrapper.jar"),
      "--no-daemon",
      "--console=plain",
      "--no-configuration-cache",
      "--no-watch-fs",
      "--max-workers=2",
      "--project-cache-dir",
      join(buildState, "gradle-project-cache"),
      "--dependency-verification",
      "strict",
      "clean",
      "build",
    ]);
    assert.deepEqual(Object.keys(buildCall?.options.env ?? {}).sort(), [
      "GRADLE_USER_HOME",
      "HOME",
      "JAVA_HOME",
      "LANG",
      "LC_ALL",
      "MCDEV_BUILD_NONCE",
      "MCDEV_JAVA21_HOME",
      "MCDEV_JAVA25_HOME",
      "SOURCE_DATE_EPOCH",
      "TMPDIR",
      "TZ",
    ]);
    assert.equal(buildCall?.options.shell, false);
    assert.equal(buildCall?.options.detached, true);
    assert.equal(buildCall?.options.env.PATH, undefined);
    assert.equal(buildCall?.options.env.JAVA_TOOL_OPTIONS, undefined);
    assert.equal(buildCall?.options.env.MCDEV_BUILD_NONCE, "ab".repeat(16));
    assert.equal(buildCall?.options.env.GRADLE_USER_HOME,
      join(fixture.artifactCache, BUILTIN_NEOFORGE_26_1_2.treeSha256, "gradle-user-home"));
    const probeCalls = runtime.calls.filter((call) => !call.options.detached);
    assert.equal(probeCalls.length, 2);
    assert.equal(probeCalls.every((call) => call.args.join(" ") === "-XshowSettings:properties -version"), true);
  } finally {
    if (poison === undefined) delete process.env.JAVA_TOOL_OPTIONS;
    else process.env.JAVA_TOOL_OPTIONS = poison;
  }
});

await withFabricFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace, "runnerfixture-1.0.0.jar", Buffer.from("fabric-jar"));
    child.stdout.write("fabric build ok\n");
    child.finish(0, null);
  });
  const runner = createFabricPhase1BuildRunnerWithDependencies(
    fixture.fabricConfig,
    runnerDependencies(runtime),
  );
  const result = await runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest });
  assert.deepEqual(result.outputs.entries[0], {
    path: "build/libs/runnerfixture-1.0.0.jar",
    mode: 420,
    size: 10,
    sha256: sha(Buffer.from("fabric-jar")),
    kind: "build-output",
    provenance: "build",
  });
  const buildCall = runtime.calls.find((call) => call.options.detached);
  assert.equal(buildCall?.command, join(fixture.java17, "bin", "java"));
  assert.deepEqual(buildCall?.args.slice(-6), [
    "clean",
    "build",
    "-x",
    "sourcesJar",
    "-x",
    "remapSourcesJar",
  ]);
  assert.deepEqual(Object.keys(buildCall?.options.env ?? {}).sort(), [
    "GRADLE_USER_HOME",
    "HOME",
    "JAVA_HOME",
    "LANG",
    "LC_ALL",
    "MCDEV_BUILD_NONCE",
    "MCDEV_JAVA17_HOME",
    "SOURCE_DATE_EPOCH",
    "TMPDIR",
    "TZ",
  ]);
  assert.equal(buildCall?.options.env.JAVA_HOME, fixture.java17);
  assert.equal(buildCall?.options.env.MCDEV_JAVA17_HOME, fixture.java17);
  assert.equal(
    buildCall?.options.env.GRADLE_USER_HOME,
    join(fixture.artifactCache, BUILTIN_FABRIC_1_20_1.treeSha256, "gradle-user-home"),
  );
  assert.equal(runtime.calls.filter((call) => !call.options.detached).length, 1);
});

await withFabricFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  const plan = structuredClone(fixture.plan) as BuildPlan;
  const buildNode = plan.nodes.find((node) => node.kind === "gradle-clean-build");
  assert.ok(buildNode?.kind === "gradle-clean-build");
  Object.defineProperty(buildNode, "policy", { value: "neoforge-phase1-v1", enumerable: true });
  const runner = createFabricPhase1BuildRunnerWithDependencies(
    fixture.fabricConfig,
    runnerDependencies(runtime),
  );
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan, manifest: fixture.manifest }),
    "PLAN_INVALID",
  );
  assert.equal(runtime.calls.length, 0, "a cross-loader policy fails before any process is spawned");
});

{
  let getterCalls = 0;
  const hostileConfig = Object.defineProperty({
    java25Home: "/jdk25",
    artifactCacheRoot: "/cache",
  }, "java21Home", {
    enumerable: true,
    get(): string {
      getterCalls += 1;
      return "/jdk21";
    },
  });
  assert.throws(
    () => createNeoForgePhase1BuildRunnerWithDependencies(hostileConfig, DEFAULT_RUNNER_DEPENDENCIES),
    (error: unknown) => error instanceof BuildRunnerError && error.code === "INTERNAL_ERROR",
  );
  assert.equal(getterCalls, 0, "factory validation must not invoke accessors");
  assert.throws(
    () => createNeoForgePhase1BuildRunnerWithDependencies(new Proxy({}, {}), DEFAULT_RUNNER_DEPENDENCIES),
    BuildRunnerError,
  );
  assert.throws(
    () => createFabricPhase1BuildRunnerWithDependencies({
      java17Home: "/jdk17",
      artifactCacheRoot: "/cache",
      java21Home: "/unexpected",
    }, DEFAULT_RUNNER_DEPENDENCIES),
    (error: unknown) => error instanceof BuildRunnerError && error.code === "INTERNAL_ERROR",
    "Fabric config must reject fields from another loader policy",
  );
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  let getterCalls = 0;
  const hostileInput = Object.defineProperty({
    workspaceRoot: fixture.workspace,
    manifest: fixture.manifest,
  }, "plan", {
    enumerable: true,
    get(): BuildPlan {
      getterCalls += 1;
      return fixture.plan;
    },
  });
  await expectRunnerError(runner.run(hostileInput as unknown as Parameters<typeof runner.run>[0]), "PLAN_INVALID");
  assert.equal(getterCalls, 0, "run validation must not invoke accessors");

  const mismatchedManifest = structuredClone(fixture.manifest) as WorkspaceManifest;
  Object.defineProperty(mismatchedManifest, "planId", { value: "d".repeat(64), enumerable: true });
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: mismatchedManifest }),
    "PLAN_INVALID",
  );

  const foreignPlan = structuredClone(fixture.plan) as BuildPlan;
  const foreignManifest = structuredClone(fixture.manifest) as WorkspaceManifest;
  Object.defineProperty(foreignPlan.pack, "treeSha256", { value: "e".repeat(64), enumerable: true });
  Object.defineProperty(foreignManifest.pack, "treeSha256", { value: "e".repeat(64), enumerable: true });
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: foreignPlan, manifest: foreignManifest }),
    "PACK_INTEGRITY_FAILED",
  );
  assert.equal(runtime.calls.length, 0, "invalid identities fail before any process is spawned");
});

for (const mutation of ["downstream-output", "swapped-generator-partition"] as const) {
  await withFixture(async (fixture) => {
    const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
    const plan = structuredClone(fixture.plan) as BuildPlan;
    const project = plan.nodes.find((node) => node.nodeId === "generate-project");
    const content = plan.nodes.find((node) => node.nodeId === "generate-content");
    const downstream = plan.nodes.find((node) => node.nodeId === "apply-workspace");
    assert.notEqual(project, undefined);
    assert.notEqual(content, undefined);
    assert.notEqual(downstream, undefined);
    if (mutation === "downstream-output") {
      Object.defineProperty(downstream, "outputs", {
        value: [fixture.manifest.files[0]],
        enumerable: true,
      });
    } else {
      const projectOutputs = project?.outputs ?? [];
      Object.defineProperty(project, "outputs", { value: content?.outputs ?? [], enumerable: true });
      Object.defineProperty(content, "outputs", { value: projectOutputs, enumerable: true });
    }
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan, manifest: fixture.manifest }),
      "PLAN_INVALID",
    );
    assert.equal(runtime.calls.length, 0, "invalid fixed-plan output ownership fails before probes");
  });
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  const mutablePlan = structuredClone(fixture.plan) as BuildPlan;
  const mutableManifest = structuredClone(fixture.manifest) as WorkspaceManifest;
  const pending = runner.run({ workspaceRoot: fixture.workspace, plan: mutablePlan, manifest: mutableManifest });
  Object.defineProperty(mutablePlan, "planId", { value: "f".repeat(64), enumerable: true });
  Object.defineProperty(mutableManifest, "planId", { value: "e".repeat(64), enumerable: true });
  assert.equal((await pending).outputs.entries.length, 1, "run input is snapshotted before the first await");
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  const input = { workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest };
  const first = await runner.run(input);
  const second = await runner.run(input);
  assert.deepEqual(second.outputs.entries, first.outputs.entries);
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 2);
  assert.equal(runtime.signals.length, 0, "two successful runs leave no process-group cleanup signal");
});

for (const tamper of ["replace", "add"] as const) {
  await withFixture(async (fixture) => {
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    const input = { workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest };
    await runner.run(input);
    if (tamper === "replace") {
      await writeFile(join(fixture.workspace, "build", "libs", "runnerfixture-1.0.0.jar"), "tampered", {
        mode: 0o644,
      });
    } else {
      await writeFile(join(fixture.workspace, "build", "libs", "arbitrary.jar"), "arbitrary", { mode: 0o644 });
    }
    await expectRunnerError(runner.run(input), "ARTIFACT_INTEGRITY_FAILED");
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 1,
      "unverified prior output is rejected before a second worker starts");
  });
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const input = { workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest };
  const firstRunner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await firstRunner.run(input);
  const restartedRunner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await expectRunnerError(restartedRunner.run(input), "WORKSPACE_INVALID");
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 1,
    "a process restart loses ephemeral provenance and therefore fails closed");
});

for (const bytes of [BUILD_RUNNER_LIMITS.rawOutputBytes, BUILD_RUNNER_LIMITS.rawOutputBytes + 1]) {
  await withFixture(async (fixture) => {
    const runtime = fakeRuntime(fixture, async (child) => {
      const stdoutBytes = Math.floor(bytes / 2);
      child.stdout.write(Buffer.alloc(stdoutBytes, 0x78));
      child.stderr.write(Buffer.alloc(bytes - stdoutBytes, 0x79));
      if (child.closed) return;
      await writeOrdinaryJar(fixture.workspace);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    const run = runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest });
    if (bytes === BUILD_RUNNER_LIMITS.rawOutputBytes) {
      assert.equal((await run).outputs.entries.length, 1, "the exact output cap is accepted");
    } else {
      await expectRunnerError(run, "BUILD_OUTPUT_LIMIT");
      assert.deepEqual(runtime.signals.map(({ signal }) => signal), ["SIGTERM"]);
    }
  });
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async () => new Promise<void>(() => undefined));
  const timeoutClock: RunnerClock = {
    ...DEFAULT_RUNNER_DEPENDENCIES.clock,
    setTimeout: (callback, milliseconds): unknown => {
      if (milliseconds === BUILD_RUNNER_LIMITS.buildTimeoutMilliseconds) queueMicrotask(callback);
      return Object.freeze({ milliseconds });
    },
    clearTimeout: () => undefined,
    sleep: async () => undefined,
  };
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(
    fixture.config,
    runnerDependencies(runtime, { clock: timeoutClock }),
  );
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "BUILD_TIMEOUT",
  );
  assert.deepEqual(runtime.signals.map(({ signal }) => signal), ["SIGTERM"]);
});

for (const scenario of [
  { code: 1, signal: null },
  { code: null, signal: "SIGSEGV" as NodeJS.Signals },
] as const) {
  await withFixture(async (fixture) => {
    const runtime = fakeRuntime(fixture, async (child) => {
      child.finish(scenario.code, scenario.signal);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "BUILD_FAILED",
    );
  });
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    const split = Math.floor(fixture.workspace.length / 2);
    child.stdout.write(`prefix ${fixture.workspace.slice(0, split)}`);
    child.stdout.write(`${fixture.workspace.slice(split)} token=super-secret\n`);
    child.stderr.write(`/another/absolute/path credential=hunter2\n`);
    child.finish(1, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  const error = await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "BUILD_FAILED",
  );
  assert.equal(error.stdoutTail?.includes(fixture.workspace), false);
  assert.equal(error.stdoutTail?.includes("super-secret"), false);
  assert.equal(error.stderrTail?.includes("/another/absolute/path"), false);
  assert.equal(error.stderrTail?.includes("hunter2"), false);
  assert.equal(Buffer.byteLength(error.stdoutTail ?? "", "utf8") <= BUILD_RUNNER_LIMITS.redactedTailBytes, true);
  assert.equal(Buffer.byteLength(error.stderrTail ?? "", "utf8") <= BUILD_RUNNER_LIMITS.redactedTailBytes, true);
});

await withFixture(async (fixture) => {
  await writeFile(join(fixture.workspace, ".mcdev-workspace.lock"), "other operation\n", { mode: 0o600 });
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_BUSY",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    platform: () => "darwin",
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "INTERNAL_ERROR",
  );
  assert.equal(runtime.calls.length, 0);
});

for (const mountScope of ["workspace", "artifact-cache", "jdk"] as const) {
  await withFixture(async (fixture) => {
    const nestedMount = mountScope === "workspace"
      ? join(fixture.workspace, "gradle", "wrapper")
      : mountScope === "artifact-cache"
        ? fixtureGradleUserHome(fixture)
        : join(fixture.java25, "lib");
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
      readMountInfo: async () => syntheticMountInfo(nestedMount),
    }));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      mountScope === "workspace" ? "WORKSPACE_INVALID" : "PACK_INTEGRITY_FAILED",
    );
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

for (const mountInfoFailure of ["malformed", "unavailable", "overflow"] as const) {
  await withFixture(async (fixture) => {
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace);
      child.finish(0, null);
    });
    const readMountInfo = async (): Promise<Uint8Array> => {
      if (mountInfoFailure === "unavailable") throw new Error("mountinfo unavailable");
      if (mountInfoFailure === "overflow") return new Uint8Array(1_048_577);
      return Buffer.from("malformed mountinfo\\999\n", "utf8");
    };
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
      readMountInfo,
    }));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "INTERNAL_ERROR",
    );
    assert.equal(runtime.calls.length, 0);
  });
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const baseFileSystem = DEFAULT_RUNNER_DEPENDENCIES.fileSystem;
  let closed = false;
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    fileSystem: {
      ...baseFileSystem,
      openDirectory: async (path) => {
        if (path !== fixture.workspace) return baseFileSystem.openDirectory(path);
        let reads = 0;
        return {
          read: async () => {
            reads += 1;
            return reads <= 16_385 ? Object.freeze({ name: `entry-${reads}` }) : null;
          },
          close: async () => { closed = true; },
        };
      },
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_INVALID",
  );
  assert.equal(closed, true, "bounded directory streams are closed on overflow");
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
});

for (const unsafeDirectory of ["workspace-state", "gradle-cache"] as const) {
  await withFixture(async (fixture) => {
    const target = unsafeDirectory === "workspace-state"
      ? join(fixture.workspace, ".mcdev")
      : fixtureGradleUserHome(fixture);
    await mkdir(target, { recursive: true, mode: 0o700 });
    await chmod(target, 0o777);
    const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      unsafeDirectory === "workspace-state" ? "WORKSPACE_INVALID" : "PACK_INTEGRITY_FAILED",
    );
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

for (const cacheAttack of ["symlink", "unsafe-file", "hardlink", "case-collision"] as const) {
  await withFixture(async (fixture) => {
    const cache = fixtureGradleUserHome(fixture);
    await mkdir(join(cache, "modules"), { recursive: true, mode: 0o700 });
    const outside = join(fixture.root, "outside-cache-marker");
    await writeFile(outside, "outside marker\n", { mode: 0o600 });
    if (cacheAttack === "symlink") {
      await symlink(outside, join(cache, "modules", "linked.bin"));
    } else if (cacheAttack === "unsafe-file") {
      const target = join(cache, "modules", "unsafe.bin");
      await writeFile(target, "unsafe\n", { mode: 0o666 });
      await chmod(target, 0o666);
    } else if (cacheAttack === "hardlink") {
      await link(outside, join(cache, "modules", "linked.bin"));
    } else {
      await writeFile(join(cache, "modules", "Entry.bin"), "one\n", { mode: 0o600 });
      await writeFile(join(cache, "modules", "entry.bin"), "two\n", { mode: 0o600 });
    }
    const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "PACK_INTEGRITY_FAILED",
    );
    assert.equal(await readFile(outside, "utf8"), "outside marker\n");
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

await withFixture(async (fixture) => {
  const cacheFile = join(fixtureGradleUserHome(fixture), "caches", "modules-2", "safe.bin");
  await mkdir(dirname(cacheFile), { recursive: true, mode: 0o700 });
  await writeFile(cacheFile, "safe cached dependency\n", { mode: 0o600 });
  await chmod(cacheFile, 0o600);
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  assert.equal((await runner.run({
    workspaceRoot: fixture.workspace,
    plan: fixture.plan,
    manifest: fixture.manifest,
  })).outputs.entries.length, 1);
  assert.equal(await readFile(cacheFile, "utf8"), "safe cached dependency\n");
});

for (const stateAttack of ["symlink", "unsafe-file", "hardlink", "case-collision"] as const) {
  await withFixture(async (fixture) => {
    const buildState = join(fixture.workspace, ".mcdev", "build");
    const targetRoot = stateAttack === "symlink"
      ? join(buildState, "home")
      : stateAttack === "hardlink"
        ? join(buildState, "tmp")
        : join(buildState, "gradle-project-cache");
    await mkdir(targetRoot, { recursive: true, mode: 0o700 });
    const outside = join(fixture.root, "outside-state-marker");
    await writeFile(outside, "outside state marker\n", { mode: 0o600 });
    if (stateAttack === "symlink") {
      await symlink(outside, join(targetRoot, "linked.bin"));
    } else if (stateAttack === "unsafe-file") {
      const unsafe = join(targetRoot, "unsafe.bin");
      await writeFile(unsafe, "unsafe\n", { mode: 0o666 });
      await chmod(unsafe, 0o666);
    } else if (stateAttack === "hardlink") {
      await link(outside, join(targetRoot, "linked.bin"));
    } else {
      await writeFile(join(targetRoot, "Entry.bin"), "one\n", { mode: 0o600 });
      await writeFile(join(targetRoot, "entry.bin"), "two\n", { mode: 0o600 });
    }
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "WORKSPACE_INVALID",
    );
    assert.equal(await readFile(outside, "utf8"), "outside state marker\n");
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

await withFixture(async (fixture) => {
  const safeStateFile = join(fixture.workspace, ".mcdev", "build", "gradle-project-cache", "safe.bin");
  await mkdir(dirname(safeStateFile), { recursive: true, mode: 0o700 });
  await writeFile(safeStateFile, "safe project cache\n", { mode: 0o600 });
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  assert.equal((await runner.run({
    workspaceRoot: fixture.workspace,
    plan: fixture.plan,
    manifest: fixture.manifest,
  })).outputs.entries.length, 1);
  assert.equal(await readFile(safeStateFile, "utf8"), "safe project cache\n");
});

await withFixture(async (fixture) => {
  const state = join(fixture.workspace, ".mcdev");
  const baseFileSystem = DEFAULT_RUNNER_DEPENDENCIES.fileSystem;
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    fileSystem: {
      ...baseFileSystem,
      lstat: async (path) => {
        const stats = await baseFileSystem.lstat(path);
        if (path === state) Object.defineProperty(stats, "uid", { value: stats.uid + 1n });
        return stats;
      },
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_INVALID",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0,
    "workspace state ownership is bound to the effective uid");
});

if ((process.geteuid?.() ?? process.getuid?.()) === 0) {
  await withFixture(async (fixture) => {
    const cache = fixtureGradleUserHome(fixture);
    await mkdir(cache, { recursive: true, mode: 0o700 });
    await chown(cache, 65_534, 65_534);
    const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "PACK_INTEGRITY_FAILED",
    );
  });
}

type JarScenario = "none" | "two" | "symlink" | "hardlink" | "oversize" | "directory";
for (const scenario of ["none", "two", "symlink", "hardlink", "oversize", "directory"] as const satisfies readonly JarScenario[]) {
  await withFixture(async (fixture) => {
    const runtime = fakeRuntime(fixture, async (child) => {
      const libs = join(fixture.workspace, "build", "libs");
      await mkdir(libs, { recursive: true });
      if (scenario === "two") {
        await writeOrdinaryJar(fixture.workspace, "one.jar");
        await writeOrdinaryJar(fixture.workspace, "two.jar");
      } else if (scenario === "symlink") {
        const outside = join(fixture.root, "outside.jar");
        await writeFile(outside, "jar", { mode: 0o644 });
        await symlink(outside, join(libs, "linked.jar"));
      } else if (scenario === "hardlink") {
        const outside = join(fixture.root, "outside.jar");
        await writeFile(outside, "jar", { mode: 0o644 });
        await chmod(outside, 0o644);
        await link(outside, join(libs, "linked.jar"));
      } else if (scenario === "oversize") {
        const jar = join(libs, "large.jar");
        await writeFile(jar, "x", { mode: 0o644 });
        await truncate(jar, BUILD_RUNNER_LIMITS.jarBytes + 1);
        await chmod(jar, 0o644);
      } else if (scenario === "directory") {
        await mkdir(join(libs, "not-a-file.jar"), { mode: 0o700 });
      }
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "ARTIFACT_INTEGRITY_FAILED",
    );
  });
}

for (const initialMode of [0o600, 0o640, 0o644] as const) {
  await withFixture(async (fixture) => {
    const jar = join(fixture.workspace, "build", "libs", "runnerfixture-1.0.0.jar");
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace, "runnerfixture-1.0.0.jar", Buffer.from("jar"), initialMode);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    const result = await runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest });
    assert.equal(result.outputs.entries[0]?.mode, 0o644);
    assert.equal((await stat(jar)).mode & 0o777, 0o644, "accepted JAR mode is normalized through its open handle");
  });
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace, "runnerfixture-1.0.0.jar", Buffer.from("jar"), 0o664);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "ARTIFACT_INTEGRITY_FAILED",
  );
});

if ((process.geteuid?.() ?? process.getuid?.()) === 0) {
  await withFixture(async (fixture) => {
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace);
      await chown(join(fixture.workspace, "build", "libs", "runnerfixture-1.0.0.jar"), 65_534, 65_534);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "ARTIFACT_INTEGRITY_FAILED",
    );
  });
}

await withFixture(async (fixture) => {
  let replaced = false;
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    checkpoint: async (point, path) => {
      if (!replaced && point === "managed-file-before-post-stat" && path === "build.gradle") {
        replaced = true;
        const target = join(fixture.workspace, "build.gradle");
        const previous = join(fixture.root, "previous-build.gradle");
        const bytes = await readFile(target);
        await rename(target, previous);
        await writeFile(target, bytes, { mode: 0o644 });
        await chmod(target, 0o644);
      }
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_MANAGED_FILE_MODIFIED",
  );
});

await withFixture(async (fixture) => {
  let modifiedAfterBuild = false;
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    checkpoint: async (point) => {
      if (!modifiedAfterBuild && point === "workspace-before-post-verify") {
        modifiedAfterBuild = true;
        await writeFile(join(fixture.workspace, "settings.gradle"), "tampered after build\n", { mode: 0o644 });
      }
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_MANAGED_FILE_MODIFIED",
  );
});

for (const unsafeAncestor of [
  "gradle/wrapper",
  "src/main/java/dev/mcdev/generated/m_runnerfixture",
] as const) {
  await withFixture(async (fixture) => {
    await chmod(join(fixture.workspace, ...unsafeAncestor.split("/")), 0o777);
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "WORKSPACE_INVALID",
    );
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

await withFixture(async (fixture) => {
  const target = join(fixture.workspace, "build.gradle");
  const baseFileSystem = DEFAULT_RUNNER_DEPENDENCIES.fileSystem;
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    fileSystem: {
      ...baseFileSystem,
      lstat: async (path) => {
        const stats = await baseFileSystem.lstat(path);
        if (path === target) Object.defineProperty(stats, "uid", { value: stats.uid + 1n });
        return stats;
      },
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_MANAGED_FILE_MODIFIED",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
});

if ((process.geteuid?.() ?? process.getuid?.()) === 0) {
  await withFixture(async (fixture) => {
    await chown(join(fixture.workspace, "gradle", "wrapper"), 65_534, 65_534);
    const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "WORKSPACE_INVALID",
    );
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

await withFixture(async (fixture) => {
  let replaced = false;
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    checkpoint: async (point, path) => {
      if (!replaced && point === "jar-file-before-post-stat" && path?.endsWith(".jar")) {
        replaced = true;
        const target = join(fixture.workspace, ...path.split("/"));
        const previous = join(fixture.root, "previous.jar");
        const bytes = await readFile(target);
        await rename(target, previous);
        await writeFile(target, bytes, { mode: 0o644 });
        await chmod(target, 0o644);
      }
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "ARTIFACT_INTEGRITY_FAILED",
  );
});

await withFixture(async (fixture) => {
  await writeFile(join(fixture.workspace, "evil.gradle"), "throw new Error('owned')\n", { mode: 0o644 });
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_INVALID",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
});

for (const unmanagedPath of [
  "src/main/java/Injected.java",
  "src/main/resources/assets/runnerfixture/injected.txt",
  "gradle/libs.versions.toml",
] as const) {
  await withFixture(async (fixture) => {
    const target = join(fixture.workspace, ...unmanagedPath.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "unmanaged\n", { mode: 0o644 });
    const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "WORKSPACE_INVALID",
    );
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    const injected = join(fixture.workspace, "src", "main", "resources", "injected-after-build.txt");
    await mkdir(dirname(injected), { recursive: true });
    await writeFile(injected, "worker-created unmanaged input\n", { mode: 0o644 });
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_INVALID",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 1);
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(
    fixture,
    async (child) => child.finish(0, null),
    { java21: "21.0.11+10", java25: "25.0.3+9-LTS" },
  );
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "PACK_INTEGRITY_FAILED",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
});

for (const unsafeJdkDirectory of ["bin", "lib"] as const) {
  await withFixture(async (fixture) => {
    await chmod(join(fixture.java25, unsafeJdkDirectory), 0o777);
    const runtime = fakeRuntime(fixture, async (child) => {
      await writeOrdinaryJar(fixture.workspace);
      child.finish(0, null);
    });
    const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
    await expectRunnerError(
      runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
      "PACK_INTEGRITY_FAILED",
    );
    assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
  });
}

await withFixture(async (fixture) => {
  let replaced = false;
  const executable = join(fixture.java25, "bin", "java");
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    checkpoint: async (point) => {
      if (point === "before-build-spawn" && !replaced) {
        replaced = true;
        await rename(executable, join(fixture.root, "previous-java25"));
        await writeFile(executable, "fake java 25\n", { mode: 0o755 });
        await chmod(executable, 0o755);
      }
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "PACK_INTEGRITY_FAILED",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
});

await withFixture(async (fixture) => {
  const executable = join(fixture.java25, "bin", "java");
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    await rename(executable, join(fixture.root, "post-build-java25"));
    await writeFile(executable, "fake java 25\n", { mode: 0o755 });
    await chmod(executable, 0o755);
    child.finish(0, null);
  });
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "PACK_INTEGRITY_FAILED",
  );
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  let java21DirectoryReads = 0;
  const baseFileSystem = DEFAULT_RUNNER_DEPENDENCIES.fileSystem;
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    fileSystem: {
      ...baseFileSystem,
      lstat: async (path) => {
        if (path === fixture.java21) {
          java21DirectoryReads += 1;
          if (java21DirectoryReads >= 3) throw new Error("simulated JDK identity replacement");
        }
        return baseFileSystem.lstat(path);
      },
    },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "PACK_INTEGRITY_FAILED",
  );
  assert.equal(runtime.calls.filter((call) => call.options.detached).length, 0);
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  let aliveChecks = 0;
  const processGroups: ProcessGroups = {
    signal: (pid, signal): void => {
      runtime.signals.push({ pid, signal });
    },
    isAlive: (): boolean => {
      aliveChecks += 1;
      return aliveChecks === 1;
    },
  };
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    processGroups,
    clock: { ...DEFAULT_RUNNER_DEPENDENCIES.clock, sleep: async () => undefined },
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "BUILD_FAILED",
  );
  assert.deepEqual(runtime.signals.map(({ signal }) => signal), ["SIGTERM"]);
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => {
    await writeOrdinaryJar(fixture.workspace);
    child.finish(0, null);
  });
  const processGroups: ProcessGroups = {
    signal: (pid, signal): void => {
      runtime.signals.push({ pid, signal });
    },
    isAlive: () => true,
  };
  const immediateClock: RunnerClock = {
    ...DEFAULT_RUNNER_DEPENDENCIES.clock,
    sleep: async () => undefined,
  };
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    processGroups,
    clock: immediateClock,
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "BUILD_FAILED",
  );
  assert.deepEqual(runtime.signals.map(({ signal }) => signal), ["SIGTERM", "SIGKILL"]);
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async () => new Promise<void>(() => undefined));
  const activeTimers = new Set<{ cancelled: boolean }>();
  const reapClock: RunnerClock = {
    setTimeout: (callback): unknown => {
      const handle = { cancelled: false };
      activeTimers.add(handle);
      queueMicrotask(() => {
        if (!handle.cancelled) callback();
        activeTimers.delete(handle);
      });
      return handle;
    },
    clearTimeout: (rawHandle): void => {
      const handle = rawHandle as { cancelled: boolean };
      handle.cancelled = true;
      activeTimers.delete(handle);
    },
    sleep: async () => undefined,
  };
  const stubbornGroups: ProcessGroups = {
    signal: (pid, signal): void => {
      runtime.signals.push({ pid, signal });
    },
    isAlive: () => true,
  };
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    processGroups: stubbornGroups,
    clock: reapClock,
  }));
  await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "BUILD_FAILED",
  );
  assert.deepEqual(runtime.signals.map(({ signal }) => signal), ["SIGTERM", "SIGKILL"]);
  assert.equal(activeTimers.size, 0);
});

await withFixture(async (fixture) => {
  const runtime = fakeRuntime(fixture, async (child) => child.finish(0, null));
  const rawSecret = "/raw/secret/from/filesystem";
  const runner = createNeoForgePhase1BuildRunnerWithDependencies(fixture.config, runnerDependencies(runtime, {
    fileSystem: {
      ...DEFAULT_RUNNER_DEPENDENCIES.fileSystem,
      lstat: async () => { throw new Error(rawSecret); },
    },
  }));
  const error = await expectRunnerError(
    runner.run({ workspaceRoot: fixture.workspace, plan: fixture.plan, manifest: fixture.manifest }),
    "WORKSPACE_INVALID",
  );
  assert.equal(error.message.includes(rawSecret), false);
  assert.equal(error.stack?.includes(rawSecret), false);
});
