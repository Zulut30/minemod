import {
  ArticulatedModelPlanSchema,
  CuboidTexturePlanSchema,
  type ArticulatedModelPlan,
  type CuboidTexturePlan,
} from "@mcdev/assets-contracts";

type Vector3 = [number, number, number];
type Bone = ArticulatedModelPlan["bones"][number];
type Cube = Bone["cubes"][number];

export interface DragonArchetypeOptions {
  readonly id: string;
  readonly name: string;
}

function cube(
  id: string,
  originOffset: Vector3,
  size: [number, number, number],
  rotation: Vector3 = [0, 0, 0],
): Cube {
  return { id, originOffset, size, rotation, inflate: 0, mirror: false };
}

function bone(
  id: string,
  parent: string | null,
  pivotOffset: Vector3,
  cubes: readonly Cube[],
  rotation: Vector3 = [0, 0, 0],
): Bone {
  return { id, parent, pivotOffset, rotation, cubes: [...cubes] };
}

function mirrorRotation([x, y, z]: Vector3): Vector3 {
  return [x, -y, -z];
}

function bilateralPair(
  id: string,
  parents: string | readonly [string, string],
  leftPivotOffset: Vector3,
  cubes: readonly Cube[],
  leftRotation: Vector3 = [0, 0, 0],
): readonly [Bone, Bone] {
  const [leftParent, rightParent] = typeof parents === "string" ? [parents, parents] : parents;
  const leftId = `left_${id}`;
  const rightId = `right_${id}`;
  const leftCubes = cubes.map((part) => ({ ...part, id: `${leftId}_${part.id}` }));
  const rightCubes = cubes.map((part) => ({
    ...part,
    id: `${rightId}_${part.id}`,
    originOffset: [-part.originOffset[0] - part.size[0], part.originOffset[1], part.originOffset[2]] as Vector3,
    rotation: mirrorRotation(part.rotation),
    mirror: true,
  }));
  return [
    bone(leftId, leftParent, leftPivotOffset, leftCubes, leftRotation),
    bone(rightId, rightParent, [-leftPivotOffset[0], leftPivotOffset[1], leftPivotOffset[2]], rightCubes,
      mirrorRotation(leftRotation)),
  ];
}

/**
 * Produces a large, animation-ready Minecraft dragon blockout. Bilateral anatomy is
 * authored once and mirrored deterministically, while the neck and tail use separate
 * pivots so procedural animation can bend them without deforming the torso.
 */
