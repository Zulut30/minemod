import { z } from "zod";

export * from "./reference-study.ts";
export * from "./implementation-study.ts";
export * from "./crop-asset-plan.ts";

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
export const CUBOID_TEXTURE_LIMITS = Object.freeze({
  maxMaterials: 16,
  maxAssignments: CUBOID_MODEL_LIMITS.maxCubes,
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

export const ARTICULATED_MODEL_PLAN_SCHEMA_ID =
  "https://mcdev.local/schemas/articulated-model-plan-v0.json";

const ArticulatedCubeSchema = z.strictObject({
  id: identifier,
  originOffset: vector3,
  size: z.tuple([
    z.number().int().positive().max(CUBOID_MODEL_LIMITS.maxCubeSize),
    z.number().int().positive().max(CUBOID_MODEL_LIMITS.maxCubeSize),
    z.number().int().positive().max(CUBOID_MODEL_LIMITS.maxCubeSize),
  ]),
  rotation: rotation3,
  inflate: z.number().min(0).max(4),
  mirror: z.boolean(),
});

const ArticulatedBoneSchema = z.strictObject({
  id: identifier,
  parent: identifier.nullable(),
  pivotOffset: vector3,
  rotation: rotation3,
  cubes: z.array(ArticulatedCubeSchema).max(CUBOID_MODEL_LIMITS.maxCubesPerBone),
});

export const ArticulatedModelPlanSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("articulated-model-plan"),
  id: z.string().regex(new RegExp(MODEL_RESOURCE_LOCATION_PATTERN, "u")),
  name: modelName,
  modelType: z.enum(["entity", "held-item"]),
  texture: z.strictObject({ width: textureDimension, height: textureDimension }),
  uvPadding: z.number().int().min(0).max(4),
  bones: z.array(ArticulatedBoneSchema).min(1).max(CUBOID_MODEL_LIMITS.maxBones),
}).superRefine((plan, context) => {
  const boneIds = new Set<string>();
  const cubeIds = new Set<string>();
  let totalCubes = 0;
  for (const [boneIndex, bone] of plan.bones.entries()) {
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
    }
  }
  if (totalCubes > CUBOID_MODEL_LIMITS.maxCubes) {
    context.addIssue({ code: "custom", path: ["bones"], message: "Model cube limit exceeded." });
  }
  for (const [boneIndex, bone] of plan.bones.entries()) {
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
      parent = plan.bones.find(({ id }) => id === parent)?.parent ?? null;
    }
  }
});

export type ArticulatedModelPlan = z.infer<typeof ArticulatedModelPlanSchema>;

export const ArticulatedModelPlanJsonSchema = Object.freeze({
  ...z.toJSONSchema(ArticulatedModelPlanSchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ARTICULATED_MODEL_PLAN_SCHEMA_ID,
});

export const CUBOID_TEXTURE_PLAN_SCHEMA_ID = "https://mcdev.local/schemas/cuboid-texture-plan-v0.json";

const rgbHex = z.string().regex(/^#[0-9a-f]{6}$/u);
const MaterialSchema = z.strictObject({
  id: identifier,
  colors: z.strictObject({
    base: rgbHex,
    shadow: rgbHex,
    highlight: rgbHex,
    accent: rgbHex,
  }),
});
const TextureAssignmentSchema = z.strictObject({
  cubeId: identifier,
  materialId: identifier,
  pattern: z.enum([
    "solid",
    "panel",
    "riveted",
    "striped",
    "scales",
    "mottled",
    "gradient",
  ]),
  detailScale: z.number().int().min(1).max(4).optional(),
  seed: z.number().int().min(0).max(4_294_967_295),
});

export const CuboidTexturePlanSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("cuboid-texture-plan"),
  modelId: z.string().regex(new RegExp(MODEL_RESOURCE_LOCATION_PATTERN, "u")),
  materials: z.array(MaterialSchema).min(1).max(CUBOID_TEXTURE_LIMITS.maxMaterials),
  assignments: z.array(TextureAssignmentSchema).min(1).max(CUBOID_TEXTURE_LIMITS.maxAssignments),
}).superRefine((plan, context) => {
  const materialIds = new Set<string>();
  for (const [index, material] of plan.materials.entries()) {
    if (materialIds.has(material.id)) {
      context.addIssue({ code: "custom", path: ["materials", index, "id"], message: "Material ids must be unique." });
    }
    materialIds.add(material.id);
  }

  const cubeIds = new Set<string>();
  for (const [index, assignment] of plan.assignments.entries()) {
    if (cubeIds.has(assignment.cubeId)) {
      context.addIssue({ code: "custom", path: ["assignments", index, "cubeId"], message: "Each cube can have only one texture assignment." });
    }
    cubeIds.add(assignment.cubeId);
    if (!materialIds.has(assignment.materialId)) {
      context.addIssue({ code: "custom", path: ["assignments", index, "materialId"], message: "Assigned material does not exist." });
    }
  }
});

