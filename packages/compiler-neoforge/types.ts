import type { BuildPlan } from "@mcdev/contracts";
import type { GeneratedFile } from "@mcdev/codegen-core";

export type CompilerNodeId = "generate-content" | "generate-project";
export type CompiledArtifactKind = "resource" | "source" | "template";

export interface CompiledOutput {
  readonly file: GeneratedFile;
  readonly nodeId: CompilerNodeId;
  readonly artifactKind: CompiledArtifactKind;
}

export interface CompiledNeoForgeProject {
  readonly plan: BuildPlan;
  readonly outputs: readonly CompiledOutput[];
}
