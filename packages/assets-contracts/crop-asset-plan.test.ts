import assert from "node:assert/strict";
import { CropAssetPlanJsonSchema, CropAssetPlanSchema, type CropAssetPlan } from "./index.ts";

const waterRice: CropAssetPlan = {
  schemaVersion: 0,
  kind: "crop-asset-plan",
  id: "mcdev:water_rice",
  name: "Water Rice",
  runtimeAges: 8,
  visualStages: 4,
  layers: "double",
  placement: "water",
  upperStartsAt: 4,
  palette: { stem: "#456b32", leaf: "#6f963d", highlight: "#9fbe55", matureAccent: "#d5b84a" },
  seed: 20260722,
  referenceRuleIds: ["split_tall_crop_layers", "require_growth_silhouette_progression"],
};

assert.equal(CropAssetPlanSchema.safeParse(waterRice).success, true);
assert.equal(CropAssetPlanJsonSchema.additionalProperties, false);
assert.equal(CropAssetPlanSchema.safeParse({ ...waterRice, command: "render" }).success, false);
assert.equal(CropAssetPlanSchema.safeParse({ ...waterRice, visualStages: 9 }).success, false);
assert.equal(CropAssetPlanSchema.safeParse({ ...waterRice, upperStartsAt: null }).success, false);
assert.equal(CropAssetPlanSchema.safeParse({
  ...waterRice,
  layers: "single",
  upperStartsAt: 4,
}).success, false);
assert.equal(CropAssetPlanSchema.safeParse({
  ...waterRice,
  referenceRuleIds: ["split_tall_crop_layers", "split_tall_crop_layers"],
}).success, false);
