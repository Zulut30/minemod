import type { ArtSpec, ModSpec, ModSpecV1 } from "../../packages/modspec/index.ts";
import type { DiagnosticCode } from "../../packages/validation/index.ts";

export const source = {
  kind: "generated",
  source: "https://example.invalid/generator/mcdev-v0",
  license: "CC0-1.0",
  sha256: "a".repeat(64),
} as const;

export const validModFixture: ModSpec = {
  schemaVersion: 0,
  kind: "mod",
  project: {
    modId: "tidecaller",
    name: "Tidecaller",
    version: "0.1.0",
    license: "MIT",
    provenance: [source],
  },
  target: { minecraft: "26.1.2", loader: "neoforge", java: 25 },
  gameplay: {
    items: [{ id: "tidecaller:shell", references: [], maxStackSize: 64 }],
    blocks: [],
    entities: [{
      id: "tidecaller:crab",
      references: ["tidecaller:shell"],
      attributes: { maxHealth: 20, movementSpeed: 0.25 },
      renderer: "tidecaller:crab_model",
      dimensions: { width: 0.8, height: 0.6 },
    }],
    recipes: [],
    summoning: [],
    screens: [],
  },
  assets: {
    artSpec: "art-spec.yaml",
    models: [{
      id: "tidecaller:crab_model",
      path: "tidecaller/models/entity/crab.bbmodel",
      license: "CC0-1.0",
      provenance: [source],
      metrics: { textureBytes: 0, cubes: 24, bones: 8, triangles: 288, keyframes: 0 },
    }],
    textures: [{
      id: "tidecaller:crab_texture",
      path: "tidecaller/textures/entity/crab.png",
      license: "CC0-1.0",
      provenance: [source],
      metrics: { textureBytes: 16_384, cubes: 0, bones: 0, triangles: 0, keyframes: 0 },
    }],
    animations: [{
      id: "tidecaller:crab_animation",
      path: "tidecaller/animations/entity/crab.json",
      license: "CC0-1.0",
      provenance: [source],
      metrics: { textureBytes: 0, cubes: 0, bones: 0, triangles: 0, keyframes: 96 },
    }],
    budgets: {
      maxTextureBytes: 1_048_576,
      maxCubes: 128,
      maxBones: 32,
      maxTriangles: 2_048,
      maxKeyframes: 1_024,
    },
  },
  dependencies: { required: ["geckolib"], optional: ["jei", "jade"] },
  integrations: { jei: "auto", jade: "auto" },
  tests: { gameTests: [{ id: "tidecaller:crab_spawns", references: ["tidecaller:crab"] }] },
  packaging: { includeSources: true, publish: false },
};

