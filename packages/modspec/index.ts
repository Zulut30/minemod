import { z } from "zod";

export const MODSPEC_SCHEMA_ID = "https://mcdev.local/schemas/modspec-v0.json";
export const ARTSPEC_SCHEMA_ID = "https://mcdev.local/schemas/artspec-v0.json";
export const SPEC_COLLECTION_LIMITS = Object.freeze({
  projectProvenance: 16,
  gameplayItems: 64,
  gameplayBlocks: 32,
  gameplayEntities: 32,
  gameplayRecipes: 64,
  gameplaySummoning: 32,
  gameplayScreens: 32,
  resourceReferences: 16,
  assetModels: 64,
  assetTextures: 64,
  assetAnimations: 64,
  artAssets: 64,
  assetProvenance: 4,
  requiredDependencies: 32,
  optionalDependencies: 32,
  gameTests: 64,
  targetContexts: 16,
  targetMatrix: 8,
  palette: 32,
  hueValueColors: 8,
  materialRecipes: 16,
  forbiddenReferences: 32,
  artReferences: 32,
  allowedSourceKinds: 3,
} as const);

export const RESOURCE_LOCATION_PATTERN =
  "^(?!\\.{1,2}:)[a-z0-9_.-]{1,64}:(?=[a-z0-9_./-]{1,128}$)(?:(?!\\.{1,2}(?:/|$))[a-z0-9_.-]+/)*(?!\\.{1,2}$)[a-z0-9_.-]+$";
export const SAFE_ASSET_PATH_PATTERN =
  "^(?!/)(?!.*//)(?!.*(?:^|/)\\.{1,2}(?:/|$))[a-z0-9_.-]{1,64}/[a-z0-9_./-]{1,128}\\.(?:png|json|bbmodel|nbt|snbt|schem|schematic|blend)$";
// v0 deliberately accepts BMP scalar values only. This keeps Zod's UTF-16
// min/max semantics identical to JSON Schema code-point minLength/maxLength.
export const BMP_ONLY_STRING_PATTERN = "^[\\u0000-\\uD7FF\\uE000-\\uFFFF]*$";

function boundedBmpString(minLength: number, maxLength: number): z.ZodString {
  return z.string()
    .min(minLength)
    .max(maxLength)
    .regex(new RegExp(BMP_ONLY_STRING_PATTERN), "Only BMP Unicode scalar values are supported in v0.");
}

const ResourceLocation = z.string().min(3).max(193).regex(new RegExp(RESOURCE_LOCATION_PATTERN));
const SafeAssetPath = z.string().min(3).max(200).regex(new RegExp(SAFE_ASSET_PATH_PATTERN));
const SafeSpecPath = z.string().min(3).max(200).regex(
  /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*\.(?:json|ya?ml)$/,
);
const ModId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);
const LicenseId = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9.+-]*$/);
const Sha256 = z.string().length(64).regex(/^[a-f0-9]{64}$/);

const ProvenanceSchema = z.strictObject({
  kind: z.enum(["generated", "manual", "imported"]),
  source: boundedBmpString(1, 2048).url(),
  license: LicenseId,
  sha256: Sha256,
});

const AssetMetricsSchema = z.strictObject({
  textureBytes: z.number().int().min(0).max(16_777_216),
  cubes: z.number().int().min(0).max(512),
  bones: z.number().int().min(0).max(64),
  triangles: z.number().int().min(0).max(65_536),
  keyframes: z.number().int().min(0).max(4_096),
});

const AssetBudgetSchema = z.strictObject({
  maxTextureBytes: z.number().int().min(0).max(67_108_864),
  maxCubes: z.number().int().min(0).max(2_048),
  maxBones: z.number().int().min(0).max(256),
  maxTriangles: z.number().int().min(0).max(262_144),
  maxKeyframes: z.number().int().min(0).max(16_384),
});

const AssetEntrySchema = z.strictObject({
  id: ResourceLocation,
  path: SafeAssetPath,
  license: LicenseId,
  provenance: z.array(ProvenanceSchema).min(1).max(SPEC_COLLECTION_LIMITS.assetProvenance),
  metrics: AssetMetricsSchema,
});

const ReferencesSchema = z.array(ResourceLocation).max(SPEC_COLLECTION_LIMITS.resourceReferences);

const ItemSchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  maxStackSize: z.number().int().min(1).max(99),
});

const BlockSchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  item: ResourceLocation,
  hardness: z.number().min(0).max(100),
});

const EntitySchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  attributes: z.strictObject({
    maxHealth: z.number().positive().max(2_048),
    movementSpeed: z.number().min(0).max(16),
  }),
  renderer: ResourceLocation,
  dimensions: z.strictObject({
    width: z.number().positive().max(64),
    height: z.number().positive().max(64),
  }),
});

const RecipeSchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  type: z.enum(["shaped", "shapeless", "smelting", "custom"]),
  serializer: ResourceLocation.optional(),
  ingredients: ReferencesSchema,
  result: ResourceLocation,
});

const SummoningSchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  entity: ResourceLocation,
  ingredients: ReferencesSchema,
});

const ScreenSchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  menuId: ResourceLocation,
  serverValidation: z.boolean(),
});

const JeiIntegrationSchema = z.union([
  z.enum(["off", "auto"]),
  z.strictObject({ mode: z.literal("required"), pluginId: ResourceLocation }),
]);
const JadeIntegrationSchema = z.union([
  z.enum(["off", "auto"]),
  z.strictObject({
    mode: z.literal("required"),
    providerId: ResourceLocation,
    maxDataBytes: z.number().int().min(1).max(16_384),
  }),
]);

const GameTestSchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
});

export const ModSpecSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("mod"),
  project: z.strictObject({
    modId: z.string().min(2).max(64).regex(/^[a-z][a-z0-9_-]*$/),
    name: boundedBmpString(1, 80),
    version: z.string().min(1).max(32).regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
    license: LicenseId,
    provenance: z.array(ProvenanceSchema).min(1).max(SPEC_COLLECTION_LIMITS.projectProvenance),
  }),
  target: z.strictObject({
    minecraft: boundedBmpString(1, 32),
    loader: z.enum(["neoforge", "fabric", "forge", "paper"]),
    java: z.number().int().min(17).max(25),
  }),
  gameplay: z.strictObject({
    items: z.array(ItemSchema).max(SPEC_COLLECTION_LIMITS.gameplayItems),
    blocks: z.array(BlockSchema).max(SPEC_COLLECTION_LIMITS.gameplayBlocks),
    entities: z.array(EntitySchema).max(SPEC_COLLECTION_LIMITS.gameplayEntities),
    recipes: z.array(RecipeSchema).max(SPEC_COLLECTION_LIMITS.gameplayRecipes),
    summoning: z.array(SummoningSchema).max(SPEC_COLLECTION_LIMITS.gameplaySummoning),
    screens: z.array(ScreenSchema).max(SPEC_COLLECTION_LIMITS.gameplayScreens),
  }),
  assets: z.strictObject({
    artSpec: SafeSpecPath,
    models: z.array(AssetEntrySchema).max(SPEC_COLLECTION_LIMITS.assetModels),
    textures: z.array(AssetEntrySchema).max(SPEC_COLLECTION_LIMITS.assetTextures),
    animations: z.array(AssetEntrySchema).max(SPEC_COLLECTION_LIMITS.assetAnimations),
    budgets: AssetBudgetSchema,
  }),
  dependencies: z.strictObject({
    required: z.array(ModId).max(SPEC_COLLECTION_LIMITS.requiredDependencies),
    optional: z.array(ModId).max(SPEC_COLLECTION_LIMITS.optionalDependencies),
  }),
  integrations: z.strictObject({
    jei: JeiIntegrationSchema,
    jade: JadeIntegrationSchema,
  }),
  tests: z.strictObject({
    gameTests: z.array(GameTestSchema).max(SPEC_COLLECTION_LIMITS.gameTests),
  }),
  packaging: z.strictObject({
    includeSources: z.boolean(),
    publish: z.literal(false),
  }),
});

