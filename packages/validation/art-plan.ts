import { createHash } from "node:crypto";
import type { ArtSpecV1 } from "@mcdev/modspec";
import { validateInlineSpec, type ValidationResult } from "./index.ts";

export const MAX_ART_PLAN_BYTES = 262_144;
export interface ArtPlan {
  readonly contract: "mcdev.art-plan/v1";
  readonly sourceSha256: string;
  readonly id: string;
  readonly targetMatrix: ArtSpecV1["targetMatrix"];
  readonly assetClass: ArtSpecV1["assetClass"];
  readonly textureLayout: ArtSpecV1["textureLayout"];
  readonly modelIntent: ArtSpecV1["modelIntent"];
  readonly style: ArtSpecV1["style"];
  readonly budgets: ArtSpecV1["budgets"];
  readonly requiredCaptures: ArtSpecV1["targetContexts"];
  readonly status: {
    readonly specification: "validated";
    readonly generation: "not-run";
    readonly runtimeCapability: "not-verified";
    readonly artistic: "requires-human-review";
    readonly game: "not-run";
    readonly integration: "not-run";
  };
}
export interface ArtPlanResult {
  readonly valid: boolean;
  readonly diagnostics: ValidationResult["diagnostics"];
  readonly plan?: ArtPlan;
}

/** Один ограниченный inline-документ. Не читает файлы и не запускает генератор. */
export function createArtPlan(payload: string): ArtPlanResult {
  const result = validateInlineSpec(payload, "art");
  if (!result.valid) return { valid: false, diagnostics: result.diagnostics };
  const spec = result.value;
  if (spec?.kind !== "art" || spec.schemaVersion !== 1) {
    return { valid: false, diagnostics: [{ code: "SCHEMA_INVALID", path: "/schemaVersion", message: "An art plan requires ArtSpec v1; v0 is not implicitly migrated." }] };
  }
  const plan: ArtPlan = {
    contract: "mcdev.art-plan/v1", sourceSha256: createHash("sha256").update(payload, "utf8").digest("hex"),
    id: spec.id, targetMatrix: spec.targetMatrix, assetClass: spec.assetClass, textureLayout: spec.textureLayout,
    modelIntent: spec.modelIntent, style: spec.style, budgets: spec.budgets, requiredCaptures: spec.targetContexts,
    status: { specification: "validated", generation: "not-run", runtimeCapability: "not-verified", artistic: "requires-human-review", game: "not-run", integration: "not-run" },
  };
  if (Buffer.byteLength(JSON.stringify(plan), "utf8") > MAX_ART_PLAN_BYTES) {
    return { valid: false, diagnostics: [{ code: "PAYLOAD_TOO_LARGE", path: "", message: `Art plan exceeds ${MAX_ART_PLAN_BYTES} UTF-8 bytes.` }] };
  }
  return { valid: true, diagnostics: [], plan };
}
