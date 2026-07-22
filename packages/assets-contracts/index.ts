import { z } from "zod";

export const CUBOID_MODEL_SPEC_SCHEMA_ID = "https://mcdev.local/schemas/cuboid-model-spec-v0.json";
export const MODEL_RESOURCE_LOCATION_PATTERN =
  "^(?!\\.{1,2}:)[a-z0-9_.-]{1,64}:(?=[a-z0-9_./-]{1,128}$)(?:(?!\\.{1,2}(?:/|$))[a-z0-9_.-]+/)*(?!\\.{1,2}$)[a-z0-9_.-]+$";
export const CUBOID_MODEL_LIMITS = Object.freeze({
  maxBones: 64,
  maxCubesPerBone: 64,
  maxCubes: 256,
  maxCoordinateMagnitude: 128,
  maxCubeSize: 64,
} as const);

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
function containsOnlyBmpCodeUnits(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) return false;
  }
  return true;
}

const modelName = z.string().min(1).max(80).refine(
  containsOnlyBmpCodeUnits,
  "Only BMP Unicode scalar values are supported in v0.",
);
const coordinate = z.number()
  .min(-CUBOID_MODEL_LIMITS.maxCoordinateMagnitude)
  .max(CUBOID_MODEL_LIMITS.maxCoordinateMagnitude);
const rotation = z.number().min(-180).max(180);
const vector3 = z.tuple([coordinate, coordinate, coordinate]);
const rotation3 = z.tuple([rotation, rotation, rotation]);
const textureDimension = z.union([
  z.literal(16),
  z.literal(32),
  z.literal(64),
  z.literal(128),
  z.literal(256),
]);

const CuboidSchema = z.strictObject({
  id: identifier,
  origin: vector3,
  size: z.tuple([
    z.number().positive().max(CUBOID_MODEL_LIMITS.maxCubeSize),
    z.number().positive().max(CUBOID_MODEL_LIMITS.maxCubeSize),
    z.number().positive().max(CUBOID_MODEL_LIMITS.maxCubeSize),
  ]),
  pivot: vector3,
  rotation: rotation3,
  uv: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
  inflate: z.number().min(0).max(4),
  mirror: z.boolean(),
});

const BoneSchema = z.strictObject({
  id: identifier,
  parent: identifier.nullable(),
  pivot: vector3,
  rotation: rotation3,
  cubes: z.array(CuboidSchema).max(CUBOID_MODEL_LIMITS.maxCubesPerBone),
});

export const CuboidModelSpecSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("cuboid-model"),
  id: z.string().regex(new RegExp(MODEL_RESOURCE_LOCATION_PATTERN, "u")),
  name: modelName,
  modelType: z.enum(["entity", "held-item"]),
  texture: z.strictObject({ width: textureDimension, height: textureDimension }),
  bones: z.array(BoneSchema).min(1).max(CUBOID_MODEL_LIMITS.maxBones),
}).superRefine((model, context) => {
  const boneIds = new Set<string>();
  const cubeIds = new Set<string>();
  let totalCubes = 0;

  for (const [boneIndex, bone] of model.bones.entries()) {
    if (boneIds.has(bone.id)) {
      context.addIssue({ code: "custom", path: ["bones", boneIndex, "id"], message: "Bone ids must be unique." });
    }
    boneIds.add(bone.id);
    totalCubes += bone.cubes.length;

    for (const [cubeIndex, cube] of bone.cubes.entries()) {
      if (cubeIds.has(cube.id)) {
        context.addIssue({ code: "custom", path: ["bones", boneIndex, "cubes", cubeIndex, "id"], message: "Cube ids must be unique." });
      }
      cubeIds.add(cube.id);

      for (let axis = 0; axis < 3; axis += 1) {
        const origin = cube.origin[axis];
        const size = cube.size[axis];
        if (origin === undefined || size === undefined ||
          origin + size > CUBOID_MODEL_LIMITS.maxCoordinateMagnitude) {
          context.addIssue({
            code: "custom",
            path: ["bones", boneIndex, "cubes", cubeIndex, "size", axis],
            message: "Cube bounds must stay inside the modeling coordinate limit.",
          });
        }
      }

      const boxUvWidth = 2 * (cube.size[0] + cube.size[2]);
      const boxUvHeight = cube.size[1] + cube.size[2];
      if (cube.uv[0] + boxUvWidth > model.texture.width ||
        cube.uv[1] + boxUvHeight > model.texture.height) {
        context.addIssue({
          code: "custom",
          path: ["bones", boneIndex, "cubes", cubeIndex, "uv"],
          message: "Box UV must fit inside the declared texture atlas.",
        });
      }
    }
  }

  if (totalCubes > CUBOID_MODEL_LIMITS.maxCubes) {
    context.addIssue({ code: "custom", path: ["bones"], message: "Model cube limit exceeded." });
  }

  for (const [boneIndex, bone] of model.bones.entries()) {
    if (bone.parent !== null && !boneIds.has(bone.parent)) {
      context.addIssue({ code: "custom", path: ["bones", boneIndex, "parent"], message: "Parent bone does not exist." });
      continue;
    }
    const visited = new Set<string>([bone.id]);
    let parent = bone.parent;
    while (parent !== null) {
      if (visited.has(parent)) {
        context.addIssue({ code: "custom", path: ["bones", boneIndex, "parent"], message: "Bone hierarchy must be acyclic." });
        break;
      }
      visited.add(parent);
      parent = model.bones.find(({ id }) => id === parent)?.parent ?? null;
    }
  }
});

export type CuboidModelSpec = z.infer<typeof CuboidModelSpecSchema>;

export const CuboidModelSpecJsonSchema = Object.freeze({
  ...z.toJSONSchema(CuboidModelSpecSchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CUBOID_MODEL_SPEC_SCHEMA_ID,
});
