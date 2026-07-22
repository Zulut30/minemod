import {
  CuboidTexturePlanSchema,
  type ArticulatedModelPlan,
  type CuboidTexturePlan,
} from "@mcdev/assets-contracts";

export type MechanismVisualState = "idle" | "active";

function stableSeed(id: string): number {
  const canonical = id.replace(/^(?:left|right)_/u, "side_");
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function createClockworkStampTexturePlan(
  plan: ArticulatedModelPlan,
  state: MechanismVisualState,
): CuboidTexturePlan {
  const assignments = plan.bones.flatMap(({ cubes }) => cubes.map(({ id }) => {
    let materialId = "iron";
    let pattern: CuboidTexturePlan["assignments"][number]["pattern"] = "panel";
    let detailScale = 1;
    if (id.includes("flywheel") || id.includes("cam_lobe") || id.includes("collar") || id.includes("arrow")) {
      materialId = "brass";
      pattern = "riveted";
    } else if (id.includes("shaft") || id.includes("rod") || id.includes("die") || id.includes("hub")) {
      materialId = "steel";
      pattern = "gradient";
    } else if (id.includes("lamp")) {
      materialId = "signal";
      pattern = "gradient";
      detailScale = 2;
    } else if (id.includes("hopper") || id.includes("tray")) {
      materialId = "enamel";
      pattern = "riveted";
    } else if (id.includes("foot") || id.includes("rail")) {
      materialId = "steel";
      pattern = "riveted";
    }
    return { cubeId: id, materialId, pattern, detailScale, seed: stableSeed(id) };
  }));
  const signal = state === "active"
    ? { base: "#e39a25", shadow: "#753714", highlight: "#ffe783", accent: "#ff5a1f" }
    : { base: "#5e4630", shadow: "#291f1a", highlight: "#8a7051", accent: "#704629" };
  const result = CuboidTexturePlanSchema.safeParse({
    schemaVersion: 0,
    kind: "cuboid-texture-plan",
    modelId: plan.id,
    materials: [
      { id: "iron", colors: { base: "#4f5b5d", shadow: "#252e31", highlight: "#829093", accent: "#374347" } },
      { id: "steel", colors: { base: "#303942", shadow: "#151b21", highlight: "#65717d", accent: "#46525d" } },
      { id: "brass", colors: { base: "#a67b32", shadow: "#533a1f", highlight: "#dfbd63", accent: "#785423" } },
      { id: "enamel", colors: { base: "#315e62", shadow: "#173235", highlight: "#619397", accent: "#24484c" } },
      { id: "signal", colors: signal },
    ],
    assignments,
  });
  if (!result.success) throw new TypeError(`Generated clockwork stamp texture plan is invalid: ${result.error.message}`);
  return result.data;
}
