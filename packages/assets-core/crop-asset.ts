import { createHash } from "node:crypto";
import { CropAssetPlanSchema, type CropAssetPlan } from "@mcdev/assets-contracts";
import { renderCropStageTexture, type CropLayer } from "./crop-texture.ts";
import type { RenderedPixelIcon } from "./inventory-icon.ts";
import type { ReferenceCatalogReport } from "./reference-analysis.ts";

interface TextArtifact {
  readonly path: string;
  readonly text: string;
  readonly sha256: string;
}

interface TextureArtifact {
  readonly path: string;
  readonly texture: RenderedPixelIcon;
}

export interface CompiledCropAssets {
  readonly blockstate: TextArtifact;
  readonly models: readonly TextArtifact[];
  readonly textures: readonly TextureArtifact[];
  readonly metrics: {
    readonly runtimeAges: number;
    readonly visualStages: number;
    readonly layers: number;
    readonly modelFiles: number;
    readonly textureFiles: number;
  };
}

function textArtifact(path: string, value: unknown): TextArtifact {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return Object.freeze({ path, text, sha256: createHash("sha256").update(text, "utf8").digest("hex") });
}

function stageForAge(age: number, plan: CropAssetPlan): number {
  return Math.min(plan.visualStages - 1, Math.floor(age * plan.visualStages / plan.runtimeAges));
}

export function compileCropAssets(input: unknown, references: ReferenceCatalogReport): CompiledCropAssets {
  const result = CropAssetPlanSchema.safeParse(input);
  if (!result.success) throw new TypeError(`Invalid CropAssetPlan (${result.error.issues[0]?.message ?? "validation failed"}).`);
  const plan = result.data;
  if (!references.readyForRulePromotion) throw new TypeError("Reference catalog is not ready for rule promotion.");
  const promotedRules = new Set(references.candidateRules.filter(({ promotable }) => promotable).map(({ id }) => id));
  const missingRules = plan.referenceRuleIds.filter((id) => !promotedRules.has(id));
  if (missingRules.length > 0) throw new TypeError(`Crop plan uses unpromoted reference rules: ${missingRules.join(", ")}.`);

  const separator = plan.id.indexOf(":");
  const namespace = plan.id.slice(0, separator);
  const resourcePath = plan.id.slice(separator + 1);
  const layers: readonly CropLayer[] = plan.layers === "double" ? ["lower", "upper"] : ["lower"];
  const models: TextArtifact[] = [];
  const textures: TextureArtifact[] = [];
  for (let stage = 0; stage < plan.visualStages; stage += 1) {
    for (const layer of layers) {
      const name = `${resourcePath}_${layer}_stage${stage}`;
      models.push(textArtifact(`assets/${namespace}/models/block/${name}.json`, {
        parent: "minecraft:block/crop",
        render_type: "minecraft:cutout",
        textures: { crop: `${namespace}:block/${name}` },
      }));
      textures.push(Object.freeze({
        path: `assets/${namespace}/textures/block/${name}.png`,
        texture: renderCropStageTexture(plan, layer, stage),
      }));
    }
  }

  const variants: Record<string, { model: string }> = {};
  for (let age = 0; age < plan.runtimeAges; age += 1) {
    const stage = stageForAge(age, plan);
    for (const layer of layers) {
      const key = plan.layers === "double" ? `age=${age},upper=${layer === "upper"}` : `age=${age}`;
      variants[key] = { model: `${namespace}:block/${resourcePath}_${layer}_stage${stage}` };
    }
  }
  return Object.freeze({
    blockstate: textArtifact(`assets/${namespace}/blockstates/${resourcePath}.json`, { variants }),
    models: Object.freeze(models),
    textures: Object.freeze(textures),
    metrics: Object.freeze({
      runtimeAges: plan.runtimeAges,
      visualStages: plan.visualStages,
      layers: layers.length,
      modelFiles: models.length,
      textureFiles: textures.length,
    }),
  });
}
