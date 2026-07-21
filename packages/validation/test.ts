import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ModSpecJsonSchema, SPEC_COLLECTION_LIMITS } from "@mcdev/modspec";
import {
  createEnumerableArrayExtraKeyBomb,
  createEnumerableObjectKeyBomb,
  ENUMERABLE_KEY_BOMB_SIZE,
} from "../../fixtures/specs/key-bombs.ts";
import {
  invalidFixtures,
  source,
  validArtFixture,
  validModFixture,
} from "../../fixtures/specs/validation.ts";
import {
  MAX_DIAGNOSTICS,
  MAX_INLINE_SPEC_BYTES,
  MAX_SPEC_ARRAY_ITEMS,
  MAX_SPEC_KEY_CHARS,
  MAX_SPEC_NESTING_DEPTH,
  MAX_SPEC_OBJECT_KEYS,
  MAX_SPEC_TOTAL_KEY_CHARS,
  MAX_SPEC_TOTAL_NODES,
  MAX_SPEC_TOTAL_OBJECT_KEYS,
  VALIDATION_PROFILE_IDS,
  type Diagnostic,
  validateInlineSpec,
  validateSpec,
} from "./index.ts";

type JsonObject = Record<string, unknown>;

type PrototypeKeyBombKind = "array" | "object";

interface PrototypeKeyBombResult {
  readonly kind: PrototypeKeyBombKind;
  readonly keys: number;
  readonly diagnosticCode: string | undefined;
  readonly diagnosticPath: string | undefined;
  readonly diagnosticCount: number;
  readonly getterCalls: number;
  readonly semanticHandlerCalls: number;
  readonly elapsedMilliseconds: number;
  readonly rssGrowthBytes: number;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertBoundedEnumerableKeyBomb(
  name: string,
  value: unknown,
  expectedDiagnostic: Diagnostic,
): void {
  assert.ok(globalThis.gc !== undefined, "validation regressions must run with --expose-gc");
  globalThis.gc();
  const rssBefore = process.memoryUsage.rss();
  const started = process.hrtime.bigint();
  assert.deepEqual(validateSpec({ kind: "mod", bomb: value }).diagnostics, [expectedDiagnostic], name);
  const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
  globalThis.gc();
  const rssGrowth = Math.max(0, process.memoryUsage.rss() - rssBefore);
  assert.ok(
    elapsedMilliseconds < 2_000,
    `${name} (${ENUMERABLE_KEY_BOMB_SIZE} keys) took ${elapsedMilliseconds.toFixed(1)}ms`,
  );
  assert.ok(
    rssGrowth < 16 * 1024 * 1024,
    `${name} (${ENUMERABLE_KEY_BOMB_SIZE} keys) retained ${rssGrowth} RSS bytes`,
  );
}

function runPrototypeKeyBombChild(kind: PrototypeKeyBombKind): PrototypeKeyBombResult {
  assert.ok(globalThis.gc !== undefined, "prototype regressions must run with --expose-gc");
  const pollutedPrototype = kind === "object" ? Object.prototype : Array.prototype;
  let getterCalls = 0;
  Object.defineProperty(pollutedPrototype, "mcdevInheritedGetter", {
    configurable: true,
    enumerable: true,
    get: () => {
      getterCalls += 1;
      throw new Error("inherited getter must not run during structural rejection");
    },
  });
  for (let index = 0; index < ENUMERABLE_KEY_BOMB_SIZE; index += 1) {
    Object.defineProperty(pollutedPrototype, `mcdevInherited${index}`, {
      configurable: true,
      enumerable: true,
      value: 0,
    });
  }

  let semanticHandlerCalls = 0;
  const originalSetHas = Set.prototype.has;
  Set.prototype.has = function countedSemanticSetHas<T>(this: Set<T>, value: T): boolean {
    semanticHandlerCalls += 1;
    return originalSetHas.call(this, value);
  };

  globalThis.gc();
  const rssBefore = process.memoryUsage.rss();
  const started = process.hrtime.bigint();
  const validation = validateSpec(validModFixture);
  const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
  Set.prototype.has = originalSetHas;
  globalThis.gc();
  const rssGrowthBytes = Math.max(0, process.memoryUsage.rss() - rssBefore);
  const expectedPath = kind === "object" ? "" : "/assets/animations";
  assert.deepEqual(validation.diagnostics, [{
    code: "NON_JSON_VALUE",
    path: expectedPath,
    message: "Enumerable inherited properties are not accepted as JSON data.",
  }]);
  assert.equal(getterCalls, 0, `${kind} prototype pollution must not invoke inherited getters`);
  assert.equal(
    semanticHandlerCalls,
    0,
    `${kind} prototype pollution must be rejected before semantic duplicate handlers`,
  );
  assert.ok(
    elapsedMilliseconds < 2_000,
    `${kind} inherited-key bomb took ${elapsedMilliseconds.toFixed(1)}ms`,
  );
  assert.ok(
    rssGrowthBytes < 16 * 1024 * 1024,
    `${kind} inherited-key bomb retained ${rssGrowthBytes} RSS bytes`,
  );

  return {
    kind,
    keys: ENUMERABLE_KEY_BOMB_SIZE,
    diagnosticCode: validation.diagnostics[0]?.code,
    diagnosticPath: validation.diagnostics[0]?.path,
    diagnosticCount: validation.diagnostics.length,
    getterCalls,
    semanticHandlerCalls,
    elapsedMilliseconds,
    rssGrowthBytes,
  };
}

function assertBoundedPrototypeKeyBombSubprocess(kind: PrototypeKeyBombKind): void {
  const child = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--experimental-strip-types",
      fileURLToPath(import.meta.url),
      "--prototype-key-bomb-child",
      kind,
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    },
  );
  assert.equal(child.error, undefined, `${kind} inherited-key child failed to launch`);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout) as PrototypeKeyBombResult;
  assert.equal(result.kind, kind);
  assert.equal(result.keys, ENUMERABLE_KEY_BOMB_SIZE);
  assert.equal(result.diagnosticCode, "NON_JSON_VALUE");
  assert.equal(result.diagnosticPath, kind === "object" ? "" : "/assets/animations");
  assert.equal(result.diagnosticCount, 1);
  assert.equal(result.getterCalls, 0);
  assert.equal(result.semanticHandlerCalls, 0);
  assert.ok(result.elapsedMilliseconds < 2_000);
  assert.ok(result.rssGrowthBytes < 16 * 1024 * 1024);
}

