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

interface NormalizedContent {
  readonly items: readonly ModSpecV1["gameplay"]["items"][number][];
  readonly blocks: readonly ModSpecV1["gameplay"]["blocks"][number][];
  readonly recipes: readonly ModSpecV1["gameplay"]["recipes"][number][];
  readonly itemParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly blockParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly recipeParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly blockByItem: ReadonlyMap<string, ModSpecV1["gameplay"]["blocks"][number]>;
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
    [spec.dependencies.required, "/dependencies/required"],
    [spec.dependencies.optional, "/dependencies/optional"],
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
    if (recipe.type === "shaped" || recipe.type === "custom") {
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
      if (!itemParts.has(ingredient)) {
        pushUnsupported(
          errors,
          `/gameplay/recipes/${index}/ingredients/${ingredientIndex}`,
          "Fabric phase 1 recipe ingredients must be declared gameplay items.",
        );
      }
    });
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
    items: Object.freeze([...spec.gameplay.items].sort((left, right) => compareAscii(left.id, right.id))),
    blocks: Object.freeze([...spec.gameplay.blocks].sort((left, right) => compareAscii(left.id, right.id))),
    recipes: Object.freeze([...spec.gameplay.recipes].sort((left, right) => compareAscii(left.id, right.id))),
    itemParts,
    blockParts,
    recipeParts,
    blockByItem,
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

function renderTemplate(path: ProjectTemplateSource, bytes: Uint8Array, spec: ModSpecV1): Uint8Array {
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
  return utf8FileBytes(source.replace(tokenPattern, (token) => replacements[token as TemplateToken]));
}

function projectInputs(spec: ModSpecV1, pack: VerifiedFabricPack): readonly GeneratedFileInput[] {
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
        bytes: template ? renderTemplate(sourcePath, packBytes(pack, sourcePath), spec) : packBytes(pack, sourcePath),
        origin: template ? "compiler" as const : "pack" as const,
      };
    });
}

function javaString(value: string): string {
  return JSON.stringify(value);
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

function generatedContentSource(modId: string, content: NormalizedContent): string {
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
    const block = content.blockByItem.get(item.id);
    const constructor = block === undefined
      ? `new Item(new Item.Properties().stacksTo(${item.maxStackSize}))`
      : (() => {
          const blockParts = content.blockParts.get(block.id);
          if (blockParts === undefined) {
            throw fabricCompilerError("INTERNAL_ERROR", "Block-item normalization failed safely.");
          }
          return `new BlockItem(BLOCK_${javaConstantPath(blockParts.path)}, ` +
            `new Item.Properties().stacksTo(${item.maxStackSize}))`;
        })();
    return `    public static final Item ITEM_${javaConstantPath(parts.path)} = registerItem(\n` +
      `            ${javaString(parts.path)}, ${constructor});`;
  });
  const declarations = [...blockLines, ...itemLines];
  const declarationSection = declarations.length === 0 ? "" : `${declarations.join("\n\n")}\n\n`;
  const ingredientEntries = content.items
    .filter((item) => !content.blockByItem.has(item.id))
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
  const creativeRegistrations = [
    ingredientEntries.length === 0 ? "" :
      `        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.INGREDIENTS).register(entries -> {\n` +
      `${ingredientEntries.join("\n")}\n        });`,
    buildingEntries.length === 0 ? "" :
      `        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.BUILDING_BLOCKS).register(entries -> {\n` +
      `${buildingEntries.join("\n")}\n        });`,
  ].filter((entry) => entry.length > 0).join("\n");
  return `package dev.mcdev.generated.m_${modId};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;

public final class GeneratedContent {
${declarationSection}    private GeneratedContent() {}

    public static void register() {
${creativeRegistrations}
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

function contentInputs(spec: ModSpecV1, content: NormalizedContent): readonly GeneratedFileInput[] {
  const modId = spec.project.modId;
  const packageRoot = `dev.mcdev.generated.m_${modId}`;
  const pathRoot = `dev/mcdev/generated/m_${modId}`;
  const mainSource = `package ${packageRoot};

import net.fabricmc.api.ModInitializer;

public final class GeneratedMod implements ModInitializer {
    public static final String MOD_ID = ${javaString(modId)};

    @Override
    public void onInitialize() {
        GeneratedContent.register();
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

  for (const item of content.items) {
    const parts = content.itemParts.get(item.id);
    if (parts === undefined) throw fabricCompilerError("INTERNAL_ERROR", "Item resource normalization failed safely.");
    const block = content.blockByItem.get(item.id);
    const blockParts = block === undefined ? undefined : content.blockParts.get(block.id);
    if (block !== undefined && blockParts === undefined) {
      throw fabricCompilerError("INTERNAL_ERROR", "Block-item resource normalization failed safely.");
    }
    inputs.push(jsonInput(
      `${resourceRoot}/assets/${parts.namespace}/models/item/${parts.path}.json`,
      block === undefined
        ? { parent: "minecraft:item/generated", textures: { layer0: `${modId}:mcdev/placeholder` } }
        : { parent: `${modId}:block/${blockParts?.path}` },
    ));
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
    const value = recipe.type === "shapeless"
      ? {
          type: "minecraft:crafting_shapeless",
          category: "misc",
          ingredients: recipe.ingredients.map((item) => ({ item })),
          result: { item: recipe.result },
        }
      : {
          type: "minecraft:smelting",
          category: "misc",
          cookingtime: 200,
          experience: 0,
          ingredient: { item: recipe.ingredients[0] },
          result: recipe.result,
        };
    inputs.push(jsonInput(
      `${resourceRoot}/data/${parts.namespace}/recipes/${parts.path}.json`,
      value,
    ));
  }

  inputs.push(jsonInput(`${resourceRoot}/assets/${modId}/lang/en_us.json`, language));
  if (content.items.length > 0 || content.blocks.length > 0) {
    inputs.push(input(
      `${resourceRoot}/assets/${modId}/textures/mcdev/placeholder.png`,
      Buffer.from(PLACEHOLDER_PNG_BASE64, "base64"),
    ));
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
      spec.gameplay.items.length > 0 || spec.gameplay.blocks.length > 0
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
      items: [...content.items],
      blocks: [...content.blocks],
      recipes: [...content.recipes],
    },
  };
  const projectFileInputs = projectInputs(spec, verifiedPack);
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
