import {
  canonicalJson,
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

const COMPILER_ID = "@mcdev/compiler-fabric@0.1.0-phase.0";
const SPEC_DIGEST_DOMAIN = "mcdev.compiler-fabric.modspec/v1";
const NODE_INPUT_DIGEST_DOMAIN = "mcdev.compiler-fabric.node-input/v1";
const NODE_CACHE_KEY_DOMAIN = "mcdev.compiler-fabric.node-cache/v1";
const PLAN_ID_DOMAIN = "mcdev.compiler-fabric.plan/v1";

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

function phase0Preflight(spec: ModSpecV1): void {
  const errors: McdevError[] = [];
  if (!/^[a-z][a-z0-9_]{1,63}$/u.test(spec.project.modId)) {
    pushUnsupported(errors, "/project/modId", "Fabric phase 0 requires a Java-safe mod id without hyphens.");
  }
  if (spec.target.minecraft !== "1.20.1" || spec.target.loader !== "fabric" || spec.target.java !== 17) {
    pushUnsupported(errors, "/target", "Fabric phase 0 supports only Minecraft 1.20.1 and Java 17.");
  }
  const sections: readonly [readonly unknown[], string][] = [
    [spec.gameplay.items, "/gameplay/items"],
    [spec.gameplay.blocks, "/gameplay/blocks"],
    [spec.gameplay.entities, "/gameplay/entities"],
    [spec.gameplay.recipes, "/gameplay/recipes"],
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
      pushUnsupported(errors, path, "This content is modeled by ModSpec v1 but is not generated in Fabric phase 0 yet.");
    }
  }
  if (spec.integrations.jei !== "off") {
    pushUnsupported(errors, "/integrations/jei", "JEI integration must be off in Fabric phase 0.");
  }
  if (spec.integrations.jade !== "off") {
    pushUnsupported(errors, "/integrations/jade", "Jade integration must be off in Fabric phase 0.");
  }
  if (spec.packaging.includeSources) {
    pushUnsupported(errors, "/packaging/includeSources", "Source packaging is not supported in Fabric phase 0.");
  }
  if (errors.length > 0) throw new FabricCompilerError("SPEC_UNSUPPORTED", errors);
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

function contentInputs(spec: ModSpecV1): readonly GeneratedFileInput[] {
  const modId = spec.project.modId;
  const packageRoot = `dev.mcdev.generated.m_${modId}`;
  const pathRoot = `dev/mcdev/generated/m_${modId}`;
  const mainSource = `package ${packageRoot};

import net.fabricmc.api.ModInitializer;

public final class GeneratedMod implements ModInitializer {
    public static final String MOD_ID = ${javaString(modId)};

    @Override
    public void onInitialize() {
        // Fabric content registries are added by later compiler phases.
    }
}
`;
  const clientSource = `package ${packageRoot}.client;

import net.fabricmc.api.ClientModInitializer;

public final class GeneratedClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // Client renderers and screens are added by later compiler phases.
    }
}
`;
  return Object.freeze([
    {
      path: `src/main/java/${pathRoot}/GeneratedMod.java`,
      mode: 420,
      bytes: utf8FileBytes(mainSource),
      origin: "compiler",
    },
    {
      path: `src/client/java/${pathRoot}/client/GeneratedClient.java`,
      mode: 420,
      bytes: utf8FileBytes(clientSource),
      origin: "compiler",
    },
  ]);
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
      policy: "fabric-1.20.1-phase0-v1",
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
    warnings: Object.freeze([]),
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
export function compileVerifiedFabricPhase0(
  validatedSpec: ModSpecV1,
  verifiedPack: VerifiedFabricPack,
): CompiledFabricProject {
  const spec = copyValidatedSpec(validatedSpec);
  phase0Preflight(spec);
  const projectFileInputs = projectInputs(spec, verifiedPack);
  const contentFileInputs = contentInputs(spec);
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
  const plan = buildPlan(spec, verifiedPack, projectFiles, contentFiles);
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
