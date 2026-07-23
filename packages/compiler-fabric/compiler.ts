import {
  canonicalJson,
  canonicalJsonFileBytes,
  createGeneratedFile,
  finalizeGeneratedFiles,
  sha256Hex,
  utf8FileBytes,
  type GeneratedFile,
  type GeneratedFileInput,
} from "@mcdev/codegen-core";
import {
  deriveEquipmentPalette,
  renderArmorInventoryIcon,
  renderToolInventoryIcon,
  renderWearableArmorLayers,
  type EquipmentPalette,
} from "@mcdev/assets-core";
import {
  BUILTIN_FABRIC_1_20_1,
  type VerifiedCompatibilityPack,
} from "@mcdev/compatibility-packs";
import {
  BUILD_PLAN_CONTRACT,
  isBuildPlan,
  mcdevError,
  type BuildPlan,
  type BuildPlanNode,
  type CompatibilityPackManifestV3,
  type McdevError,
  type PlannedOutput,
  type Sha256,
} from "@mcdev/contracts";
import {
  renderFabric1201GradleLibraries,
  resolveFabric1201Libraries,
  type ResolvedFabricLibrary,
} from "@mcdev/library-catalog";
import type { ModSpecV1 } from "@mcdev/modspec";
import { FabricCompilerError, fabricCompilerError } from "./errors.ts";
import type {
  CompiledFabricOutput,
  CompiledFabricProject,
  FabricArtifactKind,
  FabricCompilerNodeId,
} from "./types.ts";

type VerifiedFabricPack = VerifiedCompatibilityPack<CompatibilityPackManifestV3>;

const COMPILER_ID = "@mcdev/compiler-fabric@0.1.0-phase.1";
const SPEC_DIGEST_DOMAIN = "mcdev.compiler-fabric.modspec/v1";
const NODE_INPUT_DIGEST_DOMAIN = "mcdev.compiler-fabric.node-input/v1";
const NODE_CACHE_KEY_DOMAIN = "mcdev.compiler-fabric.node-cache/v1";
const PLAN_ID_DOMAIN = "mcdev.compiler-fabric.plan/v1";
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mPIDur7j4xvrLBEwYTkGYaBAaRqQJcfDgaMpoPRdAA0AADYy4EfTnIAEwAAAABJRU5ErkJggg==";

const PACK_PAYLOAD_PATHS = Object.freeze([
  "templates/.gitignore",
  "templates/build.gradle.tpl",
  "templates/fabric.mod.json.tpl",
  "templates/gradle.properties",
  "templates/gradle/verification-metadata.xml",
  "templates/gradle/wrapper/gradle-wrapper.jar",
  "templates/gradle/wrapper/gradle-wrapper.properties",
  "templates/gradlew",
  "templates/gradlew.bat",
  "templates/settings.gradle.tpl",
  "versions.lock.json",
] as const);

const PROJECT_TEMPLATE_DESTINATIONS = Object.freeze({
  "templates/.gitignore": ".gitignore",
  "templates/build.gradle.tpl": "build.gradle",
  "templates/fabric.mod.json.tpl": "src/main/resources/fabric.mod.json",
  "templates/gradle.properties": "gradle.properties",
  "templates/gradle/verification-metadata.xml": "gradle/verification-metadata.xml",
  "templates/gradle/wrapper/gradle-wrapper.jar": "gradle/wrapper/gradle-wrapper.jar",
  "templates/gradle/wrapper/gradle-wrapper.properties": "gradle/wrapper/gradle-wrapper.properties",
  "templates/gradlew": "gradlew",
  "templates/gradlew.bat": "gradlew.bat",
  "templates/settings.gradle.tpl": "settings.gradle",
} as const);

type ProjectTemplateSource = keyof typeof PROJECT_TEMPLATE_DESTINATIONS;
type TemplateToken =
  | "@@MCDEV_CLIENT_CLASS@@"
  | "@@MCDEV_MAIN_CLASS@@"
  | "@@MCDEV_MOD_ID@@"
  | "@@MCDEV_PROJECT_AUTHOR@@"
  | "@@MCDEV_PROJECT_LICENSE@@"
  | "@@MCDEV_PROJECT_NAME@@"
  | "@@MCDEV_PROJECT_VERSION@@";

const TEMPLATE_TOKEN_COUNTS: Readonly<Record<string, Readonly<Partial<Record<TemplateToken, number>>>>> =
  Object.freeze({
    "templates/build.gradle.tpl": Object.freeze({
      "@@MCDEV_MOD_ID@@": 2,
      "@@MCDEV_PROJECT_VERSION@@": 1,
    }),
    "templates/fabric.mod.json.tpl": Object.freeze({
      "@@MCDEV_CLIENT_CLASS@@": 1,
      "@@MCDEV_MAIN_CLASS@@": 1,
      "@@MCDEV_MOD_ID@@": 1,
      "@@MCDEV_PROJECT_AUTHOR@@": 1,
      "@@MCDEV_PROJECT_LICENSE@@": 1,
      "@@MCDEV_PROJECT_NAME@@": 1,
    }),
    "templates/settings.gradle.tpl": Object.freeze({ "@@MCDEV_MOD_ID@@": 1 }),
  });

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

interface ResourceLocationParts {
  readonly namespace: string;
  readonly path: string;
}

type GameplayItem = ModSpecV1["gameplay"]["items"][number];
type GameplayMaterial = ModSpecV1["gameplay"]["materials"][number];

