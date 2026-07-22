import { createHash } from "node:crypto";
import {
  PixelIconPlanSchema,
  type PixelIconPlan,
} from "@mcdev/assets-contracts";
import { encodeRgbaPng } from "./texture.ts";

export interface RenderedPixelIcon {
  readonly format: "png";
  readonly width: 16 | 32;
  readonly height: 16 | 32;
  readonly bytes: Uint8Array;
  readonly dataUrl: string;
  readonly sha256: string;
  readonly opaquePixels: number;
  readonly colorCount: number;
}

export interface CompiledInventoryIcon {
  readonly texture: RenderedPixelIcon;
  readonly itemModelText: string;
  readonly itemModelSha256: string;
}

type Rgba = readonly [number, number, number, 255];

function parseHex(value: string): Rgba {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    255,
  ];
}

function setPixel(pixels: Uint8Array, size: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  pixels.set(color, (y * size + x) * 4);
}

function drawThickPixel(
  pixels: Uint8Array,
  size: number,
  x: number,
  y: number,
  thickness: number,
  color: Rgba,
): void {
  const before = Math.floor((thickness - 1) / 2);
  const after = thickness - before - 1;
  for (let offsetY = -before; offsetY <= after; offsetY += 1) {
    for (let offsetX = -before; offsetX <= after; offsetX += 1) {
      setPixel(pixels, size, x + offsetX, y + offsetY, color);
    }
  }
}

function drawLine(
  pixels: Uint8Array,
  size: number,
  from: readonly [number, number],
  to: readonly [number, number],
  thickness: number,
  color: Rgba,
): void {
  let x = from[0];
  let y = from[1];
  const deltaX = Math.abs(to[0] - x);
  const deltaY = Math.abs(to[1] - y);
  const stepX = x < to[0] ? 1 : -1;
  const stepY = y < to[1] ? 1 : -1;
  let error = deltaX - deltaY;
  while (true) {
    drawThickPixel(pixels, size, x, y, thickness, color);
    if (x === to[0] && y === to[1]) break;
    const doubled = error * 2;
    if (doubled > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (doubled < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function render(plan: PixelIconPlan): RenderedPixelIcon {
  const pixels = new Uint8Array(plan.size * plan.size * 4);
  const palette = new Map(plan.palette.map(({ id, color }) => [id, parseHex(color)]));
  for (const primitive of plan.primitives) {
    const color = palette.get(primitive.colorId);
    if (color === undefined) throw new Error("Validated icon palette became inconsistent.");
    if (primitive.type === "line") {
      drawLine(pixels, plan.size, primitive.from, primitive.to, primitive.thickness, color);
      continue;
    }
    for (let y = 0; y < primitive.size[1]; y += 1) {
      for (let x = 0; x < primitive.size[0]; x += 1) {
        setPixel(pixels, plan.size, primitive.origin[0] + x, primitive.origin[1] + y, color);
      }
    }
  }
  let opaquePixels = 0;
  const colors = new Set<number>();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] !== 255) continue;
    opaquePixels += 1;
    colors.add(((pixels[offset] ?? 0) << 16) | ((pixels[offset + 1] ?? 0) << 8) | (pixels[offset + 2] ?? 0));
  }
  const bytes = encodeRgbaPng(plan.size, plan.size, pixels);
  return Object.freeze({
    format: "png" as const,
    width: plan.size,
    height: plan.size,
    bytes,
    dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    opaquePixels,
    colorCount: colors.size,
  });
}

export function compileInventoryIcon(input: unknown): CompiledInventoryIcon {
  const result = PixelIconPlanSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new TypeError(`Invalid PixelIconPlan (${issue?.message ?? "validation failed"}).`);
  }
  const texture = render(result.data);
  const itemModelText = `${JSON.stringify({
    parent: "minecraft:item/handheld",
    textures: { layer0: result.data.id },
  }, null, 2)}\n`;
  return Object.freeze({
    texture,
    itemModelText,
    itemModelSha256: createHash("sha256").update(itemModelText, "utf8").digest("hex"),
  });
}