export const validFabricV1Fixture: ModSpecV1 = {
  schemaVersion: 1,
  kind: "mod",
  project: {
    modId: "infectedfrontier",
    name: "Infected Frontier",
    version: "0.1.0",
    license: "Apache-2.0",
    provenance: [source],
  },
  target: { minecraft: "1.20.1", loader: "fabric", java: 17 },
  gameplay: {
    items: [],
    blocks: [],
    entities: [{
      id: "infectedfrontier:fungal_infected",
      references: [],
      attributes: { maxHealth: 30, movementSpeed: 0.24 },
      renderer: "infectedfrontier:fungal_infected_model",
      animation: "infectedfrontier:fungal_infected_animation",
      dimensions: { width: 0.8, height: 2.1 },
      behavior: {
        goals: [
          { id: "wander", type: "wander", priority: 5, speed: 0.8 },
          { id: "melee", type: "melee_attack", priority: 2, speed: 1.1, range: 2, cooldownTicks: 20 },
        ],
        targets: [{
          id: "players",
          type: "player",
          priority: 1,
          range: 32,
          requireLineOfSight: true,
        }],
        stateMachine: {
          initial: "idle",
          states: [
            { id: "idle", animation: "infectedfrontier:fungal_infected_animation", invulnerable: false, movementMultiplier: 1 },
            { id: "chase", animation: "infectedfrontier:fungal_infected_animation", invulnerable: false, movementMultiplier: 1.2 },
            { id: "attack", animation: "infectedfrontier:fungal_infected_animation", invulnerable: false, movementMultiplier: 0 },
          ],
          transitions: [
            { from: "idle", to: "chase", trigger: "target_acquired" },
            { from: "chase", to: "attack", trigger: "in_melee_range" },
            { from: "attack", to: "chase", trigger: "animation_complete" },
          ],
        },
      },
      spawn: {
        mode: "structure",
        group: "monster",
        biomes: ["minecraft:plains"],
        weight: 20,
        minGroupSize: 1,
        maxGroupSize: 2,
        placement: "on_ground",
        heightmap: "motion_blocking_no_leaves",
        minLight: 0,
        maxLight: 7,
        maxNearby: 4,
      },
      persistence: { fields: [{ id: "behavior_state", type: "int" }] },
      syncedState: { fields: [{ id: "attacking", type: "boolean" }] },
    }],
    recipes: [],
    summoning: [],
    structures: [{
      id: "infectedfrontier:quarantine_camp",
      references: ["infectedfrontier:fungal_infected"],
      startPool: "infectedfrontier:quarantine_camp/start",
      biomeTag: "infectedfrontier:has_structure/quarantine_camp",
      step: "surface_structures",
      terrainAdaptation: "beard_thin",
      size: 3,
      placement: { spacing: 32, separation: 12, salt: 1_820_431 },
      pieces: [{
        id: "camp_center",
        asset: "infectedfrontier:quarantine_camp_structure",
        weight: 1,
        processors: ["minecraft:empty"],
      }],
      spawnOverrides: [{
        entity: "infectedfrontier:fungal_infected",
        weight: 10,
        minCount: 1,
        maxCount: 2,
      }],
    }],
    screens: [{
      id: "infectedfrontier:research_table",
      references: [],
      menuId: "infectedfrontier:research_table",
      type: "machine",
      slots: [
        { id: "input", inventory: "block_entity", index: 0, x: 56, y: 35, role: "input" },
        { id: "output", inventory: "block_entity", index: 1, x: 116, y: 35, role: "output" },
      ],
      syncedFields: [{ id: "progress", type: "int" }],
      actions: [{
        id: "set_mode",
        payload: "bounded_int",
        validation: {
          requireOpenMenu: true,
          requireSameDimension: true,
          maxDistance: 8,
          minimum: 0,
          maximum: 2,
        },
      }],
    }],
  },
  assets: {
    artSpec: "infected-frontier-art.json",
    models: [
      {
        id: "infectedfrontier:fungal_infected_model",
        path: "infectedfrontier/models/entity/fungal_infected.bbmodel",
        license: "CC0-1.0",
        provenance: [source],
        metrics: { textureBytes: 0, cubes: 32, bones: 12, triangles: 384, keyframes: 0 },
      },
      {
        id: "infectedfrontier:quarantine_camp_structure",
        path: "infectedfrontier/structures/quarantine_camp.nbt",
        license: "CC0-1.0",
        provenance: [source],
        metrics: { textureBytes: 0, cubes: 0, bones: 0, triangles: 0, keyframes: 0 },
      },
    ],
    textures: [],
    animations: [{
      id: "infectedfrontier:fungal_infected_animation",
      path: "infectedfrontier/animations/entity/fungal_infected.json",
      license: "CC0-1.0",
      provenance: [source],
      metrics: { textureBytes: 0, cubes: 0, bones: 0, triangles: 0, keyframes: 160 },
    }],
    budgets: {
      maxTextureBytes: 1_048_576,
      maxCubes: 128,
      maxBones: 32,
      maxTriangles: 2_048,
      maxKeyframes: 1_024,
    },
  },
  dependencies: { required: [], optional: [] },
  integrations: { jei: "off", jade: "off" },
  tests: { gameTests: [] },
  packaging: { includeSources: true, publish: false },
};

