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
  BUILTIN_NEOFORGE_26_1_2,
  type VerifiedCompatibilityPack,
} from "@mcdev/compatibility-packs";
import {
  BUILD_PLAN_CONTRACT,
  isBuildPlan,
  mcdevError,
  type BuildPlan,
  type BuildPlanNode,
  type McdevError,
  type PlannedOutput,
  type Sha256,
} from "@mcdev/contracts";
import type { ModSpec } from "@mcdev/modspec";
import { CompilerError, compilerError } from "./errors.ts";
import type {
  CompiledArtifactKind,
  CompiledNeoForgeProject,
  CompiledOutput,
  CompilerNodeId,
} from "./types.ts";

const SPEC_DIGEST_DOMAIN = "mcdev.compiler-neoforge.modspec/v1";
const NODE_INPUT_DIGEST_DOMAIN = "mcdev.compiler-neoforge.node-input/v1";
const NODE_CACHE_KEY_DOMAIN = "mcdev.compiler-neoforge.node-cache/v1";
const PLAN_ID_DOMAIN = "mcdev.compiler-neoforge.plan/v1";

const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mPIDur7j4xvrLBEwYTkGYaBAaRqQJcfDgaMpoPRdAA0AADYy4EfTnIAEwAAAABJRU5ErkJggg==";

