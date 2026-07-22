import {
  CuboidModelSpecSchema,
  CuboidTexturePlanSchema,
  type CuboidModelSpec,
  type CuboidTexturePlan,
} from "@mcdev/assets-contracts";
import type { ModelQualityDiagnostic } from "./model-quality.ts";

export interface TextureQualityThresholds {
  readonly minShadowLuminanceDelta: number;
  readonly minHighlightLuminanceDelta: number;
  readonly minAccentRgbDistance: number;
}

export interface TextureQualityReport {
  readonly passes: boolean;
  readonly materialCount: number;
  readonly assignmentCount: number;
  readonly texturedBilateralPairs: number;
  readonly diagnostics: readonly ModelQualityDiagnostic[];
}

type Rgb = readonly [number, number, number];

function parseModel(input: unknown): CuboidModelSpec {
  const result = CuboidModelSpecSchema.safeParse(input);
  if (!result.success) throw new TypeError(`Invalid CuboidModelSpec (${result.error.issues[0]?.message ?? "validation failed"}).`);
  return result.data;
}

function parsePlan(input: unknown): CuboidTexturePlan {
  const result = CuboidTexturePlanSchema.safeParse(input);
  if (!result.success) throw new TypeError(`Invalid CuboidTexturePlan (${result.error.issues[0]?.message ?? "validation failed"}).`);
  return result.data;
}

function rgb(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  ];
}

function luminance(value: Rgb): number {
  const linear = value.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function distance(left: Rgb, right: Rgb): number {
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - (right[index] ?? 0)) ** 2, 0) / 3);
}

function counterpart(id: string): string | undefined {
  if (id.startsWith("left_")) return `right_${id.slice(5)}`;
  return undefined;
}

/** Palette and bilateral-texture preflight; visual review remains mandatory. */
export function analyzeTexturePlanQuality(
  modelInput: unknown,
  planInput: unknown,
  thresholds: TextureQualityThresholds,
): TextureQualityReport {
  const model = parseModel(modelInput);
  const plan = parsePlan(planInput);
  const diagnostics: ModelQualityDiagnostic[] = [];
  if (model.id !== plan.modelId) diagnostics.push({ id: "ART_TEXTURE_MODEL_ID_MISMATCH", severity: "error",
    message: `Texture plan ${plan.modelId} does not target model ${model.id}.` });

  for (const material of plan.materials) {
    const base = rgb(material.colors.base);
    const shadow = rgb(material.colors.shadow);
    const highlight = rgb(material.colors.highlight);
    const accent = rgb(material.colors.accent);
    const baseLuminance = luminance(base);
    if (baseLuminance - luminance(shadow) < thresholds.minShadowLuminanceDelta) {
      diagnostics.push({ id: "ART_PALETTE_SHADOW_CONTRAST_LOW", severity: "error",
        message: `Material ${material.id} shadow is not sufficiently darker than its base color.` });
    }
    if (luminance(highlight) - baseLuminance < thresholds.minHighlightLuminanceDelta) {
      diagnostics.push({ id: "ART_PALETTE_HIGHLIGHT_CONTRAST_LOW", severity: "error",
        message: `Material ${material.id} highlight is not sufficiently brighter than its base color.` });
    }
    if (distance(base, accent) < thresholds.minAccentRgbDistance) {
      diagnostics.push({ id: "ART_PALETTE_ACCENT_SEPARATION_LOW", severity: "warning",
        message: `Material ${material.id} accent is too close to its base color to read at game distance.` });
    }
  }

  const cubes = new Set(model.bones.flatMap(({ cubes: boneCubes }) => boneCubes.map(({ id }) => id)));
  const assignments = new Map(plan.assignments.map((assignment) => [assignment.cubeId, assignment]));
  for (const id of cubes) {
    if (!assignments.has(id)) diagnostics.push({ id: "ART_TEXTURE_ASSIGNMENT_MISSING", severity: "error",
      message: `Cube ${id} has no texture assignment.` });
  }

  let texturedBilateralPairs = 0;
  for (const leftId of [...cubes].filter((id) => id.startsWith("left_"))) {
    const rightId = counterpart(leftId);
    if (rightId === undefined || !cubes.has(rightId)) {
      diagnostics.push({ id: "ART_TEXTURE_SYMMETRY_MISSING", severity: "error",
        message: `Textured detail ${leftId} has no mirrored cube counterpart.` });
      continue;
    }
    const left = assignments.get(leftId);
    const right = assignments.get(rightId);
    if (left === undefined || right === undefined) continue;
    texturedBilateralPairs += 1;
    if (left.materialId !== right.materialId || left.pattern !== right.pattern ||
      (left.detailScale ?? 1) !== (right.detailScale ?? 1) || left.seed !== right.seed) {
      diagnostics.push({ id: "ART_TEXTURE_SYMMETRY_DRIFT", severity: "error",
        message: `Texture assignments ${leftId}/${rightId} do not share material, pattern, scale and seed.` });
    }
  }

  return Object.freeze({
    passes: diagnostics.every(({ severity }) => severity !== "error"),
    materialCount: plan.materials.length,
    assignmentCount: plan.assignments.length,
    texturedBilateralPairs,
    diagnostics: Object.freeze(diagnostics),
  });
}
