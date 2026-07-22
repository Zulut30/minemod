import { z } from "zod";

export const CROP_ASSET_PLAN_SCHEMA_ID = "https://mcdev.local/schemas/crop-asset-plan-v0.json";
export const CROP_ASSET_LIMITS = Object.freeze({ maxRuntimeAges: 8, maxVisualStages: 8 } as const);

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const resourceLocation = z.string().regex(
  /^(?!\.{1,2}:)[a-z0-9_.-]{1,64}:(?=[a-z0-9_./-]{1,128}$)(?:(?!\.{1,2}(?:\/|$))[a-z0-9_.-]+\/)*(?!\.{1,2}$)[a-z0-9_.-]+$/u,
);
const rgbHex = z.string().regex(/^#[0-9a-f]{6}$/u);

export const CropAssetPlanSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("crop-asset-plan"),
  id: resourceLocation,
  name: z.string().min(1).max(80),
  runtimeAges: z.number().int().min(2).max(CROP_ASSET_LIMITS.maxRuntimeAges),
  visualStages: z.number().int().min(2).max(CROP_ASSET_LIMITS.maxVisualStages),
  layers: z.enum(["single", "double"]),
  placement: z.enum(["farmland", "water"]),
  upperStartsAt: z.number().int().min(1).max(CROP_ASSET_LIMITS.maxRuntimeAges - 1).nullable(),
  palette: z.strictObject({
    stem: rgbHex,
    leaf: rgbHex,
    highlight: rgbHex,
    matureAccent: rgbHex,
  }),
  seed: z.number().int().min(0).max(4_294_967_295),
  referenceRuleIds: z.array(identifier).min(1).max(8),
}).superRefine((plan, context) => {
  if (plan.visualStages > plan.runtimeAges) {
    context.addIssue({ code: "custom", path: ["visualStages"], message: "Visual stages cannot exceed runtime ages." });
  }
  if (plan.layers === "single" && plan.upperStartsAt !== null) {
    context.addIssue({ code: "custom", path: ["upperStartsAt"], message: "Single-layer crops cannot define an upper start age." });
  }
  if (plan.layers === "double" && (plan.upperStartsAt === null || plan.upperStartsAt >= plan.runtimeAges)) {
    context.addIssue({ code: "custom", path: ["upperStartsAt"], message: "Double-layer crops require an upper start age below runtimeAges." });
  }
  if (new Set(plan.referenceRuleIds).size !== plan.referenceRuleIds.length) {
    context.addIssue({ code: "custom", path: ["referenceRuleIds"], message: "Reference rule ids must be unique." });
  }
});

export type CropAssetPlan = z.infer<typeof CropAssetPlanSchema>;

export const CropAssetPlanJsonSchema = Object.freeze({
  ...z.toJSONSchema(CropAssetPlanSchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CROP_ASSET_PLAN_SCHEMA_ID,
});