const PACK_PAYLOAD_PATHS = Object.freeze([
  "templates/.gitignore",
  "templates/META-INF/neoforge.mods.toml.tpl",
  "templates/build.gradle.tpl",
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
  "templates/META-INF/neoforge.mods.toml.tpl": "src/main/resources/META-INF/neoforge.mods.toml",
  "templates/build.gradle.tpl": "build.gradle",
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
  | "@@MCDEV_MOD_ID@@"
  | "@@MCDEV_PROJECT_LICENSE@@"
  | "@@MCDEV_PROJECT_NAME@@"
  | "@@MCDEV_PROJECT_VERSION@@";

const TEMPLATE_TOKEN_COUNTS: Readonly<Record<string, Readonly<Partial<Record<TemplateToken, number>>>>> =
  Object.freeze({
    "templates/META-INF/neoforge.mods.toml.tpl": Object.freeze({
      "@@MCDEV_MOD_ID@@": 3,
      "@@MCDEV_PROJECT_LICENSE@@": 1,
      "@@MCDEV_PROJECT_NAME@@": 1,
      "@@MCDEV_PROJECT_VERSION@@": 1,
    }),
    "templates/build.gradle.tpl": Object.freeze({
      "@@MCDEV_MOD_ID@@": 2,
      "@@MCDEV_PROJECT_VERSION@@": 1,
    }),
    "templates/settings.gradle.tpl": Object.freeze({
      "@@MCDEV_MOD_ID@@": 1,
    }),
  });

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

interface ResourceLocationParts {
  readonly id: string;
  readonly namespace: string;
  readonly path: string;
}

interface NormalizedContent {
  readonly items: readonly ModSpec["gameplay"]["items"][number][];
  readonly blocks: readonly ModSpec["gameplay"]["blocks"][number][];
  readonly itemParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly blockParts: ReadonlyMap<string, ResourceLocationParts>;
  readonly blockByItem: ReadonlyMap<string, ModSpec["gameplay"]["blocks"][number]>;
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function domainDigest(domain: string, value: unknown): Sha256 {
  return sha256Hex(`${domain}\0${canonicalJson(value)}`);
}

function parseResourceLocation(id: string): ResourceLocationParts {
  const separator = id.indexOf(":");
  return Object.freeze({
    id,
    namespace: id.slice(0, separator),
    path: id.slice(separator + 1),
  });
}

function copyValidatedSpec(spec: ModSpec): ModSpec {
  try {
    return JSON.parse(canonicalJson(spec)) as ModSpec;
  } catch {
    throw compilerError("SPEC_INVALID", "The validated ModSpec could not be copied deterministically.");
  }
}

function pushUnsupported(
  errors: McdevError[],
  path: string,
  message: string,
): void {
  if (errors.length < 100) errors.push(mcdevError("SPEC_UNSUPPORTED", message, path));
}

function scopePreflight(spec: ModSpec): NormalizedContent {
  const errors: McdevError[] = [];
  const modId = spec.project.modId;
  if (!/^[a-z][a-z0-9_]{1,63}$/u.test(modId)) {
    pushUnsupported(
      errors,
      "/project/modId",
      "Phase 1 requires an official NeoForge mod id containing lowercase letters, digits, or underscores.",
    );
  }
  if (spec.target.minecraft !== "26.1.2" || spec.target.loader !== "neoforge" || spec.target.java !== 25) {
    pushUnsupported(errors, "/target", "Phase 1 supports only Minecraft 26.1.2, NeoForge, and Java 25.");
  }

  const unsupportedSections: readonly [readonly unknown[], string, string][] = [
    [spec.gameplay.entities, "/gameplay/entities", "Entity generation is not supported in Phase 1."],
    [spec.gameplay.recipes, "/gameplay/recipes", "Recipe generation is not supported in Phase 1."],
    [spec.gameplay.summoning, "/gameplay/summoning", "Summoning generation is not supported in Phase 1."],
    [spec.gameplay.screens, "/gameplay/screens", "Screen generation is not supported in Phase 1."],
    [spec.assets.models, "/assets/models", "Authored model assets are not supported in Phase 1."],
    [spec.assets.textures, "/assets/textures", "Authored texture assets are not supported in Phase 1."],
    [spec.assets.animations, "/assets/animations", "Animation assets are not supported in Phase 1."],
    [spec.dependencies.required, "/dependencies/required", "Required mod dependencies are not supported in Phase 1."],
    [spec.dependencies.optional, "/dependencies/optional", "Optional mod dependencies are not supported in Phase 1."],
    [spec.tests.gameTests, "/tests/gameTests", "Generated game tests are not supported in Phase 1."],
  ];
  for (const [entries, path, message] of unsupportedSections) {
    if (entries.length > 0) pushUnsupported(errors, path, message);
  }
  if (spec.integrations.jei !== "off") {
    pushUnsupported(errors, "/integrations/jei", "JEI integration must be off in Phase 1.");
  }
  if (spec.integrations.jade !== "off") {
    pushUnsupported(errors, "/integrations/jade", "Jade integration must be off in Phase 1.");
  }
  if (spec.packaging.includeSources) {
    pushUnsupported(errors, "/packaging/includeSources", "Source packaging is not supported in Phase 1.");
  }

  const itemParts = new Map<string, ResourceLocationParts>();
  spec.gameplay.items.forEach((item, index) => {
    const parts = parseResourceLocation(item.id);
    if (parts.namespace !== modId) {
      pushUnsupported(
        errors,
        `/gameplay/items/${index}/id`,
        "Phase 1 item namespaces must equal project.modId.",
      );
    }
    if (item.references.length > 0) {
      pushUnsupported(
        errors,
        `/gameplay/items/${index}/references`,
        "Phase 1 items cannot carry resource references.",
      );
    }
    if (itemParts.has(item.id)) {
      pushUnsupported(errors, `/gameplay/items/${index}/id`, "Phase 1 item ids must be unique.");
    } else {
      itemParts.set(item.id, parts);
    }
  });

  const blockParts = new Map<string, ResourceLocationParts>();
  const blockByItem = new Map<string, ModSpec["gameplay"]["blocks"][number]>();
  spec.gameplay.blocks.forEach((block, index) => {
    const parts = parseResourceLocation(block.id);
    const item = parseResourceLocation(block.item);
    if (parts.namespace !== modId) {
      pushUnsupported(
        errors,
        `/gameplay/blocks/${index}/id`,
        "Phase 1 block namespaces must equal project.modId.",
      );
    }
    if (item.namespace !== modId) {
      pushUnsupported(
        errors,
        `/gameplay/blocks/${index}/item`,
        "Phase 1 block-item namespaces must equal project.modId.",
      );
    }
    if (block.references.length > 0) {
      pushUnsupported(
        errors,
        `/gameplay/blocks/${index}/references`,
        "Phase 1 blocks cannot carry resource references.",
      );
    }
    if (blockParts.has(block.id)) {
      pushUnsupported(errors, `/gameplay/blocks/${index}/id`, "Phase 1 block ids must be unique.");
    } else {
      blockParts.set(block.id, parts);
    }
    if (!itemParts.has(block.item)) {
      pushUnsupported(
        errors,
        `/gameplay/blocks/${index}/item`,
        "Each Phase 1 block item must resolve to exactly one declared gameplay item.",
      );
    }
    if (blockByItem.has(block.item)) {
      pushUnsupported(
        errors,
        `/gameplay/blocks/${index}/item`,
        "Each declared gameplay item can back at most one Phase 1 block.",
      );
    } else {
      blockByItem.set(block.item, block);
    }
  });

  if (errors.length > 0) throw new CompilerError("SPEC_UNSUPPORTED", errors);
  const items = [...spec.gameplay.items].sort((left, right) => compareAscii(left.id, right.id));
  const blocks = [...spec.gameplay.blocks].sort((left, right) => compareAscii(left.id, right.id));
  return Object.freeze({
    items: Object.freeze(items),
    blocks: Object.freeze(blocks),
    itemParts,
    blockParts,
    blockByItem,
  });
}

function assertExactPack(pack: VerifiedCompatibilityPack): void {
  const expected = BUILTIN_NEOFORGE_26_1_2;
  const ref = pack.ref;
  const manifest = pack.manifest;
  if (ref.packId !== expected.packId || ref.revision !== expected.revision ||
    ref.treeSha256 !== expected.treeSha256 || manifest.packId !== expected.packId ||
    manifest.revision !== expected.revision || manifest.target.minecraft !== expected.target.minecraft ||
    manifest.target.loader !== expected.target.loader || manifest.target.java !== expected.target.java ||
    manifest.target.neoForge !== expected.target.neoForge) {
    throw compilerError(
      "PACK_INTEGRITY_FAILED",
      "The compiler accepts only the exact reviewed NeoForge 26.1.2 compatibility pack.",
    );
  }
  const manifestPaths = manifest.files.map(({ path }) => path);
  let listed: readonly string[];
  try {
    listed = pack.listFiles();
  } catch {
    throw compilerError("PACK_INTEGRITY_FAILED", "The reviewed compatibility pack inventory is unavailable.");
  }
  if (manifestPaths.length !== PACK_PAYLOAD_PATHS.length || listed.length !== PACK_PAYLOAD_PATHS.length ||
    PACK_PAYLOAD_PATHS.some((path, index) => manifestPaths[index] !== path || listed[index] !== path)) {
    throw compilerError("PACK_INTEGRITY_FAILED", "The reviewed compatibility pack inventory changed.");
  }
}

function packBytes(pack: VerifiedCompatibilityPack, path: ProjectTemplateSource): Uint8Array {
  const descriptor = pack.manifest.files.find((entry) => entry.path === path);
  if (descriptor === undefined) {
    throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack template is unavailable.");
  }
  let file: GeneratedFile;
  try {
    file = createGeneratedFile({
      path,
      mode: descriptor.mode,
      bytes: pack.readFile(path),
      origin: "pack",
    });
  } catch {
    throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack template is unavailable.");
  }
  if (file.bytes.byteLength !== descriptor.size || file.sha256 !== descriptor.sha256) {
    throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack template changed after verification.");
  }
  return file.bytes;
}

function tomlBasicString(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08: escaped += "\\b"; break;
      case 0x09: escaped += "\\t"; break;
      case 0x0a: escaped += "\\n"; break;
      case 0x0c: escaped += "\\f"; break;
      case 0x0d: escaped += "\\r"; break;
      case 0x22: escaped += "\\\""; break;
      case 0x5c: escaped += "\\\\"; break;
      default:
        escaped += code < 0x20 || code === 0x7f
          ? `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`
          : value[index];
    }
  }
  return escaped;
}

function renderReviewedTemplate(
  path: ProjectTemplateSource,
  bytes: Uint8Array,
  spec: ModSpec,
): Uint8Array {
  const expectedCounts = TEMPLATE_TOKEN_COUNTS[path];
  if (expectedCounts === undefined) return bytes;
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed text template is not valid UTF-8.");
  }
  const replacements: Readonly<Record<TemplateToken, string>> = Object.freeze({
    "@@MCDEV_MOD_ID@@": spec.project.modId,
    "@@MCDEV_PROJECT_LICENSE@@": tomlBasicString(spec.project.license),
    "@@MCDEV_PROJECT_NAME@@": tomlBasicString(spec.project.name),
    "@@MCDEV_PROJECT_VERSION@@": path.endsWith("neoforge.mods.toml.tpl")
      ? tomlBasicString(spec.project.version)
      : spec.project.version,
  });
  const seen = new Map<TemplateToken, number>();
  const tokenPattern = /@@MCDEV_[A-Z0-9_]+@@/gu;
  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0] as TemplateToken;
    if (!Object.hasOwn(replacements, token) || expectedCounts[token] === undefined) {
      throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed template contains an unknown token.");
    }
    seen.set(token, (seen.get(token) ?? 0) + 1);
  }
  for (const [token, expectedCount] of Object.entries(expectedCounts) as [TemplateToken, number][]) {
    if (seen.get(token) !== expectedCount) {
      throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed template token count changed.");
    }
  }
  const withoutRecognizedTokens = source.replace(tokenPattern, "");
  if (withoutRecognizedTokens.includes("@@MCDEV_")) {
    throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed template contains a malformed token.");
  }
  // String.replace performs a single scan of the source. Replacement text is
  // intentionally never scanned as a template, preventing second-order injection.
  return utf8FileBytes(source.replace(tokenPattern, (token) => replacements[token as TemplateToken]));
}

