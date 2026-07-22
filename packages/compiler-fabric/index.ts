import {
  BUILTIN_FABRIC_1_20_1_SELECTOR,
  BuiltinPackIntegrityError,
  loadBuiltinCompatibilityPack,
} from "@mcdev/compatibility-packs";
import { validateInlineSpec } from "@mcdev/validation";
import { compileVerifiedFabricPhase1 } from "./compiler.ts";
import {
  boundedFabricError,
  FabricCompilerError,
  fabricCompilerError,
} from "./errors.ts";
import type { CompiledFabricProject } from "./types.ts";

function packFailure(error: BuiltinPackIntegrityError): FabricCompilerError {
  const code = error.code === "BUILTIN_PACK_NOT_FOUND" ? "PACK_NOT_FOUND" : "PACK_INTEGRITY_FAILED";
  return fabricCompilerError(code, code === "PACK_NOT_FOUND"
    ? "The exact built-in Fabric 1.20.1 compatibility pack is unavailable."
    : "The built-in Fabric 1.20.1 compatibility pack failed integrity verification.");
}

export async function compileFabricPhase1(payload: string): Promise<CompiledFabricProject> {
  if (typeof payload !== "string") {
    throw fabricCompilerError("INVALID_REQUEST", "Fabric compiler payload must be an inline JSON string.");
  }
  const validation = validateInlineSpec(
    payload,
    "mod",
    { profile: "fabric-1.20.1-java-17" },
  );
  if (!validation.valid || validation.kind !== "mod" || validation.value?.kind !== "mod" ||
    validation.value.schemaVersion !== 1) {
    const errors = validation.diagnostics.map((diagnostic) => boundedFabricError(
      "SPEC_INVALID",
      diagnostic.message,
      diagnostic.path,
    ));
    throw new FabricCompilerError(
      "SPEC_INVALID",
      errors.length === 0
        ? [boundedFabricError(
          "SPEC_INVALID",
          "The Fabric 1.20.1 compiler requires a schemaVersion 1 ModSpec.",
          "/schemaVersion",
        )]
        : errors,
    );
  }

  try {
    const pack = await loadBuiltinCompatibilityPack(BUILTIN_FABRIC_1_20_1_SELECTOR);
    return compileVerifiedFabricPhase1(validation.value, pack);
  } catch (error) {
    if (error instanceof FabricCompilerError) throw error;
    if (error instanceof BuiltinPackIntegrityError) throw packFailure(error);
    throw fabricCompilerError("INTERNAL_ERROR", "Fabric compilation failed safely.");
  }
}

/** @deprecated Use compileFabricPhase1. Kept as a source-compatible scaffold alias. */
export const compileFabricPhase0 = compileFabricPhase1;

export { FabricCompilerError } from "./errors.ts";
export type {
  CompiledFabricOutput,
  CompiledFabricProject,
  FabricArtifactKind,
  FabricCompilerNodeId,
} from "./types.ts";
