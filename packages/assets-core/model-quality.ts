import { CuboidModelSpecSchema, type CuboidModelSpec } from "@mcdev/assets-contracts";

type Vector3 = readonly [number, number, number];

export interface ArticulatedQualityThresholds {
  readonly minBones: number;
  readonly minCubes: number;
  readonly minHierarchyDepth: number;
  readonly minScaleBands: number;
  readonly symmetryTolerance: number;
  readonly requiredBones: readonly string[];
  readonly minDetailCubeRatio?: number;
}

export interface ModelQualityDiagnostic {
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface ArticulatedModelQualityReport {
  readonly passes: boolean;
  readonly boneCount: number;
  readonly cubeCount: number;
  readonly hierarchyDepth: number;
  readonly scaleBands: number;
  readonly bilateralPairs: number;
  readonly detailCubeRatio: number;
  readonly bounds: { readonly min: Vector3; readonly max: Vector3; readonly span: Vector3 };
  readonly diagnostics: readonly ModelQualityDiagnostic[];
}

function parseModel(input: unknown): CuboidModelSpec {
  const result = CuboidModelSpecSchema.safeParse(input);
  if (!result.success) throw new TypeError(`Invalid CuboidModelSpec (${result.error.issues[0]?.message ?? "validation failed"}).`);
  return result.data;
}

function hierarchyDepth(model: CuboidModelSpec): number {
  const parents = new Map(model.bones.map(({ id, parent }) => [id, parent]));
  const depths = new Map<string, number>();
  function depth(id: string): number {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const parent = parents.get(id) ?? null;
    const value = parent === null ? 1 : depth(parent) + 1;
    depths.set(id, value);
    return value;
  }
  return Math.max(...model.bones.map(({ id }) => depth(id)));
}

function approximatelyEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

/** Structural preflight, not a replacement for the visual and in-game human review. */
export function analyzeArticulatedModelQuality(
  modelInput: unknown,
  thresholds: ArticulatedQualityThresholds,
): ArticulatedModelQualityReport {
  const model = parseModel(modelInput);
  const diagnostics: ModelQualityDiagnostic[] = [];
  const bones = new Map(model.bones.map((entry) => [entry.id, entry]));
  const cubes = model.bones.flatMap(({ cubes: boneCubes }) => boneCubes);
  const depth = hierarchyDepth(model);
  const volumeBands = new Set(cubes.map(({ size }) => Math.floor(Math.log2(size[0] * size[1] * size[2]))));
  const volumes = cubes.map(({ size }) => size[0] * size[1] * size[2]);
  const largestVolume = Math.max(...volumes, 0);
  const detailCubeRatio = cubes.length === 0 ? 0 :
    volumes.filter((volume) => volume <= largestVolume * 0.05).length / cubes.length;

  if (model.bones.length < thresholds.minBones) {
    diagnostics.push({ id: "ART_ANATOMY_BONE_COUNT_LOW", severity: "error",
      message: `Expected at least ${thresholds.minBones} bones, received ${model.bones.length}.` });
  }
  if (cubes.length < thresholds.minCubes) {
    diagnostics.push({ id: "ART_DETAIL_CUBE_COUNT_LOW", severity: "error",
      message: `Expected at least ${thresholds.minCubes} cubes, received ${cubes.length}.` });
  }
  if (depth < thresholds.minHierarchyDepth) {
    diagnostics.push({ id: "ART_ANATOMY_HIERARCHY_SHALLOW", severity: "error",
      message: `Expected hierarchy depth ${thresholds.minHierarchyDepth}, received ${depth}.` });
  }
  if (volumeBands.size < thresholds.minScaleBands) {
    diagnostics.push({ id: "ART_DETAIL_SCALE_BANDS_LOW", severity: "warning",
      message: `Expected ${thresholds.minScaleBands} visible size bands, received ${volumeBands.size}.` });
  }
  if (detailCubeRatio < (thresholds.minDetailCubeRatio ?? 0)) {
    diagnostics.push({ id: "ART_DETAIL_DENSITY_LOW", severity: "warning",
      message: `Small-detail ratio ${detailCubeRatio.toFixed(3)} is below ${thresholds.minDetailCubeRatio?.toFixed(3)}.` });
  }
  for (const required of thresholds.requiredBones) {
    if (!bones.has(required)) diagnostics.push({ id: "ART_ANATOMY_REQUIRED_BONE_MISSING", severity: "error",
      message: `Required animation bone ${required} is missing.` });
  }

  let bilateralPairs = 0;
  for (const left of model.bones.filter(({ id }) => id.startsWith("left_"))) {
    const counterpartId = `right_${left.id.slice(5)}`;
    const right = bones.get(counterpartId);
    if (right === undefined) {
      diagnostics.push({ id: "ART_ANATOMY_SYMMETRY_MISSING", severity: "error",
        message: `Bone ${left.id} has no ${counterpartId} counterpart.` });
      continue;
    }
    bilateralPairs += 1;
    const expectedParent = left.parent?.startsWith("left_") ? `right_${left.parent.slice(5)}` : left.parent;
    const pivotsMirror = approximatelyEqual(left.pivot[0], -right.pivot[0], thresholds.symmetryTolerance) &&
      approximatelyEqual(left.pivot[1], right.pivot[1], thresholds.symmetryTolerance) &&
      approximatelyEqual(left.pivot[2], right.pivot[2], thresholds.symmetryTolerance);
    const rotationsMirror = approximatelyEqual(left.rotation[0], right.rotation[0], thresholds.symmetryTolerance) &&
      approximatelyEqual(left.rotation[1], -right.rotation[1], thresholds.symmetryTolerance) &&
      approximatelyEqual(left.rotation[2], -right.rotation[2], thresholds.symmetryTolerance);
    const cubesMirror = left.cubes.length === right.cubes.length && left.cubes.every((leftCube, index) => {
      const rightCube = right.cubes[index];
      const expectedId = `right_${leftCube.id.slice(5)}`;
      return rightCube !== undefined && rightCube.id === expectedId &&
        leftCube.size.every((value, axis) =>
          approximatelyEqual(value, rightCube.size[axis] ?? Number.NaN, thresholds.symmetryTolerance)) &&
        approximatelyEqual(-leftCube.origin[0] - leftCube.size[0], rightCube.origin[0], thresholds.symmetryTolerance) &&
        approximatelyEqual(leftCube.origin[1], rightCube.origin[1], thresholds.symmetryTolerance) &&
        approximatelyEqual(leftCube.origin[2], rightCube.origin[2], thresholds.symmetryTolerance) &&
        approximatelyEqual(leftCube.rotation[0], rightCube.rotation[0], thresholds.symmetryTolerance) &&
        approximatelyEqual(leftCube.rotation[1], -rightCube.rotation[1], thresholds.symmetryTolerance) &&
        approximatelyEqual(leftCube.rotation[2], -rightCube.rotation[2], thresholds.symmetryTolerance) &&
        leftCube.mirror !== rightCube.mirror;
    });
    if (right.parent !== expectedParent || !pivotsMirror || !rotationsMirror || !cubesMirror) {
      diagnostics.push({ id: "ART_ANATOMY_SYMMETRY_DRIFT", severity: "error",
      message: `Bilateral pair ${left.id}/${counterpartId} differs beyond tolerance ${thresholds.symmetryTolerance}.` });
    }
  }

  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const entry of cubes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Number.POSITIVE_INFINITY, entry.origin[axis] ?? Number.POSITIVE_INFINITY);
      max[axis] = Math.max(max[axis] ?? Number.NEGATIVE_INFINITY,
        (entry.origin[axis] ?? Number.NEGATIVE_INFINITY) + (entry.size[axis] ?? 0));
    }
  }
  const span: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (span.some((value) => !Number.isFinite(value) || value <= 0)) {
    diagnostics.push({ id: "ART_MODEL_BOUNDS_DEGENERATE", severity: "error", message: "Model bounds are empty or degenerate." });
  }
  return Object.freeze({
    passes: diagnostics.every(({ severity }) => severity !== "error"),
    boneCount: model.bones.length,
    cubeCount: cubes.length,
    hierarchyDepth: depth,
    scaleBands: volumeBands.size,
    bilateralPairs,
    detailCubeRatio,
    bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max), span: Object.freeze(span) }),
    diagnostics: Object.freeze(diagnostics),
  });
}