function projectInputs(spec: ModSpec, pack: VerifiedCompatibilityPack): readonly GeneratedFileInput[] {
  assertExactPack(pack);
  const inputs: GeneratedFileInput[] = [];
  for (const sourcePath of Object.keys(PROJECT_TEMPLATE_DESTINATIONS).sort(compareAscii) as ProjectTemplateSource[]) {
    const destination = PROJECT_TEMPLATE_DESTINATIONS[sourcePath];
    const descriptor = pack.manifest.files.find(({ path }) => path === sourcePath);
    if (descriptor === undefined) {
      throw compilerError("PACK_INTEGRITY_FAILED", "A reviewed compatibility pack descriptor is unavailable.");
    }
    const sourceBytes = packBytes(pack, sourcePath);
    const rendered = sourcePath.endsWith(".tpl")
      ? renderReviewedTemplate(sourcePath, sourceBytes, spec)
      : sourceBytes;
    inputs.push({
      path: destination,
      mode: descriptor.mode,
      bytes: rendered,
      origin: sourcePath.endsWith(".tpl") ? "compiler" : "pack",
    });
  }
  return inputs;
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
    else throw compilerError("SPEC_UNSUPPORTED", "A resource path cannot be encoded as a Java field name.");
  }
  return result;
}

function float32Bits(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : Math.fround(value);
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, normalized, false);
  return view.getUint32(0, false).toString(16).toUpperCase().padStart(8, "0");
}

