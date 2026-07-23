import { createHash } from "node:crypto";
import type { PixelIconPlan } from "@mcdev/assets-contracts";
import { compileInventoryIcon, type RenderedPixelIcon } from "./inventory-icon.ts";

export type ToolVisualKind = "sword" | "pickaxe" | "axe" | "shovel" | "hoe";

export interface EquipmentPalette {
  readonly base: string;
  readonly shadow: string;
  readonly highlight: string;
  readonly accent: string;
  readonly handle: string;
}

type Primitive = PixelIconPlan["primitives"][number];

function colorHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

export function deriveEquipmentPalette(materialId: string): EquipmentPalette {
  const digest = createHash("sha256").update(materialId, "utf8").digest();
  const base = [70 + (digest[0] ?? 0) % 96, 80 + (digest[1] ?? 0) % 96, 90 + (digest[2] ?? 0) % 96] as const;
  return Object.freeze({
    base: colorHex(...base),
    shadow: colorHex(base[0] * 0.42, base[1] * 0.42, base[2] * 0.42),
    highlight: colorHex(base[0] + (255 - base[0]) * 0.62, base[1] + (255 - base[1]) * 0.62,
      base[2] + (255 - base[2]) * 0.62),
    accent: colorHex(150 + (digest[3] ?? 0) % 90, 100 + (digest[4] ?? 0) % 100, 35 + (digest[5] ?? 0) % 90),
    handle: colorHex(70 + (digest[6] ?? 0) % 45, 42 + (digest[7] ?? 0) % 35, 24 + (digest[8] ?? 0) % 25),
  });
}

const line = (from: [number, number], to: [number, number],
  thickness: number, colorId: string): Primitive => ({ type: "line", from, to, thickness, colorId });
const rectangle = (origin: [number, number], size: [number, number],
  colorId: string): Primitive => ({ type: "rectangle", origin, size, colorId });

function toolPrimitives(kind: ToolVisualKind): Primitive[] {
  const handle = [
    line([2, 14], [9, 7], 3, "shadow"),
    line([2, 14], [9, 7], 2, "handle"),
    line([3, 13], [9, 7], 1, "highlight"),
    rectangle([1, 13], [3, 3], "accent"),
  ];
  if (kind === "sword") return [
    line([5, 11], [13, 3], 4, "shadow"), line([5, 11], [13, 3], 2, "base"),
    line([7, 9], [13, 3], 1, "highlight"), line([3, 10], [7, 14], 2, "accent"), ...handle.slice(0, 2),
  ];
  if (kind === "pickaxe") return [
    ...handle, line([6, 5], [14, 5], 4, "shadow"), line([6, 5], [14, 5], 2, "base"),
    line([7, 4], [13, 4], 1, "highlight"), rectangle([13, 5], [2, 2], "accent"),
  ];
  if (kind === "axe") return [
    ...handle, rectangle([8, 3], [6, 6], "shadow"), rectangle([9, 3], [5, 4], "base"),
    rectangle([10, 3], [4, 1], "highlight"), rectangle([12, 7], [2, 2], "accent"),
  ];
  if (kind === "shovel") return [
    ...handle, rectangle([9, 2], [5, 6], "shadow"), rectangle([10, 2], [3, 5], "base"),
    rectangle([10, 2], [3, 1], "highlight"), rectangle([10, 6], [3, 2], "accent"),
  ];
  return [...handle, line([7, 5], [14, 5], 4, "shadow"), line([8, 5], [14, 5], 2, "base"),
    rectangle([13, 5], [2, 3], "accent")];
}

export function renderToolInventoryIcon(
  materialId: string,
  kind: ToolVisualKind,
  palette: EquipmentPalette = deriveEquipmentPalette(materialId),
): RenderedPixelIcon {
  return compileInventoryIcon({
    schemaVersion: 0,
    kind: "pixel-icon",
    id: `${materialId.split(":")[0]}:item/${materialId.split(":")[1]}_${kind}`,
    size: 16,
    palette: Object.entries(palette).map(([id, color]) => ({ id, color })),
    primitives: toolPrimitives(kind),
  }).texture;
}
