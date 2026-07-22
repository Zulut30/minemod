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

interface UvShelf {
  readonly y: number;
  readonly height: number;
  nextX: number;
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

function packUv(
  plan: ArticulatedModelPlan,
): { readonly offsets: ReadonlyMap<string, readonly [number, number]>; readonly metrics: ArticulatedModelPackingMetrics } {
  const rectangles: UvRectangle[] = plan.bones.flatMap(({ cubes }) => cubes.map((cube) => ({
    cubeId: cube.id,
    width: 2 * (cube.size[0] + cube.size[2]),
    height: cube.size[1] + cube.size[2],
  })));
  rectangles.sort((left, right) =>
    right.height - left.height || right.width - left.width || left.cubeId.localeCompare(right.cubeId));

  const shelves: UvShelf[] = [];
  const offsets = new Map<string, readonly [number, number]>();
  let occupiedPixels = 0;
  let usedWidth = 0;
  let usedHeight = 0;

  for (const rectangle of rectangles) {
    let shelf = shelves.find((candidate) =>
      rectangle.height <= candidate.height && candidate.nextX + rectangle.width <= plan.texture.width);
    if (shelf === undefined) {
      const previous = shelves.at(-1);
      const y = previous === undefined ? 0 : previous.y + previous.height + plan.uvPadding;
      if (rectangle.width > plan.texture.width || y + rectangle.height > plan.texture.height) {
        throw new RangeError(
          `Articulated model ${plan.id} UV atlas ${plan.texture.width}x${plan.texture.height} ` +
          `cannot fit cube ${rectangle.cubeId} (${rectangle.width}x${rectangle.height}) ` +
          `with padding ${plan.uvPadding}.`,
        );
      }
      shelf = { y, height: rectangle.height, nextX: 0 };
      shelves.push(shelf);
    }
    offsets.set(rectangle.cubeId, [shelf.nextX, shelf.y]);
    occupiedPixels += rectangle.width * rectangle.height;
    usedWidth = Math.max(usedWidth, shelf.nextX + rectangle.width);
    usedHeight = Math.max(usedHeight, shelf.y + rectangle.height);
    shelf.nextX += rectangle.width + plan.uvPadding;
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
