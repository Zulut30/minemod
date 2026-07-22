import { isProxy } from "node:util/types";
import { createArtifactIndex, type ArtifactSource } from "@mcdev/artifacts";
import {
  createFabricPhase1BuildRunner,
  type BuildRunnerResult,
  type FabricBuildRunnerConfig,
  type FabricPhase1BuildRunner,
} from "@mcdev/build-runner";
import {
  compileFabricPhase1,
  type CompiledFabricProject,
} from "@mcdev/compiler-fabric";
import {
  isPlainJsonObject,
  type ArtifactIndex,
  type BuildPlan,
} from "@mcdev/contracts";
import {
  applyWorkspacePlan,
  type WorkspaceApplyInput,
  type WorkspaceApplyResult,
} from "@mcdev/workspace";

export interface FabricBuildRequest {
  readonly payload: string;
  readonly workspaceRoot: string;
}

export interface FabricBuildResult {
  readonly planId: string;
  readonly workspaceStatus: WorkspaceApplyResult["status"];
  readonly artifacts: ArtifactIndex;
}

export interface FabricApplication {
  build(request: FabricBuildRequest): Promise<FabricBuildResult>;
}

export interface FabricApplicationDependencies {
  readonly compile: (payload: string) => Promise<CompiledFabricProject>;
  readonly applyWorkspace: (input: WorkspaceApplyInput) => Promise<WorkspaceApplyResult>;
  readonly createRunner: (config: FabricBuildRunnerConfig) => FabricPhase1BuildRunner;
  readonly indexArtifacts: typeof createArtifactIndex;
}

export const DEFAULT_FABRIC_APPLICATION_DEPENDENCIES: FabricApplicationDependencies = Object.freeze({
  compile: compileFabricPhase1,
  applyWorkspace: applyWorkspacePlan,
  createRunner: createFabricPhase1BuildRunner,
  indexArtifacts: createArtifactIndex,
});

function closedStringObject(value: unknown, keys: readonly string[]): Record<string, string> | undefined {
  if (isProxy(value) || !isPlainJsonObject(value)) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return undefined;
  const actual = (ownKeys as string[]).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, string> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor) ||
      typeof descriptor.value !== "string") return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function buildArtifactSources(
  compiled: CompiledFabricProject,
  build: BuildRunnerResult,
): readonly ArtifactSource[] {
  const generated: ArtifactSource[] = compiled.outputs.map(({ artifactKind, file }) => ({
    path: file.path,
    mode: file.mode,
    bytes: file.bytes,
    kind: artifactKind,
    provenance: file.origin === "pack" ? "pack" : "generator",
  }));
  const built: ArtifactSource[] = build.outputs.entries.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    bytes: build.outputs.readFile(entry.path),
    kind: entry.kind,
    provenance: entry.provenance,
  }));
  return Object.freeze([...generated, ...built]);
}

function workspaceInput(
  workspaceRoot: string,
  plan: BuildPlan,
  compiled: CompiledFabricProject,
): WorkspaceApplyInput {
  return {
    workspaceRoot,
    plan,
    files: compiled.outputs.map(({ file }) => ({
      path: file.path,
      mode: file.mode,
      content: file.bytes,
    })),
  };
}

export function createFabricApplication(
  configValue: FabricBuildRunnerConfig,
  dependencies: FabricApplicationDependencies = DEFAULT_FABRIC_APPLICATION_DEPENDENCIES,
): FabricApplication {
  const config = closedStringObject(configValue, ["java17Home", "artifactCacheRoot"]);
  if (config === undefined) throw new TypeError("Fabric application configuration must use the closed data shape.");
  const runner = dependencies.createRunner({
    java17Home: config.java17Home ?? "",
    artifactCacheRoot: config.artifactCacheRoot ?? "",
  });
  return Object.freeze({
    build: async (requestValue: FabricBuildRequest): Promise<FabricBuildResult> => {
      const request = closedStringObject(requestValue, ["payload", "workspaceRoot"]);
      if (request === undefined) throw new TypeError("Fabric build request must use the closed data shape.");
      const payload = request.payload ?? "";
      const workspaceRoot = request.workspaceRoot ?? "";
      const compiled = await dependencies.compile(payload);
      const applied = await dependencies.applyWorkspace(workspaceInput(workspaceRoot, compiled.plan, compiled));
      const built = await runner.run({ workspaceRoot, plan: compiled.plan, manifest: applied.manifest });
      const artifacts = dependencies.indexArtifacts({
        planId: compiled.plan.planId,
        pack: compiled.plan.pack,
        sources: buildArtifactSources(compiled, built),
      });
      return Object.freeze({
        planId: compiled.plan.planId,
        workspaceStatus: applied.status,
        artifacts,
      });
    },
  });
}
