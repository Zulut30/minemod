import { createHash } from "node:crypto";
import { CuboidModelSpecSchema, ItemPixelTexturePlanSchema } from "@mcdev/assets-contracts";
import type { CompiledBlockbenchModel, CompiledTexturedBlockbenchModel } from "./index.ts";
import { compileMinecraftItemModel, type CompiledMinecraftItemModel } from "./minecraft-item.ts";
import { encodeRgbaPng } from "./texture.ts";

export interface PaintedMinecraftItemAssets {
  readonly native: CompiledMinecraftItemModel;
  readonly editable: CompiledTexturedBlockbenchModel;
}

/** Собирает явную пиксельную покраску; геометрия и её игровые ограничения проверяются отдельно. */
export function assemblePaintedMinecraftItem(
  modelInput: unknown,
  textureInput: unknown,
  project: CompiledBlockbenchModel,
  textureUuid: string,
): PaintedMinecraftItemAssets {
  const modelResult = CuboidModelSpecSchema.safeParse(modelInput);
  const planResult = ItemPixelTexturePlanSchema.safeParse(textureInput);
  if (!modelResult.success) throw new TypeError(`Invalid painted item model: ${modelResult.error.message}`);
  if (!planResult.success) throw new TypeError(`Invalid pixel texture plan: ${planResult.error.message}`);
  const model = modelResult.data;
  const plan = planResult.data;
  const native = compileMinecraftItemModel(model);
  const { width, height } = model.texture;
  if (plan.modelId !== model.id) throw new TypeError("Pixel texture modelId must match model.");
  if (plan.rows.length !== height || plan.rows.some((row) => row.length !== width)) {
    throw new TypeError("Pixel rows must match the declared atlas width and height.");
  }
  const cubeIds = new Set(model.bones.flatMap(({ cubes }) => cubes.map(({ id }) => id)));
  if (plan.faces.length !== cubeIds.size || plan.faces.some(({ cubeId }) => !cubeIds.has(cubeId))) {
    throw new TypeError("Pixel texture needs exactly one face binding for every model cube.");
  }
  for (const binding of plan.faces) for (const uv of Object.values(binding.uv)) {
    if (uv.some((coordinate, index) => coordinate > (index % 2 === 0 ? width : height))) {
      throw new TypeError(`Cube ${binding.cubeId} face UV exceeds the declared atlas.`);
    }
  }
  const palette = new Map(plan.palette.map(({ symbol, color }) => [symbol,
    [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))]));
  const pixels = new Uint8Array(width * height * 4);
  let opaquePixels = 0;
  const usedColors = new Set<string>();
  for (const [y, row] of plan.rows.entries()) for (let x = 0; x < row.length; x += 1) {
    const symbol = row[x]!;
    if (symbol === ".") continue;
    const color = palette.get(symbol);
    if (color === undefined) throw new TypeError(`Pixel texture uses undeclared palette symbol ${symbol}.`);
    pixels.set([...color, 255], (y * width + x) * 4);
    usedColors.add(color.join(","));
    opaquePixels += 1;
  }
  const bytes = encodeRgbaPng(width, height, pixels);
  const hash = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");
  const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  type Face = { uv: number[]; texture: string };
  const document = JSON.parse(native.text) as { elements: { name: string; faces: Record<string, Face> }[]; display: unknown };
  const bindings = new Map(plan.faces.map(({ cubeId, uv }) => [cubeId, uv]));
  for (const element of document.elements) {
    const binding = bindings.get(element.name)!;
    element.faces = Object.fromEntries(Object.entries(binding).map(([face, uv]) => [face, {
      uv: uv.map((coordinate, index) => coordinate * 16 / (index % 2 === 0 ? width : height)), texture: "#0",
    }]));
  }
  const projectDocument = JSON.parse(project.text) as {
    meta: { model_format: string; box_uv: boolean };
    elements: { name: string; box_uv: boolean; faces?: object }[];
    textures: object[];
    display?: unknown;
    front_gui_light?: boolean;
    ambientocclusion?: boolean;
  };
  if (projectDocument.elements.length !== cubeIds.size || projectDocument.elements.some(({ name }) => !bindings.has(name))) {
    throw new Error("Painted item project and native geometry differ.");
  }
  projectDocument.meta = { ...projectDocument.meta, model_format: "java_block", box_uv: false };
  projectDocument.display = document.display;
  projectDocument.front_gui_light = true;
  projectDocument.ambientocclusion = false;
  for (const element of projectDocument.elements) {
    element.box_uv = false;
    element.faces = Object.fromEntries(Object.entries(bindings.get(element.name)!).map(([face, uv]) => [face, { uv, texture: 0 }]));
  }
  const [namespace, path] = model.id.split(":") as [string, string];
  projectDocument.textures = [{ name: `${path.split("/").at(-1)}.png`, namespace,
    folder: `item/${path}`.slice(0, `item/${path}`.lastIndexOf("/")), id: "0",
    width, height, uv_width: width, uv_height: height, particle: true, render_mode: "default", render_sides: "auto",
    visible: true, internal: true, saved: false, uuid: textureUuid, source: dataUrl }];
  const nativeText = `${JSON.stringify(document, null, 2)}\n`;
  const projectText = `${JSON.stringify(projectDocument, null, 2)}\n`;
  return Object.freeze({ native: Object.freeze({ ...native, text: nativeText, sha256: hash(nativeText) }),
    editable: Object.freeze({ ...project, text: projectText, sha256: hash(projectText), texture: Object.freeze({
      format: "png", width, height, bytes, dataUrl, sha256: hash(bytes), opaquePixels,
      colorCount: usedColors.size,
    }) }) });
}
