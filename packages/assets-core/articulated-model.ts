import {
  ArticulatedModelPlanSchema,
  CuboidModelSpecSchema,
  type ArticulatedModelPlan,
  type CuboidModelSpec,
} from "@mcdev/assets-contracts";

type Vector3 = readonly [number, number, number];

interface UvRectangle {
  readonly cubeId: string;
  readonly width: number;
  readonly height: number;
}

interface FreeRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ArticulatedModelPackingMetrics {
  readonly rectangles: number;
  readonly occupiedPixels: number;
  readonly usedWidth: number;
  readonly usedHeight: number;
  readonly atlasPixels: number;
  readonly utilization: number;
}

export interface MaterializedArticulatedModel {
  readonly model: CuboidModelSpec;
  readonly packing: ArticulatedModelPackingMetrics;
}

function add(left: Vector3, right: Vector3): Vector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function parsePlan(input: unknown): ArticulatedModelPlan {
  const result = ArticulatedModelPlanSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue === undefined ? "unknown validation error" :
      `${issue.path.join(".") || "plan"}: ${issue.message}`;
    throw new TypeError(`Invalid ArticulatedModelPlan (${detail}).`);
  }
  return result.data;
}

function intersects(left: FreeRectangle, right: FreeRectangle): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y;
}

function splitFreeRectangle(free: FreeRectangle, used: FreeRectangle): FreeRectangle[] {
  if (!intersects(free, used)) return [free];
  const split: FreeRectangle[] = [];
  if (used.x > free.x) {
    split.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
  }
  const freeRight = free.x + free.width;
  const usedRight = used.x + used.width;
  if (usedRight < freeRight) {
    split.push({ x: usedRight, y: free.y, width: freeRight - usedRight, height: free.height });
  }
  if (used.y > free.y) {
    split.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
  }
  const freeBottom = free.y + free.height;
  const usedBottom = used.y + used.height;
  if (usedBottom < freeBottom) {
    split.push({ x: free.x, y: usedBottom, width: free.width, height: freeBottom - usedBottom });
  }
  return split.filter(({ width, height }) => width > 0 && height > 0);
}

function contains(outer: FreeRectangle, inner: FreeRectangle): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function pruneContained(rectangles: readonly FreeRectangle[]): FreeRectangle[] {
  return rectangles.filter((candidate, index) => !rectangles.some((other, otherIndex) =>
    index !== otherIndex && contains(other, candidate) &&
    (other.width * other.height > candidate.width * candidate.height || otherIndex < index)));
}

function packUv(
  plan: ArticulatedModelPlan,
): { readonly offsets: ReadonlyMap<string, readonly [number, number]>; readonly metrics: ArticulatedModelPackingMetrics } {
  const rectangles: UvRectangle[] = plan.bones.flatMap(({ cubes }) => cubes.map((cube) => ({
    cubeId: cube.id,
    width: 2 * (cube.size[0] + cube.size[2]),
    height: cube.size[1] + cube.size[2],
  })));
  rectangles.sort((left, right) =>
    right.width * right.height - left.width * left.height ||
    Math.max(right.width, right.height) - Math.max(left.width, left.height) ||
    left.cubeId.localeCompare(right.cubeId));

  let freeRectangles: FreeRectangle[] = [{
    x: 0,
    y: 0,
    width: plan.texture.width,
    height: plan.texture.height,
  }];
  const offsets = new Map<string, readonly [number, number]>();
  let occupiedPixels = 0;
  let usedWidth = 0;
  let usedHeight = 0;

  for (const rectangle of rectangles) {
    const reservedWidth = rectangle.width + plan.uvPadding;
    const reservedHeight = rectangle.height + plan.uvPadding;
    const choices = freeRectangles
      .filter(({ width, height }) => reservedWidth <= width && reservedHeight <= height)
      .map((free) => ({
        free,
        shortSide: Math.min(free.width - reservedWidth, free.height - reservedHeight),
        longSide: Math.max(free.width - reservedWidth, free.height - reservedHeight),
        areaWaste: free.width * free.height - reservedWidth * reservedHeight,
      }))
      .sort((left, right) =>
        left.shortSide - right.shortSide || left.longSide - right.longSide ||
        left.areaWaste - right.areaWaste || left.free.y - right.free.y || left.free.x - right.free.x);
    const choice = choices[0];
    if (choice === undefined) {
      throw new RangeError(
        `Articulated model ${plan.id} UV atlas ${plan.texture.width}x${plan.texture.height} ` +
        `cannot fit cube ${rectangle.cubeId} (${rectangle.width}x${rectangle.height}) ` +
        `with padding ${plan.uvPadding}.`,
      );
    }
    const used = {
      x: choice.free.x,
      y: choice.free.y,
      width: reservedWidth,
      height: reservedHeight,
    };
    offsets.set(rectangle.cubeId, [used.x, used.y]);
    occupiedPixels += rectangle.width * rectangle.height;
    usedWidth = Math.max(usedWidth, used.x + rectangle.width);
    usedHeight = Math.max(usedHeight, used.y + rectangle.height);
    freeRectangles = pruneContained(freeRectangles.flatMap((free) => splitFreeRectangle(free, used)));
  }

  const atlasPixels = plan.texture.width * plan.texture.height;
  return {
    offsets,
    metrics: Object.freeze({
      rectangles: rectangles.length,
      occupiedPixels,
      usedWidth,
      usedHeight,
      atlasPixels,
      utilization: occupiedPixels / atlasPixels,
    }),
  };
}

export function materializeArticulatedModel(input: unknown): MaterializedArticulatedModel {
  const plan = parsePlan(input);
  const bonesById = new Map(plan.bones.map((bone) => [bone.id, bone]));
  const worldPivots = new Map<string, Vector3>();

  function resolvePivot(boneId: string): Vector3 {
    const cached = worldPivots.get(boneId);
    if (cached !== undefined) return cached;
    const bone = bonesById.get(boneId);
    if (bone === undefined) throw new Error("Validated articulated bone index became inconsistent.");
    const pivot = bone.parent === null ? bone.pivotOffset : add(resolvePivot(bone.parent), bone.pivotOffset);
    worldPivots.set(boneId, pivot);
    return pivot;
  }

  const packed = packUv(plan);
  const candidate = {
    schemaVersion: 0 as const,
    kind: "cuboid-model" as const,
    id: plan.id,
    name: plan.name,
    modelType: plan.modelType,
    texture: plan.texture,
    bones: plan.bones.map((bone) => {
      const pivot = resolvePivot(bone.id);
      return {
        id: bone.id,
        parent: bone.parent,
        pivot,
        rotation: bone.rotation,
        cubes: bone.cubes.map((cube) => {
          const uv = packed.offsets.get(cube.id);
          if (uv === undefined) throw new Error("Validated articulated UV index became inconsistent.");
          return {
            id: cube.id,
            origin: add(pivot, cube.originOffset),
            size: cube.size,
            pivot,
            rotation: cube.rotation,
            uv,
            inflate: cube.inflate,
            mirror: cube.mirror,
          };
        }),
      };
    }),
  };

  const result = CuboidModelSpecSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue === undefined ? "unknown validation error" :
      `${issue.path.join(".") || "model"}: ${issue.message}`;
    throw new RangeError(`Materialized CuboidModelSpec is invalid (${detail}).`);
  }
  return Object.freeze({ model: result.data, packing: packed.metrics });
}
