import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactIndex } from "@mcdev/artifacts";
import type {
  BuildRunnerResult,
  BuildRunnerRunInput,
  FabricPhase1BuildRunner,
} from "@mcdev/build-runner";
import { compileFabricPhase1, type CompiledFabricProject } from "@mcdev/compiler-fabric";
import { applyWorkspacePlan } from "@mcdev/workspace";
import { fabricBasicContentFixture } from "../../fixtures/specs/fabric-basic-content.ts";
import {
  createFabricApplication,
  type FabricApplicationDependencies,
} from "./index.ts";

const jarBytes = Buffer.from("fabric application jar", "utf8");
const jarSha256 = createHash("sha256").update(jarBytes).digest("hex");

function dependencies(overrides: Partial<FabricApplicationDependencies> = {}): FabricApplicationDependencies {
  return {
    compile: compileFabricPhase1,
    applyWorkspace: applyWorkspacePlan,
    createRunner: (): FabricPhase1BuildRunner => Object.freeze({
      run: async ({ workspaceRoot, plan, manifest }: BuildRunnerRunInput): Promise<BuildRunnerResult> => {
        assert.equal(manifest.planId, plan.planId);
        assert.equal(
          await readFile(join(workspaceRoot, "src/main/resources/fabric.mod.json"), "utf8")
            .then((text) => text.includes("infectedfrontier")),
          true,
        );
        const entry = Object.freeze({
          path: "build/libs/infectedfrontier-0.1.0.jar" as const,
          mode: 420 as const,
          size: jarBytes.byteLength,
          sha256: jarSha256,
          kind: "build-output" as const,
          provenance: "build" as const,
        });
        return Object.freeze({
          nodeId: "gradle-clean-build" as const,
          outputs: Object.freeze({
            entries: Object.freeze([entry]),
            readFile: (path: unknown): Uint8Array => {
              assert.equal(path, entry.path);
              return new Uint8Array(jarBytes);
            },
          }),
        });
      },
    }),
    indexArtifacts: createArtifactIndex,
    ...overrides,
  };
}

const root = await mkdtemp(join(tmpdir(), "mcdev-fabric-application-"));
try {
  let compiled: CompiledFabricProject | undefined;
  const app = createFabricApplication({
    java17Home: "/fixed/jdk-17",
    artifactCacheRoot: "/fixed/artifact-cache",
  }, dependencies({
    compile: async (payload) => {
      compiled = await compileFabricPhase1(payload);
      return compiled;
    },
  }));
  const result = await app.build({
    payload: JSON.stringify(fabricBasicContentFixture()),
    workspaceRoot: root,
  });
  assert.ok(compiled !== undefined);
  assert.equal(result.planId, compiled.plan.planId);
  assert.equal(result.workspaceStatus, "created");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.artifacts.entries.length, compiled.outputs.length + 1);
  assert.deepEqual(result.artifacts.entries.at(-1), {
    path: "src/main/resources/fabric.mod.json",
    mode: 420,
    size: compiled.outputs.find(({ file }) => file.path === "src/main/resources/fabric.mod.json")?.file.bytes.byteLength,
    sha256: compiled.outputs.find(({ file }) => file.path === "src/main/resources/fabric.mod.json")?.file.sha256,
    kind: "template",
    provenance: "generator",
  });
  const jar = result.artifacts.entries.find(({ path }) => path === "build/libs/infectedfrontier-0.1.0.jar");
  assert.deepEqual(jar, {
    path: "build/libs/infectedfrontier-0.1.0.jar",
    mode: 420,
    size: jarBytes.byteLength,
    sha256: jarSha256,
    kind: "build-output",
    provenance: "build",
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

{
  const app = createFabricApplication({
    java17Home: "/fixed/jdk-17",
    artifactCacheRoot: "/fixed/artifact-cache",
  }, dependencies());
  let getterCalls = 0;
  const hostile = Object.defineProperty({ payload: "{}" }, "workspaceRoot", {
    enumerable: true,
    get(): string {
      getterCalls += 1;
      return "/must/not/read";
    },
  });
  await assert.rejects(
    app.build(hostile as unknown as Parameters<typeof app.build>[0]),
    TypeError,
  );
  assert.equal(getterCalls, 0);
}

{
  let indexCalls = 0;
  const runnerFailure = new Error("fixed runner failed");
  const app = createFabricApplication({
    java17Home: "/fixed/jdk-17",
    artifactCacheRoot: "/fixed/artifact-cache",
  }, dependencies({
    createRunner: () => ({ run: async () => Promise.reject(runnerFailure) }),
    indexArtifacts: (input) => {
      indexCalls += 1;
      return createArtifactIndex(input);
    },
  }));
  const failureRoot = await mkdtemp(join(tmpdir(), "mcdev-fabric-application-failure-"));
  try {
    await assert.rejects(app.build({
      payload: JSON.stringify(fabricBasicContentFixture()),
      workspaceRoot: failureRoot,
    }), runnerFailure);
    assert.equal(indexCalls, 0, "failed builds must never be indexed as successful artifacts");
  } finally {
    await rm(failureRoot, { recursive: true, force: true });
  }
}
