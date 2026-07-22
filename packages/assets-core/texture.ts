import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  CuboidModelSpecSchema,
  CuboidTexturePlanSchema,
  type CuboidModelSpec,
  type CuboidTexturePlan,
} from "@mcdev/assets-contracts";

export interface RenderedCuboidTextureAtlas {
  readonly format: "png";
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  readonly dataUrl: string;
  readonly sha256: string;
  readonly opaquePixels: number;
  readonly colorCount: number;
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

function invalid(kind: string, issue: string): never {
  throw new TypeError(`Invalid ${kind} (${issue}).`);
}

function parseInputs(modelInput: unknown, planInput: unknown): {
  readonly model: CuboidModelSpec;
  readonly plan: CuboidTexturePlan;
} {
  const modelResult = CuboidModelSpecSchema.safeParse(modelInput);
  if (!modelResult.success) invalid("CuboidModelSpec", modelResult.error.issues[0]?.message ?? "validation failed");
  const planResult = CuboidTexturePlanSchema.safeParse(planInput);
  if (!planResult.success) invalid("CuboidTexturePlan", planResult.error.issues[0]?.message ?? "validation failed");
  return { model: modelResult.data, plan: planResult.data };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  typeBytes.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + body.length)), 8 + body.length);
  return chunk;
}

export function encodeRgbaPng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    scanlines[rowStart] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(scanlines, rowStart + 1);
  }
  return Uint8Array.from(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", new Uint8Array()),
  ]));
}

function colorForPixel(
  pattern: CuboidTexturePlan["assignments"][number]["pattern"],
  colors: readonly [Rgba, Rgba, Rgba, Rgba],
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
  detailScale: number,
): Rgba {
  const [base, shadow, highlight, accent] = colors;
  const detailX = x * detailScale;
  const detailY = y * detailScale;
  if (x === 0 || y === 0) return highlight;
  if (x === width - 1 || y === height - 1) return shadow;
  if (pattern === "striped" && (x + y + seed) % 7 < 2) return accent;
  if (pattern === "panel" && (x === 2 || y === 2 || x === width - 3 || y === height - 3)) return shadow;
  if (pattern === "riveted" && ((x === 1 || x === width - 2) && (y === 1 || y === height - 2))) return accent;
  if (pattern === "scales") {
    const row = Math.floor(detailY / 4);
    const staggeredX = detailX + (row % 2) * 3 + seed;
    const scaleX = staggeredX % 6;
    if (detailY % 4 === 3 && scaleX > 0 && scaleX < 5) return shadow;
    if (scaleX === 0 && detailY % 4 === 0) return highlight;
    if (staggeredX % 12 === 6 && detailY % 4 === 1) return accent;
  }
  if (pattern === "mottled") {
    const patch = (Math.floor(detailX / 3) * 19 + Math.floor(detailY / 3) * 37 + seed) % 11;
    if (patch === 0 || patch === 1) return shadow;
    if (patch === 5) return accent;
    if (patch === 8) return highlight;
  }
  if (pattern === "gradient") {
    const vertical = height <= 2 ? 0.5 : y / (height - 1);
    if (vertical < 0.22) return highlight;
    if (vertical > 0.78) return shadow;
    if ((detailX * 13 + detailY * 7 + seed) % 31 === 0) return accent;
  }
  if (pattern !== "solid" && (detailX * 17 + detailY * 31 + seed) % 29 === 0) return highlight;
  return base;
}

export function renderCuboidTextureAtlas(modelInput: unknown, planInput: unknown): RenderedCuboidTextureAtlas {
  const { model, plan } = parseInputs(modelInput, planInput);
  if (model.id !== plan.modelId) invalid("CuboidTexturePlan", "modelId does not match CuboidModelSpec");

  const cubes = model.bones.flatMap(({ cubes: boneCubes }) => boneCubes);
  const cubeIds = new Set(cubes.map(({ id }) => id));
  const assignments = new Map(plan.assignments.map((assignment) => [assignment.cubeId, assignment]));
  const missing = cubes.filter(({ id }) => !assignments.has(id)).map(({ id }) => id);
  const unknown = plan.assignments.filter(({ cubeId }) => !cubeIds.has(cubeId)).map(({ cubeId }) => cubeId);
  if (missing.length > 0) invalid("CuboidTexturePlan", `missing assignments: ${missing.join(", ")}`);
  if (unknown.length > 0) invalid("CuboidTexturePlan", `unknown cubes: ${unknown.join(", ")}`);

  const materials = new Map(plan.materials.map((material) => [material.id, material]));
  const pixels = new Uint8Array(model.texture.width * model.texture.height * 4);
  for (const cube of cubes) {
    const assignment = assignments.get(cube.id);
    const material = assignment === undefined ? undefined : materials.get(assignment.materialId);
    if (assignment === undefined || material === undefined) throw new Error("Validated texture indexes became inconsistent.");
    const boxWidth = 2 * (cube.size[0] + cube.size[2]);
    const boxHeight = cube.size[1] + cube.size[2];
    if (!Number.isInteger(boxWidth) || !Number.isInteger(boxHeight)) {
      invalid("CuboidModelSpec", `cube ${cube.id} requires integer box-UV dimensions`);
    }
    const colors = [
      parseHex(material.colors.base),
      parseHex(material.colors.shadow),
      parseHex(material.colors.highlight),
      parseHex(material.colors.accent),
    ] as const;
    for (let y = 0; y < boxHeight; y += 1) {
      for (let x = 0; x < boxWidth; x += 1) {
        const color = colorForPixel(assignment.pattern, colors, x, y, boxWidth, boxHeight, assignment.seed,
          assignment.detailScale ?? 1);
        const offset = ((cube.uv[1] + y) * model.texture.width + cube.uv[0] + x) * 4;
        pixels.set(color, offset);
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
  const bytes = encodeRgbaPng(model.texture.width, model.texture.height, pixels);
  return Object.freeze({
    format: "png" as const,
    width: model.texture.width,
    height: model.texture.height,
    bytes,
    dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    opaquePixels,
    colorCount: colors.size,
  });
}