export function createDragonArchetype(options: DragonArchetypeOptions): ArticulatedModelPlan {
  const bones: Bone[] = [
    bone("root", null, [0, 16, 0], []),
    bone("body", "root", [0, 8, 0], [
      cube("body_core", [-10, -7, -14], [20, 14, 28]),
      cube("body_back", [-8, 6, -10], [16, 5, 20]),
      cube("body_belly", [-8, -10, -9], [16, 5, 19]),
      cube("body_spine", [-2, 10, -3], [4, 6, 7], [0, 0, 45]),
    ]),
    bone("chest", "body", [0, 2, -10], [
      cube("chest_core", [-12, -8, -10], [24, 16, 20]),
      cube("chest_plate", [-10, -10, -8], [20, 5, 16]),
      cube("chest_spine", [-2, 8, -4], [4, 7, 8], [0, 0, 45]),
    ]),
    bone("pelvis", "body", [0, -1, 12], [
      cube("pelvis_core", [-9, -6, -6], [18, 12, 14]),
      cube("pelvis_spine", [-2, 6, -2], [4, 6, 7], [0, 0, 45]),
    ]),
    bone("neck_base", "chest", [0, 3, -10], [
      cube("neck_base_core", [-7, -5, -12], [14, 11, 13]),
      cube("neck_base_spine", [-2, 5, -7], [4, 6, 6], [0, 0, 45]),
    ], [12, 0, 0]),
    bone("neck_mid", "neck_base", [0, 2, -10], [
      cube("neck_mid_core", [-6, -4, -10], [12, 9, 11]),
      cube("neck_mid_spine", [-2, 4, -6], [4, 6, 6], [0, 0, 45]),
    ], [-6, 0, 0]),
    bone("neck_upper", "neck_mid", [0, 2, -8], [
      cube("neck_upper_core", [-5, -3, -9], [10, 8, 10]),
      cube("neck_upper_spine", [-2, 4, -5], [4, 5, 5], [0, 0, 45]),
    ], [-4, 0, 0]),
    bone("head", "neck_upper", [0, 2, -8], [
      cube("head_core", [-7, -4, -10], [14, 9, 12]),
      cube("snout", [-5, -3, -15], [10, 6, 6]),
      cube("brow", [-7, 2, -9], [14, 3, 5]),
      cube("left_eye", [6, 0, -8], [1, 2, 2]),
      cube("right_eye", [-7, 0, -8], [1, 2, 2]),
      cube("head_spine", [-2, 4, -2], [4, 7, 7], [0, 0, 45]),
    ], [-2, 0, 0]),
    bone("jaw", "head", [0, -3, -9], [
      cube("jaw_core", [-5, -2, -9], [10, 3, 10]),
      cube("left_fang", [3, -4, -8], [2, 4, 3]),
      cube("right_fang", [-5, -4, -8], [2, 4, 3]),
    ], [8, 0, 0]),
    bone("tail_base", "pelvis", [0, 0, 7], [
      cube("tail_base_core", [-7, -5, 0], [14, 10, 14]),
      cube("tail_base_spine", [-2, 4, 4], [4, 6, 7], [0, 0, 45]),
    ]),
    bone("tail_2", "tail_base", [0, 0, 12], [
      cube("tail_2_core", [-6, -4, 0], [12, 8, 13]),
      cube("tail_2_spine", [-2, 3, 4], [4, 5, 6], [0, 0, 45]),
    ], [0, 5, 0]),
    bone("tail_3", "tail_2", [0, 0, 11], [
      cube("tail_3_core", [-5, -3, 0], [10, 7, 12]),
      cube("tail_3_spine", [-2, 3, 4], [4, 5, 6], [0, 0, 45]),
    ], [0, 7, 0]),
    bone("tail_4", "tail_3", [0, 1, 10], [
      cube("tail_4_core", [-4, -3, 0], [8, 6, 11]),
      cube("tail_4_spine", [-1, 2, 4], [3, 4, 5], [0, 0, 45]),
    ], [0, 8, 0]),
    bone("tail_5", "tail_4", [0, 1, 9], [
      cube("tail_5_core", [-3, -2, 0], [6, 5, 10]),
      cube("tail_5_spine", [-1, 2, 4], [3, 4, 5], [0, 0, 45]),
    ], [0, 8, 0]),
    bone("tail_6", "tail_5", [0, 1, 8], [cube("tail_6_core", [-2, -2, 0], [4, 4, 9])], [0, 7, 0]),
    bone("tail_tip", "tail_6", [0, 1, 7], [cube("tail_tip_core", [-1, -1, 0], [2, 3, 8])], [0, 6, 0]),
  ];

  bones.push(
    ...bilateralPair("wing_shoulder", "chest", [11, 5, -4], [
      cube("arm", [0, -2, -2], [18, 5, 5]),
      cube("membrane", [2, -1, -14], [16, 1, 14]),
    ], [0, -18, 12]),
    ...bilateralPair("wing_elbow", ["left_wing_shoulder", "right_wing_shoulder"], [16, 0, 0], [
      cube("arm", [0, -2, -2], [20, 4, 4]),
      cube("membrane", [0, -1, -17], [20, 1, 17]),
    ], [0, -12, 6]),
    ...bilateralPair("wing_wrist", ["left_wing_elbow", "right_wing_elbow"], [18, 0, 0], [
      cube("arm", [0, -1, -1], [16, 3, 3]),
      cube("membrane", [0, -1, -14], [16, 1, 14]),
    ], [0, -10, 4]),
    ...bilateralPair("wing_finger_1", ["left_wing_wrist", "right_wing_wrist"], [12, 0, 0], [
      cube("finger", [0, -1, -1], [18, 2, 2]),
      cube("membrane", [0, 0, -9], [16, 1, 9]),
    ], [0, -30, 0]),
    ...bilateralPair("wing_finger_2", ["left_wing_wrist", "right_wing_wrist"], [10, 0, -2], [
      cube("finger", [0, -1, -1], [16, 2, 2]),
      cube("membrane", [0, 0, -8], [14, 1, 8]),
    ], [0, -18, 0]),
    ...bilateralPair("wing_finger_3", ["left_wing_wrist", "right_wing_wrist"], [8, 0, -4], [
      cube("finger", [0, -1, -1], [14, 2, 2]),
      cube("membrane", [0, 0, -7], [12, 1, 7]),
    ], [0, -8, 0]),
    ...bilateralPair("front_upper_leg", "chest", [9, -4, -8], [
      cube("limb", [-2, -12, -3], [6, 13, 7]),
    ], [-15, 0, -8]),
    ...bilateralPair("front_lower_leg", ["left_front_upper_leg", "right_front_upper_leg"], [1, -11, 0], [
      cube("limb", [-2, -11, -2], [5, 12, 5]),
    ], [12, 0, 4]),
    ...bilateralPair("front_foot", ["left_front_lower_leg", "right_front_lower_leg"], [0, -10, -1], [
      cube("foot", [-3, -3, -8], [7, 4, 10]),
      cube("claw_1", [-3, -4, -12], [2, 2, 5]),
      cube("claw_2", [0, -4, -13], [2, 2, 6]),
      cube("claw_3", [3, -4, -12], [2, 2, 5]),
    ], [8, 0, 0]),
    ...bilateralPair("hind_upper_leg", "pelvis", [8, -2, 5], [
      cube("limb", [-2, -14, -5], [8, 15, 10]),
    ], [-18, 0, -7]),
    ...bilateralPair("hind_lower_leg", ["left_hind_upper_leg", "right_hind_upper_leg"], [2, -12, 1], [
      cube("limb", [-2, -12, -3], [6, 13, 6]),
    ], [18, 0, 4]),
    ...bilateralPair("hind_foot", ["left_hind_lower_leg", "right_hind_lower_leg"], [0, -11, -1], [
      cube("foot", [-4, -3, -8], [9, 4, 10]),
      cube("claw_1", [-4, -4, -12], [2, 2, 5]),
      cube("claw_2", [-1, -4, -13], [2, 2, 6]),
      cube("claw_3", [3, -4, -12], [2, 2, 5]),
    ], [8, 0, 0]),
    ...bilateralPair("horn_base", "head", [4, 3, -2], [cube("horn", [-1, 0, 0], [2, 3, 7])], [-35, 0, -15]),
    ...bilateralPair("horn_tip", ["left_horn_base", "right_horn_base"], [0, 1, 7], [
      cube("horn", [-1, 0, 0], [1, 2, 5]),
    ], [-20, 0, -8]),
  );

  const parsed = ArticulatedModelPlanSchema.safeParse({
    schemaVersion: 0,
    kind: "articulated-model-plan",
    id: options.id,
    name: options.name,
    modelType: "entity",
    texture: { width: 256, height: 256 },
    uvPadding: 1,
    bones,
  });
  if (!parsed.success) throw new TypeError(`Generated dragon archetype is invalid: ${parsed.error.message}`);
  return parsed.data;
}