export const validArtFixture: ArtSpec = {
  schemaVersion: 0,
  kind: "art",
  id: "tidecaller:default",
  targetMatrix: [{
    minecraft: "26.1.2",
    loader: "neoforge",
    java: 25,
    loaderVersion: "26.1.2.80",
    runtime: { id: "java", version: "25" },
    renderer: { id: "vanilla", version: "26.1.2" },
  }],
  assetClass: "animated-model",
  targetContexts: [
    "turntable",
    "key-poses",
    "idle",
    "gameplay-animation",
    "near",
    "mid",
    "daylight",
    "night",
    "interior",
    "timing-evidence",
  ],
  style: {
    family: "vanilla-plus",
    palette: ["#B46A4C", "#4B8F8C"],
    targetPaletteColors: 2,
    hueValueHierarchy: {
      shadows: ["#4B8F8C"],
      midtones: ["#B46A4C"],
      highlights: ["#B46A4C"],
      minimumValueStep: 12,
    },
    lighting: { source: "sun", direction: "top-left" },
    outline: { policy: "selective", color: "#2A2428" },
    saturation: { minimum: 20, maximum: 75 },
    detail: { scale: "medium", maxNoisePercent: 15 },
    materialRecipes: [{
      id: "tidecaller:copper_coral",
      material: "metal",
      shadow: "#4B8F8C",
      base: "#B46A4C",
      highlight: "#B46A4C",
      pattern: "Sparse oxidized edges with broad readable planes.",
    }],
    silhouetteLanguage: "Broad claws, low body, and a readable asymmetrical coral crest.",
    forbiddenReferences: [{
      subject: "assets copied from reference mods",
      reason: "References inform function only; runtime art must remain original.",
    }],
    textureResolution: 64,
    texelDensity: { pixelsPerBlock: 16, tolerancePercent: 10 },
  },
  provenancePolicy: {
    allowedSourceKinds: ["generated", "manual"],
    requireSourceHashes: true,
    requireReferenceRights: true,
    forbidLivingArtistStylePrompts: true,
  },
  references: [],
  budgets: {
    maxTextureBytes: 1_048_576,
    maxCubes: 128,
    maxBones: 32,
    maxTriangles: 2_048,
    maxKeyframes: 1_024,
  },
  assets: [
    ...validModFixture.assets.models,
    ...validModFixture.assets.textures,
    ...validModFixture.assets.animations,
  ],
};

export const invalidFixtures: readonly {
  readonly name: string;
  readonly expectedCode: DiagnosticCode;
  readonly value: unknown;
}[] = [
  {
    name: "duplicate ResourceLocation",
    expectedCode: "DUPLICATE_RESOURCE_LOCATION",
    value: {
      ...validModFixture,
      gameplay: {
        ...validModFixture.gameplay,
        items: [validModFixture.gameplay.items[0], validModFixture.gameplay.items[0]],
      },
    },
  },
  {
    name: "duplicate ModSpec asset ResourceLocation",
    expectedCode: "DUPLICATE_RESOURCE_LOCATION",
    value: {
      ...validModFixture,
      assets: {
        ...validModFixture.assets,
        models: [validModFixture.assets.models[0], validModFixture.assets.models[0]],
      },
    },
  },
  {
    name: "broken reference",
    expectedCode: "BROKEN_REFERENCE",
    value: {
      ...validModFixture,
      gameplay: {
        ...validModFixture.gameplay,
        items: [{ ...validModFixture.gameplay.items[0], references: ["tidecaller:missing"] }],
      },
    },
  },
  {
    name: "missing license",
    expectedCode: "MISSING_LICENSE",
    value: {
      ...validModFixture,
      project: {
        modId: validModFixture.project.modId,
        name: validModFixture.project.name,
        version: validModFixture.project.version,
        provenance: validModFixture.project.provenance,
      },
    },
  },
  {
    name: "missing provenance",
    expectedCode: "MISSING_PROVENANCE",
    value: { ...validArtFixture, assets: [{ ...validArtFixture.assets[0], provenance: [] }] },
  },
  {
    name: "budget overflow",
    expectedCode: "BUDGET_OVERFLOW",
    value: { ...validArtFixture, budgets: { ...validArtFixture.budgets, maxCubes: 1 } },
  },
];