export type CuboidTexturePlan = z.infer<typeof CuboidTexturePlanSchema>;

export const CuboidTexturePlanJsonSchema = Object.freeze({
  ...z.toJSONSchema(CuboidTexturePlanSchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CUBOID_TEXTURE_PLAN_SCHEMA_ID,
});

export const PIXEL_ICON_PLAN_SCHEMA_ID = "https://mcdev.local/schemas/pixel-icon-plan-v0.json";
export const PIXEL_ICON_LIMITS = Object.freeze({ maxPaletteColors: 16, maxPrimitives: 128 } as const);

const iconCoordinate = z.number().int().min(0).max(31);
const IconPaletteEntrySchema = z.strictObject({ id: identifier, color: rgbHex });
const IconPrimitiveSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("line"),
    from: z.tuple([iconCoordinate, iconCoordinate]),
    to: z.tuple([iconCoordinate, iconCoordinate]),
    thickness: z.number().int().min(1).max(4),
    colorId: identifier,
  }),
  z.strictObject({
    type: z.literal("rectangle"),
    origin: z.tuple([iconCoordinate, iconCoordinate]),
    size: z.tuple([z.number().int().min(1).max(32), z.number().int().min(1).max(32)]),
    colorId: identifier,
  }),
]);

export const PixelIconPlanSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("pixel-icon"),
  id: z.string().regex(new RegExp(MODEL_RESOURCE_LOCATION_PATTERN, "u")),
  size: z.union([z.literal(16), z.literal(32)]),
  palette: z.array(IconPaletteEntrySchema).min(1).max(PIXEL_ICON_LIMITS.maxPaletteColors),
  primitives: z.array(IconPrimitiveSchema).min(1).max(PIXEL_ICON_LIMITS.maxPrimitives),
}).superRefine((plan, context) => {
  const colorIds = new Set<string>();
  for (const [index, entry] of plan.palette.entries()) {
    if (colorIds.has(entry.id)) {
      context.addIssue({ code: "custom", path: ["palette", index, "id"], message: "Palette ids must be unique." });
    }
    colorIds.add(entry.id);
  }
  for (const [index, primitive] of plan.primitives.entries()) {
    if (!colorIds.has(primitive.colorId)) {
      context.addIssue({ code: "custom", path: ["primitives", index, "colorId"], message: "Primitive color does not exist." });
    }
    const points: readonly (readonly [number, number])[] = primitive.type === "line"
      ? [primitive.from, primitive.to]
      : [primitive.origin, [
        primitive.origin[0] + primitive.size[0] - 1,
        primitive.origin[1] + primitive.size[1] - 1,
      ]];
    if (points.some(([x, y]) => x >= plan.size || y >= plan.size)) {
      context.addIssue({ code: "custom", path: ["primitives", index], message: "Primitive must fit inside the icon." });
    }
  }
});

export type PixelIconPlan = z.infer<typeof PixelIconPlanSchema>;

