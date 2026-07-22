import { CropAssetPlanSchema, type CropAssetPlan, type PixelIconPlan } from "@mcdev/assets-contracts";
import { compileInventoryIcon, type RenderedPixelIcon } from "./inventory-icon.ts";

export type CropLayer = "lower" | "upper";

function pixel(value: number): number {
  return Math.max(0, Math.min(15, value));
}

function parsePlan(input: unknown): CropAssetPlan {
  const result = CropAssetPlanSchema.safeParse(input);
  if (!result.success) throw new TypeError(`Invalid CropAssetPlan (${result.error.issues[0]?.message ?? "validation failed"}).`);
  return result.data;
}

export function renderCropStageTexture(
  input: unknown,
  layer: CropLayer,
  stage: number,
): RenderedPixelIcon {
  const plan = parsePlan(input);
  if (!Number.isInteger(stage) || stage < 0 || stage >= plan.visualStages) {
    throw new RangeError(`Crop visual stage must be between 0 and ${plan.visualStages - 1}.`);
  }
  if (layer === "upper" && plan.layers !== "double") {
    throw new TypeError("Single-layer crops cannot render an upper texture.");
  }
  const progress = stage / (plan.visualStages - 1);
  const sway = (plan.seed + stage) % 2 === 0 ? -1 : 1;
  const primitives: PixelIconPlan["primitives"][number][] = [];
  const stemCount = 1 + Math.floor(progress * 3);
  const height = layer === "lower" ? 4 + Math.round(progress * 9) : 6 + Math.round(progress * 7);
  const top = 15 - height;
  const offsets = [-4, -1, 2, 4];
  for (let index = 0; index < stemCount; index += 1) {
    const offset = offsets[index] ?? 0;
    const baseX = 8 + offset;
    const tipX = baseX + (index % 2 === 0 ? sway : -sway);
    primitives.push({ type: "line", from: [baseX, 15], to: [tipX, top], thickness: 1, colorId: "stem" });
    if (progress >= 0.25) {
      const leafY = 14 - Math.floor(height * (0.35 + index * 0.08));
      const direction = index % 2 === 0 ? -1 : 1;
      primitives.push({
        type: "line",
        from: [baseX, leafY],
        to: [pixel(baseX + direction * (2 + Math.round(progress * 2))), pixel(Math.max(top + 2, leafY - 2))],
        thickness: 1,
        colorId: "leaf",
      });
    }
    if (progress >= 0.66) {
      const direction = index % 2 === 0 ? -1 : 1;
      const panicleX = pixel(tipX + direction * (2 + (stage % 2)));
      const panicleY = pixel(top + 2 + (index % 2));
      primitives.push({
        type: "line",
        from: [tipX, top],
        to: [panicleX, panicleY],
        thickness: 1,
        colorId: "leaf",
      });
      primitives.push({ type: "rectangle", origin: [panicleX, pixel(panicleY - 1)], size: [1, 2], colorId: "grain" });
      primitives.push({
        type: "rectangle",
        origin: [pixel(Math.round((tipX + panicleX) / 2)), pixel(Math.round((top + panicleY) / 2))],
        size: [1, 1],
        colorId: "grain",
      });
    }
  }
  primitives.push({ type: "line", from: [8, 15], to: [8 + sway, Math.min(14, top + 1)], thickness: 1, colorId: "highlight" });
  return compileInventoryIcon({
    schemaVersion: 0,
    kind: "pixel-icon",
    id: `${plan.id}_${layer}_stage${stage}`,
    size: 16,
    palette: [
      { id: "stem", color: plan.palette.stem },
      { id: "leaf", color: plan.palette.leaf },
      { id: "highlight", color: plan.palette.highlight },
      { id: "grain", color: plan.palette.matureAccent },
    ],
    primitives,
  }).texture;
}
