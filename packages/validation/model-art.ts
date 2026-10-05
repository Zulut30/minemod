import type { ArtSpecV1 } from "@mcdev/modspec";
import type { Diagnostic } from "./index.ts";

export const REQUIRED_MODEL_CONTEXTS = Object.freeze({
  weapon: ["eight-neutral-views", "uv-sheet", "silhouette-32", "silhouette-64", "inventory-normal", "hand", "ground", "daylight", "night"],
  armor: ["four-slot-icons", "player-front-back-sides", "walk-poses", "uv-sheet", "daylight", "night", "enchanted-glint"],
  "building-block": ["all-six-faces", "wall-3x3", "placed", "daylight", "night", "near", "mid"],
  "decorative-prop": ["eight-neutral-views", "uv-sheet", "four-placement-directions", "active-inactive", "placed", "daylight", "night", "silhouette-32", "silhouette-64"],
  creature: ["eight-neutral-views", "rig-sheet", "key-poses", "idle", "gameplay-animation", "timing-evidence", "near", "mid", "daylight", "night", "silhouette-32", "silhouette-64"],
} as const);

/** Проверка связей задания; не измерение модели и не artistic PASS. */
export function validateModelArtConstraints(spec: ArtSpecV1, diagnostics: Diagnostic[], limit: number): void {
  const fail = (path: string, message: string, code: Diagnostic["code"] = "SEMANTIC_INVALID") => {
    if (diagnostics.length < limit) diagnostics.push({ code, path, message });
  };
  const modelClass = spec.modelIntent.modelClass;
  const expectedAssetClass = modelClass === "armor" ? "wearable-set" :
    modelClass === "creature" ? "animated-model" : "cuboid-model";
  if (spec.assetClass !== expectedAssetClass) {
    fail("/assetClass", `Model class ${modelClass} requires asset class ${expectedAssetClass}; acceptance does not enable its exporter.`);
  }
  if (modelClass === "armor") {
    if (spec.textureLayout.kind !== "native-armor-layers" || spec.style.textureResolution !== 64) {
      fail("/textureLayout", "Native wearable layers require two 64 x 32 layers; style.textureResolution is their maximum dimension, 64.");
    }
  } else if (spec.textureLayout.kind !== "square-atlas") {
    fail("/textureLayout", "This model class requires one square atlas at style.textureResolution.");
  }
  if (spec.style.silhouetteLanguage !== spec.modelIntent.silhouette) {
    fail("/style/silhouetteLanguage", "Style and model intent must describe the same silhouette.");
  }
  const palette = new Set(spec.style.palette.map(color => color.toUpperCase()));
  const checkColor = (color: string, path: string) => {
    if (!palette.has(color.toUpperCase())) fail(path, "Color is not in the declared palette.", "BROKEN_REFERENCE");
  };
  for (const band of ["shadows", "midtones", "highlights"] as const) {
    const colors = spec.style.hueValueHierarchy[band];
    colors.forEach((color, index) => checkColor(color, `/style/hueValueHierarchy/${band}/${index}`));
    if (new Set(colors.map(color => color.toUpperCase())).size !== colors.length) {
      fail(`/style/hueValueHierarchy/${band}`, "Value-band colors must be unique.");
    }
  }
  if (spec.style.outline.color !== undefined) checkColor(spec.style.outline.color, "/style/outline/color");
  if (spec.style.outline.policy !== "none" && spec.style.outline.color === undefined) {
    fail("/style/outline/color", "An outline policy requires a palette color.");
  }
  const recipes = new Set<string>();
  const brightness = (color: string) => Math.max(...[1, 3, 5].map(start => Number.parseInt(color.slice(start, start + 2), 16))) * 100 / 255;
  spec.style.materialRecipes.forEach((recipe, index) => {
    const path = `/style/materialRecipes/${index}`;
    if (recipes.has(recipe.id)) fail(`${path}/id`, "Material recipe IDs must be unique.");
    recipes.add(recipe.id);
    for (const key of ["shadow", "base", "highlight"] as const) checkColor(recipe[key], `${path}/${key}`);
    const step = spec.style.hueValueHierarchy.minimumValueStep;
    if (brightness(recipe.base) - brightness(recipe.shadow) + 1e-9 < step ||
      brightness(recipe.highlight) - brightness(recipe.base) + 1e-9 < step) {
      fail(path, "Material recipe must meet the declared HSV value step between shadow, base and highlight.");
    }
  });
  spec.modelIntent.parts.forEach((part, index) => {
    if (!recipes.has(part.materialRecipe)) fail(`/modelIntent/parts/${index}/materialRecipe`, "Part material recipe is not declared.", "BROKEN_REFERENCE");
  });
  if (spec.budgets.maxTextureBytes < 1) fail("/budgets/maxTextureBytes", "A textured model needs a nonzero texture budget.");
  if (modelClass !== "armor" && spec.budgets.maxCubes < 1) fail("/budgets/maxCubes", "A cuboid model needs a nonzero cube budget.");
  if (modelClass === "creature" && (spec.budgets.maxBones < 1 || spec.budgets.maxKeyframes < 1)) {
    fail("/budgets", "An animated creature needs bone and keyframe budgets; runtime support is checked separately.");
  }
  if (modelClass === "building-block" && Object.values(spec.modelIntent.bounds).some(value => value !== 16)) {
    fail("/modelIntent/bounds", "A full building block occupies one 16 x 16 x 16 model-unit cell.");
  }
  if ((modelClass === "weapon" || modelClass === "decorative-prop") &&
    Object.values(spec.modelIntent.bounds).some(value => value > 48)) {
    fail("/modelIntent/bounds", "Native item/block coordinate span cannot exceed 48 model units in this profile.");
  }
}
