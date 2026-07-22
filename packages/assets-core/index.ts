import { createHash } from "node:crypto";
import {
  CuboidModelSpecSchema,
  type CuboidModelSpec,
} from "@mcdev/assets-contracts";
import {
  renderCuboidTextureAtlas,
  type RenderedCuboidTextureAtlas,
} from "./texture.ts";

export interface BlockbenchModelMetrics {
  readonly bones: number;
  readonly cubes: number;
  readonly triangles: number;
}

export interface CompiledBlockbenchModel {
  readonly format: "blockbench-project";
  readonly formatVersion: "5.0";
  readonly text: string;
  readonly sha256: string;
  readonly metrics: BlockbenchModelMetrics;
}

export interface CompiledTexturedBlockbenchModel extends CompiledBlockbenchModel {
  readonly texture: RenderedCuboidTextureAtlas;
}

type Vector3 = readonly [number, number, number];

interface BlockbenchElement {
  readonly name: string;
  readonly box_uv: true;
  readonly locked: false;
  readonly from: Vector3;
  readonly to: Vector3;
  readonly autouv: 0;
  readonly color: number;
  readonly origin: Vector3;
  readonly rotation: Vector3;
  readonly uv_offset: readonly [number, number];
  readonly mirror_uv: boolean;
  readonly inflate: number;
  readonly uuid: string;
}

interface BlockbenchGroup {
  readonly name: string;
  readonly origin: Vector3;
  readonly rotation: Vector3;
  readonly color: number;
  readonly uuid: string;
  readonly export: true;
  readonly locked: false;
}

interface BlockbenchOutlinerGroup {
  readonly uuid: string;
  readonly isOpen: true;
  readonly children: readonly (string | BlockbenchOutlinerGroup)[];
}

function deterministicUuid(modelId: string, kind: "bone" | "cube" | "texture", id: string): string {
  const digest = createHash("sha256")
    .update(`mcdev:blockbench-5\0${modelId}\0${kind}\0${id}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = "8";
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function addVectors(left: Vector3, right: Vector3): Vector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function outlinerFor(model: CuboidModelSpec, boneUuids: ReadonlyMap<string, string>, cubeUuids: ReadonlyMap<string, string>): readonly BlockbenchOutlinerGroup[] {
  const childrenByParent = new Map<string, string[]>();
  for (const bone of model.bones) {
    if (bone.parent === null) continue;
    const children = childrenByParent.get(bone.parent) ?? [];
    children.push(bone.id);
    childrenByParent.set(bone.parent, children);
  }

  function compileGroup(boneId: string): BlockbenchOutlinerGroup {
    const bone = model.bones.find(({ id }) => id === boneId);
    const uuid = boneUuids.get(boneId);
    if (bone === undefined || uuid === undefined) {
      throw new Error("Validated model hierarchy became inconsistent.");
    }
    const cubeChildren = bone.cubes.map((cube) => {
      const cubeUuid = cubeUuids.get(cube.id);
      if (cubeUuid === undefined) throw new Error("Validated model cube index became inconsistent.");
      return cubeUuid;
    });
    const boneChildren = (childrenByParent.get(boneId) ?? []).map(compileGroup);
    return {
      uuid,
      isOpen: true,
      children: [...cubeChildren, ...boneChildren],
    };
  }

  return model.bones
    .filter(({ parent }) => parent === null)
    .map(({ id }) => compileGroup(id));
}

function parseModel(input: unknown): CuboidModelSpec {
  const result = CuboidModelSpecSchema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const detail = firstIssue === undefined
      ? "unknown validation error"
      : `${firstIssue.path.join(".") || "model"}: ${firstIssue.message}`;
    throw new TypeError(`Invalid CuboidModelSpec (${detail}).`);
  }
  return result.data;
}

export function compileBlockbenchModel(input: unknown): CompiledBlockbenchModel {
  const model = parseModel(input);
  const boneUuids = new Map(model.bones.map((bone) => [
    bone.id,
    deterministicUuid(model.id, "bone", bone.id),
  ]));
  const cubeUuids = new Map(model.bones.flatMap((bone) => bone.cubes.map((cube) => [
    cube.id,
    deterministicUuid(model.id, "cube", cube.id),
  ])));

  const elements: BlockbenchElement[] = [];
  const groups: BlockbenchGroup[] = [];
  for (const [boneIndex, bone] of model.bones.entries()) {
    const boneUuid = boneUuids.get(bone.id);
    if (boneUuid === undefined) throw new Error("Validated model bone index became inconsistent.");
    groups.push({
      name: bone.id,
      origin: bone.pivot,
      rotation: bone.rotation,
      color: boneIndex % 8,
      uuid: boneUuid,
      export: true,
      locked: false,
    });

    for (const cube of bone.cubes) {
      const cubeUuid = cubeUuids.get(cube.id);
      if (cubeUuid === undefined) throw new Error("Validated model cube index became inconsistent.");
      elements.push({
        name: cube.id,
        box_uv: true,
        locked: false,
        from: cube.origin,
        to: addVectors(cube.origin, cube.size),
        autouv: 0,
        color: boneIndex % 8,
        origin: cube.pivot,
        rotation: cube.rotation,
        uv_offset: cube.uv,
        mirror_uv: cube.mirror,
        inflate: cube.inflate,
        uuid: cubeUuid,
      });
    }
  }

  const document = {
    meta: {
      format_version: "5.0",
      model_format: "free",
      box_uv: true,
    },
    name: model.name,
    resolution: {
      width: model.texture.width,
      height: model.texture.height,
    },
    elements,
    groups,
    outliner: outlinerFor(model, boneUuids, cubeUuids),
    textures: [],
  } as const;
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const metrics = Object.freeze({
    bones: model.bones.length,
    cubes: elements.length,
    triangles: elements.length * 12,
  });
  return Object.freeze({
    format: "blockbench-project" as const,
    formatVersion: "5.0" as const,
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    metrics,
  });
}

export function compileTexturedBlockbenchModel(
  modelInput: unknown,
  texturePlanInput: unknown,
): CompiledTexturedBlockbenchModel {
  const model = parseModel(modelInput);
  const texture = renderCuboidTextureAtlas(model, texturePlanInput);
  const compiled = compileBlockbenchModel(model);
  const document = JSON.parse(compiled.text) as { textures: unknown[] };
  const separator = model.id.indexOf(":");
  const namespace = model.id.slice(0, separator);
  const resourcePath = model.id.slice(separator + 1);
  const textureName = `${resourcePath.split("/").at(-1) ?? resourcePath}.png`;
  document.textures = [{
    name: textureName,
    folder: "",
    namespace,
    id: "0",
    width: texture.width,
    height: texture.height,
    uv_width: texture.width,
    uv_height: texture.height,
    particle: false,
    render_mode: "default",
    render_sides: "auto",
    frame_time: 1,
    frame_order_type: "loop",
    frame_order: "",
    frame_interpolate: false,
    visible: true,
    internal: true,
    saved: false,
    uuid: deterministicUuid(model.id, "texture", textureName),
    source: texture.dataUrl,
  }];
  const text = `${JSON.stringify(document, null, 2)}\n`;
  return Object.freeze({
    ...compiled,
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    texture,
  });
}

export {
  renderCuboidTextureAtlas,
  type RenderedCuboidTextureAtlas,
} from "./texture.ts";
export {
  compileInventoryIcon,
  type CompiledInventoryIcon,
  type RenderedPixelIcon,
} from "./inventory-icon.ts";