interface NormalizedContent {
  readonly materials: readonly ModSpecV1["gameplay"]["materials"][number][];
  readonly items: readonly ModSpecV1["gameplay"]["items"][number][];
  readonly blocks: readonly ModSpecV1["gameplay"]["blocks"][number][];
  readonly recipes: readonly ModSpecV1["gameplay"]["recipes"][number][];
  readonly itemParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly blockParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly recipeParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly materialParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly blockByItem: ReadonlyMap<string, ModSpecV1["gameplay"]["blocks"][number]>;
  readonly libraries: readonly ResolvedFabricLibrary[];
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function domainDigest(domain: string, value: unknown): Sha256 {
  return sha256Hex(`${domain}\0${canonicalJson(value)}`);
}

function copyValidatedSpec(spec: ModSpecV1): ModSpecV1 {
  try {
    return JSON.parse(canonicalJson(spec)) as ModSpecV1;
  } catch {
    throw fabricCompilerError("SPEC_INVALID", "The validated ModSpec could not be copied deterministically.");
  }
}

function pushUnsupported(errors: McdevError[], path: string, message: string): void {
  if (errors.length < 100) errors.push(mcdevError("SPEC_UNSUPPORTED", message, path));
}

function parseResourceLocation(id: string): ResourceLocationParts {
  const separator = id.indexOf(":");
  return Object.freeze({ namespace: id.slice(0, separator), path: id.slice(separator + 1) });
}

function basicContentPreflight(spec: ModSpecV1): NormalizedContent {
  const errors: McdevError[] = [];
  if (!/^[a-z][a-z0-9_]{1,63}$/u.test(spec.project.modId)) {
    pushUnsupported(errors, "/project/modId", "Fabric phase 1 requires a Java-safe mod id without hyphens.");
  }
  if (spec.target.minecraft !== "1.20.1" || spec.target.loader !== "fabric" || spec.target.java !== 17) {
    pushUnsupported(errors, "/target", "Fabric phase 1 supports only Minecraft 1.20.1 and Java 17.");
  }
  const sections: readonly [readonly unknown[], string][] = [
    [spec.gameplay.entities, "/gameplay/entities"],
    [spec.gameplay.summoning, "/gameplay/summoning"],
    [spec.gameplay.screens, "/gameplay/screens"],
    [spec.gameplay.structures, "/gameplay/structures"],
    [spec.assets.models, "/assets/models"],
    [spec.assets.textures, "/assets/textures"],
    [spec.assets.animations, "/assets/animations"],
    [spec.tests.gameTests, "/tests/gameTests"],
  ];
  for (const [entries, path] of sections) {
    if (entries.length > 0) {
      pushUnsupported(errors, path, "This content is modeled by ModSpec v1 but is not generated in Fabric phase 1 yet.");
    }
  }
  if (spec.integrations.jei !== "off") {
    pushUnsupported(errors, "/integrations/jei", "JEI integration must be off in Fabric phase 1.");
  }
  if (spec.integrations.jade !== "off") {
    pushUnsupported(errors, "/integrations/jade", "Jade integration must be off in Fabric phase 1.");
  }
  if (spec.packaging.includeSources) {
    pushUnsupported(errors, "/packaging/includeSources", "Source packaging is not supported in Fabric phase 1.");
  }

  const libraryResolution = resolveFabric1201Libraries(
    spec.dependencies.required,
    spec.dependencies.optional,
  );
  if (!libraryResolution.valid) {
    for (const entry of libraryResolution.diagnostics) {
      pushUnsupported(errors, entry.path, entry.message);
    }
  }
  if (spec.integrations.yacl !== undefined && libraryResolution.valid) {
    const selected = new Set(libraryResolution.libraries.map(({ id }) => id));
    if (!selected.has("yet_another_config_lib_v3")) {
      pushUnsupported(errors, "/integrations/yacl", "A generated YACL configuration requires YACL as a required dependency.");
    }
    if (!selected.has("modmenu")) {
      pushUnsupported(errors, "/integrations/yacl", "A generated YACL configuration requires Mod Menu as an optional dependency.");
    }
  }

  const itemParts = new Map<string, ResourceLocationParts>();
  spec.gameplay.items.forEach((item, index) => {
    const parts = parseResourceLocation(item.id);
    if (parts.namespace !== spec.project.modId) {
      pushUnsupported(errors, `/gameplay/items/${index}/id`, "Fabric phase 1 item namespaces must equal project.modId.");
    }
    if (item.references.length > 0) {
      pushUnsupported(errors, `/gameplay/items/${index}/references`, "Fabric phase 1 items cannot carry resource references.");
    }
    itemParts.set(item.id, parts);
  });

  const materialParts = new Map<string, ResourceLocationParts>();
  spec.gameplay.materials.forEach((material, index) => {
    const parts = parseResourceLocation(material.id);
    if (parts.namespace !== spec.project.modId) {
      pushUnsupported(
        errors,
        `/gameplay/materials/${index}/id`,
        "Fabric phase 1 material namespaces must equal project.modId.",
      );
    }
    if (materialParts.has(material.id)) {
      pushUnsupported(errors, `/gameplay/materials/${index}/id`, "Fabric phase 1 material ids must be unique.");
    }
    const repairParts = parseResourceLocation(material.repairIngredient);
    if (repairParts.namespace !== "minecraft" && !itemParts.has(material.repairIngredient)) {
      pushUnsupported(
        errors,
        `/gameplay/materials/${index}/repairIngredient`,
        "A material repair ingredient must be a vanilla item or declared gameplay item.",
      );
    }
    materialParts.set(material.id, parts);
  });
  spec.gameplay.items.forEach((item, index) => {
    if (!("material" in item)) return;
    const material = spec.gameplay.materials.find(({ id }) => id === item.material);
    if (material === undefined) {
      pushUnsupported(
        errors,
        `/gameplay/items/${index}/material`,
        "Equipment items must reference a declared gameplay material.",
      );
      return;
    }
    if (item.kind === "armor" && material.armor === undefined) {
      pushUnsupported(
        errors,
        `/gameplay/items/${index}/material`,
        "Armor items require a material with armor properties.",
      );
    }
  });

  const blockParts = new Map<string, ResourceLocationParts>();
  const blockByItem = new Map<string, ModSpecV1["gameplay"]["blocks"][number]>();
  spec.gameplay.blocks.forEach((block, index) => {
    const parts = parseResourceLocation(block.id);
    const item = parseResourceLocation(block.item);
    if (parts.namespace !== spec.project.modId) {
      pushUnsupported(errors, `/gameplay/blocks/${index}/id`, "Fabric phase 1 block namespaces must equal project.modId.");
    }
    if (item.namespace !== spec.project.modId) {
      pushUnsupported(errors, `/gameplay/blocks/${index}/item`, "Fabric phase 1 block-item namespaces must equal project.modId.");
    }
    if (block.references.length > 0) {
      pushUnsupported(errors, `/gameplay/blocks/${index}/references`, "Fabric phase 1 blocks cannot carry resource references.");
    }
    if (!itemParts.has(block.item)) {
      pushUnsupported(errors, `/gameplay/blocks/${index}/item`, "Every Fabric phase 1 block item must be declared in gameplay.items.");
    }
    const blockItem = spec.gameplay.items.find(({ id }) => id === block.item);
    if (blockItem !== undefined && blockItem.kind !== undefined && blockItem.kind !== "basic") {
      pushUnsupported(
        errors,
        `/gameplay/blocks/${index}/item`,
        "A block item cannot also be a tool, weapon, or armor item.",
      );
    }
    if (blockByItem.has(block.item)) {
      pushUnsupported(errors, `/gameplay/blocks/${index}/item`, "A gameplay item can back at most one Fabric phase 1 block.");
    }
    blockParts.set(block.id, parts);
    blockByItem.set(block.item, block);
  });

  const recipeParts = new Map<string, ResourceLocationParts>();
  spec.gameplay.recipes.forEach((recipe, index) => {
    const parts = parseResourceLocation(recipe.id);
    if (parts.namespace !== spec.project.modId) {
      pushUnsupported(errors, `/gameplay/recipes/${index}/id`, "Fabric phase 1 recipe namespaces must equal project.modId.");
    }
    if (recipe.references.length > 0) {
      pushUnsupported(errors, `/gameplay/recipes/${index}/references`, "Fabric phase 1 recipes cannot carry resource references.");
    }
    if (recipe.serializer !== undefined) {
      pushUnsupported(errors, `/gameplay/recipes/${index}/serializer`, "Fabric phase 1 recipes use only built-in serializers.");
    }
    if (recipe.type === "custom") {
      pushUnsupported(
        errors,
        `/gameplay/recipes/${index}/type`,
        `Fabric phase 1 cannot safely generate ${recipe.type} recipes from the current ModSpec fields.`,
      );
    }
    if (recipe.type === "shapeless" && (recipe.ingredients.length < 1 || recipe.ingredients.length > 9)) {
      pushUnsupported(
        errors,
        `/gameplay/recipes/${index}/ingredients`,
        "A Fabric 1.20.1 shapeless recipe requires between 1 and 9 item ingredients.",
      );
    }
    if (recipe.type === "smelting" && recipe.ingredients.length !== 1) {
      pushUnsupported(
        errors,
        `/gameplay/recipes/${index}/ingredients`,
        "A Fabric 1.20.1 smelting recipe requires exactly one item ingredient.",
      );
    }
    recipe.ingredients.forEach((ingredient, ingredientIndex) => {
      const ingredientParts = parseResourceLocation(ingredient);
      if (ingredientParts.namespace !== "minecraft" && !itemParts.has(ingredient)) {
        pushUnsupported(
          errors,
          `/gameplay/recipes/${index}/ingredients/${ingredientIndex}`,
          "Fabric phase 1 recipe ingredients must be vanilla items or declared gameplay items.",
        );
      }
    });
    if (recipe.type === "shaped") {
      if (recipe.pattern === undefined || recipe.key === undefined) {
        pushUnsupported(
          errors,
          `/gameplay/recipes/${index}`,
          "A shaped recipe requires the validated pattern and key contract.",
        );
      } else {
        recipe.key.forEach((entry, keyIndex) => {
          const ingredientParts = parseResourceLocation(entry.item);
          if (ingredientParts.namespace !== "minecraft" && !itemParts.has(entry.item)) {
            pushUnsupported(
              errors,
              `/gameplay/recipes/${index}/key/${keyIndex}/item`,
              "Fabric phase 1 shaped recipe keys must use vanilla items or declared gameplay items.",
            );
          }
        });
      }
    }
    if (!itemParts.has(recipe.result)) {
      pushUnsupported(
        errors,
        `/gameplay/recipes/${index}/result`,
        "Fabric phase 1 recipe results must be declared gameplay items.",
      );
    }
    recipeParts.set(recipe.id, parts);
  });

  if (errors.length > 0) throw new FabricCompilerError("SPEC_UNSUPPORTED", errors);
  return Object.freeze({
    materials: Object.freeze([...spec.gameplay.materials].sort((left, right) => compareAscii(left.id, right.id))),
    items: Object.freeze([...spec.gameplay.items].sort((left, right) => compareAscii(left.id, right.id))),
    blocks: Object.freeze([...spec.gameplay.blocks].sort((left, right) => compareAscii(left.id, right.id))),
    recipes: Object.freeze([...spec.gameplay.recipes].sort((left, right) => compareAscii(left.id, right.id))),
    itemParts,
    blockParts,
    recipeParts,
    materialParts,
    blockByItem,
    libraries: libraryResolution.valid ? libraryResolution.libraries : Object.freeze([]),
  });
}

function assertExactPack(pack: VerifiedFabricPack): void {
  const expected = BUILTIN_FABRIC_1_20_1;
  const { manifest, ref } = pack;
  if (ref.packId !== expected.packId || ref.revision !== expected.revision ||
    ref.treeSha256 !== expected.treeSha256 || manifest.packId !== expected.packId ||
    manifest.revision !== expected.revision || manifest.target.minecraft !== expected.target.minecraft ||
    manifest.target.loader !== expected.target.loader || manifest.target.java !== expected.target.java ||
    manifest.target.fabricLoader !== expected.target.fabricLoader) {
    throw fabricCompilerError(
      "PACK_INTEGRITY_FAILED",
      "The compiler accepts only the exact reviewed Fabric 1.20.1 compatibility pack.",
    );
  }
  let listed: readonly string[];
  try {
    listed = pack.listFiles();
  } catch {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "The reviewed compatibility pack inventory is unavailable.");
  }
  const manifestPaths = manifest.files.map(({ path }) => path);
  if (manifestPaths.length !== PACK_PAYLOAD_PATHS.length || listed.length !== PACK_PAYLOAD_PATHS.length ||
    PACK_PAYLOAD_PATHS.some((path, index) => manifestPaths[index] !== path || listed[index] !== path)) {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "The reviewed compatibility pack inventory changed.");
  }
}