export const ArtSpecSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("art"),
  id: ResourceLocation,
  targetMatrix: z.array(z.strictObject({
    minecraft: boundedBmpString(1, 32),
    loader: z.enum(["neoforge", "fabric", "forge", "paper"]),
    java: z.number().int().min(17).max(25),
    loaderVersion: boundedBmpString(1, 64),
    runtime: z.strictObject({
      id: z.literal("java"),
      version: boundedBmpString(1, 32),
    }),
    renderer: z.strictObject({
      id: boundedBmpString(1, 64),
      version: boundedBmpString(1, 64),
    }),
  })).min(1).max(SPEC_COLLECTION_LIMITS.targetMatrix),
  assetClass: z.enum([
    "item-icon",
    "cuboid-model",
    "animated-model",
    "structure",
    "decorative-mesh",
    "ui-sprite",
  ]),
  targetContexts: z.array(z.enum([
    "native-size",
    "nearest-neighbor-2x",
    "nearest-neighbor-4x",
    "alpha-checkerboard",
    "inventory-normal",
    "inventory-selected",
    "hand",
    "ground",
    "enchanted-glint",
    "turntable",
    "uv-sheet",
    "close-seams",
    "placed",
    "in-world",
    "daylight",
    "night",
    "interior",
    "near",
    "mid",
    "far",
    "key-poses",
    "idle",
    "gameplay-animation",
    "timing-evidence",
    "orthographic-elevations",
    "palette-material-sheet",
    "placed-fixture",
    "exterior",
    "renderer-fixture",
    "wireframe-lod-uv",
    "worst-case-lighting",
    "lod-transitions",
    "source-atlas",
    "nine-slice-bounds",
    "gui-scale-2",
    "gui-scale-3",
    "gui-scale-4",
    "minimum-resolution",
    "reference-resolution",
    "en_us",
    "ru_ru",
    "hover",
    "disabled",
    "error",
  ])).min(1).max(SPEC_COLLECTION_LIMITS.targetContexts),
  style: z.strictObject({
    family: boundedBmpString(1, 64),
    palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(SPEC_COLLECTION_LIMITS.palette),
    targetPaletteColors: z.number().int().min(1).max(SPEC_COLLECTION_LIMITS.palette),
    hueValueHierarchy: z.strictObject({
      shadows: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(SPEC_COLLECTION_LIMITS.hueValueColors),
      midtones: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(SPEC_COLLECTION_LIMITS.hueValueColors),
      highlights: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(SPEC_COLLECTION_LIMITS.hueValueColors),
      minimumValueStep: z.number().int().min(1).max(100),
    }),
    lighting: z.strictObject({
      source: z.enum(["sun", "moon", "torch", "emissive", "studio-neutral"]),
      direction: z.enum(["top-left", "top-right", "front", "back", "omnidirectional"]),
    }),
    outline: z.strictObject({
      policy: z.enum(["none", "selective", "full"]),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    }),
    saturation: z.strictObject({
      minimum: z.number().int().min(0).max(100),
      maximum: z.number().int().min(0).max(100),
    }),
    detail: z.strictObject({
      scale: z.enum(["broad", "medium", "fine"]),
      maxNoisePercent: z.number().int().min(0).max(100),
    }),
    materialRecipes: z.array(z.strictObject({
      id: ResourceLocation,
      material: z.enum(["metal", "wood", "cloth", "stone", "organic", "glass", "custom"]),
      shadow: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      base: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      highlight: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      pattern: boundedBmpString(1, 160),
    })).max(SPEC_COLLECTION_LIMITS.materialRecipes),
    silhouetteLanguage: boundedBmpString(1, 240),
    forbiddenReferences: z.array(z.strictObject({
      subject: boundedBmpString(1, 160),
      reason: boundedBmpString(1, 240),
    })).max(SPEC_COLLECTION_LIMITS.forbiddenReferences),
    textureResolution: z.union([z.literal(16), z.literal(32), z.literal(64), z.literal(128), z.literal(256)]),
    texelDensity: z.strictObject({
      pixelsPerBlock: z.number().int().min(1).max(256),
      tolerancePercent: z.number().int().min(0).max(100),
    }),
  }),
  provenancePolicy: z.strictObject({
    allowedSourceKinds: z.array(z.enum(["generated", "manual", "imported"]))
      .min(1)
      .max(SPEC_COLLECTION_LIMITS.allowedSourceKinds),
    requireSourceHashes: z.literal(true),
    requireReferenceRights: z.literal(true),
    forbidLivingArtistStylePrompts: z.literal(true),
  }),
  references: z.array(z.strictObject({
    source: boundedBmpString(1, 2048).url(),
    license: LicenseId,
    rights: z.enum(["owned", "licensed", "public-domain", "reference-only"]),
    sha256: Sha256,
  })).max(SPEC_COLLECTION_LIMITS.artReferences),
  budgets: AssetBudgetSchema,
  assets: z.array(AssetEntrySchema).max(SPEC_COLLECTION_LIMITS.artAssets),
});

export type ModSpec = z.infer<typeof ModSpecSchema>;
export type ArtSpec = z.infer<typeof ArtSpecSchema>;
export type Spec = ModSpec | ArtSpec;

function jsonSchema(schema: z.ZodType, id: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...z.toJSONSchema(schema),
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
  });
}

export const ModSpecJsonSchema = jsonSchema(ModSpecSchema, MODSPEC_SCHEMA_ID);
export const ArtSpecJsonSchema = jsonSchema(ArtSpecSchema, ARTSPEC_SCHEMA_ID);
