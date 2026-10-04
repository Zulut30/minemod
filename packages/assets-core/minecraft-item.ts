import { createHash } from "node:crypto";
import { CuboidModelSpecSchema, type CuboidModelSpec } from "@mcdev/assets-contracts";

type Cube = CuboidModelSpec["bones"][number]["cubes"][number];
type Vector3 = readonly [number, number, number];
type UvRectangle = readonly [number, number, number, number];
type Face = "north" | "south" | "east" | "west" | "up" | "down";

export class MinecraftItemModelError extends Error {
  readonly code = "SPEC_UNSUPPORTED" as const;

  constructor(message: string) {
    super(message);
    this.name = "MinecraftItemModelError";
  }
}

export interface CompiledMinecraftItemModel {
  readonly format: "minecraft-java-item-model";
  readonly minecraft: "1.20.1";
  readonly modelPath: string;
  readonly texturePath: string;
  readonly textureId: string;
  readonly text: string;
  readonly sha256: string;
  readonly elements: number;
}

function unsupported(message: string): never {
  throw new MinecraftItemModelError(message);
}

function assertNativeGeometry(model: CuboidModelSpec): void {
  if (model.modelType !== "held-item") unsupported("Item export requires modelType held-item.");
  if (model.bones.every(({ cubes }) => cubes.length === 0)) unsupported("Item export requires visible geometry.");
  for (const bone of model.bones) {
    if (bone.rotation.some((angle) => angle !== 0)) {
      unsupported(`Bone ${bone.id} has a rotation. Author the rest pose in cube coordinates; use display transforms for the held pose.`);
    }
    for (const cube of bone.cubes) {
      const angles = cube.rotation.filter((angle) => angle !== 0);
      if (angles.length > 1 || angles.some((angle) => ![-45, -22.5, 22.5, 45].includes(angle))) {
        unsupported(`Cube ${cube.id} needs one rotation axis with angle 0, +/-22.5 or +/-45 degrees for Minecraft 1.20.1.`);
      }
      if (cube.origin.some((coordinate, axis) => coordinate - cube.inflate < -16 ||
        coordinate + cube.size[axis]! + cube.inflate > 32)) {
        unsupported(`Cube ${cube.id} bounds, including inflate, must stay inside [-16, 32].`);
      }
    }
  }
}

/** Развёртка box UV задаётся в пикселях и переводится в UV-единицы Minecraft 0..16. */
function facesFor(cube: Cube, texture: CuboidModelSpec["texture"]): Record<Face, { readonly uv: UvRectangle; readonly texture: "#0" }> {
  const [width, height, depth] = cube.size;
  const [u, v] = cube.uv;
  const horizontal = v + depth;
  const pixels: Record<Face, UvRectangle> = {
    north: [u + depth, horizontal, u + depth + width, horizontal + height],
    south: [u + 2 * depth + width, horizontal, u + 2 * depth + 2 * width, horizontal + height],
    east: [u, horizontal, u + depth, horizontal + height],
    west: [u + depth + width, horizontal, u + 2 * depth + width, horizontal + height],
    up: [u + depth + width, horizontal, u + depth, v],
    down: [u + depth + 2 * width, v, u + depth + width, horizontal],
  };
  const result = {} as Record<Face, { readonly uv: UvRectangle; readonly texture: "#0" }>;
  for (const face of ["north", "south", "east", "west", "up", "down"] as const) {
    const source = cube.mirror && face === "east" ? "west" : cube.mirror && face === "west" ? "east" : face;
    const rectangle = pixels[source];
    const firstU = cube.mirror ? rectangle[2] : rectangle[0];
    const lastU = cube.mirror ? rectangle[0] : rectangle[2];
    result[face] = {
      uv: [firstU * 16 / texture.width, rectangle[1] * 16 / texture.height,
        lastU * 16 / texture.width, rectangle[3] * 16 / texture.height],
      texture: "#0",
    };
  }
  return result;
}

function elementFor(cube: Cube, texture: CuboidModelSpec["texture"]): object {
  const from: Vector3 = [cube.origin[0] - cube.inflate, cube.origin[1] - cube.inflate, cube.origin[2] - cube.inflate];
  const to: Vector3 = [cube.origin[0] + cube.size[0] + cube.inflate,
    cube.origin[1] + cube.size[1] + cube.inflate, cube.origin[2] + cube.size[2] + cube.inflate];
  const axisIndex = cube.rotation.findIndex((angle) => angle !== 0);
  return {
    name: cube.id,
    from,
    to,
    ...(axisIndex === -1 ? {} : { rotation: {
      origin: [...cube.pivot], axis: ["x", "y", "z"][axisIndex], angle: cube.rotation[axisIndex], rescale: false,
    } }),
    faces: facesFor(cube, texture),
  };
}

/** Экспортирует данные без исполнения скриптов и внешних загрузчиков моделей. */
export function compileMinecraftItemModel(input: unknown): CompiledMinecraftItemModel {
  const parsed = CuboidModelSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    unsupported(`Invalid CuboidModelSpec at ${issue?.path.join(".") || "model"}: ${issue?.message ?? "validation failed"}`);
  }
  const model = parsed.data;
  assertNativeGeometry(model);
  const [namespace, path] = model.id.split(":") as [string, string];
  const textureId = `${namespace}:item/${path}`;
  const cubes = model.bones.flatMap(({ cubes: entries }) => entries).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const document = {
    ambientocclusion: false,
    gui_light: "front",
    textures: { "0": textureId, particle: textureId },
    display: {
      gui: { rotation: [15, -30, -15], translation: [0, -3, 0], scale: [0.55, 0.55, 0.55] },
      ground: { rotation: [0, 0, 0], translation: [0, 2, 0], scale: [0.3, 0.3, 0.3] },
      fixed: { rotation: [0, 180, 0], translation: [0, -2, 0], scale: [0.6, 0.6, 0.6] },
      firstperson_righthand: { rotation: [0, -90, 25], translation: [0, -2, 0], scale: [0.65, 0.65, 0.65] },
      firstperson_lefthand: { rotation: [0, 90, -25], translation: [0, -2, 0], scale: [0.65, 0.65, 0.65] },
      thirdperson_righthand: { rotation: [0, -90, 0], translation: [0, 0, 0], scale: [0.6, 0.6, 0.6] },
      thirdperson_lefthand: { rotation: [0, 90, 0], translation: [0, 0, 0], scale: [0.6, 0.6, 0.6] },
    },
    elements: cubes.map((cube) => elementFor(cube, model.texture)),
  };
  const text = `${JSON.stringify(document, null, 2)}\n`;
  return Object.freeze({
    format: "minecraft-java-item-model", minecraft: "1.20.1",
    modelPath: `assets/${namespace}/models/item/${path}.json`,
    texturePath: `assets/${namespace}/textures/item/${path}.png`,
    textureId, text, sha256: createHash("sha256").update(text).digest("hex"), elements: cubes.length,
  });
}
