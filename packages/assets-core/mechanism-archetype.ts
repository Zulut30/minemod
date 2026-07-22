import { ArticulatedModelPlanSchema, type ArticulatedModelPlan } from "@mcdev/assets-contracts";
import type { ReferenceCatalogReport } from "./reference-analysis.ts";
import { createBilateralBonePair } from "./symmetry.ts";

type Vector3 = [number, number, number];
type Bone = ArticulatedModelPlan["bones"][number];
type Cube = Bone["cubes"][number];

export interface MechanismArchetypeOptions {
  readonly id: string;
  readonly name: string;
}

function cube(id: string, originOffset: Vector3, size: Vector3, rotation: Vector3 = [0, 0, 0]): Cube {
  return { id, originOffset, size, rotation, inflate: 0, mirror: false };
}

function bone(id: string, parent: string | null, pivotOffset: Vector3, cubes: readonly Cube[]): Bone {
  return { id, parent, pivotOffset, rotation: [0, 0, 0], cubes: [...cubes] };
}

function requirePromotedMechanismRules(report: ReferenceCatalogReport): void {
  if (!report.readyForRulePromotion) throw new TypeError("Mechanism reference catalog is not ready for rule promotion.");
  const promoted = new Set(report.candidateRules.filter(({ promotable }) => promotable).map(({ id }) => id));
  for (const required of ["make_machine_state_visible", "reuse_directional_geometry_with_rotation"]) {
    if (!promoted.has(required)) throw new TypeError(`Mechanism reference rule ${required} is not promoted.`);
  }
}

/** Original animation-ready stamp mill derived only from promoted cross-project design rules. */
export function createClockworkStampArchetype(
  options: MechanismArchetypeOptions,
  references: ReferenceCatalogReport,
): ArticulatedModelPlan {
  requirePromotedMechanismRules(references);
  const bones: Bone[] = [
    bone("root", null, [0, 0, 0], []),
    bone("base", "root", [0, 0, 0], [
      cube("base_plinth", [-11, 0, -9], [22, 3, 18]),
      cube("base_front_rail", [-10, 3, -9], [20, 2, 3]),
      cube("base_rear_rail", [-10, 3, 6], [20, 2, 3]),
      cube("base_left_foot", [-12, 0, -10], [4, 2, 4]),
      cube("base_right_foot", [8, 0, -10], [4, 2, 4]),
    ]),
    bone("frame", "base", [0, 3, 0], [
      cube("frame_left_post", [-10, 0, -6], [3, 21, 12]),
      cube("frame_right_post", [7, 0, -6], [3, 21, 12]),
      cube("frame_top_beam", [-11, 19, -7], [22, 4, 14]),
      cube("frame_rear_brace", [-8, 4, 5], [16, 3, 3], [0, 0, -18]),
      cube("frame_front_panel", [-7, 13, -7], [14, 5, 2]),
    ]),
    bone("hopper", "frame", [0, 22, 0], [
      cube("hopper_throat", [-3, -3, -3], [6, 5, 6]),
      cube("hopper_bowl", [-6, 2, -6], [12, 5, 12]),
      cube("hopper_lip", [-7, 7, -7], [14, 2, 14]),
    ]),
    bone("drive_shaft", "frame", [0, 12, 2], [
      cube("drive_shaft_axle", [-13, -1, -1], [26, 2, 2]),
      cube("drive_shaft_collar", [-3, -3, -3], [6, 6, 6]),
    ]),
    bone("cam", "drive_shaft", [0, 0, 0], [
      cube("cam_core", [-3, -5, -2], [6, 10, 4]),
      cube("cam_lobe", [-2, 3, -2], [7, 5, 4], [0, 0, 18]),
    ]),
    bone("press_slider", "frame", [0, 18, -1], [
      cube("press_slider_rod", [-2, -12, -2], [4, 13, 4]),
      cube("press_slider_guide", [-4, -3, -4], [8, 4, 8]),
    ]),
    bone("press_head", "press_slider", [0, -12, 0], [
      cube("press_head_plate", [-6, -2, -6], [12, 4, 12]),
      cube("press_head_die", [-4, -4, -4], [8, 3, 8]),
    ]),
    bone("output_tray", "base", [0, 4, -7], [
      cube("output_tray_floor", [-8, -1, -6], [16, 2, 10]),
      cube("output_tray_left_lip", [-9, 0, -6], [2, 3, 10]),
      cube("output_tray_right_lip", [7, 0, -6], [2, 3, 10]),
    ]),
    bone("state_indicator", "frame", [0, 16, -8], [
      cube("state_indicator_frame", [-4, -2, 0], [8, 4, 2]),
      cube("state_indicator_lamp", [-2, -1, -1], [4, 2, 1]),
      cube("state_indicator_arrow", [-1, -5, 0], [2, 4, 1]),
    ]),
  ];
  bones.push(...createBilateralBonePair({
    id: "flywheel",
    parents: "drive_shaft",
    leftPivotOffset: [10, 0, 0],
    cubes: [
      cube("hub", [-2, -2, -2], [4, 4, 4]),
      cube("vertical_spoke", [-1, -7, -2], [2, 14, 4]),
      cube("horizontal_spoke", [-1, -2, -7], [2, 4, 14]),
      cube("rim_top", [-1, -8, -5], [2, 3, 10]),
      cube("rim_bottom", [-1, 5, -5], [2, 3, 10]),
      cube("rim_front", [-1, -5, -8], [2, 10, 3]),
      cube("rim_back", [-1, -5, 5], [2, 10, 3]),
    ],
  }));
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
  if (!parsed.success) throw new TypeError(`Generated clockwork stamp archetype is invalid: ${parsed.error.message}`);
  return parsed.data;
}
