import {
  BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  BuiltinPackIntegrityError,
  loadBuiltinCompatibilityPack,
} from "@mcdev/compatibility-packs";
import { validateInlineSpec } from "@mcdev/validation";
import { compileVerifiedNeoForgePhase1 } from "./compiler.ts";
import { boundedMcdevError, CompilerError, compilerError } from "./errors.ts";
import type { CompiledNeoForgeProject } from "./types.ts";

function packFailure(error: BuiltinPackIntegrityError): CompilerError {
  const code = error.code === "BUILTIN_PACK_NOT_FOUND" ? "PACK_NOT_FOUND" : "PACK_INTEGRITY_FAILED";
  return compilerError(code, code === "PACK_NOT_FOUND"
    ? "The exact built-in NeoForge compatibility pack is unavailable."
    : "The built-in NeoForge compatibility pack failed integrity verification.");
}

export async function compileNeoForgePhase1(payload: string): Promise<CompiledNeoForgeProject> {
  if (typeof payload !== "string") {
    throw compilerError("INVALID_REQUEST", "NeoForge compiler payload must be an inline JSON string.");
  }

  // This is deliberately the single validation boundary. It returns a detached
  // JSON graph, applies all hostile-input limits, and pins the exact Phase-1 target.
  const validation = validateInlineSpec(
    payload,
    "mod",
    { profile: "neoforge-26.1.2-java-25" },
  );
  if (!validation.valid || validation.kind !== "mod" || validation.value?.kind !== "mod") {
    const errors = validation.diagnostics.map((diagnostic) => boundedMcdevError(
      "SPEC_INVALID",
      diagnostic.message,
      diagnostic.path,
    ));
    throw new CompilerError(
      "SPEC_INVALID",
      errors.length === 0
        ? [boundedMcdevError("SPEC_INVALID", "The ModSpec is invalid for the Phase-1 NeoForge target.")]
        : errors,
    );
  }

  try {
    const pack = await loadBuiltinCompatibilityPack(BUILTIN_NEOFORGE_26_1_2_SELECTOR);
    return compileVerifiedNeoForgePhase1(validation.value, pack);
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    if (error instanceof BuiltinPackIntegrityError) throw packFailure(error);
    throw compilerError("INTERNAL_ERROR", "NeoForge compilation failed safely.");
  }
}

export { CompilerError } from "./errors.ts";
export type {
  CompiledArtifactKind,
  CompiledNeoForgeProject,
  CompiledOutput,
  CompilerNodeId,
} from "./types.ts";
