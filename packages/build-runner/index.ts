import {
  DEFAULT_RUNNER_DEPENDENCIES,
  createFabricPhase1BuildRunnerWithDependencies,
  createNeoForgePhase1BuildRunnerWithDependencies,
} from "./internal.ts";

export {
  BUILD_RUNNER_LIMITS,
  BuildRunnerError,
  type BuildOutputEntry,
  type BuildRunnerConfig,
  type BuildRunnerErrorCode,
  type BuildRunnerOutputs,
  type BuildRunnerResult,
  type BuildRunnerRunInput,
  type FabricBuildRunnerConfig,
  type FabricPhase1BuildRunner,
  type NeoForgePhase1BuildRunner,
} from "./internal.ts";

export function createNeoForgePhase1BuildRunner(
  config: import("./internal.ts").BuildRunnerConfig,
): import("./internal.ts").NeoForgePhase1BuildRunner {
  return createNeoForgePhase1BuildRunnerWithDependencies(config, DEFAULT_RUNNER_DEPENDENCIES);
}

export function createFabricPhase1BuildRunner(
  config: import("./internal.ts").FabricBuildRunnerConfig,
): import("./internal.ts").FabricPhase1BuildRunner {
  return createFabricPhase1BuildRunnerWithDependencies(config, DEFAULT_RUNNER_DEPENDENCIES);
}