export const PixelIconPlanJsonSchema = Object.freeze({
  ...z.toJSONSchema(PixelIconPlanSchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: PIXEL_ICON_PLAN_SCHEMA_ID,
});

export const CUBOID_ANIMATION_PLAN_SCHEMA_ID =
  "https://mcdev.local/schemas/cuboid-animation-plan-v0.json";
export const CUBOID_ANIMATION_LIMITS = Object.freeze({
  maxClips: 16,
  maxTracksPerClip: CUBOID_MODEL_LIMITS.maxBones * 2,
  maxKeyframesPerTrack: 64,
  maxClipLengthSeconds: 20,
  maxPositionMagnitude: 32,
} as const);

const animationName = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u);
const keyframeTime = z.number().min(0).max(CUBOID_ANIMATION_LIMITS.maxClipLengthSeconds);
const interpolation = z.enum(["linear", "catmullrom"]);
const PositionKeyframeSchema = z.strictObject({
  time: keyframeTime,
  value: z.tuple([
    z.number().min(-CUBOID_ANIMATION_LIMITS.maxPositionMagnitude).max(CUBOID_ANIMATION_LIMITS.maxPositionMagnitude),
    z.number().min(-CUBOID_ANIMATION_LIMITS.maxPositionMagnitude).max(CUBOID_ANIMATION_LIMITS.maxPositionMagnitude),
    z.number().min(-CUBOID_ANIMATION_LIMITS.maxPositionMagnitude).max(CUBOID_ANIMATION_LIMITS.maxPositionMagnitude),
  ]),
  interpolation,
});
const RotationKeyframeSchema = z.strictObject({
  time: keyframeTime,
  value: rotation3,
  interpolation,
});
const AnimationTrackSchema = z.discriminatedUnion("channel", [
  z.strictObject({
    boneId: identifier,
    channel: z.literal("position"),
    keyframes: z.array(PositionKeyframeSchema).min(1).max(CUBOID_ANIMATION_LIMITS.maxKeyframesPerTrack),
  }),
  z.strictObject({
    boneId: identifier,
    channel: z.literal("rotation"),
    keyframes: z.array(RotationKeyframeSchema).min(1).max(CUBOID_ANIMATION_LIMITS.maxKeyframesPerTrack),
  }),
]);
const AnimationClipSchema = z.strictObject({
  id: identifier,
  name: animationName,
  loop: z.enum(["once", "loop", "hold"]),
  length: z.number().positive().max(CUBOID_ANIMATION_LIMITS.maxClipLengthSeconds),
  snapping: z.number().int().min(1).max(120),
  tracks: z.array(AnimationTrackSchema).min(1).max(CUBOID_ANIMATION_LIMITS.maxTracksPerClip),
}).superRefine((clip, context) => {
  const sameVector = (left: readonly number[], right: readonly number[]): boolean =>
    left.every((value, index) => value === right[index]);
  const trackIds = new Set<string>();
  for (const [trackIndex, track] of clip.tracks.entries()) {
    const trackId = `${track.boneId}:${track.channel}`;
    if (trackIds.has(trackId)) {
      context.addIssue({ code: "custom", path: ["tracks", trackIndex], message: "Each bone channel can have only one track per clip." });
    }
    trackIds.add(trackId);
    let previousTime = -1;
    for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
      if (keyframe.time <= previousTime) {
        context.addIssue({ code: "custom", path: ["tracks", trackIndex, "keyframes", keyframeIndex, "time"], message: "Keyframe times must be strictly increasing." });
      }
      if (keyframe.time > clip.length) {
        context.addIssue({ code: "custom", path: ["tracks", trackIndex, "keyframes", keyframeIndex, "time"], message: "Keyframe time must not exceed clip length." });
      }
      previousTime = keyframe.time;
    }
    const firstKeyframe = track.keyframes[0];
    const lastKeyframe = track.keyframes.at(-1);
    if (firstKeyframe === undefined || lastKeyframe === undefined) continue;
    if (clip.loop === "loop" && (
      firstKeyframe.time !== 0 ||
      lastKeyframe.time !== clip.length ||
      !sameVector(firstKeyframe.value, lastKeyframe.value)
    )) {
      context.addIssue({
        code: "custom",
        path: ["tracks", trackIndex, "keyframes"],
        message: "Looping tracks must cover the full clip and end at their starting value.",
      });
    }
    if (clip.loop !== "hold" && track.boneId === "root" && track.channel === "position" &&
      !sameVector(firstKeyframe.value, lastKeyframe.value)) {
      context.addIssue({
        code: "custom",
        path: ["tracks", trackIndex, "keyframes"],
        message: "Non-hold clips must restore root position to avoid persistent visual root motion.",
      });
    }
  }
});

export const CuboidAnimationPlanSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("cuboid-animation-plan"),
  modelId: z.string().regex(new RegExp(MODEL_RESOURCE_LOCATION_PATTERN, "u")),
  clips: z.array(AnimationClipSchema).min(1).max(CUBOID_ANIMATION_LIMITS.maxClips),
}).superRefine((plan, context) => {
  const clipIds = new Set<string>();
  const clipNames = new Set<string>();
  for (const [index, clip] of plan.clips.entries()) {
    if (clipIds.has(clip.id)) {
      context.addIssue({ code: "custom", path: ["clips", index, "id"], message: "Clip ids must be unique." });
    }
    if (clipNames.has(clip.name)) {
      context.addIssue({ code: "custom", path: ["clips", index, "name"], message: "Clip names must be unique." });
    }
    clipIds.add(clip.id);
    clipNames.add(clip.name);
  }
});

export type CuboidAnimationPlan = z.infer<typeof CuboidAnimationPlanSchema>;

export const CuboidAnimationPlanJsonSchema = Object.freeze({
  ...z.toJSONSchema(CuboidAnimationPlanSchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CUBOID_ANIMATION_PLAN_SCHEMA_ID,
});
