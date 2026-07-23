import { createHash } from "node:crypto";
import type { PixelIconPlan } from "@mcdev/assets-contracts";
import { compileInventoryIcon, type RenderedPixelIcon } from "./inventory-icon.ts";
import { encodeRgbaPng } from "./texture.ts";

export type ToolVisualKind = "sword" | "pickaxe" | "axe" | "shovel" | "hoe";
export type ArmorVisualKind = "helmet" | "chestplate" | "leggings" | "boots";
export type EquipmentSilhouette = "balanced" | "heavy" | "ornate";
export type EquipmentMotif = "clean" | "riveted" | "runed" | "organic";

export interface EquipmentVisualProfile {
  readonly silhouette: EquipmentSilhouette;
  readonly motif: EquipmentMotif;
}

export const DEFAULT_EQUIPMENT_VISUAL_PROFILE: EquipmentVisualProfile = Object.freeze({
  silhouette: "balanced",
  motif: "clean",
});

export interface EquipmentPalette {
  readonly base: string;
  readonly shadow: string;
  readonly highlight: string;
  readonly accent: string;
  readonly handle: string;
}

export interface RenderedEquipmentTexture {
  readonly format: "png";
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly opaquePixels: number;
  readonly colorCount: number;
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

function toolPrimitives(kind: ToolVisualKind, silhouette: EquipmentSilhouette): Primitive[] {
  const headThickness = 4;
  const bladeThickness = silhouette === "ornate" ? 3 : 4;
  const handle = [
    line([2, 14], [9, 7], 3, "shadow"),
    line([2, 14], [9, 7], 2, "handle"),
    line([3, 13], [9, 7], 1, "highlight"),
    rectangle([1, 13], [3, 3], "accent"),
  ];
  if (kind === "sword") return [
    line([5, 11], [13, 3], bladeThickness, "shadow"), line([5, 11], [13, 3], silhouette === "heavy" ? 3 : 2, "base"),
    line([7, 9], [13, 3], 1, "highlight"), line([3, 10], [7, 14], 2, "accent"), ...handle.slice(0, 2),
    ...(silhouette === "ornate" ? [rectangle([12, 2], [2, 2], "accent")] : []),
  ];
  if (kind === "pickaxe") return [
    ...handle, line([6, 5], [14, 5], headThickness, "shadow"), line([6, 5], [14, 5], silhouette === "heavy" ? 3 : 2, "base"),
    line([7, 4], [13, 4], 1, "highlight"), rectangle([13, 5], [2, 2], "accent"),
    ...(silhouette === "ornate" ? [rectangle([5, 3], [2, 2], "accent")] : []),
  ];
  if (kind === "axe") return [
    ...handle, rectangle([silhouette === "heavy" ? 7 : 8, 3], [silhouette === "heavy" ? 7 : 6, silhouette === "heavy" ? 7 : 6], "shadow"),
    rectangle([9, 3], [5, silhouette === "heavy" ? 5 : 4], "base"),
    rectangle([10, 3], [4, 1], "highlight"), rectangle([12, 7], [2, 2], "accent"),
    ...(silhouette === "ornate" ? [rectangle([8, 7], [2, 2], "accent")] : []),
  ];
  if (kind === "shovel") return [
    ...handle, rectangle([silhouette === "heavy" ? 8 : 9, 2], [silhouette === "heavy" ? 6 : 5, silhouette === "heavy" ? 7 : 6], "shadow"),
    rectangle([10, 2], [silhouette === "heavy" ? 4 : 3, silhouette === "heavy" ? 6 : 5], "base"),
    rectangle([10, 2], [3, 1], "highlight"), rectangle([10, 6], [3, 2], "accent"),
    ...(silhouette === "ornate" ? [rectangle([9, 7], [2, 2], "accent")] : []),
  ];
  return [...handle, line([7, 5], [14, 5], headThickness, "shadow"),
    line([8, 5], [14, 5], silhouette === "heavy" ? 3 : 2, "base"),
    rectangle([13, 5], [2, 3], "accent"),
    ...(silhouette === "ornate" ? [rectangle([7, 3], [2, 2], "accent")] : [])];
}

function equipmentMotifPrimitives(kind: ToolVisualKind | ArmorVisualKind, motif: EquipmentMotif): Primitive[] {
  if (motif === "clean") return [];
  if (motif === "riveted") {
    return kind === "chestplate" || kind === "leggings"
      ? [rectangle([5, 6], [1, 1], "accent"), rectangle([10, 6], [1, 1], "accent")]
      : [rectangle([8, 7], [1, 1], "accent"), rectangle([10, 5], [1, 1], "accent")];
  }
  if (motif === "runed") {
    return [line([6, 9], [9, 6], 1, "accent"), rectangle([8, 7], [1, 1], "highlight")];
  }
  return [
    rectangle([7, 8], [1, 2], "accent"),
    rectangle([8, 7], [1, 2], "accent"),
    rectangle([9, 6], [1, 2], "highlight"),
  ];
}

function armorPrimitives(kind: ArmorVisualKind, silhouette: EquipmentSilhouette): Primitive[] {
  const heavy = silhouette === "heavy";
  const ornate = silhouette === "ornate";
  if (kind === "helmet") return [
    rectangle([4, 3], [8, 2], "shadow"), rectangle([3, 5], [3, 7], "shadow"),
    rectangle([10, 5], [3, 7], "shadow"), rectangle([5, 4], [6, 2], "base"),
    rectangle([4, 6], [2, 5], "base"), rectangle([10, 6], [2, 5], "base"),
    rectangle([5, 4], [5, 1], "highlight"), rectangle([4, 10], [2, 2], "accent"),
    ...(heavy ? [rectangle([2, 5], [2, 7], "shadow"), rectangle([12, 5], [2, 7], "shadow")] : []),
    ...(ornate ? [rectangle([7, 1], [2, 3], "accent")] : []),
  ];
  if (kind === "chestplate") return [
    rectangle([2, 3], [4, 4], "shadow"), rectangle([10, 3], [4, 4], "shadow"),
    rectangle([4, 4], [8, 10], "shadow"), rectangle([5, 4], [6, 9], "base"),
    rectangle([3, 4], [2, 2], "base"), rectangle([11, 4], [2, 2], "base"),
    rectangle([6, 5], [4, 1], "highlight"), rectangle([7, 7], [2, 2], "accent"),
    rectangle([7, 9], [1, 3], "shadow"),
    ...(heavy ? [rectangle([1, 3], [3, 4], "shadow"), rectangle([12, 3], [3, 4], "shadow")] : []),
    ...(ornate ? [rectangle([3, 12], [10, 2], "accent")] : []),
  ];
  if (kind === "leggings") return [
    rectangle([3, 3], [10, 4], "shadow"), rectangle([4, 4], [8, 3], "base"),
    rectangle([3, 7], [4, 7], "shadow"), rectangle([9, 7], [4, 7], "shadow"),
    rectangle([4, 7], [2, 6], "base"), rectangle([10, 7], [2, 6], "base"),
    rectangle([4, 4], [8, 1], "highlight"), rectangle([7, 4], [2, 3], "accent"),
    ...(heavy ? [rectangle([2, 7], [2, 7], "shadow"), rectangle([12, 7], [2, 7], "shadow")] : []),
    ...(ornate ? [rectangle([3, 6], [10, 2], "accent")] : []),
  ];
  return [
    rectangle([2, 8], [5, 6], "shadow"), rectangle([9, 8], [5, 6], "shadow"),
    rectangle([3, 8], [3, 5], "base"), rectangle([10, 8], [3, 5], "base"),
    rectangle([3, 8], [3, 1], "highlight"), rectangle([10, 8], [3, 1], "highlight"),
    rectangle([2, 12], [5, 2], "accent"), rectangle([9, 12], [5, 2], "accent"),
    ...(heavy ? [rectangle([1, 11], [6, 3], "shadow"), rectangle([9, 11], [6, 3], "shadow")] : []),
    ...(ornate ? [rectangle([4, 7], [1, 2], "accent"), rectangle([11, 7], [1, 2], "accent")] : []),
  ];
}

export function renderToolInventoryIcon(
  materialId: string,
  kind: ToolVisualKind,
  palette: EquipmentPalette = deriveEquipmentPalette(materialId),
  profile: EquipmentVisualProfile = DEFAULT_EQUIPMENT_VISUAL_PROFILE,
): RenderedPixelIcon {
  return compileInventoryIcon({
    schemaVersion: 0,
    kind: "pixel-icon",
    id: `${materialId.split(":")[0]}:item/${materialId.split(":")[1]}_${kind}`,
    size: 16,
    palette: Object.entries(palette).map(([id, color]) => ({ id, color })),
    primitives: [...toolPrimitives(kind, profile.silhouette), ...equipmentMotifPrimitives(kind, profile.motif)],
  }).texture;
}

export function renderArmorInventoryIcon(
  materialId: string,
  kind: ArmorVisualKind,
  palette: EquipmentPalette = deriveEquipmentPalette(materialId),
  profile: EquipmentVisualProfile = DEFAULT_EQUIPMENT_VISUAL_PROFILE,
): RenderedPixelIcon {
  return compileInventoryIcon({
    schemaVersion: 0,
    kind: "pixel-icon",
    id: `${materialId.split(":")[0]}:item/${materialId.split(":")[1]}_${kind}`,
    size: 16,
    palette: Object.entries(palette).map(([id, color]) => ({ id, color })),
    primitives: [...armorPrimitives(kind, profile.silhouette), ...equipmentMotifPrimitives(kind, profile.motif)],
  }).texture;
}

function parseColor(value: string): readonly [number, number, number, 255] {
  if (!/^#[0-9a-f]{6}$/u.test(value)) throw new TypeError("Equipment palette colors must use lowercase RGB hex.");
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16), 255];
}