function packBytes(pack: VerifiedFabricPack, path: ProjectTemplateSource): Uint8Array {
  const descriptor = pack.manifest.files.find((entry) => entry.path === path);
  if (descriptor === undefined) {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack template is unavailable.");
  }
  let file: GeneratedFile;
  try {
    file = createGeneratedFile({ path, mode: descriptor.mode, bytes: pack.readFile(path), origin: "pack" });
  } catch {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack template is unavailable.");
  }
  if (file.bytes.byteLength !== descriptor.size || file.sha256 !== descriptor.sha256) {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack template changed after verification.");
  }
  return file.bytes;
}

function jsonFragment(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function fabricMetadataWithLibraries(
  source: string,
  libraries: readonly ResolvedFabricLibrary[],
  modId: string,
): Uint8Array {
  if (libraries.length === 0) return utf8FileBytes(source);
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(source) as Record<string, unknown>;
  } catch {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "The reviewed Fabric metadata template is invalid.");
  }
  const baseDepends = metadata.depends;
  if (typeof baseDepends !== "object" || baseDepends === null || Array.isArray(baseDepends)) {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "The reviewed Fabric metadata dependency block is invalid.");
  }
  const depends: Record<string, unknown> = { ...baseDepends };
  const suggests: Record<string, string> = {};
  for (const library of libraries) {
    if (library.relation === "required") depends[library.id] = library.manifestVersion;
    else suggests[library.id] = library.manifestVersion;
  }
  metadata.depends = depends;
  if (Object.keys(suggests).length > 0) metadata.suggests = suggests;
  const hasYacl = libraries.some(({ id }) => id === "yet_another_config_lib_v3");
  const hasModMenu = libraries.some(({ id }) => id === "modmenu");
  if (hasYacl && hasModMenu) {
    const entrypoints = metadata.entrypoints;
    if (typeof entrypoints !== "object" || entrypoints === null || Array.isArray(entrypoints)) {
      throw fabricCompilerError("PACK_INTEGRITY_FAILED", "The reviewed Fabric metadata entrypoint block is invalid.");
    }
    metadata.entrypoints = {
      ...entrypoints,
      modmenu: [`dev.mcdev.generated.m_${modId}.client.GeneratedModMenuIntegration`],
    };
  }
  return canonicalJsonFileBytes(metadata);
}

function renderTemplate(
  path: ProjectTemplateSource,
  bytes: Uint8Array,
  spec: ModSpecV1,
  libraries: readonly ResolvedFabricLibrary[],
): Uint8Array {
  const expectedCounts = TEMPLATE_TOKEN_COUNTS[path];
  if (expectedCounts === undefined) return bytes;
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed text template is not valid UTF-8.");
  }
  const classRoot = `dev.mcdev.generated.m_${spec.project.modId}`;
  const replacements: Readonly<Record<TemplateToken, string>> = Object.freeze({
    "@@MCDEV_CLIENT_CLASS@@": `${classRoot}.client.GeneratedClient`,
    "@@MCDEV_MAIN_CLASS@@": `${classRoot}.GeneratedMod`,
    "@@MCDEV_MOD_ID@@": spec.project.modId,
    "@@MCDEV_PROJECT_AUTHOR@@": jsonFragment("Minecraft AI Mod Studio"),
    "@@MCDEV_PROJECT_LICENSE@@": jsonFragment(spec.project.license),
    "@@MCDEV_PROJECT_NAME@@": jsonFragment(spec.project.name),
    "@@MCDEV_PROJECT_VERSION@@": spec.project.version,
  });
  const seen = new Map<TemplateToken, number>();
  const tokenPattern = /@@MCDEV_[A-Z0-9_]+@@/gu;
  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0] as TemplateToken;
    if (!Object.hasOwn(replacements, token) || expectedCounts[token] === undefined) {
      throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed template contains an unknown token.");
    }
    seen.set(token, (seen.get(token) ?? 0) + 1);
  }
  for (const [token, count] of Object.entries(expectedCounts) as [TemplateToken, number][]) {
    if (seen.get(token) !== count) {
      throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed template token count changed.");
    }
  }
  if (source.replace(tokenPattern, "").includes("@@MCDEV_")) {
    throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed template contains a malformed token.");
  }
  const rendered = source.replace(tokenPattern, (token) => replacements[token as TemplateToken]);
  if (path === "templates/build.gradle.tpl") {
    const required = libraries.filter(({ relation }) => relation === "required").map(({ id }) => id);
    const optional = libraries.filter(({ relation }) => relation === "optional").map(({ id }) => id);
    return utf8FileBytes(`${rendered.trimEnd()}\n${renderFabric1201GradleLibraries(required, optional)}`);
  }
  if (path === "templates/fabric.mod.json.tpl") {
    return fabricMetadataWithLibraries(rendered, libraries, spec.project.modId);
  }
  return utf8FileBytes(rendered);
}