function selfTest(): void {
  assert.equal(validateSpec(validModFixture, "mod").valid, true);
  assert.equal(validateSpec(validArtFixture, "art").valid, true);

  const profile = VALIDATION_PROFILE_IDS[0];
  const loaderNeutralTargets = [
    { minecraft: "26.1.2", loader: "neoforge", java: 25 },
    { minecraft: "26.2", loader: "fabric", java: 25 },
    { minecraft: "26.2", loader: "forge", java: 25 },
    { minecraft: "26.2", loader: "paper", java: 21 },
  ] as const;
  for (const target of loaderNeutralTargets) {
    const candidate = { ...validModFixture, target };
    assert.equal(validateSpec(candidate, "mod").valid, true, `${target.loader} is loader-neutral by default`);
    assert.equal(
      validateInlineSpec(JSON.stringify(candidate), "mod").valid,
      true,
      `${target.loader} inline validation is loader-neutral by default`,
    );
    const profiled = validateSpec(candidate, "mod", { profile });
    if (target.loader === "neoforge") {
      assert.equal(profiled.valid, true, "the named NeoForge baseline must pass its own profile");
    } else {
      assert.deepEqual(profiled.diagnostics.find(({ code }) => code === "INCOMPATIBLE_TARGET"), {
        code: "INCOMPATIBLE_TARGET",
        path: "/target",
        message: `Validation profile ${profile} requires Minecraft 26.1.2, NeoForge, and Java 25.`,
      });
    }
  }

  const animationWithoutRequiredGeckoLib = {
    ...validModFixture,
    dependencies: { required: [], optional: ["jei", "jade", "geckolib"] },
  };
  assert.equal(
    validateSpec(animationWithoutRequiredGeckoLib, "mod").valid,
    true,
    "animation dependency policy must remain loader-neutral without an explicit profile",
  );
  const missingGeckoLibDiagnostic = {
    code: "SEMANTIC_INVALID" as const,
    path: "/dependencies/required",
    message: `Validation profile ${profile} requires bare dependency mod id "geckolib" in dependencies.required when assets.animations is nonempty.`,
  };
  assert.deepEqual(
    validateSpec(animationWithoutRequiredGeckoLib, "mod", { profile }).diagnostics,
    [missingGeckoLibDiagnostic],
    "the named profile must emit exactly one deterministic missing-GeckoLib diagnostic",
  );
  assert.deepEqual(
    validateInlineSpec(JSON.stringify(animationWithoutRequiredGeckoLib), "mod", { profile }).diagnostics,
    [missingGeckoLibDiagnostic],
    "inline validation must preserve the exact named-profile diagnostic",
  );
  assert.equal(
    validateSpec(validModFixture, "mod", { profile }).valid,
    true,
    "the exact bare geckolib mod id in dependencies.required must satisfy the named profile",
  );
  assert.equal(
    validateSpec({
      ...validModFixture,
      assets: { ...validModFixture.assets, animations: [] },
      dependencies: { required: [], optional: ["jei", "jade"] },
    }, "mod", { profile }).valid,
    true,
    "the named profile must not require geckolib when there are no animation assets",
  );
  assert.ok(
    validateSpec({
      ...validModFixture,
      dependencies: { required: ["com.geckolib:geckolib-neoforge"], optional: ["jei", "jade"] },
    }, "mod", { profile }).diagnostics.some(({ code, path }) =>
      code === "SCHEMA_INVALID" && path === "/dependencies/required/0"),
    "Maven coordinates must not masquerade as the required bare dependency mod id",
  );

  const fabricArt = {
    ...validArtFixture,
    targetMatrix: [{
      ...validArtFixture.targetMatrix[0],
      minecraft: "26.2",
      loader: "fabric",
      loaderVersion: "0.18.4",
      renderer: { id: "indigo", version: "26.2" },
    }],
  };
  assert.equal(validateSpec(fabricArt, "art").valid, true, "ArtSpec targets are loader-neutral by default");
  assert.deepEqual(
    validateInlineSpec(JSON.stringify(fabricArt), "art", { profile }).diagnostics
      .find(({ code }) => code === "INCOMPATIBLE_TARGET"),
    {
      code: "INCOMPATIBLE_TARGET",
      path: "/targetMatrix",
      message: `Validation profile ${profile} requires Minecraft 26.1.2, NeoForge, and Java 25.`,
    },
  );
  assert.equal(
    validateSpec({ ...validModFixture, schemaVersion: "0" }).diagnostics
      .some(({ code, path }) => code === "SCHEMA_INVALID" && path === "/schemaVersion"),
    true,
    "the Phase-0 wire contract uses numeric schemaVersion 0",
  );

  const contextsByClass = {
    "item-icon": [
      "native-size", "nearest-neighbor-2x", "nearest-neighbor-4x", "alpha-checkerboard",
      "inventory-normal", "inventory-selected",
    ],
    "cuboid-model": [
      "turntable", "uv-sheet", "close-seams", "inventory-normal", "placed",
      "daylight", "night", "interior", "near", "mid",
    ],
    "animated-model": [
      "turntable", "key-poses", "idle", "gameplay-animation", "near",
      "mid", "daylight", "night", "interior", "timing-evidence",
    ],
    structure: [
      "orthographic-elevations", "palette-material-sheet", "placed-fixture", "exterior", "near", "mid", "far",
    ],
    "decorative-mesh": [
      "turntable", "wireframe-lod-uv", "renderer-fixture", "near", "mid", "far",
      "worst-case-lighting", "lod-transitions",
    ],
    "ui-sprite": [
      "source-atlas", "nine-slice-bounds", "gui-scale-2", "gui-scale-3", "gui-scale-4",
      "minimum-resolution", "reference-resolution",
    ],
  } as const;
  for (const [assetClass, targetContexts] of Object.entries(contextsByClass)) {
    const candidate = { ...validArtFixture, assetClass, targetContexts };
    assert.equal(validateSpec(candidate, "art").valid, true, `${assetClass} required contexts are representable`);
    const missing = validateSpec({ ...candidate, targetContexts: targetContexts.slice(1) }, "art");
    assert.ok(
      missing.diagnostics.some(({ code, path }) => code === "SEMANTIC_INVALID" && path === "/targetContexts"),
      `${assetClass} must reject a missing mandatory context`,
    );
  }

  assert.deepEqual(validateSpec({
    ...validArtFixture,
    targetMatrix: [validArtFixture.targetMatrix[0], validArtFixture.targetMatrix[0]],
  }).diagnostics.find(({ code, path }) => code === "SEMANTIC_INVALID" && path === "/targetMatrix/1"), {
    code: "SEMANTIC_INVALID",
    path: "/targetMatrix/1",
    message: "Duplicate ArtSpec target matrix tuple.",
  });
  assert.deepEqual(validateSpec({
    ...validArtFixture,
    targetMatrix: [{
      ...validArtFixture.targetMatrix[0],
      runtime: { id: "java", version: "21" },
    }],
  }).diagnostics.find(({ path }) => path === "/targetMatrix/0/runtime/version"), {
    code: "SEMANTIC_INVALID",
    path: "/targetMatrix/0/runtime/version",
    message: "Java runtime version 21 must match java 25.",
  });
  assert.deepEqual(validateSpec({
    ...validArtFixture,
    style: {
      ...validArtFixture.style,
      palette: ["#abcdef", "#ABCDEF"],
    },
  }).diagnostics.find(({ path }) => path === "/style/palette/1"), {
    code: "SEMANTIC_INVALID",
    path: "/style/palette/1",
    message: "Duplicate palette color: #ABCDEF",
  });

  const wrongTypedReferences = [
    {
      path: "/gameplay/blocks/0/item",
      gameplay: {
        ...validModFixture.gameplay,
        blocks: [{ id: "tidecaller:altar", references: [], item: "tidecaller:crab", hardness: 3 }],
      },
    },
    {
      path: "/gameplay/entities/0/renderer",
      gameplay: {
        ...validModFixture.gameplay,
        entities: [{ ...validModFixture.gameplay.entities[0], renderer: "tidecaller:crab_texture" }],
      },
    },
    {
      path: "/gameplay/recipes/0/result",
      gameplay: {
        ...validModFixture.gameplay,
        recipes: [{
          id: "tidecaller:bad_recipe",
          references: [],
          type: "shapeless",
          ingredients: ["tidecaller:shell"],
          result: "tidecaller:crab",
        }],
      },
    },
    {
      path: "/gameplay/summoning/0/entity",
      gameplay: {
        ...validModFixture.gameplay,
        summoning: [{
          id: "tidecaller:bad_summon",
          references: [],
          entity: "tidecaller:shell",
          ingredients: ["tidecaller:shell"],
        }],
      },
    },
  ] as const;
  for (const testCase of wrongTypedReferences) {
    assert.ok(
      validateSpec({ ...validModFixture, gameplay: testCase.gameplay }).diagnostics
        .some(({ code, path }) => code === "BROKEN_REFERENCE" && path === testCase.path),
      `typed reference domain must reject ${testCase.path}`,
    );
  }

  assert.equal(validateSpec({
    ...validModFixture,
    gameplay: {
      ...validModFixture.gameplay,
      blocks: [{
        id: "tidecaller:shell",
        references: [],
        item: "tidecaller:shell",
        hardness: 3,
      }],
    },
  }).valid, true, "a Block and its BlockItem may share one ResourceLocation across registry domains");

  assert.equal(validateSpec({
    ...validModFixture,
    assets: {
      ...validModFixture.assets,
      textures: [{ ...validModFixture.assets.textures[0], id: "tidecaller:crab_model" }],
      animations: [{ ...validModFixture.assets.animations[0], id: "tidecaller:crab_model" }],
    },
  }).valid, true, "model, texture and animation domains may reuse one logical ResourceLocation");

  assert.ok(validateSpec({
    ...validModFixture,
    gameplay: {
      ...validModFixture.gameplay,
      recipes: [{
        id: "tidecaller:custom_recipe",
        references: [],
        type: "custom",
        ingredients: ["tidecaller:shell"],
        result: "tidecaller:shell",
      }],
    },
  }).diagnostics.some(({ code, path }) => code === "SEMANTIC_INVALID" && path.endsWith("/serializer")));

  assert.ok(validateSpec({
    ...validModFixture,
    gameplay: {
      ...validModFixture.gameplay,
      screens: [{
        id: "tidecaller:config",
        references: [],
        menuId: "tidecaller:config_menu",
        serverValidation: false,
      }],
    },
  }).diagnostics.some(({ code, path }) => code === "SEMANTIC_INVALID" && path.endsWith("/serverValidation")));

  assert.ok(validateSpec({
    ...validModFixture,
    dependencies: { required: ["geckolib", "jei"], optional: ["jade"] },
  }).diagnostics.some(({ code, path }) => code === "SEMANTIC_INVALID" && path === "/integrations/jei"));
  assert.ok(validateSpec({
    ...validModFixture,
    integrations: { ...validModFixture.integrations, jei: "off" },
  }).diagnostics.some(({ code, path }) => code === "SEMANTIC_INVALID" && path === "/integrations/jei"));
  assert.equal(validateSpec({
    ...validModFixture,
    dependencies: { required: ["geckolib", "jei"], optional: ["jade"] },
    integrations: {
      ...validModFixture.integrations,
      jei: { mode: "required", pluginId: "tidecaller:integration" },
    },
  }).valid, true, "a detailed required integration must align with the mandatory classpath");
  assert.equal(validateSpec({
    ...validModFixture,
    dependencies: { required: ["geckolib", "jei", "jade"], optional: [] },
    integrations: {
      jei: { mode: "required", pluginId: "tidecaller:integration" },
      jade: {
        mode: "required",
        providerId: "tidecaller:integration",
        maxDataBytes: 1_024,
      },
    },
  }).valid, true, "JEI plugin and Jade provider ids belong to distinct integration domains");

  const maximalReferences = Array.from(
    { length: SPEC_COLLECTION_LIMITS.resourceReferences },
    (_unused, index) => `tidecaller:item_${index}`,
  );
  const maximalItems = Array.from({ length: SPEC_COLLECTION_LIMITS.gameplayItems }, (_unused, index) => ({
    id: `tidecaller:item_${index}`,
    references: maximalReferences,
    maxStackSize: 99,
  }));
  const maximalModels = Array.from({ length: SPEC_COLLECTION_LIMITS.assetModels }, (_unused, index) => ({
    id: `tidecaller:model_${index}`,
    path: `tidecaller/textures/a${index}.png`,
    license: "CC0-1.0",
    provenance: Array.from({ length: SPEC_COLLECTION_LIMITS.assetProvenance }, () => ({ ...source })),
    metrics: { textureBytes: 0, cubes: 0, bones: 0, triangles: 0, keyframes: 0 },
  }));
  const makeAssets = (prefix: string, length: number) => Array.from({ length }, (_unused, index) => ({
    ...maximalModels[index % maximalModels.length],
    id: `tidecaller:${prefix}_${index}`,
    path: `tidecaller/${prefix}/a${index}.json`,
  }));
  const maximalModSpec = {
    ...validModFixture,
    project: {
      ...validModFixture.project,
      provenance: Array.from({ length: SPEC_COLLECTION_LIMITS.projectProvenance }, () => ({ ...source })),
    },
    gameplay: {
      items: maximalItems,
      blocks: Array.from({ length: SPEC_COLLECTION_LIMITS.gameplayBlocks }, (_unused, index) => ({
        id: `tidecaller:block_${index}`,
        references: maximalReferences,
        item: `tidecaller:item_${index}`,
        hardness: 100,
      })),
      entities: Array.from({ length: SPEC_COLLECTION_LIMITS.gameplayEntities }, (_unused, index) => ({
        id: `tidecaller:entity_${index}`,
        references: maximalReferences,
        attributes: { maxHealth: 2_048, movementSpeed: 16 },
        renderer: `tidecaller:model_${index}`,
        dimensions: { width: 64, height: 64 },
      })),
      recipes: Array.from({ length: SPEC_COLLECTION_LIMITS.gameplayRecipes }, (_unused, index) => ({
        id: `tidecaller:recipe_${index}`,
        references: maximalReferences,
        type: "shaped" as const,
        ingredients: maximalReferences,
        result: `tidecaller:item_${index}`,
      })),
      summoning: Array.from({ length: SPEC_COLLECTION_LIMITS.gameplaySummoning }, (_unused, index) => ({
        id: `tidecaller:summon_${index}`,
        references: maximalReferences,
        entity: `tidecaller:entity_${index}`,
        ingredients: maximalReferences,
      })),
      screens: Array.from({ length: SPEC_COLLECTION_LIMITS.gameplayScreens }, (_unused, index) => ({
        id: `tidecaller:screen_${index}`,
        references: maximalReferences,
        menuId: `tidecaller:menu_${index}`,
        serverValidation: true,
      })),
    },
    assets: {
      ...validModFixture.assets,
      models: maximalModels,
      textures: makeAssets("textures", SPEC_COLLECTION_LIMITS.assetTextures),
      animations: makeAssets("animations", SPEC_COLLECTION_LIMITS.assetAnimations),
    },
    dependencies: {
      required: Array.from(
        { length: SPEC_COLLECTION_LIMITS.requiredDependencies },
        (_unused, index) => `required_${index}`,
      ),
      optional: Array.from(
        { length: SPEC_COLLECTION_LIMITS.optionalDependencies },
        (_unused, index) => index === 0 ? "jei" : index === 1 ? "jade" : `optional_${index}`,
      ),
    },
    tests: {
      gameTests: Array.from({ length: SPEC_COLLECTION_LIMITS.gameTests }, (_unused, index) => ({
        id: `tidecaller:test_${index}`,
        references: maximalReferences,
      })),
    },
  };
  assert.equal(
    validateSpec(maximalModSpec, "mod").valid,
    true,
    "all simultaneous ModSpec v0 cardinality maxima must remain below structural limits",
  );
  assert.equal(
    validateSpec({
      ...validArtFixture,
      style: {
        ...validArtFixture.style,
        palette: Array.from(
          { length: SPEC_COLLECTION_LIMITS.palette },
          (_unused, index) => `#${index.toString(16).padStart(6, "0")}`,
        ),
        targetPaletteColors: SPEC_COLLECTION_LIMITS.palette,
        hueValueHierarchy: {
          ...validArtFixture.style.hueValueHierarchy,
          shadows: Array.from({ length: SPEC_COLLECTION_LIMITS.hueValueColors }, () => "#111111"),
          midtones: Array.from({ length: SPEC_COLLECTION_LIMITS.hueValueColors }, () => "#777777"),
          highlights: Array.from({ length: SPEC_COLLECTION_LIMITS.hueValueColors }, () => "#EEEEEE"),
        },
        materialRecipes: Array.from({ length: SPEC_COLLECTION_LIMITS.materialRecipes }, (_unused, index) => ({
          ...validArtFixture.style.materialRecipes[0],
          id: `tidecaller:material_${index}`,
        })),
        forbiddenReferences: Array.from(
          { length: SPEC_COLLECTION_LIMITS.forbiddenReferences },
          (_unused, index) => ({ subject: `forbidden ${index}`, reason: "Not release-compatible." }),
        ),
      },
      targetContexts: [
        "turntable", "key-poses", "idle", "gameplay-animation", "near", "mid", "daylight", "night",
        "interior", "timing-evidence", "in-world", "inventory-normal", "native-size", "hand", "ground", "enchanted-glint",
      ],
      targetMatrix: Array.from({ length: SPEC_COLLECTION_LIMITS.targetMatrix }, (_unused, index) => ({
        ...validArtFixture.targetMatrix[0],
        renderer: {
          ...validArtFixture.targetMatrix[0]?.renderer,
          version: `26.1.2-${index}`,
        },
      })),
      references: Array.from({ length: SPEC_COLLECTION_LIMITS.artReferences }, (_unused, index) => ({
        source: `https://example.invalid/reference/${index}`,
        license: "CC0-1.0",
        rights: "public-domain" as const,
        sha256: index.toString(16).padStart(64, "0"),
      })),
      provenancePolicy: {
        ...validArtFixture.provenancePolicy,
        allowedSourceKinds: ["generated", "manual", "imported"] as const,
      },
      assets: maximalModels,
    }, "art").valid,
    true,
    "all simultaneous ArtSpec v0 cardinality maxima must remain below structural limits",
  );

  for (const fixture of invalidFixtures) {
    const result = validateSpec(fixture.value);
    assert.equal(result.valid, false, fixture.name);
    assert.ok(result.diagnostics.some(({ code }) => code === fixture.expectedCode), fixture.name);
  }

  const firstResource = validModFixture.gameplay.items[0];
  const firstAsset = validModFixture.assets.models[0];
  const firstTexture = validModFixture.assets.textures[0];
  const blockEntry = {
    id: "tidecaller:altar",
    references: [] as string[],
    item: "tidecaller:shell",
    hardness: 3,
  };
  assert.ok(firstResource !== undefined);
  assert.ok(firstAsset !== undefined);
  assert.ok(firstTexture !== undefined);
  const duplicateIdCases = [
    {
      name: "ModSpec resource ids",
      value: {
        ...validModFixture,
        gameplay: { ...validModFixture.gameplay, items: [firstResource, firstResource] },
      },
      path: "/gameplay/items/1/id",
      message: `Duplicate ResourceLocation in gameplay.items: ${firstResource.id}`,
    },
    {
      name: "ModSpec block ids within the block registry",
      value: {
        ...validModFixture,
        gameplay: { ...validModFixture.gameplay, blocks: [blockEntry, blockEntry] },
      },
      path: "/gameplay/blocks/1/id",
      message: `Duplicate ResourceLocation in gameplay.blocks: ${blockEntry.id}`,
    },
    {
      name: "ModSpec asset ids",
      value: {
        ...validModFixture,
        assets: {
          ...validModFixture.assets,
          models: [firstAsset, firstAsset],
        },
      },
      path: "/assets/models/1/id",
      message: `Duplicate ResourceLocation in assets.models: ${firstAsset.id}`,
    },
    {
      name: "ModSpec texture ids within the texture domain",
      value: {
        ...validModFixture,
        assets: {
          ...validModFixture.assets,
          textures: [firstTexture, firstTexture],
        },
      },
      path: "/assets/textures/1/id",
      message: `Duplicate ResourceLocation in assets.textures: ${firstTexture.id}`,
    },
    {
      name: "ArtSpec asset ids",
      value: { ...validArtFixture, assets: [firstAsset, firstAsset] },
      path: "/assets/1/id",
      message: `Duplicate ResourceLocation: ${firstAsset.id}`,
    },
  ] as const;
  for (const testCase of duplicateIdCases) {
    assert.deepEqual(
      validateSpec(testCase.value).diagnostics.find(({ code }) => code === "DUPLICATE_RESOURCE_LOCATION"),
      {
        code: "DUPLICATE_RESOURCE_LOCATION",
        path: testCase.path,
        message: testCase.message,
      },
      testCase.name,
    );
  }
  const duplicateDependencyCases = [
    {
      name: "required dependency duplicate",
      dependencies: {
        required: ["jei", "jei"],
        optional: [],
      },
      path: "/dependencies/required/1",
      id: "jei",
    },
    {
      name: "optional dependency duplicate",
      dependencies: {
        required: [],
        optional: ["jade", "jade"],
      },
      path: "/dependencies/optional/1",
      id: "jade",
    },
    {
      name: "required/optional dependency overlap",
      dependencies: {
        required: ["jei"],
        optional: ["jei"],
      },
      path: "/dependencies/optional/0",
      id: "jei",
    },
  ] as const;
  for (const testCase of duplicateDependencyCases) {
    assert.deepEqual(
      validateSpec({
        ...validModFixture,
        dependencies: testCase.dependencies,
      }).diagnostics.filter(({ code }) => code === "DUPLICATE_DEPENDENCY"),
      [{
        code: "DUPLICATE_DEPENDENCY",
        path: testCase.path,
        message: `Duplicate dependency mod id: ${testCase.id}`,
      }],
      `${testCase.name} must point to the later dependency entry`,
    );
  }
  assert.deepEqual(validateSpec(null).diagnostics[0], {
    code: "SCHEMA_INVALID",
    path: "",
    message: "Spec must be a JSON object.",
  });
  assert.deepEqual(validateInlineSpec("{").diagnostics[0], {
    code: "INVALID_JSON",
    path: "",
    message: "Payload is not valid JSON.",
  });
  assert.equal(validateInlineSpec("x".repeat(MAX_INLINE_SPEC_BYTES + 1)).diagnostics[0]?.code, "PAYLOAD_TOO_LARGE");
  assert.equal(validateInlineSpec("x".repeat(MAX_INLINE_SPEC_BYTES + 1)).diagnostics[0]?.path, "");

  const utf8AtLimit = JSON.stringify("é".repeat((MAX_INLINE_SPEC_BYTES - 2) / 2));
  const utf8AboveLimit = JSON.stringify("é".repeat(MAX_INLINE_SPEC_BYTES / 2));
  assert.equal(Buffer.byteLength(utf8AtLimit, "utf8"), MAX_INLINE_SPEC_BYTES);
  assert.equal(Buffer.byteLength(utf8AboveLimit, "utf8"), MAX_INLINE_SPEC_BYTES + 2);
  assert.equal(validateInlineSpec(utf8AtLimit).diagnostics[0]?.code, "SCHEMA_INVALID");
  assert.equal(validateInlineSpec(utf8AboveLimit).diagnostics[0]?.code, "PAYLOAD_TOO_LARGE");

  const amplificationValue = {
    ...validModFixture,
    gameplay: {
      ...validModFixture.gameplay,
      items: Array.from({ length: 40_000 }, () => ({})),
    },
  };
  const amplificationPayload = JSON.stringify(amplificationValue);
  assert.ok(
    Buffer.byteLength(amplificationPayload, "utf8") <= MAX_INLINE_SPEC_BYTES,
    "the structural amplification regression must remain below the transport payload cap",
  );
  const expectedAmplificationDiagnostic: Diagnostic = {
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: "/gameplay/items",
    message: `Array contains 40000 items; maximum structural limit is ${SPEC_COLLECTION_LIMITS.gameplayItems}.`,
  };
  assert.deepEqual(
    validateSpec(amplificationValue).diagnostics,
    [expectedAmplificationDiagnostic],
    "API validation must reject before Zod can materialize tens of thousands of issues",
  );
  assert.deepEqual(
    validateInlineSpec(amplificationPayload).diagnostics,
    [expectedAmplificationDiagnostic],
    "raw JSON validation must distinguish structural preflight from diagnostic truncation",
  );

  const expectedPrototypeDiagnostic: Diagnostic = {
    code: "NON_JSON_VALUE",
    path: "",
    message: "Object prototype is not plain JSON data.",
  };
  const inheritedAmplification = Object.create({
    ...validModFixture,
    gameplay: {
      ...validModFixture.gameplay,
      items: Array.from({ length: 40_000 }, () => ({})),
    },
  }) as JsonObject;
  assert.deepEqual(
    validateSpec(inheritedAmplification).diagnostics,
    [expectedPrototypeDiagnostic],
    "inherited data must be rejected before inherited gameplay can be read or traversed",
  );

  let getterCalls = 0;
  const rootGetterBomb: JsonObject = { ...validModFixture };
  Object.defineProperty(rootGetterBomb, "kind", {
    enumerable: true,
    configurable: true,
    get: () => {
      getterCalls += 1;
      throw new Error("root getter must never run");
    },
  });
  assert.deepEqual(validateSpec(rootGetterBomb).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/kind",
    message: "Accessor properties are not valid JSON data.",
  }]);

  const nestedGetterProject: JsonObject = { ...validModFixture.project };
  Object.defineProperty(nestedGetterProject, "license", {
    enumerable: true,
    configurable: true,
    get: () => {
      getterCalls += 1;
      throw new Error("nested getter must never run");
    },
  });
  assert.deepEqual(validateSpec({ ...validModFixture, project: nestedGetterProject }).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/project/license",
    message: "Accessor properties are not valid JSON data.",
  }]);

  const getterResources = [...validModFixture.gameplay.items];
  Object.defineProperty(getterResources, "0", {
    enumerable: true,
    configurable: true,
    get: () => {
      getterCalls += 1;
      throw new Error("array getter must never run");
    },
  });
  assert.deepEqual(validateSpec({
    ...validModFixture,
    gameplay: { ...validModFixture.gameplay, items: getterResources },
  }).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/gameplay/items/0",
    message: "Accessor properties are not valid JSON data.",
  }]);
  assert.equal(getterCalls, 0, "structural preflight must inspect descriptors without invoking getters");

  const nonPlainTarget = Object.assign(Object.create({ inherited: true }) as JsonObject, validModFixture.target);
  assert.deepEqual(validateSpec({ ...validModFixture, target: nonPlainTarget }).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/target",
    message: "Object prototype is not plain JSON data.",
  }]);

  const symbolSpec = { ...validModFixture } as JsonObject & Record<symbol, unknown>;
  const hiddenSymbol = Symbol("hidden");
  symbolSpec[hiddenSymbol] = true;
  const symbolResult = validateSpec(symbolSpec);
  assert.equal(symbolResult.valid, true);
  assert.equal(
    symbolResult.value === undefined ? undefined : Object.hasOwn(symbolResult.value, hiddenSymbol),
    false,
    "symbol metadata is outside the detached JSON view",
  );

  const hiddenPropertySpec: JsonObject = { ...validModFixture };
  let hiddenGetterCalls = 0;
  Object.defineProperty(hiddenPropertySpec, "hidden", {
    enumerable: false,
    configurable: true,
    get: () => {
      hiddenGetterCalls += 1;
      throw new Error("non-enumerable getter must never run");
    },
  });
  const hiddenPropertyResult = validateSpec(hiddenPropertySpec);
  assert.equal(hiddenPropertyResult.valid, true);
  assert.equal(hiddenGetterCalls, 0);
  assert.equal(
    hiddenPropertyResult.value === undefined ? undefined : Object.hasOwn(hiddenPropertyResult.value, "hidden"),
    false,
    "non-enumerable metadata is outside the detached JSON view",
  );

  let proxyTrapCalls = 0;
  const proxySpec = new Proxy(validModFixture, {
    get: () => {
      proxyTrapCalls += 1;
      throw new Error("proxy get trap must never run");
    },
    ownKeys: () => {
      proxyTrapCalls += 1;
      throw new Error("proxy ownKeys trap must never run");
    },
  });
  assert.deepEqual(validateSpec(proxySpec).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "",
    message: "Proxy values are not accepted as JSON data.",
  }]);
  assert.equal(proxyTrapCalls, 0, "proxy rejection must occur before reflective traps or property reads");

  const resourcesWithExtra = [...validModFixture.gameplay.items] as unknown[] & { extra?: unknown };
  resourcesWithExtra.extra = true;
  assert.deepEqual(validateSpec({
    ...validModFixture,
    gameplay: { ...validModFixture.gameplay, items: resourcesWithExtra },
  }).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/gameplay/items",
    message: "Array contains a non-index own property.",
  }]);

  const resourcesWithSymbol = [...validModFixture.gameplay.items] as unknown[] & Record<symbol, unknown>;
  resourcesWithSymbol[Symbol("hidden")] = true;
  assert.equal(
    validateSpec({
      ...validModFixture,
      gameplay: { ...validModFixture.gameplay, items: resourcesWithSymbol },
    }).valid,
    true,
    "symbol array metadata is outside the detached JSON view",
  );

  const resourcesWithHiddenExtra = [...validModFixture.gameplay.items];
  Object.defineProperty(resourcesWithHiddenExtra, "hidden", {
    value: true,
    enumerable: false,
  });
  assert.equal(
    validateSpec({
      ...validModFixture,
      gameplay: { ...validModFixture.gameplay, items: resourcesWithHiddenExtra },
    }).valid,
    true,
    "non-enumerable array metadata is outside the detached JSON view",
  );

  const sparseResources = new Array<unknown>(1);
  assert.deepEqual(validateSpec({
    ...validModFixture,
    gameplay: { ...validModFixture.gameplay, items: sparseResources },
  }).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/gameplay/items/0",
    message: "Sparse arrays are not valid JSON data.",
  }]);

  const resourcesWithPrototype = [...validModFixture.gameplay.items];
  Object.setPrototypeOf(resourcesWithPrototype, Object.create(Array.prototype));
  assert.deepEqual(validateSpec({
    ...validModFixture,
    gameplay: { ...validModFixture.gameplay, items: resourcesWithPrototype },
  }).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/gameplay/items",
    message: "Array prototype is not plain JSON data.",
  }]);

  const unsupportedJsonValues = [undefined, 1n, Symbol("value"), () => undefined, Number.NaN, Infinity] as const;
  for (const unsupported of unsupportedJsonValues) {
    const result = validateSpec({ ...validModFixture, unsafe: unsupported });
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0]?.code, "NON_JSON_VALUE");
    assert.equal(result.diagnostics[0]?.path, "/unsafe");
  }

  const cyclic: JsonObject = { kind: "mod" };
  cyclic.loop = cyclic;
  assert.deepEqual(validateSpec(cyclic).diagnostics, [{
    code: "NON_JSON_VALUE",
    path: "/loop",
    message: "Cyclic references are not valid JSON data.",
  }]);

  const nullPrototypeSpec = Object.assign(Object.create(null) as JsonObject, validModFixture);
  assert.equal(
    validateSpec(nullPrototypeSpec).valid,
    true,
    "null-prototype objects containing only enumerable own data remain JSON-compatible",
  );

  const validModJson = JSON.stringify(validModFixture);
  const reservedKeyCases = [
    {
      name: "root reserved key",
      json: `{"__proto__":true,${validModJson.slice(1)}`,
      path: "/__proto__",
      owner: (parsed: JsonObject): unknown => parsed,
    },
    {
      name: "nested reserved key",
      json: validModJson.replace('"project":{', '"project":{"__proto__":true,'),
      path: "/project/__proto__",
      owner: (parsed: JsonObject): unknown => parsed.project,
    },
    {
      name: "array-entry reserved key",
      json: validModJson.replace('"models":[{', '"models":[{"__proto__":true,'),
      path: "/assets/models/0/__proto__",
      owner: (parsed: JsonObject): unknown => {
        const assets = isObject(parsed.assets) ? parsed.assets : undefined;
        const entries = assets === undefined ? undefined : assets.models;
        return Array.isArray(entries) ? entries[0] : undefined;
      },
    },
  ] as const;
  for (const testCase of reservedKeyCases) {
    const parsed = JSON.parse(testCase.json) as JsonObject;
    const owner = testCase.owner(parsed);
    assert.ok(isObject(owner));
    assert.equal(
      Object.hasOwn(owner, "__proto__"),
      true,
      `${testCase.name} must exercise JSON.parse own-key semantics, not object-literal prototype syntax`,
    );
    const expectedReservedDiagnostic: Diagnostic = {
      code: "SCHEMA_INVALID",
      path: testCase.path,
      message: "Reserved JSON key \"__proto__\" is not allowed.",
    };
    assert.deepEqual(validateSpec(parsed).diagnostics, [expectedReservedDiagnostic], testCase.name);
    assert.deepEqual(
      validateInlineSpec(testCase.json).diagnostics,
      [expectedReservedDiagnostic],
      `${testCase.name} raw/runtime parity`,
    );
  }

  const emittedRootSchema = ModSpecJsonSchema as JsonObject;
  assert.equal(emittedRootSchema.additionalProperties, false);
  assert.ok(isObject(emittedRootSchema.properties));
  assert.equal(Object.hasOwn(emittedRootSchema.properties, "__proto__"), false);
  const emittedProjectSchema = emittedRootSchema.properties.project;
  assert.ok(isObject(emittedProjectSchema));
  assert.equal(emittedProjectSchema.additionalProperties, false);
  assert.ok(isObject(emittedProjectSchema.properties));
  assert.equal(Object.hasOwn(emittedProjectSchema.properties, "__proto__"), false);
  const emittedAssetsSchema = emittedRootSchema.properties.assets;
  assert.ok(isObject(emittedAssetsSchema));
  assert.ok(isObject(emittedAssetsSchema.properties));
  const emittedEntriesSchema = emittedAssetsSchema.properties.models;
  assert.ok(isObject(emittedEntriesSchema));
  const emittedAssetItemSchema = emittedEntriesSchema.items;
  assert.ok(isObject(emittedAssetItemSchema));
  assert.equal(emittedAssetItemSchema.additionalProperties, false);
  assert.ok(isObject(emittedAssetItemSchema.properties));
  assert.equal(
    Object.hasOwn(emittedAssetItemSchema.properties, "__proto__"),
    false,
    "runtime reserved-key guard must preserve strict emitted-schema intent for array entries",
  );

  let inheritedGetterCalls = 0;
  const originalInheritedLicense = Object.getOwnPropertyDescriptor(Object.prototype, "license");
  Object.defineProperty(Object.prototype, "license", {
    configurable: true,
    get: () => {
      inheritedGetterCalls += 1;
      throw new Error("inherited getter must never run");
    },
  });
  try {
    const missingLicense = invalidFixtures.find(({ name }) => name === "missing license");
    assert.ok(missingLicense !== undefined);
    assert.equal(
      validateSpec(missingLicense.value).diagnostics.some(({ code }) => code === "MISSING_LICENSE"),
      true,
      "semantic validation must read the normalized own-data graph",
    );
    assert.equal(inheritedGetterCalls, 0);
  } finally {
    if (originalInheritedLicense === undefined) {
      delete (Object.prototype as JsonObject).license;
    } else {
      Object.defineProperty(Object.prototype, "license", originalInheritedLicense);
    }
  }

  const knownCollectionCases: readonly {
    readonly path: string;
    readonly limit: number;
    readonly value: unknown;
  }[] = [
    {
      path: "/project/provenance",
      limit: SPEC_COLLECTION_LIMITS.projectProvenance,
      value: {
        kind: "mod",
        project: {
          provenance: Array.from({ length: SPEC_COLLECTION_LIMITS.projectProvenance + 1 }, () => null),
        },
      },
    },
    ...([
      ["items", SPEC_COLLECTION_LIMITS.gameplayItems],
      ["blocks", SPEC_COLLECTION_LIMITS.gameplayBlocks],
      ["entities", SPEC_COLLECTION_LIMITS.gameplayEntities],
      ["recipes", SPEC_COLLECTION_LIMITS.gameplayRecipes],
      ["summoning", SPEC_COLLECTION_LIMITS.gameplaySummoning],
      ["screens", SPEC_COLLECTION_LIMITS.gameplayScreens],
    ] as const).map(([section, limit]) => ({
      path: `/gameplay/${section}`,
      limit,
      value: { kind: "mod", gameplay: { [section]: Array.from({ length: limit + 1 }) } },
    })),
    ...(["items", "blocks", "entities", "recipes", "summoning", "screens"] as const).map((section) => ({
      path: `/gameplay/${section}/0/references`,
      limit: SPEC_COLLECTION_LIMITS.resourceReferences,
      value: {
        kind: "mod",
        gameplay: {
          [section]: [{ references: Array.from({ length: SPEC_COLLECTION_LIMITS.resourceReferences + 1 }) }],
        },
      },
    })),
    ...(["recipes", "summoning"] as const).map((section) => ({
      path: `/gameplay/${section}/0/ingredients`,
      limit: SPEC_COLLECTION_LIMITS.resourceReferences,
      value: {
        kind: "mod",
        gameplay: {
          [section]: [{ ingredients: Array.from({ length: SPEC_COLLECTION_LIMITS.resourceReferences + 1 }) }],
        },
      },
    })),
    ...([
      ["models", SPEC_COLLECTION_LIMITS.assetModels],
      ["textures", SPEC_COLLECTION_LIMITS.assetTextures],
      ["animations", SPEC_COLLECTION_LIMITS.assetAnimations],
    ] as const).map(([section, limit]) => ({
      path: `/assets/${section}`,
      limit,
      value: { kind: "mod", assets: { [section]: Array.from({ length: limit + 1 }) } },
    })),
    {
      path: "/assets/models/0/provenance",
      limit: SPEC_COLLECTION_LIMITS.assetProvenance,
      value: {
        kind: "mod",
        assets: {
          models: [{ provenance: Array.from({ length: SPEC_COLLECTION_LIMITS.assetProvenance + 1 }) }],
        },
      },
    },
    {
      path: "/dependencies/required",
      limit: SPEC_COLLECTION_LIMITS.requiredDependencies,
      value: {
        kind: "mod",
        dependencies: {
          required: Array.from({ length: SPEC_COLLECTION_LIMITS.requiredDependencies + 1 }),
        },
      },
    },
    {
      path: "/dependencies/optional",
      limit: SPEC_COLLECTION_LIMITS.optionalDependencies,
      value: {
        kind: "mod",
        dependencies: {
          optional: Array.from({ length: SPEC_COLLECTION_LIMITS.optionalDependencies + 1 }),
        },
      },
    },
    {
      path: "/tests/gameTests",
      limit: SPEC_COLLECTION_LIMITS.gameTests,
      value: { kind: "mod", tests: { gameTests: Array.from({ length: SPEC_COLLECTION_LIMITS.gameTests + 1 }) } },
    },
    {
      path: "/tests/gameTests/0/references",
      limit: SPEC_COLLECTION_LIMITS.resourceReferences,
      value: {
        kind: "mod",
        tests: { gameTests: [{ references: Array.from({ length: SPEC_COLLECTION_LIMITS.resourceReferences + 1 }) }] },
      },
    },
    {
      path: "/targetMatrix",
      limit: SPEC_COLLECTION_LIMITS.targetMatrix,
      value: { kind: "art", targetMatrix: Array.from({ length: SPEC_COLLECTION_LIMITS.targetMatrix + 1 }) },
    },
    {
      path: "/targetContexts",
      limit: SPEC_COLLECTION_LIMITS.targetContexts,
      value: { kind: "art", targetContexts: Array.from({ length: SPEC_COLLECTION_LIMITS.targetContexts + 1 }) },
    },
    {
      path: "/style/palette",
      limit: SPEC_COLLECTION_LIMITS.palette,
      value: {
        kind: "art",
        style: { palette: Array.from({ length: SPEC_COLLECTION_LIMITS.palette + 1 }) },
      },
    },
    ...(["shadows", "midtones", "highlights"] as const).map((section) => ({
      path: `/style/hueValueHierarchy/${section}`,
      limit: SPEC_COLLECTION_LIMITS.hueValueColors,
      value: {
        kind: "art",
        style: {
          hueValueHierarchy: { [section]: Array.from({ length: SPEC_COLLECTION_LIMITS.hueValueColors + 1 }) },
        },
      },
    })),
    {
      path: "/style/materialRecipes",
      limit: SPEC_COLLECTION_LIMITS.materialRecipes,
      value: { kind: "art", style: { materialRecipes: Array.from({ length: SPEC_COLLECTION_LIMITS.materialRecipes + 1 }) } },
    },
    {
      path: "/style/forbiddenReferences",
      limit: SPEC_COLLECTION_LIMITS.forbiddenReferences,
      value: { kind: "art", style: { forbiddenReferences: Array.from({ length: SPEC_COLLECTION_LIMITS.forbiddenReferences + 1 }) } },
    },
    {
      path: "/provenancePolicy/allowedSourceKinds",
      limit: SPEC_COLLECTION_LIMITS.allowedSourceKinds,
      value: {
        kind: "art",
        provenancePolicy: { allowedSourceKinds: Array.from({ length: SPEC_COLLECTION_LIMITS.allowedSourceKinds + 1 }) },
      },
    },
    {
      path: "/references",
      limit: SPEC_COLLECTION_LIMITS.artReferences,
      value: { kind: "art", references: Array.from({ length: SPEC_COLLECTION_LIMITS.artReferences + 1 }) },
    },
    {
      path: "/assets",
      limit: SPEC_COLLECTION_LIMITS.artAssets,
      value: { kind: "art", assets: Array.from({ length: SPEC_COLLECTION_LIMITS.artAssets + 1 }) },
    },
    {
      path: "/assets/0/provenance",
      limit: SPEC_COLLECTION_LIMITS.assetProvenance,
      value: {
        kind: "art",
        assets: [{ provenance: Array.from({ length: SPEC_COLLECTION_LIMITS.assetProvenance + 1 }) }],
      },
    },
  ];
  for (const testCase of knownCollectionCases) {
    assert.deepEqual(validateSpec(testCase.value).diagnostics, [{
      code: "STRUCTURE_LIMIT_EXCEEDED",
      path: testCase.path,
      message: `Array contains ${testCase.limit + 1} items; maximum structural limit is ${testCase.limit}.`,
    }], `${testCase.path} must be bounded before schema validation`);
  }

  const tooManyObjectKeys = Object.fromEntries(
    Array.from({ length: MAX_SPEC_OBJECT_KEYS + 1 }, (_unused, index) => [`k${index}`, 0]),
  );
  assert.deepEqual(validateSpec({ kind: "mod", bomb: tooManyObjectKeys }).diagnostics, [{
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: "/bomb",
    message: `Object contains more than ${MAX_SPEC_OBJECT_KEYS} enumerable own string keys.`,
  }]);

  const oversizedKey = "k".repeat(MAX_SPEC_KEY_CHARS + 1);
  assert.deepEqual(validateSpec({ kind: "mod", bomb: { [oversizedKey]: 0 } }).diagnostics, [{
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: "/bomb",
    message: `Enumerable own key length exceeds ${MAX_SPEC_KEY_CHARS} UTF-16 code units.`,
  }]);

  const maximumLengthKeys = Object.fromEntries(
    Array.from({ length: MAX_SPEC_OBJECT_KEYS }, (_unused, index) => [
      `${index}`.padEnd(MAX_SPEC_KEY_CHARS, "k"),
      0,
    ]),
  );
  const aggregateKeyBomb = Array.from({ length: 8 }, () => ({ ...maximumLengthKeys }));
  assert.deepEqual(validateSpec({ kind: "mod", tree: aggregateKeyBomb }).diagnostics, [{
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: "/tree/7",
    message: `Spec contains more than ${MAX_SPEC_TOTAL_KEY_CHARS} enumerable own key UTF-16 code units.`,
  }]);

  assertBoundedEnumerableKeyBomb(
    "enumerable object-key bomb",
    createEnumerableObjectKeyBomb(),
    {
      code: "STRUCTURE_LIMIT_EXCEEDED",
      path: "/bomb",
      message: `Object contains more than ${MAX_SPEC_OBJECT_KEYS} enumerable own string keys.`,
    },
  );
  assertBoundedPrototypeKeyBombSubprocess("object");
  assertBoundedPrototypeKeyBombSubprocess("array");
  assertBoundedEnumerableKeyBomb(
    "enumerable array-extra-key bomb",
    createEnumerableArrayExtraKeyBomb(),
    {
      code: "NON_JSON_VALUE",
      path: "/bomb",
      message: "Array contains a non-index own property.",
    },
  );

  let deeplyNested: unknown = 0;
  for (let depth = 0; depth < MAX_SPEC_NESTING_DEPTH + 1; depth += 1) deeplyNested = [deeplyNested];
  assert.deepEqual(validateSpec({ kind: "mod", deep: deeplyNested }).diagnostics, [{
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: `/deep${"/0".repeat(MAX_SPEC_NESTING_DEPTH)}`,
    message: `JSON nesting depth exceeds ${MAX_SPEC_NESTING_DEPTH}.`,
  }]);

  const nodeBomb = Array.from(
    { length: 64 },
    () => Array.from({ length: MAX_SPEC_ARRAY_ITEMS }, () => 0),
  );
  assert.deepEqual(validateSpec({ kind: "mod", tree: nodeBomb }).diagnostics, [{
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: "/tree/63/189",
    message: `Spec contains more than ${MAX_SPEC_TOTAL_NODES} JSON nodes.`,
  }]);

  const objectWithMaximumKeys = Object.fromEntries(
    Array.from({ length: MAX_SPEC_OBJECT_KEYS }, (_unused, index) => [`k${index}`, 0]),
  );
  const keyBomb = [
    Array.from({ length: 128 }, () => ({ ...objectWithMaximumKeys })),
    [{ ...objectWithMaximumKeys }],
  ];
  assert.deepEqual(validateSpec({ kind: "mod", tree: keyBomb }).diagnostics, [{
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: "/tree/0/127",
    message: `Spec contains more than ${MAX_SPEC_TOTAL_OBJECT_KEYS} object keys.`,
  }]);

  const kindMismatch = validateSpec(validModFixture, "art");
  assert.equal(kindMismatch.valid, false);
  assert.deepEqual(kindMismatch.diagnostics.find(({ code }) => code === "KIND_MISMATCH"), {
    code: "KIND_MISMATCH",
    path: "/kind",
    message: "Expected art spec.",
  });

  const artWithoutKind: JsonObject = { ...validArtFixture };
  delete artWithoutKind.kind;
  const missingArtKind = validateSpec(artWithoutKind, "art");
  assert.equal(missingArtKind.valid, false);
  assert.deepEqual(
    missingArtKind.diagnostics.filter(({ code }) => code === "SCHEMA_INVALID").map(({ path }) => path),
    ["/kind"],
    "an explicit art expectation must select ArtSpec when the discriminator is absent",
  );
  assert.equal(
    missingArtKind.diagnostics.some(({ path }) => ["/project", "/target", "/assets"].includes(path)),
    false,
    "missing ArtSpec kind must not emit irrelevant ModSpec diagnostics",
  );

  assert.equal(validateSpec({
    ...validModFixture,
    project: { ...validModFixture.project, name: "Ж".repeat(80) },
  }).valid, true, "BMP non-ASCII project names at maxLength remain valid");
  for (const invalidName of [
    "Ж".repeat(81),
    "😀".repeat(40),
    "😀".repeat(81),
    "\uD83D",
    "\uDC00",
  ]) {
    const result = validateSpec({
      ...validModFixture,
      project: { ...validModFixture.project, name: invalidName },
    });
    assert.ok(
      result.diagnostics.some(({ code, path }) => code === "SCHEMA_INVALID" && path === "/project/name"),
      "project.name must enforce the emitted BMP-only length contract",
    );
  }

  const budgetFields = [
    ["maxTextureBytes", "/maxTextureBytes"],
    ["maxCubes", "/maxCubes"],
    ["maxBones", "/maxBones"],
    ["maxTriangles", "/maxTriangles"],
    ["maxKeyframes", "/maxKeyframes"],
  ] as const;
  for (const [budgetField, pathSuffix] of budgetFields) {
    const modResult = validateSpec({
      ...validModFixture,
      assets: {
        ...validModFixture.assets,
        budgets: { ...validModFixture.assets.budgets, [budgetField]: 0 },
      },
    });
    const modBudgetDiagnostics = modResult.diagnostics.filter(({ code }) => code === "BUDGET_OVERFLOW");
    assert.equal(modBudgetDiagnostics.length, 1, `ModSpec ${budgetField}`);
    assert.equal(modBudgetDiagnostics[0]?.path, `/assets/budgets${pathSuffix}`);

    const artResult = validateSpec({
      ...validArtFixture,
      budgets: { ...validArtFixture.budgets, [budgetField]: 0 },
    });
    const artBudgetDiagnostics = artResult.diagnostics.filter(({ code }) => code === "BUDGET_OVERFLOW");
    assert.equal(artBudgetDiagnostics.length, 1, `ArtSpec ${budgetField}`);
    assert.equal(artBudgetDiagnostics[0]?.path, `/budgets${pathSuffix}`);
  }

  const nestedUnknownFieldCases: readonly {
    readonly name: string;
    readonly expectedPath: string;
    readonly value: unknown;
  }[] = [
    { name: "ModSpec root", expectedPath: "/unexpected", value: { ...validModFixture, unexpected: true } },
    {
      name: "ModSpec project",
      expectedPath: "/project/unexpected",
      value: { ...validModFixture, project: { ...validModFixture.project, unexpected: true } },
    },
    {
      name: "ModSpec project provenance",
      expectedPath: "/project/provenance/0/unexpected",
      value: {
        ...validModFixture,
        project: {
          ...validModFixture.project,
          provenance: [{ ...validModFixture.project.provenance[0], unexpected: true }],
        },
      },
    },
    {
      name: "ModSpec target",
      expectedPath: "/target/unexpected",
      value: { ...validModFixture, target: { ...validModFixture.target, unexpected: true } },
    },
    {
      name: "ModSpec gameplay item",
      expectedPath: "/gameplay/items/0/unexpected",
      value: {
        ...validModFixture,
        gameplay: {
          ...validModFixture.gameplay,
          items: [{ ...validModFixture.gameplay.items[0], unexpected: true }],
        },
      },
    },
    {
      name: "ModSpec entity dimensions",
      expectedPath: "/gameplay/entities/0/dimensions/unexpected",
      value: {
        ...validModFixture,
        gameplay: {
          ...validModFixture.gameplay,
          entities: [{
            ...validModFixture.gameplay.entities[0],
            dimensions: { ...validModFixture.gameplay.entities[0]?.dimensions, unexpected: true },
          }],
        },
      },
    },
    {
      name: "ModSpec assets",
      expectedPath: "/assets/unexpected",
      value: { ...validModFixture, assets: { ...validModFixture.assets, unexpected: true } },
    },
    {
      name: "ModSpec asset entry",
      expectedPath: "/assets/models/0/unexpected",
      value: {
        ...validModFixture,
        assets: {
          ...validModFixture.assets,
          models: [{ ...validModFixture.assets.models[0], unexpected: true }],
        },
      },
    },
    {
      name: "ModSpec asset provenance",
      expectedPath: "/assets/models/0/provenance/0/unexpected",
      value: {
        ...validModFixture,
        assets: {
          ...validModFixture.assets,
          models: [{
            ...validModFixture.assets.models[0],
            provenance: [{ ...validModFixture.assets.models[0]?.provenance[0], unexpected: true }],
          }],
        },
      },
    },
    {
      name: "ModSpec asset metrics",
      expectedPath: "/assets/models/0/metrics/unexpected",
      value: {
        ...validModFixture,
        assets: {
          ...validModFixture.assets,
          models: [{
            ...validModFixture.assets.models[0],
            metrics: { ...validModFixture.assets.models[0]?.metrics, unexpected: true },
          }],
        },
      },
    },
    {
      name: "ModSpec asset budgets",
      expectedPath: "/assets/budgets/unexpected",
      value: {
        ...validModFixture,
        assets: {
          ...validModFixture.assets,
          budgets: { ...validModFixture.assets.budgets, unexpected: true },
        },
      },
    },
    {
      name: "ModSpec dependencies",
      expectedPath: "/dependencies/unexpected",
      value: { ...validModFixture, dependencies: { ...validModFixture.dependencies, unexpected: true } },
    },
    {
      name: "ModSpec packaging",
      expectedPath: "/packaging/unexpected",
      value: { ...validModFixture, packaging: { ...validModFixture.packaging, unexpected: true } },
    },
    {
      name: "ArtSpec style",
      expectedPath: "/style/unexpected",
      value: { ...validArtFixture, style: { ...validArtFixture.style, unexpected: true } },
    },
    {
      name: "ArtSpec budgets",
      expectedPath: "/budgets/unexpected",
      value: { ...validArtFixture, budgets: { ...validArtFixture.budgets, unexpected: true } },
    },
    {
      name: "ArtSpec asset entry",
      expectedPath: "/assets/0/unexpected",
      value: { ...validArtFixture, assets: [{ ...validArtFixture.assets[0], unexpected: true }] },
    },
    {
      name: "ArtSpec asset provenance",
      expectedPath: "/assets/0/provenance/0/unexpected",
      value: {
        ...validArtFixture,
        assets: [{
          ...validArtFixture.assets[0],
          provenance: [{ ...validArtFixture.assets[0]?.provenance[0], unexpected: true }],
        }],
      },
    },
    {
      name: "ArtSpec asset metrics",
      expectedPath: "/assets/0/metrics/unexpected",
      value: {
        ...validArtFixture,
        assets: [{
          ...validArtFixture.assets[0],
          metrics: { ...validArtFixture.assets[0]?.metrics, unexpected: true },
        }],
      },
    },
  ];
  for (const testCase of nestedUnknownFieldCases) {
    const diagnostics = validateSpec(testCase.value).diagnostics;
    assert.ok(
      diagnostics.some(({ code, path, message }) =>
        code === "SCHEMA_INVALID" && path === testCase.expectedPath && message.includes("unexpected")),
      `${testCase.name} must reject its unknown field at ${testCase.expectedPath}`,
    );
  }

  const rootUnknownDiagnostics = validateSpec({
    ...validModFixture,
    "z/key": true,
    "a~key": true,
  }).diagnostics.filter(({ code }) => code === "SCHEMA_INVALID");
  assert.deepEqual(
    rootUnknownDiagnostics.map(({ path }) => path),
    ["/a~0key", "/z~1key"],
    "root unknown keys must expand one-per-key in deterministic raw-key order",
  );
  assert.deepEqual(
    rootUnknownDiagnostics.map(({ message }) => message),
    ["Unrecognized key: \"a~key\"", "Unrecognized key: \"z/key\""],
  );

  const nestedUnknownDiagnostics = validateSpec({
    ...validModFixture,
    project: {
      ...validModFixture.project,
      "z/key": true,
      "a~key": true,
    },
  }).diagnostics.filter(({ code }) => code === "SCHEMA_INVALID");
  assert.deepEqual(
    nestedUnknownDiagnostics.map(({ path }) => path),
    ["/project/a~0key", "/project/z~1key"],
    "nested unknown keys must append escaped keys to the parent pointer deterministically",
  );

  const invalidModIds = [
    "Tidecaller",
    "tidecaller:jei",
    "tidecaller/jei",
    ".jei",
    "-jei",
  ] as const;
  for (const modId of invalidModIds) {
    const result = validateSpec({
      ...validModFixture,
      dependencies: { ...validModFixture.dependencies, required: [modId] },
    });
    assert.ok(
      result.diagnostics.some(({ code, path }) =>
        code === "SCHEMA_INVALID" && path === "/dependencies/required/0"),
      `${modId} must be rejected as a non-canonical mod id`,
    );
  }
  assert.equal(validateSpec({
    ...validModFixture,
    dependencies: { ...validModFixture.dependencies, required: ["geckolib", "example_mod"] },
  }).valid, true, "bounded lowercase mod ids remain valid");

  const invalidAssetPaths = [
    "tidecaller/textures//entity/crab.png",
    "tidecaller/textures/./entity/crab.png",
    "tidecaller/textures/../entity/crab.png",
    "tidecaller/textures/entity/crab.png/",
    "Tidecaller/textures/entity/crab.png",
  ] as const;
  for (const assetPath of invalidAssetPaths) {
    const result = validateSpec({
      ...validModFixture,
      assets: {
        ...validModFixture.assets,
        models: [{ ...firstAsset, path: assetPath }],
      },
    });
    assert.ok(
      result.diagnostics.some(({ code, path }) =>
        code === "SCHEMA_INVALID" && path === "/assets/models/0/path"),
      `${assetPath} must be rejected as a non-canonical lowercase asset path`,
    );
  }

  const duplicateAssets = [
    firstAsset,
    { ...firstAsset, id: "tidecaller:crab_texture_copy", path: firstAsset.path },
    {
      ...firstAsset,
      id: "tidecaller:crab_texture_alias",
      path: "tidecaller/models/./entity/crab.bbmodel",
    },
  ] as const;
  const modDuplicatePaths = validateSpec({
    ...validModFixture,
    assets: { ...validModFixture.assets, models: duplicateAssets },
  }).diagnostics.filter(({ code }) => code === "DUPLICATE_ASSET_PATH");
  assert.deepEqual(modDuplicatePaths, [
    {
      code: "DUPLICATE_ASSET_PATH",
      path: "/assets/models/1/path",
      message: `Duplicate canonical asset destination: ${firstAsset.path}`,
    },
    {
      code: "DUPLICATE_ASSET_PATH",
      path: "/assets/models/2/path",
      message: `Duplicate canonical asset destination: ${firstAsset.path}`,
    },
  ]);

  const artDuplicatePaths = validateSpec({
    ...validArtFixture,
    assets: [firstAsset, { ...firstAsset, id: "tidecaller:art_texture_copy" }],
  }).diagnostics.filter(({ code }) => code === "DUPLICATE_ASSET_PATH");
  assert.deepEqual(artDuplicatePaths, [{
    code: "DUPLICATE_ASSET_PATH",
    path: "/assets/1/path",
    message: `Duplicate canonical asset destination: ${firstAsset.path}`,
  }]);

  const maxDiagnosticsResult = validateSpec({
    ...validModFixture,
    gameplay: {
      ...validModFixture.gameplay,
      items: Array.from({ length: SPEC_COLLECTION_LIMITS.gameplayItems }, (_unused, index) => ({
        id: index,
        references: "not-an-array",
        unexpected: true,
      })),
    },
  });
  assert.equal(maxDiagnosticsResult.diagnostics.length, MAX_DIAGNOSTICS);
}

if (process.argv[2] === "--prototype-key-bomb-child") {
  const kind = process.argv[3];
  assert.ok(kind === "object" || kind === "array", "prototype key-bomb child kind is required");
  process.stdout.write(JSON.stringify(runPrototypeKeyBombChild(kind)));
} else {
  selfTest();
}