export function createDragonTexturePlan(plan: ArticulatedModelPlan): CuboidTexturePlan {
  const assignments = plan.bones.flatMap(({ cubes }) => cubes.map(({ id }, index) => {
    let materialId = "hide";
    let pattern: CuboidTexturePlan["assignments"][number]["pattern"] = "scales";
    if (id.includes("membrane")) {
      materialId = "membrane";
      pattern = "gradient";
    } else if (id.includes("eye")) {
      materialId = "eye";
      pattern = "solid";
    } else if (id.includes("horn") || id.includes("claw") || id.includes("fang")) {
      materialId = "bone";
      pattern = "gradient";
    } else if (id.includes("belly") || id.includes("plate") || id.includes("jaw")) {
      materialId = "underbelly";
      pattern = "mottled";
    } else if (id.includes("spine")) {
      materialId = "spine";
      pattern = "gradient";
    }
    return { cubeId: id, materialId, pattern, seed: 10_000 + index * 97 };
  }));
  const parsed = CuboidTexturePlanSchema.safeParse({
    schemaVersion: 0,
    kind: "cuboid-texture-plan",
    modelId: plan.id,
    materials: [
      { id: "hide", colors: { base: "#436348", shadow: "#263b2b", highlight: "#799071", accent: "#557258" } },
      { id: "underbelly", colors: { base: "#8f8062", shadow: "#4f4938", highlight: "#c9b98d", accent: "#6f684e" } },
      { id: "membrane", colors: { base: "#694555", shadow: "#2f2029", highlight: "#a8747f", accent: "#543443" } },
      { id: "spine", colors: { base: "#26372e", shadow: "#101a15", highlight: "#536957", accent: "#394d3f" } },
      { id: "bone", colors: { base: "#b9ac87", shadow: "#665d49", highlight: "#eee0b5", accent: "#8d8164" } },
      { id: "eye", colors: { base: "#d89a22", shadow: "#6e300c", highlight: "#ffe56c", accent: "#f04d18" } },
    ],
    assignments,
  });
  if (!parsed.success) throw new TypeError(`Generated dragon texture plan is invalid: ${parsed.error.message}`);
  return parsed.data;
}