function generatedModSource(modId: string): string {
  return `package dev.mcdev.generated.m_${modId};

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;

@Mod(GeneratedMod.MOD_ID)
public final class GeneratedMod {
    public static final String MOD_ID = ${javaString(modId)};

    public GeneratedMod(IEventBus modBus) {
        GeneratedContent.register(modBus);
    }
}
`;
}

function generatedContentSource(modId: string, content: NormalizedContent): string {
  // Current overloads were checked against NeoForge 26.1.2.80's reviewed
  // DeferredRegister sources and the official registries/items/blocks docs:
  // https://docs.neoforged.net/docs/concepts/registries/
  // https://docs.neoforged.net/docs/items/
  // https://docs.neoforged.net/docs/blocks/
  const blockLines = content.blocks.map((block) => {
    const parts = content.blockParts.get(block.id);
    if (parts === undefined) throw compilerError("INTERNAL_ERROR", "Block normalization failed safely.");
    return `    public static final DeferredBlock<Block> BLOCK_${javaConstantPath(parts.path)} =\n` +
      `            BLOCKS.registerSimpleBlock(${javaString(parts.path)}, props -> props.destroyTime(` +
      `Float.intBitsToFloat(0x${float32Bits(block.hardness)})));`;
  });
  const itemLines = content.items.map((item) => {
    const parts = content.itemParts.get(item.id);
    if (parts === undefined) throw compilerError("INTERNAL_ERROR", "Item normalization failed safely.");
    const block = content.blockByItem.get(item.id);
    if (block === undefined) {
      return `    public static final DeferredItem<Item> ITEM_${javaConstantPath(parts.path)} =\n` +
        `            ITEMS.registerSimpleItem(${javaString(parts.path)}, props -> props.stacksTo(${item.maxStackSize}));`;
    }
    const blockParts = content.blockParts.get(block.id);
    if (blockParts === undefined) throw compilerError("INTERNAL_ERROR", "Block-item normalization failed safely.");
    return `    public static final DeferredItem<BlockItem> ITEM_${javaConstantPath(parts.path)} =\n` +
      `            ITEMS.registerSimpleBlockItem(${javaString(parts.path)}, BLOCK_${javaConstantPath(blockParts.path)}, ` +
      `props -> props.stacksTo(${item.maxStackSize}));`;
  });
  const declarations = [...blockLines, ...itemLines];
  const declarationSection = declarations.length === 0 ? "" : `${declarations.join("\n\n")}\n\n`;
  return `package dev.mcdev.generated.m_${modId};

import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

public final class GeneratedContent {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(GeneratedMod.MOD_ID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(GeneratedMod.MOD_ID);

${declarationSection}    private GeneratedContent() {}

    public static void register(IEventBus modBus) {
        ITEMS.register(modBus);
        BLOCKS.register(modBus);
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

function contentInputs(spec: ModSpec, content: NormalizedContent): readonly GeneratedFileInput[] {
  // Minecraft 26.1 client item definitions are distinct from baked models.
  // Source: https://docs.neoforged.net/docs/resources/client/models/items/
  // Singular `loot_table` and the emitted self-drop shape were also checked
  // byte-for-structure against the pinned Minecraft 26.1.2 vanilla data jar.
  const modId = spec.project.modId;
  const javaRoot = `src/main/java/dev/mcdev/generated/m_${modId}`;
  const resourceRoot = `src/main/resources`;
  const inputs: GeneratedFileInput[] = [
    input(`${javaRoot}/GeneratedMod.java`, utf8FileBytes(generatedModSource(modId))),
    input(`${javaRoot}/GeneratedContent.java`, utf8FileBytes(generatedContentSource(modId, content))),
  ];
  const language: Record<string, string> = {};

  for (const item of content.items) {
    const parts = content.itemParts.get(item.id);
    if (parts === undefined) throw compilerError("INTERNAL_ERROR", "Item resource normalization failed safely.");
    const block = content.blockByItem.get(item.id);
    if (block === undefined) {
      inputs.push(jsonInput(
        `${resourceRoot}/assets/${parts.namespace}/items/${parts.path}.json`,
        { model: { type: "minecraft:model", model: `${parts.namespace}:item/${parts.path}` } },
      ));
      inputs.push(jsonInput(
        `${resourceRoot}/assets/${parts.namespace}/models/item/${parts.path}.json`,
        {
          parent: "minecraft:item/generated",
          textures: { layer0: `${modId}:mcdev/placeholder` },
        },
      ));
      language[`item.${parts.namespace}.${parts.path}`] = titleFromPath(parts.path);
    }
  }

  for (const block of content.blocks) {
    const parts = content.blockParts.get(block.id);
    const item = content.itemParts.get(block.item);
    if (parts === undefined || item === undefined) {
      throw compilerError("INTERNAL_ERROR", "Block resource normalization failed safely.");
    }
    inputs.push(jsonInput(
      `${resourceRoot}/assets/${item.namespace}/items/${item.path}.json`,
      { model: { type: "minecraft:model", model: `${parts.namespace}:block/${parts.path}` } },
    ));
    inputs.push(jsonInput(
      `${resourceRoot}/assets/${parts.namespace}/blockstates/${parts.path}.json`,
      { variants: { "": { model: `${parts.namespace}:block/${parts.path}` } } },
    ));
    inputs.push(jsonInput(
      `${resourceRoot}/assets/${parts.namespace}/models/block/${parts.path}.json`,
      {
        parent: "minecraft:block/cube_all",
        textures: { all: `${modId}:mcdev/placeholder` },
      },
    ));
    inputs.push(jsonInput(
      `${resourceRoot}/data/${parts.namespace}/loot_table/blocks/${parts.path}.json`,
      {
        type: "minecraft:block",
        pools: [{
          rolls: 1,
          bonus_rolls: 0,
          conditions: [{ condition: "minecraft:survives_explosion" }],
          entries: [{ type: "minecraft:item", name: block.item }],
        }],
        random_sequence: `${parts.namespace}:blocks/${parts.path}`,
      },
    ));
    language[`block.${parts.namespace}.${parts.path}`] = titleFromPath(parts.path);
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
  nodeId: CompilerNodeId,
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
    ? Object.freeze({
      ...common,
      nodeId: "generate-project",
      kind: "generate-project",
      provenance: "compiler-and-pack",
    })
    : Object.freeze({
      ...common,
      nodeId: "generate-content",
      kind: "generate-content",
      provenance: "compiler",
    });
}

function makeDownstreamNode(
  nodeId: "apply-workspace" | "gradle-clean-build" | "index-artifacts",
  kind: "apply-workspace" | "gradle-clean-build" | "index-artifacts",
  dependsOn: readonly string[],
  dependencyCacheKeys: readonly Sha256[],
): BuildPlanNode {
  const inputDigest = domainDigest(NODE_INPUT_DIGEST_DOMAIN, { nodeId, dependencyCacheKeys });
  const common = {
    nodeId,
    kind,
    dependsOn: Object.freeze([...dependsOn]),
    inputDigest,
    cacheKey: nodeCacheKey(nodeId, inputDigest, Object.freeze([])),
    outputs: Object.freeze([]),
    retryPolicy: "never" as const,
    logPolicy: "structured-redacted-v1" as const,
  };
  if (kind === "apply-workspace") {
    return Object.freeze({
      ...common,
      nodeId: "apply-workspace",
      kind: "apply-workspace",
      policy: "create-only-cas-wal-v1",
      validatorPolicy: "workspace-manifest-v1",
      provenance: "workspace-transaction",
    });
  }
  if (kind === "gradle-clean-build") {
    return Object.freeze({
      ...common,
      nodeId: "gradle-clean-build",
      kind: "gradle-clean-build",
      policy: "neoforge-phase1-v1",
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
  spec: ModSpec,
  pack: VerifiedCompatibilityPack,
  projectFiles: readonly GeneratedFile[],
  contentFiles: readonly GeneratedFile[],
): BuildPlan {
  const specDigest = domainDigest(SPEC_DIGEST_DOMAIN, spec);
  const packRef = Object.freeze({ ...pack.ref });
  const projectOutputs = plannedOutputs(projectFiles);
  const contentOutputs = plannedOutputs(contentFiles);
  const generateContent = makeGenerateNode(
    "generate-content",
    "generate-content",
    domainDigest(NODE_INPUT_DIGEST_DOMAIN, {
      nodeId: "generate-content",
      specDigest,
      compiler: "@mcdev/compiler-neoforge@0.1.0-phase.1",
    }),
    contentOutputs,
  );
  const generateProject = makeGenerateNode(
    "generate-project",
    "generate-project",
    domainDigest(NODE_INPUT_DIGEST_DOMAIN, {
      nodeId: "generate-project",
      specDigest,
      pack: packRef,
      compiler: "@mcdev/compiler-neoforge@0.1.0-phase.1",
    }),
    projectOutputs,
  );
  const applyWorkspace = makeDownstreamNode(
    "apply-workspace",
    "apply-workspace",
    ["generate-content", "generate-project"],
    [generateContent.cacheKey, generateProject.cacheKey],
  );
  const gradleCleanBuild = makeDownstreamNode(
    "gradle-clean-build",
    "gradle-clean-build",
    ["apply-workspace"],
    [applyWorkspace.cacheKey],
  );
  const indexArtifacts = makeDownstreamNode(
    "index-artifacts",
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
  const warnings = Object.freeze(
    spec.gameplay.items.length > 0 || spec.gameplay.blocks.length > 0
      ? ["PLACEHOLDER_ASSETS_USED" as const]
      : [],
  );
  const body = Object.freeze({
    contract: BUILD_PLAN_CONTRACT,
    specDigest,
    pack: packRef,
    nodes,
    warnings,
  });
  const plan: BuildPlan = Object.freeze({
    ...body,
    planId: domainDigest(PLAN_ID_DOMAIN, body),
  });
  if (!isBuildPlan(plan)) throw compilerError("INTERNAL_ERROR", "The compiler produced an invalid closed build plan.");
  return plan;
}

function artifactKind(path: string, nodeId: CompilerNodeId): CompiledArtifactKind {
  if (nodeId === "generate-project") return "template";
  return path.endsWith(".java") ? "source" : "resource";
}

/**
 * Internal deterministic seam. It is intentionally not exported by package.json;
 * the application-facing entrypoint owns validation and built-in pack selection.
 */
export function compileVerifiedNeoForgePhase1(
  validatedSpec: ModSpec,
  verifiedPack: VerifiedCompatibilityPack,
): CompiledNeoForgeProject {
  const spec = copyValidatedSpec(validatedSpec);
  const content = scopePreflight(spec);
  const normalizedSpec: ModSpec = {
    ...spec,
    gameplay: {
      ...spec.gameplay,
      items: [...content.items],
      blocks: [...content.blocks],
    },
  };
  const projectFileInputs = projectInputs(spec, verifiedPack);
  const contentFileInputs = contentInputs(spec, content);
  let files: readonly GeneratedFile[];
  try {
    files = finalizeGeneratedFiles([...projectFileInputs, ...contentFileInputs]);
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw compilerError(
      "SPEC_UNSUPPORTED",
      "The ModSpec expands to duplicate, colliding, oversized, or non-portable generated paths.",
    );
  }
  const projectPaths = new Set(projectFileInputs.map(({ path }) => path));
  const projectFiles = files.filter(({ path }) => projectPaths.has(path));
  const contentFiles = files.filter(({ path }) => !projectPaths.has(path));
  const plan = buildPlan(normalizedSpec, verifiedPack, projectFiles, contentFiles);
  const outputs: readonly CompiledOutput[] = Object.freeze(files.map((file) => {
    const nodeId: CompilerNodeId = projectPaths.has(file.path) ? "generate-project" : "generate-content";
    return Object.freeze({
      file,
      nodeId,
      artifactKind: artifactKind(file.path, nodeId),
    });
  }));
  return Object.freeze({ plan, outputs });
}

export const COMPILER_DIGEST_DOMAINS = Object.freeze({
  planId: PLAN_ID_DOMAIN,
  spec: SPEC_DIGEST_DOMAIN,
  nodeInput: NODE_INPUT_DIGEST_DOMAIN,
  nodeCacheKey: NODE_CACHE_KEY_DOMAIN,
});