function renderArmorLayer(
  palette: EquipmentPalette,
  layer: 1 | 2,
  profile: EquipmentVisualProfile,
): RenderedEquipmentTexture {
  const colors = {
    base: parseColor(palette.base),
    shadow: parseColor(palette.shadow),
    highlight: parseColor(palette.highlight),
    accent: parseColor(palette.accent),
  };
  const width = 64;
  const height = 32;
  const pixels = new Uint8Array(width * height * 4);
  const used = new Set<number>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const localX = (x + layer * 2) % 8;
      const localY = (y + layer) % 8;
      const motifAccent = profile.motif === "riveted"
        ? localX === 2 && localY === 2
        : profile.motif === "runed"
          ? (localX === localY || localX + localY === 7) && (x + y) % 3 === 0
          : profile.motif === "organic"
            ? (x * 3 + y * 5 + layer) % 29 < 2
            : (x + y + layer * 5) % 23 === 0;
      const edgeWidth = profile.silhouette === "heavy" ? 2 : 1;
      const color = localX >= 8 - edgeWidth || localY >= 8 - edgeWidth ? colors.shadow
        : localX < 1 || localY < 1 ? colors.highlight
          : motifAccent ? colors.accent : colors.base;
      pixels.set(color, (y * width + x) * 4);
      used.add((color[0] << 16) | (color[1] << 8) | color[2]);
    }
  }
  const bytes = encodeRgbaPng(width, height, pixels);
  return Object.freeze({
    format: "png",
    width,
    height,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    opaquePixels: width * height,
    colorCount: used.size,
  });
}

export function renderWearableArmorLayers(
  materialId: string,
  palette: EquipmentPalette = deriveEquipmentPalette(materialId),
  profile: EquipmentVisualProfile = DEFAULT_EQUIPMENT_VISUAL_PROFILE,
): readonly [RenderedEquipmentTexture, RenderedEquipmentTexture] {
  return Object.freeze([renderArmorLayer(palette, 1, profile), renderArmorLayer(palette, 2, profile)]);
}
