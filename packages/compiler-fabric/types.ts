import type { GeneratedFile } from "@mcdev/codegen-core";
import type { BuildPlan } from "@mcdev/contracts";

export type FabricCompilerNodeId = "generate-content" | "generate-project";
export type FabricArtifactKind = "resource" | "source" | "template";

export interface CompiledFabricOutput {
  readonly file: GeneratedFile;
  readonly nodeId: FabricCompilerNodeId;
  readonly artifactKind: FabricArtifactKind;
}

export interface CompiledFabricProject {
  readonly plan: BuildPlan;
  readonly outputs: readonly CompiledFabricOutput[];
}
