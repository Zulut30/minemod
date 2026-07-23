import { z } from "zod";

export const MODSPEC_SCHEMA_ID = "https://mcdev.local/schemas/modspec-v0.json";
export const MODSPEC_V1_SCHEMA_ID = "https://mcdev.local/schemas/modspec-v1.json";
export const ARTSPEC_SCHEMA_ID = "https://mcdev.local/schemas/artspec-v0.json";
export const SPEC_COLLECTION_LIMITS = Object.freeze({
  projectProvenance: 16,
  gameplayItems: 64,
  gameplayMaterials: 16,
  gameplayBlocks: 32,
  gameplayEntities: 32,
  gameplayRecipes: 64,
  gameplaySummoning: 32,
  gameplayScreens: 32,
  gameplayStructures: 32,
  behaviorGoals: 32,
  behaviorTargets: 16,
  behaviorStates: 32,
  behaviorTransitions: 64,
  entityDataFields: 32,
  structurePieces: 64,
  structureSpawnOverrides: 16,
  screenSlots: 64,
  screenFields: 32,
  screenActions: 32,
  configCategories: 8,
  configOptionsPerCategory: 16,
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

const BasicItemV1Schema = ItemSchema.extend({
  kind: z.literal("basic").optional(),
});

const ToolItemKindSchema = z.enum(["sword", "pickaxe", "axe", "shovel", "hoe"]);
const ToolItemV1Schema = ItemSchema.extend({
  kind: ToolItemKindSchema,
  material: ResourceLocation,
  attackDamage: z.number().int().min(0).max(64),
  attackSpeed: z.number().min(-4).max(4),
}).superRefine((item, context) => {
  if (item.maxStackSize !== 1) {
    context.addIssue({ code: "custom", path: ["maxStackSize"], message: "Tools and weapons must have maxStackSize 1." });
  }
});

const ArmorItemV1Schema = ItemSchema.extend({
  kind: z.literal("armor"),
  material: ResourceLocation,
  armorSlot: z.enum(["helmet", "chestplate", "leggings", "boots"]),
}).superRefine((item, context) => {
  if (item.maxStackSize !== 1) {
    context.addIssue({ code: "custom", path: ["maxStackSize"], message: "Armor must have maxStackSize 1." });
  }
});

const ItemV1Schema = z.union([BasicItemV1Schema, ToolItemV1Schema, ArmorItemV1Schema]);

const EquipmentColorSchema = z.string().regex(/^#[0-9a-f]{6}$/u);
const EquipmentPaletteSchema = z.strictObject({
  base: EquipmentColorSchema,
  shadow: EquipmentColorSchema,
  highlight: EquipmentColorSchema,
  accent: EquipmentColorSchema,
  handle: EquipmentColorSchema,
});
const EquipmentVisualProfileSchema = z.strictObject({
  silhouette: z.enum(["balanced", "heavy", "ornate"]),
  motif: z.enum(["clean", "riveted", "runed", "organic"]),
});

function equipmentColorLuminance(value: string): number {
  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

const MaterialV1Schema = z.strictObject({
  id: ResourceLocation,
  repairIngredient: ResourceLocation,
  durability: z.number().int().min(1).max(65_535),
  miningSpeed: z.number().positive().max(64),
  attackDamageBonus: z.number().min(0).max(64),
  miningLevel: z.number().int().min(0).max(4),
  enchantmentValue: z.number().int().min(0).max(64),
  armor: z.strictObject({
    durabilityMultiplier: z.number().int().min(1).max(128),
    defense: z.strictObject({
      helmet: z.number().int().min(0).max(30),
      chestplate: z.number().int().min(0).max(30),
      leggings: z.number().int().min(0).max(30),
      boots: z.number().int().min(0).max(30),
    }),
    toughness: z.number().min(0).max(20),
    knockbackResistance: z.number().min(0).max(1),
  }).optional(),
  palette: EquipmentPaletteSchema.optional(),
  visualProfile: EquipmentVisualProfileSchema.optional(),
}).superRefine((material, context) => {
  if (material.palette === undefined) return;
  const colors = Object.values(material.palette);
  if (new Set(colors).size !== colors.length) {
    context.addIssue({ code: "custom", path: ["palette"], message: "Equipment palette colors must be unique." });
  }
  const shadow = equipmentColorLuminance(material.palette.shadow);
  const base = equipmentColorLuminance(material.palette.base);
  const highlight = equipmentColorLuminance(material.palette.highlight);
  if (base - shadow < 24 || highlight - base < 24) {
    context.addIssue({
      code: "custom",
      path: ["palette"],
      message: "Equipment palette requires visible shadow/base/highlight value separation.",
    });
  }
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

const RecipeV1Schema = RecipeSchema.extend({
  pattern: z.array(z.string().min(1).max(3).regex(/^[A-Z ]+$/)).min(1).max(3).optional(),
  key: z.array(z.strictObject({
    symbol: z.string().length(1).regex(/^[A-Z]$/),
    item: ResourceLocation,
  })).min(1).max(9).optional(),
  resultCount: z.number().int().min(1).max(64).optional(),
}).superRefine((recipe, context) => {
  if (recipe.type !== "shaped") {
    if (recipe.pattern !== undefined) {
      context.addIssue({ code: "custom", path: ["pattern"], message: "Only shaped recipes may define a pattern." });
    }
    if (recipe.key !== undefined) {
      context.addIssue({ code: "custom", path: ["key"], message: "Only shaped recipes may define a key." });
    }
    if (recipe.type === "smelting" && recipe.resultCount !== undefined) {
      context.addIssue({ code: "custom", path: ["resultCount"], message: "Smelting output count is fixed in 1.20.1." });
    }
    return;
  }
  if (recipe.pattern === undefined || recipe.key === undefined) {
    context.addIssue({ code: "custom", path: ["pattern"], message: "Shaped recipes require pattern and key." });
    return;
  }
  if (recipe.ingredients.length > 0) {
    context.addIssue({ code: "custom", path: ["ingredients"], message: "Shaped recipes express ingredients through key." });
  }
  const width = recipe.pattern[0]?.length ?? 0;
  if (recipe.pattern.some((row) => row.length !== width)) {
    context.addIssue({ code: "custom", path: ["pattern"], message: "Shaped recipe rows must have equal width." });
  }
  if (recipe.pattern[0]?.trim().length === 0 || recipe.pattern.at(-1)?.trim().length === 0 ||
    recipe.pattern.every((row) => row.startsWith(" ")) || recipe.pattern.every((row) => row.endsWith(" "))) {
    context.addIssue({ code: "custom", path: ["pattern"], message: "Shaped recipe patterns must be tightly bounded." });
  }
  const symbols = new Set(recipe.pattern.join("").replaceAll(" ", ""));
  const declared = new Set<string>();
  recipe.key.forEach(({ symbol }, index) => {
    if (declared.has(symbol)) {
      context.addIssue({ code: "custom", path: ["key", index, "symbol"], message: "Recipe key symbols must be unique." });
    }
    declared.add(symbol);
  });
  if (symbols.size !== declared.size || [...symbols].some((symbol) => !declared.has(symbol))) {
    context.addIssue({ code: "custom", path: ["key"], message: "Recipe key must define exactly the symbols used by pattern." });
  }
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

const LocalId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);

export const BehaviorSpecSchema = z.strictObject({
  goals: z.array(z.strictObject({
    id: LocalId,
    type: z.enum([
      "swim", "wander", "look_at_player", "look_around", "melee_attack", "ranged_attack",
      "flee", "follow_owner", "return_to_home", "custom",
    ]),
    priority: z.number().int().min(0).max(31),
    speed: z.number().min(0).max(16).optional(),
    range: z.number().min(0).max(128).optional(),
    cooldownTicks: z.number().int().min(0).max(72_000).optional(),
  })).max(SPEC_COLLECTION_LIMITS.behaviorGoals),
  targets: z.array(z.strictObject({
    id: LocalId,
    type: z.enum(["player", "entity_type", "entity_tag", "attacker", "owner_target"]),
    priority: z.number().int().min(0).max(31),
    target: ResourceLocation.optional(),
    range: z.number().positive().max(128),
    requireLineOfSight: z.boolean(),
  })).max(SPEC_COLLECTION_LIMITS.behaviorTargets),
  stateMachine: z.strictObject({
    initial: LocalId,
    states: z.array(z.strictObject({
      id: LocalId,
      animation: ResourceLocation.optional(),
      invulnerable: z.boolean(),
      movementMultiplier: z.number().min(0).max(16),
    })).min(1).max(SPEC_COLLECTION_LIMITS.behaviorStates),
    transitions: z.array(z.strictObject({
      from: LocalId,
      to: LocalId,
      trigger: z.enum([
        "target_acquired", "target_lost", "in_melee_range", "outside_melee_range", "hurt",
        "cooldown_ready", "animation_complete", "health_below", "custom",
      ]),
      threshold: z.number().min(0).max(1).optional(),
    })).max(SPEC_COLLECTION_LIMITS.behaviorTransitions),
  }),
});

export const SpawnSpecSchema = z.strictObject({
  mode: z.enum(["none", "natural", "structure", "summoned"]),
  group: z.enum(["monster", "creature", "ambient", "water_creature", "misc"]),
  biomes: z.array(ResourceLocation).max(SPEC_COLLECTION_LIMITS.resourceReferences),
  weight: z.number().int().min(0).max(10_000),
  minGroupSize: z.number().int().min(1).max(64),
  maxGroupSize: z.number().int().min(1).max(64),
  placement: z.enum(["on_ground", "in_water", "no_restrictions"]),
  heightmap: z.enum(["motion_blocking", "motion_blocking_no_leaves", "ocean_floor"]),
  minLight: z.number().int().min(0).max(15),
  maxLight: z.number().int().min(0).max(15),
  maxNearby: z.number().int().min(1).max(128),
});

const EntityDataFieldSchema = z.strictObject({
  id: LocalId,
  type: z.enum(["boolean", "int", "float", "string", "uuid", "resource_location"]),
});

export const EntityV1Schema = EntitySchema.extend({
  animation: ResourceLocation.optional(),
  behavior: BehaviorSpecSchema,
  spawn: SpawnSpecSchema,
  persistence: z.strictObject({
    fields: z.array(EntityDataFieldSchema).max(SPEC_COLLECTION_LIMITS.entityDataFields),
  }),
  syncedState: z.strictObject({
    fields: z.array(EntityDataFieldSchema).max(SPEC_COLLECTION_LIMITS.entityDataFields),
  }),
});

export const StructureSpecSchema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  startPool: ResourceLocation,
  biomeTag: ResourceLocation,
  step: z.enum(["surface_structures", "underground_structures", "strongholds"]),
  terrainAdaptation: z.enum(["none", "beard_thin", "beard_box", "bury", "encapsulate"]),
  size: z.number().int().min(0).max(20),
  placement: z.strictObject({
    spacing: z.number().int().min(1).max(4_096),
    separation: z.number().int().min(0).max(4_095),
    salt: z.number().int().min(0).max(2_147_483_647),
  }),
  pieces: z.array(z.strictObject({
    id: LocalId,
    asset: ResourceLocation,
    weight: z.number().int().min(1).max(1_000),
    processors: z.array(ResourceLocation).max(SPEC_COLLECTION_LIMITS.resourceReferences),
  })).min(1).max(SPEC_COLLECTION_LIMITS.structurePieces),
  spawnOverrides: z.array(z.strictObject({
    entity: ResourceLocation,
    weight: z.number().int().min(1).max(10_000),
    minCount: z.number().int().min(1).max(64),
    maxCount: z.number().int().min(1).max(64),
  })).max(SPEC_COLLECTION_LIMITS.structureSpawnOverrides),
});

export const ScreenV1Schema = z.strictObject({
  id: ResourceLocation,
  references: ReferencesSchema,
  menuId: ResourceLocation,
  type: z.enum(["inventory", "machine", "configuration"]),
  slots: z.array(z.strictObject({
    id: LocalId,
    inventory: z.enum(["player", "block_entity"]),
    index: z.number().int().min(0).max(255),
    x: z.number().int().min(-4_096).max(4_096),
    y: z.number().int().min(-4_096).max(4_096),
    role: z.enum(["input", "output", "fuel", "energy", "storage"]),
  })).max(SPEC_COLLECTION_LIMITS.screenSlots),
  syncedFields: z.array(z.strictObject({
    id: LocalId,
    type: z.enum(["boolean", "int", "long", "float"]),
  })).max(SPEC_COLLECTION_LIMITS.screenFields),
  actions: z.array(z.strictObject({
    id: LocalId,
    payload: z.enum(["none", "boolean", "bounded_int"]),
    validation: z.strictObject({
      requireOpenMenu: z.literal(true),
      requireSameDimension: z.literal(true),
      maxDistance: z.number().positive().max(16),
      minimum: z.number().int().optional(),
      maximum: z.number().int().optional(),
    }),
  })).max(SPEC_COLLECTION_LIMITS.screenActions),
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

const ConfigOptionBase = {
  id: LocalId,
  name: boundedBmpString(1, 80),
  description: boundedBmpString(1, 240).optional(),
  restartRequired: z.boolean(),
};
const JavaInt = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const ConfigOptionSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...ConfigOptionBase, type: z.literal("boolean"), default: z.boolean() }),
  z.strictObject({
    ...ConfigOptionBase,
    type: z.literal("integer"),
    default: JavaInt,
    minimum: JavaInt,
    maximum: JavaInt,
    step: z.number().int().positive().max(2_147_483_647),
  }),
  z.strictObject({
    ...ConfigOptionBase,
    type: z.literal("string"),
    default: boundedBmpString(0, 256),
    maxLength: z.number().int().min(1).max(256),
    binding: z.enum(["player_join_message"]).optional(),
  }),
]);
export const YaclIntegrationSchema = z.strictObject({
  categories: z.array(z.strictObject({
    id: LocalId,
    name: boundedBmpString(1, 80),
    description: boundedBmpString(1, 240).optional(),
    options: z.array(ConfigOptionSchema).min(1).max(SPEC_COLLECTION_LIMITS.configOptionsPerCategory),
  })).min(1).max(SPEC_COLLECTION_LIMITS.configCategories),
}).superRefine(({ categories }, context) => {
  const categoryIds = new Set<string>();
  const optionIds = new Set<string>();
  const bindings = new Set<string>();
  categories.forEach((category, categoryIndex) => {
    if (categoryIds.has(category.id)) {
      context.addIssue({ code: "custom", path: ["categories", categoryIndex, "id"], message: "Category ids must be unique." });
    }
    categoryIds.add(category.id);
    category.options.forEach((option, optionIndex) => {
      const path = ["categories", categoryIndex, "options", optionIndex] as const;
      if (optionIds.has(option.id)) {
        context.addIssue({ code: "custom", path: [...path, "id"], message: "Config option ids must be globally unique." });
      }
      optionIds.add(option.id);
      if (option.type === "integer" &&
        (option.minimum >= option.maximum || option.default < option.minimum || option.default > option.maximum)) {
        context.addIssue({ code: "custom", path: [...path, "default"], message: "Integer defaults must be inside an ordered range." });
      }
      if (option.type === "string" && option.default.length > option.maxLength) {
        context.addIssue({ code: "custom", path: [...path, "default"], message: "String defaults must fit maxLength." });
      }
      if (option.type === "string" && option.binding !== undefined) {
        if (bindings.has(option.binding)) {
          context.addIssue({ code: "custom", path: [...path, "binding"], message: "Config bindings must be unique." });
        }
        bindings.add(option.binding);
        if (!option.restartRequired) {
          context.addIssue({
            code: "custom",
            path: [...path, "restartRequired"],
            message: "Server-authoritative bindings must require restart.",
          });
        }
      }
    });
  });
});

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

const ModSpecV1GameplaySchema = ModSpecSchema.shape.gameplay.extend({
  items: z.array(ItemV1Schema).max(SPEC_COLLECTION_LIMITS.gameplayItems),
  materials: z.array(MaterialV1Schema).max(SPEC_COLLECTION_LIMITS.gameplayMaterials).default([]),
  entities: z.array(EntityV1Schema).max(SPEC_COLLECTION_LIMITS.gameplayEntities),
  structures: z.array(StructureSpecSchema).max(SPEC_COLLECTION_LIMITS.gameplayStructures),
  screens: z.array(ScreenV1Schema).max(SPEC_COLLECTION_LIMITS.gameplayScreens),
  recipes: z.array(RecipeV1Schema).max(SPEC_COLLECTION_LIMITS.gameplayRecipes),
});
const ModSpecV1IntegrationsSchema = ModSpecSchema.shape.integrations.extend({
  yacl: YaclIntegrationSchema.optional(),
});

export const ModSpecV1Schema = ModSpecSchema.extend({
  schemaVersion: z.literal(1),
  gameplay: ModSpecV1GameplaySchema,
  integrations: ModSpecV1IntegrationsSchema,
});

export const AnyModSpecSchema = z.discriminatedUnion("schemaVersion", [ModSpecSchema, ModSpecV1Schema]);

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
export type ModSpecV1 = z.infer<typeof ModSpecV1Schema>;
export type AnyModSpec = z.infer<typeof AnyModSpecSchema>;
export type ArtSpec = z.infer<typeof ArtSpecSchema>;
export type Spec = AnyModSpec | ArtSpec;

function jsonSchema(schema: z.ZodType, id: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...z.toJSONSchema(schema),
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
  });
}

export const ModSpecJsonSchema = jsonSchema(ModSpecSchema, MODSPEC_SCHEMA_ID);
export const ModSpecV1JsonSchema = jsonSchema(ModSpecV1Schema, MODSPEC_V1_SCHEMA_ID);
export const ArtSpecJsonSchema = jsonSchema(ArtSpecSchema, ARTSPEC_SCHEMA_ID);
