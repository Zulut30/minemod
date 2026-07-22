import type { ArticulatedModelPlan } from "@mcdev/assets-contracts";

type Bone = ArticulatedModelPlan["bones"][number];
type Cube = Bone["cubes"][number];
type Vector3 = [number, number, number];

export interface BilateralBonePairOptions {
  readonly id: string;
  readonly parents: string | readonly [string, string];
  readonly leftPivotOffset: Vector3;
  readonly cubes: readonly Cube[];
  readonly leftRotation?: Vector3;
}

export function mirrorRotationAcrossX([x, y, z]: Vector3): Vector3 {
  return [x, -y, -z];
}

export function mirrorOriginAcrossX(origin: Vector3, size: Vector3): Vector3 {
  return [-origin[0] - size[0], origin[1], origin[2]];
}

/**
 * Expands one authored side into a deterministic left/right pair. IDs, parents,
 * pivots, cube origins, rotations and the box-UV mirror flag stay synchronized.
 */
export function createBilateralBonePair(options: BilateralBonePairOptions): readonly [Bone, Bone] {
  const [leftParent, rightParent] = typeof options.parents === "string" ?
    [options.parents, options.parents] : options.parents;
  const leftId = `left_${options.id}`;
  const rightId = `right_${options.id}`;
  const leftRotation = options.leftRotation ?? [0, 0, 0];
  const leftCubes = options.cubes.map((part) => ({ ...part, id: `${leftId}_${part.id}` }));
  const rightCubes = options.cubes.map((part) => ({
    ...part,
    id: `${rightId}_${part.id}`,
    originOffset: mirrorOriginAcrossX(part.originOffset, part.size),
    rotation: mirrorRotationAcrossX(part.rotation),
    mirror: true,
  }));
  return [
    {
      id: leftId,
      parent: leftParent,
      pivotOffset: options.leftPivotOffset,
      rotation: leftRotation,
      cubes: leftCubes,
    },
    {
      id: rightId,
      parent: rightParent,
      pivotOffset: [-options.leftPivotOffset[0], options.leftPivotOffset[1], options.leftPivotOffset[2]],
      rotation: mirrorRotationAcrossX(leftRotation),
      cubes: rightCubes,
    },
  ];
}
