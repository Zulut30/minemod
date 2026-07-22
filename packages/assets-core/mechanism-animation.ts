import {
  CuboidAnimationPlanSchema,
  type ArticulatedModelPlan,
  type CuboidAnimationPlan,
} from "@mcdev/assets-contracts";

function animationStem(modelId: string): string {
  return modelId.replace(":", ".").replace(/[^a-z0-9_.]/gu, "_");
}

export function createClockworkStampAnimationPlan(plan: ArticulatedModelPlan): CuboidAnimationPlan {
  const boneIds = new Set(plan.bones.map(({ id }) => id));
  for (const required of ["drive_shaft", "cam", "left_flywheel", "right_flywheel", "press_slider", "press_head"]) {
    if (!boneIds.has(required)) throw new TypeError(`Clockwork stamp animation requires bone ${required}.`);
  }
  const result = CuboidAnimationPlanSchema.safeParse({
    schemaVersion: 0,
    kind: "cuboid-animation-plan",
    modelId: plan.id,
    clips: [{
      id: "work_cycle",
      name: `animation.${animationStem(plan.id)}.work_cycle`,
      loop: "loop",
      length: 1.2,
      snapping: 20,
      tracks: [
        {
          boneId: "drive_shaft",
          channel: "rotation",
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: "linear" },
            { time: 0.3, value: [120, 0, 0], interpolation: "catmullrom" },
            { time: 0.6, value: [0, 0, 0], interpolation: "catmullrom" },
            { time: 0.9, value: [-120, 0, 0], interpolation: "catmullrom" },
            { time: 1.2, value: [0, 0, 0], interpolation: "linear" },
          ],
        },
        {
          boneId: "press_slider",
          channel: "position",
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: "linear" },
            { time: 0.3, value: [0, 0, 0], interpolation: "linear" },
            { time: 0.5, value: [0, -5, 0], interpolation: "catmullrom" },
            { time: 0.65, value: [0, -5, 0], interpolation: "linear" },
            { time: 0.9, value: [0, 0, 0], interpolation: "catmullrom" },
            { time: 1.2, value: [0, 0, 0], interpolation: "linear" },
          ],
        },
        {
          boneId: "frame",
          channel: "rotation",
          keyframes: [
            { time: 0, value: [0, 0, 0], interpolation: "linear" },
            { time: 0.5, value: [0, 0, 0.6], interpolation: "catmullrom" },
            { time: 0.65, value: [0, 0, -0.6], interpolation: "catmullrom" },
            { time: 0.9, value: [0, 0, 0], interpolation: "catmullrom" },
            { time: 1.2, value: [0, 0, 0], interpolation: "linear" },
          ],
        },
      ],
    }],
  });
  if (!result.success) throw new TypeError(`Generated clockwork stamp animation plan is invalid: ${result.error.message}`);
  return result.data;
}