function projectInputs(
  spec: ModSpecV1,
  pack: VerifiedFabricPack,
  libraries: readonly ResolvedFabricLibrary[],
): readonly GeneratedFileInput[] {
  assertExactPack(pack);
  return (Object.keys(PROJECT_TEMPLATE_DESTINATIONS).sort(compareAscii) as ProjectTemplateSource[])
    .map((sourcePath) => {
      const descriptor = pack.manifest.files.find(({ path }) => path === sourcePath);
      if (descriptor === undefined) {
        throw fabricCompilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack descriptor is unavailable.");
      }
      const template = sourcePath.endsWith(".tpl");
      return {
        path: PROJECT_TEMPLATE_DESTINATIONS[sourcePath],
        mode: descriptor.mode,
        bytes: template
          ? renderTemplate(sourcePath, packBytes(pack, sourcePath), spec, libraries)
          : packBytes(pack, sourcePath),
        origin: template ? "compiler" as const : "pack" as const,
      };
    });
}

function javaString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function javaConstantPath(path: string): string {
  let result = "";
  for (const character of path) {
    if (character >= "a" && character <= "z") result += character.toUpperCase();
    else if (character >= "0" && character <= "9") result += character;
    else if (character === "_") result += "_U";
    else if (character === "-") result += "_H";
    else if (character === ".") result += "_D";
    else if (character === "/") result += "_S";
    else throw fabricCompilerError("SPEC_UNSUPPORTED", "A resource path cannot be encoded as a Java field name.");
  }
  return result;
}

function float32Bits(value: number): string {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, Object.is(value, -0) ? 0 : Math.fround(value), false);
  return view.getUint32(0, false).toString(16).toUpperCase().padStart(8, "0");
}

function repairIngredientSource(id: string): string {
  const parts = parseResourceLocation(id);
  return `Ingredient.of(BuiltInRegistries.ITEM.get(new ResourceLocation(` +
    `${javaString(parts.namespace)}, ${javaString(parts.path)})))`;
}

function toolMaterialSource(material: GameplayMaterial, parts: ResourceLocationParts): string {
  const constant = javaConstantPath(parts.path);
  return `    private static final Tier MATERIAL_${constant} = new Tier() {
        @Override public int getUses() { return ${material.durability}; }
        @Override public float getSpeed() { return Float.intBitsToFloat(0x${float32Bits(material.miningSpeed)}); }
        @Override public float getAttackDamageBonus() {
            return Float.intBitsToFloat(0x${float32Bits(material.attackDamageBonus)});
        }
        @Override public int getLevel() { return ${material.miningLevel}; }
        @Override public int getEnchantmentValue() { return ${material.enchantmentValue}; }
        @Override public Ingredient getRepairIngredient() {
            return ${repairIngredientSource(material.repairIngredient)};
        }
    };`;
}

function armorMaterialSource(material: GameplayMaterial, parts: ResourceLocationParts): string | undefined {
  if (material.armor === undefined) return undefined;
  const constant = javaConstantPath(parts.path);
  const { armor } = material;
  return `    private static final ArmorMaterial ARMOR_MATERIAL_${constant} = new ArmorMaterial() {
        @Override public int getDurabilityForType(ArmorItem.Type type) {
            return switch (type) {
                case HELMET -> ${11 * armor.durabilityMultiplier};
                case CHESTPLATE -> ${16 * armor.durabilityMultiplier};
                case LEGGINGS -> ${15 * armor.durabilityMultiplier};
                case BOOTS -> ${13 * armor.durabilityMultiplier};
            };
        }
        @Override public int getDefenseForType(ArmorItem.Type type) {
            return switch (type) {
                case HELMET -> ${armor.defense.helmet};
                case CHESTPLATE -> ${armor.defense.chestplate};
                case LEGGINGS -> ${armor.defense.leggings};
                case BOOTS -> ${armor.defense.boots};
            };
        }
        @Override public int getEnchantmentValue() { return ${material.enchantmentValue}; }
        @Override public SoundEvent getEquipSound() { return SoundEvents.ARMOR_EQUIP_IRON; }
        @Override public Ingredient getRepairIngredient() {
            return ${repairIngredientSource(material.repairIngredient)};
        }
        @Override public String getName() { return ${javaString(material.id)}; }
        @Override public float getToughness() {
            return Float.intBitsToFloat(0x${float32Bits(armor.toughness)});
        }
        @Override public float getKnockbackResistance() {
            return Float.intBitsToFloat(0x${float32Bits(armor.knockbackResistance)});
        }
    };`;
}

function itemConstructorSource(item: GameplayItem, content: NormalizedContent): string {
  const block = content.blockByItem.get(item.id);
  if (block !== undefined) {
    const blockParts = content.blockParts.get(block.id);
    if (blockParts === undefined) {
      throw fabricCompilerError("INTERNAL_ERROR", "Block-item normalization failed safely.");
    }
    return `new BlockItem(BLOCK_${javaConstantPath(blockParts.path)}, ` +
      `new Item.Properties().stacksTo(${item.maxStackSize}))`;
  }
  if (!("material" in item)) {
    return `new Item(new Item.Properties().stacksTo(${item.maxStackSize}))`;
  }
  const materialParts = content.materialParts.get(item.material);
  if (materialParts === undefined) {
    throw fabricCompilerError("INTERNAL_ERROR", "Equipment material normalization failed safely.");
  }
  const material = `MATERIAL_${javaConstantPath(materialParts.path)}`;
  if (item.kind === "armor") {
    return `new ArmorItem(ARMOR_MATERIAL_${javaConstantPath(materialParts.path)}, ` +
      `ArmorItem.Type.${item.armorSlot.toUpperCase()}, new Item.Properties())`;
  }
  const speed = `Float.intBitsToFloat(0x${float32Bits(item.attackSpeed)})`;
  if (item.kind === "sword") {
    return `new SwordItem(${material}, ${item.attackDamage}, ${speed}, new Item.Properties())`;
  }
  const className = `${item.kind[0]?.toUpperCase() ?? ""}${item.kind.slice(1)}Item`;
  const anonymousBody = item.kind === "pickaxe" || item.kind === "axe" || item.kind === "hoe" ? " {}" : "";
  return `new ${className}(${material}, ${item.attackDamage}, ${speed}, new Item.Properties())${anonymousBody}`;
}

