import { createHash } from "node:crypto";
import {
  CuboidAnimationPlanSchema,
  CuboidModelSpecSchema,
  type CuboidAnimationPlan,
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

export interface BlockbenchAnimationMetrics {
  readonly clips: number;
  readonly tracks: number;
  readonly keyframes: number;
}

export interface CompiledAnimatedTexturedBlockbenchModel extends CompiledTexturedBlockbenchModel {
  readonly animationMetrics: BlockbenchAnimationMetrics;
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

function deterministicUuid(
  modelId: string,
  kind: "animation" | "bone" | "cube" | "keyframe" | "texture",
  id: string,
): string {
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

function parseAnimationPlan(input: unknown): CuboidAnimationPlan {
  const result = CuboidAnimationPlanSchema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const detail = firstIssue === undefined
      ? "unknown validation error"
      : `${firstIssue.path.join(".") || "plan"}: ${firstIssue.message}`;
    throw new TypeError(`Invalid CuboidAnimationPlan (${detail}).`);
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

export function compileAnimatedTexturedBlockbenchModel(
  modelInput: unknown,
  texturePlanInput: unknown,
  animationPlanInput: unknown,
): CompiledAnimatedTexturedBlockbenchModel {
  const model = parseModel(modelInput);
  const animationPlan = parseAnimationPlan(animationPlanInput);
  if (animationPlan.modelId !== model.id) {
    throw new TypeError(`Animation plan modelId ${animationPlan.modelId} does not match model ${model.id}.`);
  }

  const boneIds = new Set(model.bones.map(({ id }) => id));
  for (const clip of animationPlan.clips) {
    for (const track of clip.tracks) {
      if (!boneIds.has(track.boneId)) {
        throw new TypeError(`Animation ${clip.id} targets missing bone ${track.boneId}.`);
      }
    }
  }

  const compiled = compileTexturedBlockbenchModel(model, texturePlanInput);
  const document = JSON.parse(compiled.text) as { animations?: unknown[] };
  const boneUuids = new Map(model.bones.map((bone) => [
    bone.id,
    deterministicUuid(model.id, "bone", bone.id),
  ]));
  let trackCount = 0;
  let keyframeCount = 0;

  document.animations = animationPlan.clips.map((clip) => {
    const animators: Record<string, {
      name: string;
      type: "bone";
      keyframes: Array<{
        channel: "position" | "rotation";
        data_points: Array<{ x: number; y: number; z: number }>;
        uuid: string;
        time: number;
        color: -1;
        interpolation: "linear" | "catmullrom";
      }>;
    }> = {};

    for (const track of clip.tracks) {
      const boneUuid = boneUuids.get(track.boneId);
      if (boneUuid === undefined) throw new Error("Validated animation bone index became inconsistent.");
      const animator = animators[boneUuid] ?? {
        name: track.boneId,
        type: "bone" as const,
        keyframes: [],
      };
      const keyframes = track.keyframes.map((keyframe, index) => ({
        channel: track.channel,
        data_points: [{ x: keyframe.value[0], y: keyframe.value[1], z: keyframe.value[2] }],
        uuid: deterministicUuid(
          model.id,
          "keyframe",
          `${clip.id}:${track.boneId}:${track.channel}:${index}`,
        ),
        time: keyframe.time,
        color: -1 as const,
        interpolation: keyframe.interpolation,
      }));
      animator.keyframes.push(...keyframes);
      animators[boneUuid] = animator;
      trackCount += 1;
      keyframeCount += keyframes.length;
    }

    return {
      uuid: deterministicUuid(model.id, "animation", clip.id),
      name: clip.name,
      loop: clip.loop,
      override: false,
      length: clip.length,
      snapping: clip.snapping,
      selected: false,
      anim_time_update: "",
      blend_weight: "",
      start_delay: "",
      loop_delay: "",
      animators,
    };
  });

  const text = `${JSON.stringify(document, null, 2)}\n`;
  return Object.freeze({
    ...compiled,
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    animationMetrics: Object.freeze({
      clips: animationPlan.clips.length,
      tracks: trackCount,
      keyframes: keyframeCount,
    }),
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
export {
  materializeArticulatedModel,
  type ArticulatedModelPackingMetrics,
  type MaterializedArticulatedModel,
} from "./articulated-model.ts";
export {
  createDragonArchetype,
  createDragonTexturePlan,
  type DragonArchetypeOptions,
} from "./dragon-archetype.ts";
export {
  analyzeArticulatedModelQuality,
  type ArticulatedModelQualityReport,
  type ArticulatedQualityThresholds,
  type ModelQualityDiagnostic,
} from "./model-quality.ts";
export {
  createBilateralBonePair,
  mirrorOriginAcrossX,
  mirrorRotationAcrossX,
  type BilateralBonePairOptions,
} from "./symmetry.ts";
export {
  analyzeTexturePlanQuality,
  type TextureQualityReport,
  type TextureQualityThresholds,
} from "./texture-quality.ts";
export {
  analyzeReferenceCatalog,
  type ReferenceAnalysisThresholds,
  type ReferenceCatalogReport,
  type ReferenceRuleCandidate,
} from "./reference-analysis.ts";
export { renderCropStageTexture, type CropLayer } from "./crop-texture.ts";
export { compileCropAssets, type CompiledCropAssets } from "./crop-asset.ts";
