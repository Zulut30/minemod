import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  chown,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BUILD_PLAN_CONTRACT,
  CONTRACT_LIMITS,
  type BuildPlan,
  type FileMode,
  type PlannedOutput,
  type PortableRelativePath,
  type Sha256,
} from "@mcdev/contracts";
import {
  WORKSPACE_LOCK_FILE,
  WORKSPACE_STATE_DIRECTORY,
  WorkspaceApplyError,
  WorkspaceFaultInjectionError,
  applyWorkspacePlan,
  recoverWorkspace,
  type WorkspaceApplyInput,
  type WorkspaceFaultEvent,
  type WorkspaceFileInput,
} from "./index.ts";

const HASHES = {
  plan: "1111111111111111111111111111111111111111111111111111111111111111",
  planTwo: "2222222222222222222222222222222222222222222222222222222222222222",
  spec: "3333333333333333333333333333333333333333333333333333333333333333",
  pack: "4444444444444444444444444444444444444444444444444444444444444444",
  input: "5555555555555555555555555555555555555555555555555555555555555555",
  cache: "6666666666666666666666666666666666666666666666666666666666666666",
} as const;

interface FileDefinition {
  readonly path: string;
  readonly mode: FileMode;
  readonly content: string | Uint8Array;
}

function digest(content: Uint8Array): Sha256 {
  return createHash("sha256").update(content).digest("hex");
}

function fileBytes(file: FileDefinition): Buffer {
  return typeof file.content === "string" ? Buffer.from(file.content, "utf8") : Buffer.from(file.content);
}

function makeInput(root: string, definitions: readonly FileDefinition[], planId: Sha256 = HASHES.plan): WorkspaceApplyInput {
  const sorted = [...definitions].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const outputs: PlannedOutput[] = sorted.map((file) => {
    const content = fileBytes(file);
    return {
      path: file.path as PortableRelativePath,
      mode: file.mode,
      size: content.byteLength,
      sha256: digest(content),
    };
  });
  const plan = {
    contract: BUILD_PLAN_CONTRACT,
    planId,
    specDigest: HASHES.spec,
    pack: {
      packId: "neoforge-26.1.2-java-25",
      revision: 1,
      treeSha256: HASHES.pack,
    },
    nodes: [
      {
        nodeId: "apply-workspace",
        kind: "apply-workspace",
        dependsOn: ["generate-project"],
        inputDigest: HASHES.input,
        cacheKey: HASHES.cache,
        outputs: [],
        retryPolicy: "never",
        logPolicy: "structured-redacted-v1",
        validatorPolicy: "workspace-manifest-v1",
        provenance: "workspace-transaction",
        policy: "create-only-cas-wal-v1",
      },
      {
        nodeId: "generate-project",
        kind: "generate-project",
        dependsOn: [],
        inputDigest: HASHES.input,
        cacheKey: HASHES.cache,
        outputs,
        retryPolicy: "never",
        logPolicy: "structured-redacted-v1",
        validatorPolicy: "sha256-outputs-v1",
        provenance: "compiler-and-pack",
      },
    ],
    warnings: [],
  } as const satisfies BuildPlan;
  const files: WorkspaceFileInput[] = sorted.map((file) => ({
    path: file.path as PortableRelativePath,
    mode: file.mode,
    content: fileBytes(file),
  }));
  return { workspaceRoot: root, plan, files };
}

const STANDARD_FILES: readonly FileDefinition[] = [
  { path: "build.gradle", mode: 420, content: "plugins { id 'java' }\n" },
  { path: "gradlew", mode: 493, content: "#!/bin/sh\nexit 0\n" },
];

async function newRoot(base: string, name: string): Promise<string> {
  const root = join(base, name);
  await mkdir(root);
  return realpath(root);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ENOENT");
  }
}

