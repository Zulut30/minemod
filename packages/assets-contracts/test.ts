import assert from "node:assert/strict";
import {
  CUBOID_MODEL_LIMITS,
  CUBOID_TEXTURE_LIMITS,
  CuboidModelSpecJsonSchema,
  CuboidModelSpecSchema,
  CuboidTexturePlanJsonSchema,
  CuboidTexturePlanSchema,
  PixelIconPlanJsonSchema,
  PixelIconPlanSchema,
  type CuboidModelSpec,
  type CuboidTexturePlan,
  type PixelIconPlan,
} from "./index.ts";

const bodyCube: CuboidModelSpec["bones"][number]["cubes"][number] = {
  id: "body_core",
  origin: [-6, 8, -3],
  size: [12, 12, 6],
  pivot: [0, 8, 0],
  rotation: [0, 0, 0],
  uv: [0, 0],
  inflate: 0,
  mirror: false,
};

const validGolem: CuboidModelSpec = {
  schemaVersion: 0,
  kind: "cuboid-model",
  id: "mcdev:copper_guardian",
  name: "Copper Guardian",
  modelType: "entity",
  texture: { width: 64, height: 64 },
  bones: [
    { id: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
    { id: "body", parent: "root", pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [bodyCube] },
    {
      id: "head",
      parent: "body",
      pivot: [0, 20, 0],
      rotation: [0, 0, 0],
      cubes: [{ ...bodyCube, id: "head_core", origin: [-4, 20, -4], size: [8, 7, 8], uv: [0, 24] }],
    },
    {
      id: "left_arm",
      parent: "body",
      pivot: [7, 18, 0],
      rotation: [0, 0, -8],
      cubes: [{ ...bodyCube, id: "left_arm_core", origin: [6, 7, -3], size: [5, 12, 6], uv: [32, 0] }],
    },
    {
      id: "right_arm",
      parent: "body",
      pivot: [-7, 18, 0],
      rotation: [0, 0, 8],
      cubes: [{ ...bodyCube, id: "right_arm_core", origin: [-11, 7, -3], size: [5, 12, 6], uv: [32, 20], mirror: true }],
    },
  ],
};

assert.equal(CuboidModelSpecSchema.safeParse(validGolem).success, true);
assert.equal(CuboidModelSpecJsonSchema.additionalProperties, false);
assert.equal(CUBOID_MODEL_LIMITS.maxBones >= validGolem.bones.length, true);

const heldWeapon: CuboidModelSpec = {
  ...validGolem,
  id: "mcdev:clockwork_halberd",
  name: "Clockwork Halberd",
  modelType: "held-item",
  texture: { width: 32, height: 32 },
  bones: [{
    id: "root",
    parent: null,
    pivot: [0, 0, 0],
    rotation: [0, 0, 0],
    cubes: [{ ...bodyCube, id: "shaft", origin: [-1, -12, -1], size: [2, 24, 2], uv: [0, 0] }],
  }],
};
assert.equal(CuboidModelSpecSchema.safeParse(heldWeapon).success, true);

function invalid(mutator: (candidate: Record<string, unknown>) => void): unknown {
  const candidate = structuredClone(validGolem) as unknown as Record<string, unknown>;
  mutator(candidate);
  return candidate;
}

assert.equal(CuboidModelSpecSchema.safeParse({ ...validGolem, command: "run" }).success, false);
for (const id of ["..:model", "mcdev:a//b", "mcdev:a/../b", "mcdev:a/"]) {
  assert.equal(CuboidModelSpecSchema.safeParse({ ...validGolem, id }).success, false, id);
}
assert.equal(CuboidModelSpecSchema.safeParse({ ...validGolem, name: "😀" }).success, false);
assert.equal(CuboidModelSpecSchema.safeParse(invalid((candidate) => {
  const bones = candidate.bones as Array<{ cubes: Array<{ size: number[] }> }>;
  bones[1]!.cubes[0]!.size[0] = 0;
})).success, false, "zero-size cubes are invalid");
assert.equal(CuboidModelSpecSchema.safeParse(invalid((candidate) => {
  const bones = candidate.bones as Array<{ id: string }>;
  bones[2]!.id = "body";
})).success, false, "bone ids are unique");
assert.equal(CuboidModelSpecSchema.safeParse(invalid((candidate) => {
  const bones = candidate.bones as Array<{ parent: string | null }>;
  bones[1]!.parent = "missing";
})).success, false, "parents must exist");
assert.equal(CuboidModelSpecSchema.safeParse(invalid((candidate) => {
  const bones = candidate.bones as Array<{ parent: string | null }>;
  bones[0]!.parent = "head";
})).success, false, "bone cycles are invalid");
assert.equal(CuboidModelSpecSchema.safeParse(invalid((candidate) => {
  const bones = candidate.bones as Array<{ cubes: Array<{ uv: number[] }> }>;
  bones[1]!.cubes[0]!.uv = [63, 63];
})).success, false, "box UV must fit the texture atlas");

const validTexturePlan: CuboidTexturePlan = {
  schemaVersion: 0,
  kind: "cuboid-texture-plan",
  modelId: "mcdev:copper_guardian",
  materials: [{
    id: "copper",
    colors: {
      base: "#b85f3d",
      shadow: "#67352d",
      highlight: "#ed9a62",
      accent: "#f4c542",
    },
  }],
  assignments: [{ cubeId: "body_core", materialId: "copper", pattern: "riveted", seed: 42 }],
};

assert.equal(CuboidTexturePlanSchema.safeParse(validTexturePlan).success, true);
assert.equal(CuboidTexturePlanJsonSchema.additionalProperties, false);
assert.equal(CUBOID_TEXTURE_LIMITS.maxMaterials, 16);
assert.equal(CuboidTexturePlanSchema.safeParse({ ...validTexturePlan, command: "paint" }).success, false);
assert.equal(CuboidTexturePlanSchema.safeParse({
  ...validTexturePlan,
  materials: [...validTexturePlan.materials, validTexturePlan.materials[0]],
}).success, false, "material ids are unique");
assert.equal(CuboidTexturePlanSchema.safeParse({
  ...validTexturePlan,
  assignments: [{ ...validTexturePlan.assignments[0]!, materialId: "missing" }],
}).success, false, "assigned materials must exist");
assert.equal(CuboidTexturePlanSchema.safeParse({
  ...validTexturePlan,
  materials: [{ ...validTexturePlan.materials[0]!, colors: { ...validTexturePlan.materials[0]!.colors, base: "red" } }],
}).success, false, "colors use exact RGB hex notation");

const validIcon: PixelIconPlan = {
  schemaVersion: 0,
  kind: "pixel-icon",
  id: "mcdev:item/death_scythe",
  size: 32,
  palette: [
    { id: "shaft", color: "#241d31" },
    { id: "edge", color: "#ede4c6" },
  ],
  primitives: [
    { type: "line", from: [7, 28], to: [19, 8], thickness: 3, colorId: "shaft" },
    { type: "rectangle", origin: [18, 6], size: [10, 2], colorId: "edge" },
  ],
};
assert.equal(PixelIconPlanSchema.safeParse(validIcon).success, true);
assert.equal(PixelIconPlanJsonSchema.additionalProperties, false);
assert.equal(PixelIconPlanSchema.safeParse({ ...validIcon, command: "draw" }).success, false);
assert.equal(PixelIconPlanSchema.safeParse({
  ...validIcon,
  primitives: [{ ...validIcon.primitives[0]!, colorId: "missing" }],
}).success, false, "primitive colors must exist");
assert.equal(PixelIconPlanSchema.safeParse({
  ...validIcon,
  size: 16,
}).success, false, "primitive coordinates must fit the icon");