function generatedContentSource(modId: string, content: NormalizedContent): string {
  const materialLines = content.materials.flatMap((material) => {
    const parts = content.materialParts.get(material.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Material normalization failed safely.");
    return [toolMaterialSource(material, parts), armorMaterialSource(material, parts)]
      .filter((entry): entry is string => entry !== undefined);
  });
  const blockLines = content.blocks.map((block) => {
    const parts = content.blockParts.get(block.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Block normalization failed safely.");
    return `    public static final Block BLOCK_${javaConstantPath(parts.path)} = registerBlock(\n` +
      `            ${javaString(parts.path)}, new Block(BlockBehaviour.Properties.of().strength(` +
      `Float.intBitsToFloat(0x${float32Bits(block.hardness)}))));`;
  });
  const itemLines = content.items.map((item) => {
    const parts = content.itemParts.get(item.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Item normalization failed safely.");
    const constructor = itemConstructorSource(item, content);
    return `    public static final Item ITEM_${javaConstantPath(parts.path)} = registerItem(\n` +
      `            ${javaString(parts.path)}, ${constructor});`;
  });
  const declarations = [...materialLines, ...blockLines, ...itemLines];
  const declarationSection = declarations.length === 0 ? "" : `${declarations.join("\n\n")}\n\n`;
  const ingredientEntries = content.items
    .filter((item) => !content.blockByItem.has(item.id) && (item.kind === undefined || item.kind === "basic"))
    .map((item) => {
      const parts = content.itemParts.get(item.id);
      if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Creative item normalization failed safely.");
      return `            entries.accept(ITEM_${javaConstantPath(parts.path)});`;
    });
  const buildingEntries = content.blocks.map((block) => {
    const itemParts = content.itemParts.get(block.item);
    if (itemParts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Creative block normalization failed safely.");
    return `            entries.accept(ITEM_${javaConstantPath(itemParts.path)});`;
  });
  const toolEntries = content.items
    .filter((item) => item.kind === "pickaxe" || item.kind === "axe" || item.kind === "shovel" || item.kind === "hoe")
    .map((item) => {
      const parts = content.itemParts.get(item.id);
      if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Creative tool normalization failed safely.");
      return `            entries.accept(ITEM_${javaConstantPath(parts.path)});`;
    });
  const combatEntries = content.items
    .filter((item) => item.kind === "sword" || item.kind === "armor")
    .map((item) => {
      const parts = content.itemParts.get(item.id);
      if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Creative combat normalization failed safely.");
      return `            entries.accept(ITEM_${javaConstantPath(parts.path)});`;
    });
  const creativeRegistrations = [
    ingredientEntries.length === 0 ? "" :
      `        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.INGREDIENTS).register(entries -> {\n` +
      `${ingredientEntries.join("\n")}\n        });`,
    buildingEntries.length === 0 ? "" :
      `        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.BUILDING_BLOCKS).register(entries -> {\n` +
      `${buildingEntries.join("\n")}\n        });`,
    toolEntries.length === 0 ? "" :
      `        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.TOOLS_AND_UTILITIES).register(entries -> {\n` +
      `${toolEntries.join("\n")}\n        });`,
    combatEntries.length === 0 ? "" :
      `        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.COMBAT).register(entries -> {\n` +
      `${combatEntries.join("\n")}\n        });`,
  ].filter((entry) => entry.length > 0).join("\n");
  const creativeRegistrationBody = creativeRegistrations.length === 0
    ? ""
    : `        if (!showGeneratedContentInCreativeTabs) return;\n${creativeRegistrations}`;
  return `package dev.mcdev.generated.m_${modId};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.AxeItem;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.HoeItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.item.ShovelItem;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tier;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;

public final class GeneratedContent {
${declarationSection}    private GeneratedContent() {}

    public static void register() {
        register(true);
    }

    public static void register(boolean showGeneratedContentInCreativeTabs) {
${creativeRegistrationBody}
    }

    private static Block registerBlock(String path, Block block) {
        return Registry.register(BuiltInRegistries.BLOCK, new ResourceLocation(GeneratedMod.MOD_ID, path), block);
    }

    private static Item registerItem(String path, Item item) {
        return Registry.register(BuiltInRegistries.ITEM, new ResourceLocation(GeneratedMod.MOD_ID, path), item);
    }
}
`;
}

function titleFromPath(path: string): string {
  return path.split(/[/_.-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function input(path: string, bytes: Uint8Array): GeneratedFileInput {
  return { path, mode: 420, bytes, origin: "compiler" };
}

function jsonInput(path: string, value: unknown): GeneratedFileInput {
  return input(path, canonicalJsonFileBytes(value));
}

function generatedConfigSource(
  modId: string,
  configuration: ModSpecV1["integrations"]["yacl"],
): string {
  const options = configuration?.categories.flatMap(({ options }) => options) ?? [];
  const customFields = options.map((option) => {
    const field = `option_${option.id}`;
    const annotation = `    @SerialEntry(value = ${javaString(option.id)}, comment = ` +
      `${javaString(option.description ?? option.name)})\n`;
    if (option.type === "boolean") return `${annotation}    public boolean ${field} = ${option.default};`;
    if (option.type === "integer") return `${annotation}    public int ${field} = ${option.default};`;
    return `${annotation}    public String ${field} = ${javaString(option.default)};`;
  });
  const normalization = options.flatMap((option) => {
    const field = `config.option_${option.id}`;
    if (option.type === "integer") {
      return [`        ${field} = Math.max(${option.minimum}, Math.min(${option.maximum}, ${field}));`];
    }
    if (option.type === "string") return [`        ${field} = limitString(${field}, ${option.maxLength});`];
    return [];
  });
  const customFieldSection = customFields.length === 0 ? "" : `\n${customFields.join("\n\n")}\n`;
  const normalizationSection = normalization.length === 0 ? "" : `${normalization.join("\n")}\n`;
  const stringLimiter = options.some(({ type }) => type === "string")
    ? `\n    public static String limitString(String value, int maxLength) {\n` +
      `        if (value == null) return "";\n` +
      `        return value.length() <= maxLength ? value : value.substring(0, maxLength);\n` +
      `    }\n`
    : "";
  return `package dev.mcdev.generated.m_${modId};

import dev.isxander.yacl3.config.v2.api.ConfigClassHandler;
import dev.isxander.yacl3.config.v2.api.SerialEntry;
import dev.isxander.yacl3.config.v2.api.serializer.GsonConfigSerializerBuilder;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.resources.ResourceLocation;

public final class GeneratedConfig {
    public static final ConfigClassHandler<GeneratedConfig> HANDLER =
            ConfigClassHandler.createBuilder(GeneratedConfig.class)
                    .id(new ResourceLocation(GeneratedMod.MOD_ID, "config"))
                    .serializer(config -> GsonConfigSerializerBuilder.create(config)
                            .setPath(FabricLoader.getInstance().getConfigDir()
                                    .resolve(GeneratedMod.MOD_ID + ".json5"))
                            .setJson5(true)
                            .build())
                    .build();

    @SerialEntry(comment = "Show generated items and blocks in their default creative tabs.")
    public boolean showGeneratedContentInCreativeTabs = true;
${customFieldSection}
    public static void normalize() {
        GeneratedConfig config = HANDLER.instance();
${normalizationSection}    }
${stringLimiter}

    public GeneratedConfig() {}
}
`;
}

function generatedModMenuSource(
  modId: string,
  configuration: ModSpecV1["integrations"]["yacl"],
): string {
  const customCategoryCalls = configuration?.categories.map((category) => {
    const categoryKey = `config.${modId}.category.custom.${category.id}`;
    const tooltip = category.description === undefined
      ? ""
      : `\n                                .tooltip(Component.translatable("${categoryKey}.description"))`;
    const options = category.options.map((option) => {
      const field = `option_${option.id}`;
      const optionKey = `config.${modId}.option.custom.${option.id}`;
      const description = option.description === undefined
        ? ""
        : `\n                                        .description(OptionDescription.of(Component.translatable(` +
          `\n                                                "${optionKey}.description")))`;
      const restart = option.restartRequired ? "\n                                        .flag(OptionFlag.GAME_RESTART)" : "";
      if (option.type === "boolean") {
        return `\n                                .option(Option.<Boolean>createBuilder()` +
          `\n                                        .name(Component.translatable("${optionKey}"))${description}` +
          `\n                                        .binding(defaults.${field}, () -> config.${field},` +
          `\n                                                value -> config.${field} = value)` +
          `\n                                        .controller(BooleanControllerBuilder::create)${restart}` +
          `\n                                        .build())`;
      }
      if (option.type === "integer") {
        return `\n                                .option(Option.<Integer>createBuilder()` +
          `\n                                        .name(Component.translatable("${optionKey}"))${description}` +
          `\n                                        .binding(defaults.${field}, () -> config.${field},` +
          `\n                                                value -> config.${field} = value)` +
          `\n                                        .controller(controller -> IntegerSliderControllerBuilder` +
          `\n                                                .create(controller)` +
          `\n                                                .range(${option.minimum}, ${option.maximum})` +
          `\n                                                .step(${option.step}))${restart}` +
          `\n                                        .build())`;
      }
      return `\n                                .option(Option.<String>createBuilder()` +
        `\n                                        .name(Component.translatable("${optionKey}"))${description}` +
        `\n                                        .binding(defaults.${field}, () -> config.${field},` +
        `\n                                                value -> config.${field} = GeneratedConfig.limitString(` +
        `\n                                                        value, ${option.maxLength}))` +
        `\n                                        .controller(StringControllerBuilder::create)${restart}` +
        `\n                                        .build())`;
    }).join("");
    return `\n                        .category(ConfigCategory.createBuilder()` +
      `\n                                .name(Component.translatable("${categoryKey}"))${tooltip}${options}` +
      `\n                                .build())`;
  }).join("") ?? "";
  return `package dev.mcdev.generated.m_${modId}.client;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;
import dev.isxander.yacl3.api.ConfigCategory;
import dev.isxander.yacl3.api.Option;
import dev.isxander.yacl3.api.OptionDescription;
import dev.isxander.yacl3.api.OptionFlag;
import dev.isxander.yacl3.api.YetAnotherConfigLib;
import dev.isxander.yacl3.api.controller.BooleanControllerBuilder;
import dev.isxander.yacl3.api.controller.IntegerSliderControllerBuilder;
import dev.isxander.yacl3.api.controller.StringControllerBuilder;
import dev.mcdev.generated.m_${modId}.GeneratedConfig;
import net.minecraft.network.chat.Component;

public final class GeneratedModMenuIntegration implements ModMenuApi {
    @Override
    public ConfigScreenFactory<?> getModConfigScreenFactory() {
        return parent -> YetAnotherConfigLib.create(GeneratedConfig.HANDLER, (defaults, config, builder) ->
                builder.title(Component.translatable("config.${modId}.title"))
                        .category(ConfigCategory.createBuilder()
                                .name(Component.translatable("config.${modId}.category.general"))
                                .option(Option.<Boolean>createBuilder()
                                        .name(Component.translatable(
                                                "config.${modId}.show_generated_content"))
                                        .description(OptionDescription.of(Component.translatable(
                                                "config.${modId}.show_generated_content.description")))
                                        .binding(defaults.showGeneratedContentInCreativeTabs,
                                                () -> config.showGeneratedContentInCreativeTabs,
                                                value -> config.showGeneratedContentInCreativeTabs = value)
                                        .controller(BooleanControllerBuilder::create)
                                        .flag(OptionFlag.GAME_RESTART)
                                        .build())
                                .build())${customCategoryCalls})
                .generateScreen(parent);
    }
}
`;
}

function generatedConfiguredBehaviorSource(modId: string, optionId: string): string {
  return `package dev.mcdev.generated.m_${modId};

import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.network.chat.Component;

public final class GeneratedConfiguredBehavior {
    private GeneratedConfiguredBehavior() {}

    public static void register() {
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            String message = GeneratedConfig.HANDLER.instance().option_${optionId};
            if (message != null && !message.isBlank()) {
                handler.player.sendSystemMessage(Component.literal(message));
            }
        });
    }
}
`;
}

function contentInputs(spec: ModSpecV1, content: NormalizedContent): readonly GeneratedFileInput[] {
  const modId = spec.project.modId;
  const packageRoot = `dev.mcdev.generated.m_${modId}`;
  const pathRoot = `dev/mcdev/generated/m_${modId}`;
  const hasYacl = content.libraries.some(({ id }) => id === "yet_another_config_lib_v3");
  const hasModMenu = content.libraries.some(({ id }) => id === "modmenu");
  const joinMessageOption = spec.integrations.yacl?.categories
    .flatMap(({ options }) => options)
    .find((option) => option.type === "string" && option.binding === "player_join_message");
  const configuredBehavior = joinMessageOption === undefined
    ? ""
    : "\n        GeneratedConfiguredBehavior.register();";
  const initializeContent = hasYacl
    ? `        GeneratedConfig.HANDLER.load();\n` +
      `        GeneratedConfig.normalize();\n` +
      `        GeneratedContent.register(GeneratedConfig.HANDLER.instance().showGeneratedContentInCreativeTabs);` +
      configuredBehavior
    : "        GeneratedContent.register();";
  const mainSource = `package ${packageRoot};

import net.fabricmc.api.ModInitializer;

public final class GeneratedMod implements ModInitializer {
    public static final String MOD_ID = ${javaString(modId)};

    @Override
    public void onInitialize() {
${initializeContent}
    }
}
`;
  const clientSource = `package ${packageRoot}.client;

import net.fabricmc.api.ClientModInitializer;

public final class GeneratedClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
    }
}
`;
  const resourceRoot = "src/main/resources";
  const inputs: GeneratedFileInput[] = [
    input(`src/main/java/${pathRoot}/GeneratedMod.java`, utf8FileBytes(mainSource)),
    input(`src/main/java/${pathRoot}/GeneratedContent.java`, utf8FileBytes(generatedContentSource(modId, content))),
    input(`src/client/java/${pathRoot}/client/GeneratedClient.java`, utf8FileBytes(clientSource)),
  ];
  const language: Record<string, string> = {};
  if (hasYacl) {
    inputs.push(input(
      `src/main/java/${pathRoot}/GeneratedConfig.java`,
      utf8FileBytes(generatedConfigSource(modId, spec.integrations.yacl)),
    ));
  }
  if (joinMessageOption !== undefined) {
    inputs.push(input(
      `src/main/java/${pathRoot}/GeneratedConfiguredBehavior.java`,
      utf8FileBytes(generatedConfiguredBehaviorSource(modId, joinMessageOption.id)),
    ));
  }
  if (hasYacl && hasModMenu) {
    inputs.push(input(
      `src/client/java/${pathRoot}/client/GeneratedModMenuIntegration.java`,
      utf8FileBytes(generatedModMenuSource(modId, spec.integrations.yacl)),
    ));
    language[`config.${modId}.title`] = `${spec.project.name} Configuration`;
    language[`config.${modId}.category.general`] = "General";
    language[`config.${modId}.show_generated_content`] = "Show Generated Content";
    language[`config.${modId}.show_generated_content.description`] =
      "Show generated items and blocks in their default creative tabs after restarting the game.";
    for (const category of spec.integrations.yacl?.categories ?? []) {
      const categoryKey = `config.${modId}.category.custom.${category.id}`;
      language[categoryKey] = category.name;
      if (category.description !== undefined) language[`${categoryKey}.description`] = category.description;
      for (const option of category.options) {
        const optionKey = `config.${modId}.option.custom.${option.id}`;
        language[optionKey] = option.name;
        if (option.description !== undefined) language[`${optionKey}.description`] = option.description;
      }
    }
  }

  for (const item of content.items) {
    const parts = content.itemParts.get(item.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Item resource normalization failed safely.");
    const block = content.blockByItem.get(item.id);
    const blockParts = block === undefined ? undefined : content.blockParts.get(block.id);
    if (block !== undefined && blockParts === undefined) {
      throw fabricCompilerError("INTERNAL_ERROR", "Block-item resource normalization failed safely.");
    }
    const equipment = "material" in item;
    const itemTexture = equipment ? `${modId}:item/${parts.path}` : `${modId}:mcdev/placeholder`;
    inputs.push(jsonInput(
      `${resourceRoot}/assets/${parts.namespace}/models/item/${parts.path}.json`,
      block === undefined
        ? {
            parent: item.kind !== undefined &&
              ["sword", "pickaxe", "axe", "shovel", "hoe"].includes(item.kind)
              ? "minecraft:item/handheld"
              : "minecraft:item/generated",
            textures: { layer0: itemTexture },
          }
        : { parent: `${modId}:block/${blockParts?.path}` },
    ));
    if (equipment) {
      const material = content.materials.find(({ id }) => id === item.material);
      if (material === undefined) {
        throw fabricCompilerError("INTERNAL_ERROR", "Equipment texture material normalization failed safely.");
      }
      const palette: EquipmentPalette = material.palette ?? deriveEquipmentPalette(material.id);
      const texture = item.kind === "armor"
        ? renderArmorInventoryIcon(item.id, item.armorSlot, palette)
        : renderToolInventoryIcon(item.id, item.kind, palette);
      inputs.push(input(
        `${resourceRoot}/assets/${parts.namespace}/textures/item/${parts.path}.png`,
        texture.bytes,
      ));
    }
    language[`item.${parts.namespace}.${parts.path.replaceAll("/", ".")}`] = titleFromPath(parts.path);
  }

  for (const block of content.blocks) {
    const parts = content.blockParts.get(block.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Block resource normalization failed safely.");
    inputs.push(jsonInput(
      `${resourceRoot}/assets/${parts.namespace}/blockstates/${parts.path}.json`,
      { variants: { "": { model: `${parts.namespace}:block/${parts.path}` } } },
    ));
    inputs.push(jsonInput(
      `${resourceRoot}/assets/${parts.namespace}/models/block/${parts.path}.json`,
      { parent: "minecraft:block/cube_all", textures: { all: `${modId}:mcdev/placeholder` } },
    ));
    inputs.push(jsonInput(
      `${resourceRoot}/data/${parts.namespace}/loot_tables/blocks/${parts.path}.json`,
      {
        type: "minecraft:block",
        pools: [{
          rolls: 1,
          bonus_rolls: 0,
          conditions: [{ condition: "minecraft:survives_explosion" }],
          entries: [{ type: "minecraft:item", name: block.item }],
        }],
      },
    ));
    language[`block.${parts.namespace}.${parts.path.replaceAll("/", ".")}`] = titleFromPath(parts.path);
  }

  for (const recipe of content.recipes) {
    const parts = content.recipeParts.get(recipe.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Recipe normalization failed safely.");
    const result = recipe.resultCount === undefined || recipe.resultCount === 1
      ? { item: recipe.result }
      : { item: recipe.result, count: recipe.resultCount };
    let value: unknown;
    if (recipe.type === "shaped") {
      if (recipe.pattern === undefined || recipe.key === undefined) {
        throw fabricCompilerError("INTERNAL_ERROR", "Validated shaped recipe data is missing.");
      }
      value = {
        type: "minecraft:crafting_shaped",
        category: "misc",
        key: Object.fromEntries(
          [...recipe.key]
            .sort((left, right) => compareAscii(left.symbol, right.symbol))
            .map(({ symbol, item }) => [symbol, { item }]),
        ),
        pattern: recipe.pattern,
        result,
        show_notification: true,
      };
    } else if (recipe.type === "shapeless") {
      value = {
        type: "minecraft:crafting_shapeless",
        category: "misc",
        ingredients: recipe.ingredients.map((item) => ({ item })),
        result,
      };
    } else {
      value = {
        type: "minecraft:smelting",
        category: "misc",
        cookingtime: 200,
        experience: 0,
        ingredient: { item: recipe.ingredients[0] },
        result: recipe.result,
      };
    }
    inputs.push(jsonInput(
      `${resourceRoot}/data/${parts.namespace}/recipes/${parts.path}.json`,
      value,
    ));
  }

  const equipmentTags = [
    ["swords", "sword"],
    ["pickaxes", "pickaxe"],
    ["axes", "axe"],
    ["shovels", "shovel"],
    ["hoes", "hoe"],
    ["trimmable_armor", "armor"],
  ] as const;
  for (const [tag, kind] of equipmentTags) {
    const values = content.items.filter((item) => item.kind === kind).map(({ id }) => id);
    if (values.length > 0) {
      inputs.push(jsonInput(`${resourceRoot}/data/minecraft/tags/items/${tag}.json`, { values }));
    }
  }

  inputs.push(jsonInput(`${resourceRoot}/assets/${modId}/lang/en_us.json`, language));
  if (content.items.some((item) => !("material" in item)) || content.blocks.length > 0) {
    inputs.push(input(
      `${resourceRoot}/assets/${modId}/textures/mcdev/placeholder.png`,
      Buffer.from(PLACEHOLDER_PNG_BASE64, "base64"),
    ));
  }
  for (const material of content.materials.filter(({ armor }) => armor !== undefined)) {
    const parts = content.materialParts.get(material.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Armor material normalization failed safely.");
    const palette: EquipmentPalette = material.palette ?? deriveEquipmentPalette(material.id);
    const layers = renderWearableArmorLayers(material.id, palette);
    for (const layer of [1, 2] as const) {
      inputs.push(input(
        `${resourceRoot}/assets/${parts.namespace}/textures/models/armor/${parts.path}_layer_${layer}.png`,
        layers[layer - 1]!.bytes,
      ));
    }
  }
  return inputs;
}

function plannedOutputs(files: readonly GeneratedFile[]): readonly PlannedOutput[] {
  return Object.freeze(files.map((file) => Object.freeze({
    path: file.path,
    mode: file.mode,
    size: file.bytes.byteLength,
    sha256: file.sha256,
  })));
}

function nodeCacheKey(nodeId: string, inputDigest: Sha256, outputs: readonly PlannedOutput[]): Sha256 {
  return domainDigest(NODE_CACHE_KEY_DOMAIN, { nodeId, inputDigest, outputs });
}

function makeGenerateNode(
  nodeId: FabricCompilerNodeId,
  kind: "generate-content" | "generate-project",
  inputDigest: Sha256,
  outputs: readonly PlannedOutput[],
): BuildPlanNode {
  const common = {
    dependsOn: Object.freeze([]),
    inputDigest,
    cacheKey: nodeCacheKey(nodeId, inputDigest, outputs),
    outputs,
    retryPolicy: "never" as const,
    logPolicy: "structured-redacted-v1" as const,
    validatorPolicy: "sha256-outputs-v1" as const,
  };
  return kind === "generate-project"
    ? Object.freeze({ ...common, nodeId, kind, provenance: "compiler-and-pack" })
    : Object.freeze({ ...common, nodeId, kind, provenance: "compiler" });
}

function makeDownstreamNode(
  nodeId: "apply-workspace" | "gradle-clean-build" | "index-artifacts",
  dependsOn: readonly string[],
  dependencyCacheKeys: readonly Sha256[],
): BuildPlanNode {
  const inputDigest = domainDigest(NODE_INPUT_DIGEST_DOMAIN, { nodeId, dependencyCacheKeys });
  const common = {
    nodeId,
    kind: nodeId,
    dependsOn: Object.freeze([...dependsOn]),
    inputDigest,
    cacheKey: nodeCacheKey(nodeId, inputDigest, Object.freeze([])),
    outputs: Object.freeze([]),
    retryPolicy: "never" as const,
    logPolicy: "structured-redacted-v1" as const,
  };
  if (nodeId === "apply-workspace") {
    return Object.freeze({
      ...common,
      nodeId: "apply-workspace",
      kind: "apply-workspace",
      policy: "create-only-cas-wal-v1",
      validatorPolicy: "workspace-manifest-v1",
      provenance: "workspace-transaction",
    });
  }
  if (nodeId === "gradle-clean-build") {
    return Object.freeze({
      ...common,
      nodeId: "gradle-clean-build",
      kind: "gradle-clean-build",
      policy: "fabric-1.20.1-phase1-v1",
      validatorPolicy: "sha256-outputs-v1",
      provenance: "fixed-build-runner",
    });
  }
  return Object.freeze({
    ...common,
    nodeId: "index-artifacts",
    kind: "index-artifacts",
    policy: "sha256-v1",
    validatorPolicy: "artifact-index-v1",
    provenance: "artifact-indexer",
  });
}

function buildPlan(
  spec: ModSpecV1,
  pack: VerifiedFabricPack,
  projectFiles: readonly GeneratedFile[],
  contentFiles: readonly GeneratedFile[],
): BuildPlan {
  const specDigest = domainDigest(SPEC_DIGEST_DOMAIN, spec);
  const packRef = Object.freeze({ ...pack.ref });
  const generateContent = makeGenerateNode(
    "generate-content",
    "generate-content",
    domainDigest(NODE_INPUT_DIGEST_DOMAIN, { nodeId: "generate-content", specDigest, compiler: COMPILER_ID }),
    plannedOutputs(contentFiles),
  );
  const generateProject = makeGenerateNode(
    "generate-project",
    "generate-project",
    domainDigest(NODE_INPUT_DIGEST_DOMAIN, {
      nodeId: "generate-project",
      specDigest,
      pack: packRef,
      compiler: COMPILER_ID,
    }),
    plannedOutputs(projectFiles),
  );
  const applyWorkspace = makeDownstreamNode(
    "apply-workspace",
    ["generate-content", "generate-project"],
    [generateContent.cacheKey, generateProject.cacheKey],
  );
  const gradleCleanBuild = makeDownstreamNode(
    "gradle-clean-build",
    ["apply-workspace"],
    [applyWorkspace.cacheKey],
  );
  const indexArtifacts = makeDownstreamNode(
    "index-artifacts",
    ["gradle-clean-build"],
    [gradleCleanBuild.cacheKey],
  );
  const nodes = Object.freeze([
    applyWorkspace,
    generateContent,
    generateProject,
    gradleCleanBuild,
    indexArtifacts,
  ]);
  const body = Object.freeze({
    contract: BUILD_PLAN_CONTRACT,
    specDigest,
    pack: packRef,
    nodes,
    warnings: Object.freeze(
      spec.gameplay.items.some((item) => !("material" in item)) || spec.gameplay.blocks.length > 0
        ? ["PLACEHOLDER_ASSETS_USED" as const]
        : [],
    ),
  });
  const plan: BuildPlan = Object.freeze({ ...body, planId: domainDigest(PLAN_ID_DOMAIN, body) });
  if (!isBuildPlan(plan)) {
    throw fabricCompilerError("INTERNAL_ERROR", "The Fabric compiler produced an invalid closed build plan.");
  }
  return plan;
}

function artifactKind(path: string, nodeId: FabricCompilerNodeId): FabricArtifactKind {
  if (nodeId === "generate-project") return "template";
  return path.endsWith(".java") ? "source" : "resource";
}

/** Internal deterministic seam used only after validation and exact pack selection. */
export function compileVerifiedFabricPhase1(
  validatedSpec: ModSpecV1,
  verifiedPack: VerifiedFabricPack,
): CompiledFabricProject {
  const spec = copyValidatedSpec(validatedSpec);
  const content = basicContentPreflight(spec);
  const normalizedSpec: ModSpecV1 = {
    ...spec,
    gameplay: {
      ...spec.gameplay,
      materials: [...content.materials],
      items: [...content.items],
      blocks: [...content.blocks],
      recipes: content.recipes.map((recipe) => recipe.type === "shaped" && recipe.key !== undefined
        ? {
            ...recipe,
            key: [...recipe.key].sort((left, right) => compareAscii(left.symbol, right.symbol)),
          }
        : recipe),
    },
    dependencies: {
      required: content.libraries.filter(({ relation }) => relation === "required").map(({ id }) => id),
      optional: content.libraries.filter(({ relation }) => relation === "optional").map(({ id }) => id),
    },
  };
  const projectFileInputs = projectInputs(normalizedSpec, verifiedPack, content.libraries);
  const contentFileInputs = contentInputs(spec, content);
  let files: readonly GeneratedFile[];
  try {
    files = finalizeGeneratedFiles([...projectFileInputs, ...contentFileInputs]);
  } catch (error) {
    if (error instanceof FabricCompilerError) throw error;
    throw fabricCompilerError(
      "SPEC_UNSUPPORTED",
      "The ModSpec expands to duplicate, colliding, oversized, or non-portable generated paths.",
    );
  }
  const projectPaths = new Set(projectFileInputs.map(({ path }) => path));
  const projectFiles = files.filter(({ path }) => projectPaths.has(path));
  const contentFiles = files.filter(({ path }) => !projectPaths.has(path));
  const plan = buildPlan(normalizedSpec, verifiedPack, projectFiles, contentFiles);
  const outputs: readonly CompiledFabricOutput[] = Object.freeze(files.map((file) => {
    const nodeId: FabricCompilerNodeId = projectPaths.has(file.path) ? "generate-project" : "generate-content";
    return Object.freeze({ file, nodeId, artifactKind: artifactKind(file.path, nodeId) });
  }));
  return Object.freeze({ plan, outputs });
}

export const FABRIC_COMPILER_DIGEST_DOMAINS = Object.freeze({
  planId: PLAN_ID_DOMAIN,
  spec: SPEC_DIGEST_DOMAIN,
  nodeInput: NODE_INPUT_DIGEST_DOMAIN,
  nodeCacheKey: NODE_CACHE_KEY_DOMAIN,
});