async function expectWorkspaceError(
  action: Promise<unknown>,
  code: WorkspaceApplyError["code"],
  forbiddenAbsolute?: string,
): Promise<WorkspaceApplyError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof WorkspaceApplyError, `expected WorkspaceApplyError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (forbiddenAbsolute !== undefined) {
      assert.equal(error.message.includes(forbiddenAbsolute), false, "error must not disclose the absolute root");
      assert.equal(JSON.stringify(error.error).includes(forbiddenAbsolute), false);
    }
    return error;
  }
  assert.fail(`expected ${code}`);
}

async function assertStandardOutputs(root: string): Promise<void> {
  assert.equal(await readFile(join(root, "build.gradle"), "utf8"), "plugins { id 'java' }\n");
  assert.equal(await readFile(join(root, "gradlew"), "utf8"), "#!/bin/sh\nexit 0\n");
  assert.equal((await stat(join(root, "build.gradle"))).mode & 0o777, 0o644);
  assert.equal((await stat(join(root, "gradlew"))).mode & 0o777, 0o755);
}

const temporaryBase = await mkdtemp(join(tmpdir(), "mcdev-workspace-tests-"));
try {
  {
    const root = await newRoot(temporaryBase, "create-and-noop");
    const input = makeInput(root, STANDARD_FILES);
    const created = await applyWorkspacePlan(input);
    assert.equal(created.status, "created");
    await assertStandardOutputs(root);
    assert.equal(await exists(join(root, WORKSPACE_LOCK_FILE)), false);
    assert.equal(await exists(join(root, WORKSPACE_STATE_DIRECTORY, "workspace-journal.json")), false);
    assert.equal(await exists(join(root, WORKSPACE_STATE_DIRECTORY, "workspace-directories.json")), false);

    const buildDigest = digest(fileBytes(STANDARD_FILES[0] ?? assert.fail("missing fixture")));
    const casFile = join(root, WORKSPACE_STATE_DIRECTORY, "cas", "sha256", buildDigest);
    const outputStat = await stat(join(root, "build.gradle"), { bigint: true });
    const casStat = await stat(casFile, { bigint: true });
    assert.notEqual(outputStat.ino, casStat.ino, "outputs must be byte copies, never CAS hardlinks");
    assert.equal(outputStat.nlink, 1n);
    assert.equal(casStat.nlink, 1n);

    const frozenTime = new Date("2001-02-03T04:05:06.000Z");
    const manifestPath = join(root, WORKSPACE_STATE_DIRECTORY, "workspace-manifest.json");
    await Promise.all([
      utimes(join(root, "build.gradle"), frozenTime, frozenTime),
      utimes(join(root, "gradlew"), frozenTime, frozenTime),
      utimes(manifestPath, frozenTime, frozenTime),
      utimes(casFile, frozenTime, frozenTime),
    ]);
    const before = await Promise.all([
      stat(join(root, "build.gradle"), { bigint: true }),
      stat(join(root, "gradlew"), { bigint: true }),
      stat(manifestPath, { bigint: true }),
      stat(casFile, { bigint: true }),
    ]);
    const noop = await applyWorkspacePlan(input);
    assert.equal(noop.status, "noop");
    const after = await Promise.all([
      stat(join(root, "build.gradle"), { bigint: true }),
      stat(join(root, "gradlew"), { bigint: true }),
      stat(manifestPath, { bigint: true }),
      stat(casFile, { bigint: true }),
    ]);
    assert.deepEqual(after.map((entry) => entry.mtimeNs), before.map((entry) => entry.mtimeNs));
    assert.deepEqual(after.map((entry) => entry.ino), before.map((entry) => entry.ino));
  }

  {
    const root = await newRoot(temporaryBase, "restart-linked-state-and-cas");
    const input = makeInput(root, STANDARD_FILES);
    await applyWorkspacePlan(input);
    const state = join(root, WORKSPACE_STATE_DIRECTORY);
    const manifest = join(state, "workspace-manifest.json");
    const manifestOrphan = join(state, ".workspace-manifest.json.987654.40.tmp");
    const manifestTemporary = join(state, ".workspace-manifest.json.987654.41.tmp");
    await writeFile(manifestOrphan, "orphan-before-link", { flag: "wx", mode: 0o600 });
    await link(manifest, manifestTemporary);
    assert.equal((await stat(manifest, { bigint: true })).nlink, 2n);
    assert.equal((await applyWorkspacePlan(input)).status, "noop");
    assert.equal(await exists(manifestTemporary), false);
    assert.equal(await readFile(manifestOrphan, "utf8"), "orphan-before-link");
    assert.equal((await stat(manifestOrphan, { bigint: true })).nlink, 1n);
    assert.equal((await stat(manifest, { bigint: true })).nlink, 1n);

    const firstFile = input.files[0] ?? assert.fail("missing fixture");
    const casObject = join(state, "cas", "sha256", digest(firstFile.content));
    const casOrphan = join(dirname(casObject), `.${digest(firstFile.content)}.987654.40.tmp`);
    const casTemporary = join(dirname(casObject), `.${digest(firstFile.content)}.987654.42.tmp`);
    await writeFile(casOrphan, "orphan-before-link", { flag: "wx", mode: 0o600 });
    await link(casObject, casTemporary);
    assert.equal((await stat(casObject, { bigint: true })).nlink, 2n);
    assert.equal((await applyWorkspacePlan(input)).status, "noop");
    assert.equal(await exists(casTemporary), false);
    assert.equal(await readFile(casOrphan, "utf8"), "orphan-before-link");
    assert.equal((await stat(casOrphan, { bigint: true })).nlink, 1n);
    assert.equal((await stat(casObject, { bigint: true })).nlink, 1n);
  }

  {
    const root = await newRoot(temporaryBase, "restart-linked-journal");
    const input = makeInput(root, STANDARD_FILES);
    await assert.rejects(
      applyWorkspacePlan(input, {
        checkpoint: (event) => {
          if (event.point === "journal-prepared") throw new WorkspaceFaultInjectionError(event);
        },
      }),
      WorkspaceFaultInjectionError,
    );
    const state = join(root, WORKSPACE_STATE_DIRECTORY);
    const journal = join(state, "workspace-journal.json");
    const journalOrphan = join(state, ".workspace-journal.json.987654.40.tmp");
    const journalTemporary = join(state, ".workspace-journal.json.987654.43.tmp");
    await writeFile(journalOrphan, "orphan-before-link", { flag: "wx", mode: 0o600 });
    await link(journal, journalTemporary);
    assert.equal((await stat(journal, { bigint: true })).nlink, 2n);
    assert.equal((await recoverWorkspace({ workspaceRoot: root })).status, "recovered");
    assert.equal(await exists(journalTemporary), false);
    assert.equal(await readFile(journalOrphan, "utf8"), "orphan-before-link");
    assert.equal((await stat(journalOrphan, { bigint: true })).nlink, 1n);
  }

  {
    const root = await newRoot(temporaryBase, "reject-unproven-linked-state");
    const input = makeInput(root, STANDARD_FILES);
    await applyWorkspacePlan(input);
    const state = join(root, WORKSPACE_STATE_DIRECTORY);
    const manifest = join(state, "workspace-manifest.json");
    const externalLink = join(root, "external-manifest-link");
    await link(manifest, externalLink);
    await expectWorkspaceError(applyWorkspacePlan(input), "WORKSPACE_RECOVERY_REQUIRED");
    assert.equal(await exists(externalLink), true, "an arbitrary hardlink must never be removed");
    await unlink(externalLink);

    const firstTemporary = join(state, ".workspace-manifest.json.987654.44.tmp");
    const secondTemporary = join(state, ".workspace-manifest.json.987654.45.tmp");
    await link(manifest, firstTemporary);
    await link(manifest, secondTemporary);
    await expectWorkspaceError(applyWorkspacePlan(input), "WORKSPACE_RECOVERY_REQUIRED");
    assert.equal(await exists(firstTemporary), true);
    assert.equal(await exists(secondTemporary), true);
    await Promise.all([unlink(firstTemporary), unlink(secondTemporary)]);
  }

  {
    const root = await newRoot(temporaryBase, "input-snapshot");
    const input = makeInput(root, STANDARD_FILES);
    const originalPlanId = input.plan.planId;
    const originalPackId = input.plan.pack.packId;
    const applying = applyWorkspacePlan(input);
    input.files[0]?.content.fill(0);
    const mutablePlan = input.plan as unknown as {
      planId: string;
      pack: { packId: string };
    };
    mutablePlan.planId = HASHES.planTwo;
    mutablePlan.pack.packId = "mutated-after-call";
    const result = await applying;
    assert.equal(result.manifest.planId, originalPlanId);
    assert.equal(result.manifest.pack.packId, originalPackId);
    assert.equal(await readFile(join(root, "build.gradle"), "utf8"), "plugins { id 'java' }\n");
  }

  {
    const root = await newRoot(temporaryBase, "late-conflict");
    await writeFile(join(root, "gradlew"), fileBytes(STANDARD_FILES[1] ?? assert.fail("missing fixture")), { mode: 0o755 });
    await expectWorkspaceError(applyWorkspacePlan(makeInput(root, STANDARD_FILES)), "WORKSPACE_CONFLICT");
    assert.equal(await exists(join(root, "build.gradle")), false, "preflight must find the last conflict before any output");
    assert.equal(await exists(join(root, WORKSPACE_STATE_DIRECTORY)), false, "preflight conflict must not create state");
    assert.equal(await exists(join(root, WORKSPACE_LOCK_FILE)), false);
  }

  {
    const outside = await newRoot(temporaryBase, "outside");
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(sentinel, "outside-safe\n");
    const invalidPaths = [
      "/absolute",
      "../escape",
      "a/../../escape",
      "a\\b",
      "C:/drive",
      ".mcdev/state.json",
      ".MCDEV/state.json",
      "nul",
      "a/COM1.txt",
      "a/trailing.",
    ];
    for (const [index, invalidPath] of invalidPaths.entries()) {
      const root = await newRoot(temporaryBase, `invalid-${index}`);
      await expectWorkspaceError(
        applyWorkspacePlan(makeInput(root, [{ path: invalidPath, mode: 420, content: "bad" }])),
        "WORKSPACE_INVALID",
        root,
      );
      assert.equal(await exists(join(root, WORKSPACE_STATE_DIRECTORY)), false, invalidPath);
      assert.equal(await readFile(sentinel, "utf8"), "outside-safe\n");
    }

    const collisionRoot = await newRoot(temporaryBase, "case-collision");
    await expectWorkspaceError(applyWorkspacePlan(makeInput(collisionRoot, [
      { path: "A.txt", mode: 420, content: "one" },
      { path: "a.txt", mode: 420, content: "two" },
    ])), "WORKSPACE_INVALID");

    const ancestorCollisionRoot = await newRoot(temporaryBase, "file-directory-collision");
    await expectWorkspaceError(applyWorkspacePlan(makeInput(ancestorCollisionRoot, [
      { path: "a", mode: 420, content: "file" },
      { path: "a/b", mode: 420, content: "child" },
    ])), "WORKSPACE_INVALID");
    assert.equal(
      await exists(join(ancestorCollisionRoot, WORKSPACE_STATE_DIRECTORY)),
      false,
      "impossible file/directory trees must fail before state creation",
    );

    const directoryCaseRoot = await newRoot(temporaryBase, "directory-case-collision");
    await expectWorkspaceError(applyWorkspacePlan(makeInput(directoryCaseRoot, [
      { path: "A/x", mode: 420, content: "upper directory" },
      { path: "a/y", mode: 420, content: "lower directory" },
    ])), "WORKSPACE_INVALID");
    assert.equal(await exists(join(directoryCaseRoot, WORKSPACE_STATE_DIRECTORY)), false);

    const accessorRoot = await newRoot(temporaryBase, "input-accessor");
    const accessorInput = makeInput(accessorRoot, STANDARD_FILES);
    let inputAccessorCalls = 0;
    Object.defineProperty(accessorInput.files, "0", {
      enumerable: true,
      get(): never {
        inputAccessorCalls += 1;
        throw new Error("workspace input accessor executed");
      },
    });
    await expectWorkspaceError(applyWorkspacePlan(accessorInput), "WORKSPACE_INVALID");
    assert.equal(inputAccessorCalls, 0, "workspace validation must not execute file-array accessors");
    assert.equal(await exists(join(accessorRoot, WORKSPACE_STATE_DIRECTORY)), false);

    const planAccessorRoot = await newRoot(temporaryBase, "plan-accessor");
    const planAccessorInput = makeInput(planAccessorRoot, STANDARD_FILES);
    const mutableNodes = planAccessorInput.plan.nodes as unknown as Record<string, unknown>[];
    const firstNode = mutableNodes[0] ?? assert.fail("missing plan node");
    let planAccessorCalls = 0;
    Object.defineProperty(firstNode, "kind", {
      configurable: true,
      enumerable: true,
      get(): never {
        planAccessorCalls += 1;
        throw new Error("workspace plan accessor executed");
      },
    });
    await expectWorkspaceError(applyWorkspacePlan(planAccessorInput), "WORKSPACE_INVALID");
    assert.equal(planAccessorCalls, 0, "workspace validation must not execute build-plan accessors");
    assert.equal(await exists(join(planAccessorRoot, WORKSPACE_STATE_DIRECTORY)), false);

    const proxyRoot = await newRoot(temporaryBase, "input-proxy");
    let proxyTrapCalls = 0;
    const proxiedInput = new Proxy(makeInput(proxyRoot, STANDARD_FILES), {
      ownKeys(): never {
        proxyTrapCalls += 1;
        throw new Error("workspace input proxy trap executed");
      },
    });
    await expectWorkspaceError(applyWorkspacePlan(proxiedInput), "WORKSPACE_INVALID");
    assert.equal(proxyTrapCalls, 0, "workspace validation must reject proxies without invoking traps");
    assert.equal(await exists(join(proxyRoot, WORKSPACE_STATE_DIRECTORY)), false);

    const cyclicRoot = await newRoot(temporaryBase, "cyclic-plan");
    const cyclicInput = makeInput(cyclicRoot, STANDARD_FILES);
    Object.defineProperty(cyclicInput.plan, "cycle", {
      configurable: true,
      enumerable: true,
      value: cyclicInput.plan,
      writable: true,
    });
    await expectWorkspaceError(applyWorkspacePlan(cyclicInput), "WORKSPACE_INVALID");
    assert.equal(await exists(join(cyclicRoot, WORKSPACE_STATE_DIRECTORY)), false);

    const sharedRoot = await newRoot(temporaryBase, "shared-content");
    const sharedInput = makeInput(sharedRoot, [STANDARD_FILES[0] ?? assert.fail()]);
    const expectedContent = sharedInput.files[0]?.content;
    assert.ok(expectedContent !== undefined);
    const sharedContent = new Uint8Array(new SharedArrayBuffer(expectedContent.byteLength));
    sharedContent.set(expectedContent);
    let sharedBufferGetterCalls = 0;
    Object.defineProperty(sharedContent, "buffer", {
      get(): never {
        sharedBufferGetterCalls += 1;
        throw new Error("workspace content buffer getter executed");
      },
    });
    await expectWorkspaceError(applyWorkspacePlan({
      ...sharedInput,
      files: [{ ...sharedInput.files[0] as WorkspaceFileInput, content: sharedContent }],
    }), "WORKSPACE_INVALID");
    assert.equal(sharedBufferGetterCalls, 0, "workspace validation must use TypedArray intrinsics");
    assert.equal(await exists(join(sharedRoot, WORKSPACE_STATE_DIRECTORY)), false);

    const dependencyRoot = await newRoot(temporaryBase, "dependency-accessor");
    let dependencyGetterCalls = 0;
    const dependencyAccessor = Object.defineProperty({}, "checkpoint", {
      enumerable: true,
      get(): never {
        dependencyGetterCalls += 1;
        throw new Error("workspace dependency accessor executed");
      },
    });
    await expectWorkspaceError(
      applyWorkspacePlan(
        makeInput(dependencyRoot, [STANDARD_FILES[0] ?? assert.fail()]),
        dependencyAccessor,
      ),
      "WORKSPACE_INVALID",
    );
    assert.equal(dependencyGetterCalls, 0, "workspace dependency validation must not execute accessors");
    assert.equal(await exists(join(dependencyRoot, WORKSPACE_STATE_DIRECTORY)), false);

    const ancestorRoot = await newRoot(temporaryBase, "symlink-ancestor");
    await symlink(outside, join(ancestorRoot, "src"), "dir");
    await expectWorkspaceError(applyWorkspacePlan(makeInput(ancestorRoot, [
      { path: "src/generated.txt", mode: 420, content: "must-not-escape" },
    ])), "WORKSPACE_INVALID");
    assert.equal(await exists(join(outside, "generated.txt")), false);
    assert.equal(await readFile(sentinel, "utf8"), "outside-safe\n");

    const existingCaseRoot = await newRoot(temporaryBase, "existing-case-collision");
    await mkdir(join(existingCaseRoot, "SRC"));
    await expectWorkspaceError(applyWorkspacePlan(makeInput(existingCaseRoot, [
      { path: "src/generated.txt", mode: 420, content: "case-safe" },
    ])), "WORKSPACE_CONFLICT");
    assert.equal(await exists(join(existingCaseRoot, "src")), false);

    const targetRoot = await newRoot(temporaryBase, "symlink-target");
    await symlink(sentinel, join(targetRoot, "build.gradle"));
    await expectWorkspaceError(applyWorkspacePlan(makeInput(targetRoot, [STANDARD_FILES[0] ?? assert.fail()])), "WORKSPACE_INVALID");
    assert.equal(await readFile(sentinel, "utf8"), "outside-safe\n");

    const stateRoot = await newRoot(temporaryBase, "symlink-state");
    await symlink(outside, join(stateRoot, WORKSPACE_STATE_DIRECTORY), "dir");
    await expectWorkspaceError(applyWorkspacePlan(makeInput(stateRoot, STANDARD_FILES)), "WORKSPACE_INVALID");
    assert.equal(await readFile(sentinel, "utf8"), "outside-safe\n");

    const realRoot = await newRoot(temporaryBase, "real-root");
    const linkedRoot = join(temporaryBase, "linked-root");
    await symlink(realRoot, linkedRoot, "dir");
    await expectWorkspaceError(applyWorkspacePlan(makeInput(linkedRoot, STANDARD_FILES)), "WORKSPACE_INVALID", linkedRoot);
    await expectWorkspaceError(
      applyWorkspacePlan(makeInput(`${realRoot}/../real-root`, STANDARD_FILES)),
      "WORKSPACE_INVALID",
      `${realRoot}/../real-root`,
    );
  }

  {
    const root = await newRoot(temporaryBase, "managed-modified");
    const input = makeInput(root, STANDARD_FILES);
    await applyWorkspacePlan(input);
    await writeFile(join(root, "build.gradle"), "user modification\n");
    await expectWorkspaceError(applyWorkspacePlan(input), "WORKSPACE_MANAGED_FILE_MODIFIED");
    assert.equal(await readFile(join(root, "build.gradle"), "utf8"), "user modification\n");
    await expectWorkspaceError(
      applyWorkspacePlan(makeInput(root, STANDARD_FILES, HASHES.planTwo)),
      "WORKSPACE_CONFLICT",
    );
  }

  {
    const root = await newRoot(temporaryBase, "tampered-cas");
    const input = makeInput(root, STANDARD_FILES);
    await applyWorkspacePlan(input);
    const expected = input.files[0];
    assert.ok(expected !== undefined);
    const casFile = join(root, WORKSPACE_STATE_DIRECTORY, "cas", "sha256", digest(expected.content));
    await chmod(casFile, 0o644);
    await expectWorkspaceError(applyWorkspacePlan(input), "CAS_INTEGRITY_FAILED");
    await chmod(casFile, 0o600);
    await writeFile(casFile, "tampered CAS bytes");
    await expectWorkspaceError(applyWorkspacePlan(input), "CAS_INTEGRITY_FAILED");
    assert.equal(await readFile(join(root, expected.path), "utf8"), "plugins { id 'java' }\n");

    await unlink(casFile);
    const outside = join(root, "outside-cas-target");
    await writeFile(outside, expected.content);
    await symlink(outside, casFile);
    await expectWorkspaceError(applyWorkspacePlan(input), "CAS_INTEGRITY_FAILED");
    assert.deepEqual(await readFile(outside), Buffer.from(expected.content));
  }

  {
    const root = await newRoot(temporaryBase, "busy-lock");
    await writeFile(join(root, WORKSPACE_LOCK_FILE), "held\n", { mode: 0o600 });
    await expectWorkspaceError(applyWorkspacePlan(makeInput(root, STANDARD_FILES)), "WORKSPACE_BUSY");
    assert.equal(await exists(join(root, "build.gradle")), false);
  }

  {
    const root = await newRoot(temporaryBase, "bounded-state-read");
    const state = join(root, WORKSPACE_STATE_DIRECTORY);
    const oversizedJournal = join(state, "workspace-journal.json");
    await mkdir(state, { mode: 0o700 });
    await writeFile(
      oversizedJournal,
      Buffer.alloc(CONTRACT_LIMITS.logOrJournalRecordBytes + 1, 0x20),
      { mode: 0o600 },
    );
    await expectWorkspaceError(recoverWorkspace({ workspaceRoot: root }), "WORKSPACE_RECOVERY_REQUIRED");
    assert.equal(await exists(join(root, WORKSPACE_LOCK_FILE)), false);
    await unlink(oversizedJournal);
    assert.equal((await recoverWorkspace({ workspaceRoot: root })).status, "noop");
  }

  {
    const root = await newRoot(temporaryBase, "unsafe-state-directory-mode");
    const state = join(root, WORKSPACE_STATE_DIRECTORY);
    await mkdir(state, { mode: 0o700 });
    await chmod(state, 0o777);
    await expectWorkspaceError(applyWorkspacePlan(makeInput(root, STANDARD_FILES)), "WORKSPACE_INVALID");
    assert.equal(await exists(join(state, "cas")), false);
  }

  {
    const root = await newRoot(temporaryBase, "ownership-api-unavailable");
    const descriptor = Object.getOwnPropertyDescriptor(process, "geteuid");
    Object.defineProperty(process, "geteuid", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      await expectWorkspaceError(applyWorkspacePlan(makeInput(root, STANDARD_FILES)), "WORKSPACE_INVALID");
    } finally {
      if (descriptor === undefined) delete (process as { geteuid?: unknown }).geteuid;
      else Object.defineProperty(process, "geteuid", descriptor);
    }
    assert.equal(await exists(join(root, WORKSPACE_STATE_DIRECTORY)), false);
  }

  {
    const root = await newRoot(temporaryBase, "unsafe-cas-directory-mode");
    const state = join(root, WORKSPACE_STATE_DIRECTORY);
    const cas = join(state, "cas");
    await mkdir(join(cas, "sha256"), { recursive: true, mode: 0o700 });
    await chmod(cas, 0o777);
    await expectWorkspaceError(
      applyWorkspacePlan(makeInput(root, STANDARD_FILES)),
      "CAS_INTEGRITY_FAILED",
    );
    assert.equal(await exists(join(root, "build.gradle")), false);
  }

  {
    const root = await newRoot(temporaryBase, "unsafe-state-directory-owner");
    const state = join(root, WORKSPACE_STATE_DIRECTORY);
    await mkdir(state, { mode: 0o700 });
    const original = await stat(state, { bigint: true });
    let ownershipChanged = false;
    try {
      await chown(state, Number(original.uid) + 1, Number(original.gid));
      ownershipChanged = true;
      await expectWorkspaceError(applyWorkspacePlan(makeInput(root, STANDARD_FILES)), "WORKSPACE_INVALID");
    } catch (error) {
      assert.ok(
        error instanceof WorkspaceApplyError ||
          (error instanceof Error && "code" in error &&
            ["EACCES", "EINVAL", "ENOSYS", "ENOTSUP", "EPERM"].includes(String(error.code))),
        `unexpected ownership probe result: ${String(error)}`,
      );
    } finally {
      if (ownershipChanged) await chown(state, Number(original.uid), Number(original.gid));
    }
  }

  {
    const root = await newRoot(temporaryBase, "world-writable-journal");
    const input = makeInput(root, STANDARD_FILES);
    await assert.rejects(
      applyWorkspacePlan(input, {
        checkpoint: (event) => {
          if (event.point === "output-materialized") throw new WorkspaceFaultInjectionError(event);
        },
      }),
      WorkspaceFaultInjectionError,
    );
    const firstPath = input.files[0]?.path ?? assert.fail("missing fixture");
    const journal = join(root, WORKSPACE_STATE_DIRECTORY, "workspace-journal.json");
    await chmod(journal, 0o666);
    await expectWorkspaceError(recoverWorkspace({ workspaceRoot: root }), "WORKSPACE_RECOVERY_REQUIRED");
    assert.equal(await exists(join(root, firstPath)), true, "an unsafe WAL must not authorize deletion");
  }

  {
    const root = await newRoot(temporaryBase, "concurrent-lock");
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolvePromise) => {
      enteredResolve = resolvePromise;
    });
    const release = new Promise<void>((resolvePromise) => {
      releaseResolve = resolvePromise;
    });
    const first = applyWorkspacePlan(makeInput(root, STANDARD_FILES), {
      checkpoint: async (event) => {
        if (event.point === "preflight-complete") {
          enteredResolve?.();
          await release;
        }
      },
    });
    await entered;
    await expectWorkspaceError(applyWorkspacePlan(makeInput(root, STANDARD_FILES)), "WORKSPACE_BUSY");
    releaseResolve?.();
    assert.equal((await first).status, "created");
  }

  {
    const root = await newRoot(temporaryBase, "exclusive-target-race");
    const input = makeInput(root, STANDARD_FILES);
    await expectWorkspaceError(applyWorkspacePlan(input, {
      checkpoint: async (event) => {
        if (event.point === "journal-prepared") {
          assert.equal(await exists(join(root, WORKSPACE_STATE_DIRECTORY, "workspace-journal.json")), true);
          assert.equal(await exists(join(root, "build.gradle")), false, "WAL must precede target materialization");
          assert.equal(await exists(join(root, "gradlew")), false, "WAL must precede every target");
          await writeFile(join(root, "build.gradle"), "racer-owned\n", { flag: "wx" });
        }
      },
    }), "WORKSPACE_CONFLICT");
    assert.equal(await readFile(join(root, "build.gradle"), "utf8"), "racer-owned\n");
    await expectWorkspaceError(recoverWorkspace({ workspaceRoot: root }), "WORKSPACE_RECOVERY_REQUIRED");
    assert.equal(await readFile(join(root, "build.gradle"), "utf8"), "racer-owned\n");
  }

  {
    const root = await newRoot(temporaryBase, "exclusive-directory-race");
    const input = makeInput(root, [{
      path: "src/main/Generated.java",
      mode: 420,
      content: "final class Generated {}\n",
    }]);
    await expectWorkspaceError(applyWorkspacePlan(input, {
      checkpoint: async (event) => {
        if (event.point === "journal-prepared") await mkdir(join(root, "src"));
      },
    }), "WORKSPACE_CONFLICT");
    assert.equal((await recoverWorkspace({ workspaceRoot: root })).status, "recovered");
    assert.equal(await exists(join(root, "src")), true, "recovery must preserve a raced empty directory");
  }

  {
    const root = await newRoot(temporaryBase, "state-create-only-race");
    const attackerJournal = "attacker-owned state\n";
    let installed = false;
    await expectWorkspaceError(applyWorkspacePlan(makeInput(root, STANDARD_FILES), {
      checkpoint: async (event) => {
        if (!installed && event.point === "cas-object-committed") {
          installed = true;
          await writeFile(
            join(root, WORKSPACE_STATE_DIRECTORY, "workspace-journal.json"),
            attackerJournal,
            { flag: "wx", mode: 0o600 },
          );
        }
      },
    }), "WORKSPACE_RECOVERY_REQUIRED");
    assert.equal(
      await readFile(join(root, WORKSPACE_STATE_DIRECTORY, "workspace-journal.json"), "utf8"),
      attackerJournal,
      "state publication must never replace a raced destination",
    );
    assert.equal(await exists(join(root, "build.gradle")), false);
  }

  {
    const recordingRoot = await newRoot(temporaryBase, "checkpoint-recording");
    const checkpoints: WorkspaceFaultEvent[] = [];
    await applyWorkspacePlan(makeInput(recordingRoot, STANDARD_FILES), {
      checkpoint: (event) => {
        checkpoints.push(event);
      },
    });
    assert.ok(checkpoints.length >= 8, "apply must expose every durable fault boundary");

    for (const checkpointNumber of checkpoints.map((event) => event.sequence)) {
      const root = await newRoot(temporaryBase, `fault-${checkpointNumber}`);
      let injected: WorkspaceFaultInjectionError | undefined;
      try {
        await applyWorkspacePlan(makeInput(root, STANDARD_FILES), {
          checkpoint: (event) => {
            if (event.sequence === checkpointNumber) throw new WorkspaceFaultInjectionError(event);
          },
        });
      } catch (error) {
        assert.ok(error instanceof WorkspaceFaultInjectionError);
        injected = error;
      }
      assert.ok(injected !== undefined, `checkpoint ${checkpointNumber} did not inject`);
      const recovery = await recoverWorkspace({ workspaceRoot: root });
      assert.ok(["noop", "recovered", "committed"].includes(recovery.status));
      const finalApply = await applyWorkspacePlan(makeInput(root, STANDARD_FILES));
      assert.ok(finalApply.status === "created" || finalApply.status === "noop");
      await assertStandardOutputs(root);
      assert.equal(await exists(join(root, WORKSPACE_LOCK_FILE)), false);
      assert.equal(await exists(join(root, WORKSPACE_STATE_DIRECTORY, "workspace-journal.json")), false);
    }
  }

  {
    const root = await newRoot(temporaryBase, "recovery-modified");
    const input = makeInput(root, STANDARD_FILES);
    await assert.rejects(
      applyWorkspacePlan(input, {
        checkpoint: (event) => {
          if (event.point === "output-materialized") throw new WorkspaceFaultInjectionError(event);
        },
      }),
      WorkspaceFaultInjectionError,
    );
    const firstPath = input.files[0]?.path;
    assert.ok(firstPath !== undefined);
    const interruptedJournal = JSON.parse(await readFile(
      join(root, WORKSPACE_STATE_DIRECTORY, "workspace-journal.json"),
      "utf8",
    )) as { createdPaths?: unknown };
    assert.deepEqual(interruptedJournal.createdPaths, [firstPath], "WAL must persist exact created-path progress");
    await writeFile(join(root, firstPath), "modified after interrupted apply\n");
    await expectWorkspaceError(recoverWorkspace({ workspaceRoot: root }), "WORKSPACE_RECOVERY_REQUIRED");
    assert.equal(await readFile(join(root, firstPath), "utf8"), "modified after interrupted apply\n");
  }

  {
    const root = await newRoot(temporaryBase, "recovery-owned-only");
    const outside = await newRoot(temporaryBase, "recovery-outside");
    const outsideSentinel = join(outside, "sentinel.txt");
    const unmanaged = join(root, "unmanaged.txt");
    await Promise.all([writeFile(outsideSentinel, "outside-safe\n"), writeFile(unmanaged, "unmanaged-safe\n")]);
    await assert.rejects(
      applyWorkspacePlan(makeInput(root, STANDARD_FILES), {
        checkpoint: (event) => {
          if (event.point === "output-materialized") throw new WorkspaceFaultInjectionError(event);
        },
      }),
      WorkspaceFaultInjectionError,
    );
    const recovery = await recoverWorkspace({ workspaceRoot: root });
    assert.equal(recovery.status, "recovered");
    assert.equal(await exists(join(root, "build.gradle")), false);
    assert.equal(await readFile(unmanaged, "utf8"), "unmanaged-safe\n");
    assert.equal(await readFile(outsideSentinel, "utf8"), "outside-safe\n");
  }

  {
    const root = await newRoot(temporaryBase, "nested-recovery");
    const nestedInput = makeInput(root, [{
      path: "src/main/java/Generated.java",
      mode: 420,
      content: "final class Generated {}\n",
    }]);
    await assert.rejects(
      applyWorkspacePlan(nestedInput, {
        checkpoint: (event) => {
          if (event.point === "output-materialized") throw new WorkspaceFaultInjectionError(event);
        },
      }),
      WorkspaceFaultInjectionError,
    );
    assert.equal((await recoverWorkspace({ workspaceRoot: root })).status, "recovered");
    assert.equal(await exists(join(root, "src")), false, "recovery removes only journal-recorded empty directories");
  }

  {
    const root = await newRoot(temporaryBase, "state-cleanliness");
    await applyWorkspacePlan(makeInput(root, STANDARD_FILES));
    const stateEntries = await readdir(join(root, WORKSPACE_STATE_DIRECTORY));
    assert.deepEqual(stateEntries.sort(), ["cas", "workspace-manifest.json"]);
    const manifest = JSON.parse(await readFile(
      join(root, WORKSPACE_STATE_DIRECTORY, "workspace-manifest.json"),
      "utf8",
    )) as { planId?: unknown; pack?: unknown };
    assert.equal(manifest.planId, HASHES.plan);
    assert.deepEqual(manifest.pack, {
      packId: "neoforge-26.1.2-java-25",
      revision: 1,
      treeSha256: HASHES.pack,
    });
  }
} finally {
  await rm(temporaryBase, { recursive: true, force: true });
}
