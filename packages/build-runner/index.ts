import {
  DEFAULT_RUNNER_DEPENDENCIES,
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
  type NeoForgePhase1BuildRunner,
} from "./internal.ts";

export function createNeoForgePhase1BuildRunner(
  config: import("./internal.ts").BuildRunnerConfig,
): import("./internal.ts").NeoForgePhase1BuildRunner {
  return createNeoForgePhase1BuildRunnerWithDependencies(config, DEFAULT_RUNNER_DEPENDENCIES);
}
