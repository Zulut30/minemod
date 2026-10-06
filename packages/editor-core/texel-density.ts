import { z } from "zod";
import { EditorError } from "./errors.ts";
import type { EditorProject, FaceName } from "./index.ts";

export const TexelDensityProfileSchema = z.strictObject({
  pixelsPerBlock: z.number().int().min(1).max(256),
  tolerancePercent: z.number().int().min(0).max(100),
});
export const TexelDensityCubeIdsSchema = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).min(1).max(256);
export type TexelDensityProfile = z.infer<typeof TexelDensityProfileSchema>;
const axesByFace: Record<FaceName, readonly [number, number]> = {
  north: [0, 1], south: [0, 1], east: [2, 1], west: [2, 1], up: [0, 2], down: [0, 2],
};

function axisMeasurement(modelUnits: number, pixels: number, atlasLimit: number, profile: TexelDensityProfile) {
  const density = pixels / modelUnits * 16;
  const idealPixels = modelUnits * profile.pixelsPerBlock / 16;
  const tolerance = profile.tolerancePercent / 100;
  // Погрешность только для границ floating point; не исключение из профиля.
  const lower = Math.max(1, Math.ceil(idealPixels * (1 - tolerance) - 1e-12));
  const upper = Math.floor(idealPixels * (1 + tolerance) + 1e-12);
  const integerPixelRange = lower <= upper ? [lower, upper] : null;
  return {
    modelUnits, pixels, pixelsPerBlock: Number.isFinite(density) ? density : null,
    withinTolerance: Number.isFinite(density) && Math.abs(density / profile.pixelsPerBlock - 1) <= tolerance + 1e-12,
    integerPixelRange, fitsCurrentAtlas: integerPixelRange !== null && lower <= atlasLimit,
    closestPositivePixels: Math.max(1, Math.round(idealPixels)),
  };
}

/** Получает уже проверенный проект; публичный wrapper в index.ts валидирует вход. */
export function measureTexelDensity(project: EditorProject, profileInput: unknown, cubeIdsInput?: unknown) {
  const parsedProfile = TexelDensityProfileSchema.safeParse(profileInput);
  const parsedIds = cubeIdsInput === undefined ? undefined : TexelDensityCubeIdsSchema.safeParse(cubeIdsInput);
  if (!parsedProfile.success || (parsedIds && !parsedIds.success))
    throw new EditorError("INVALID_ARGUMENTS", "Нужен профиль 1–256 пикс./блок, допуск 0–100% и до 256 cube IDs.");
  const profile = parsedProfile.data;
  const cubeIds = parsedIds?.success ? parsedIds.data : undefined;
  if (cubeIds && new Set(cubeIds).size !== cubeIds.length)
    throw new EditorError("DUPLICATE_ID", "Куб указан в измерении дважды.");
  const cubes = new Map(project.model.bones.flatMap(bone => bone.cubes).map(cube => [cube.id, cube]));
  if (cubeIds?.some(id => !cubes.has(id))) throw new EditorError("TARGET", "Куб для измерения не найден.");
  const selected = cubeIds ? new Set(cubeIds) : undefined;
  const faces = project.texturePlan.faces.filter(binding => !selected || selected.has(binding.cubeId)).flatMap(binding => {
    const cube = cubes.get(binding.cubeId)!;
    return (Object.keys(axesByFace) as FaceName[]).map(face => {
      const dimensions = axesByFace[face].map(axis => cube.size[axis]! + 2 * cube.inflate);
      const rect = binding.uv[face];
      return { cubeId: cube.id, face, axes: [
        axisMeasurement(dimensions[0]!, Math.abs(rect[2] - rect[0]), project.model.texture.width, profile),
        axisMeasurement(dimensions[1]!, Math.abs(rect[3] - rect[1]), project.model.texture.height, profile),
      ] };
    });
  });
  const axes = faces.flatMap(face => face.axes);
  return {
    kind: "texel-density-measurement" as const, profile, profileSource: "caller-supplied-not-ArtSpec-verified" as const,
    modelUnitsPerBlock: 16, selectedCubes: cubeIds?.length ?? cubes.size,
    summary: { faces: faces.length, axes: axes.length,
      axesWithinTolerance: axes.filter(axis => axis.withinTolerance).length,
      axesOutsideTolerance: axes.filter(axis => !axis.withinTolerance).length,
      axesWithoutIntegerCoverage: axes.filter(axis => axis.integerPixelRange === null).length,
      axesWithoutAtlasCapacity: axes.filter(axis => axis.integerPixelRange !== null && !axis.fitsCurrentAtlas).length,
      unmeasurableAxes: axes.filter(axis => axis.pixelsPerBlock === null).length },
    faces, artisticAcceptance: "requires-human-review" as const,
  };
}
export type TexelDensityReport = ReturnType<typeof measureTexelDensity>;
