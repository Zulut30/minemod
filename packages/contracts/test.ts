import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_INDEX_CONTRACT,
  APPLY_PLAN_REQUEST_CONTRACT,
  APPLY_PLAN_RESULT_CONTRACT,
  BUILD_PLAN_CONTRACT,
  COMPATIBILITY_PACK_CONTRACT,
  COMPATIBILITY_PACK_V2_CONTRACT,
  COMPATIBILITY_PACK_V3_CONTRACT,
  CONTRACT_LIMITS,
  ERROR_CONTRACT,
  LOG_EVENT_CONTRACT,
  PLAN_BUILD_REQUEST_CONTRACT,
  PLAN_BUILD_RESULT_CONTRACT,
  WORKSPACE_JOURNAL_CONTRACT,
  WORKSPACE_MANIFEST_CONTRACT,
  containsForbiddenExecutionSurface,
  isArtifactIndex,
  isApplyPlanRequest,
  isApplyPlanResult,
  isBuildPlan,
  isCompatibilityPackManifest,
  isCompatibilityPackManifestV2,
  isCompatibilityPackManifestV3,
  isCompatibilitySelectorV2,
  isCompatibilitySelectorV3,
  isLogEvent,
  isMcdevError,
  isPlanBuildRequest,
  isPlanBuildResult,
  isPortableRelativePath,
  isWorkspaceJournal,
  isWorkspaceManifest,
} from "./index.ts";

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/contracts/v1/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function fixtureV2(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/contracts/v2/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const pack = fixture("compatibility-pack");
const fabricPack = fixtureV2("compatibility-pack");
const fabricJava17Pack = {
  ...(clone(fabricPack) as Record<string, unknown>),
  contract: COMPATIBILITY_PACK_V3_CONTRACT,
  packId: "fabric-1.20.1-java-17",
  target: {
    minecraft: "1.20.1",
    loader: "fabric",
    java: 17,
    fabricLoader: "0.19.3",
  },
};
const plan = fixture("build-plan");
const artifactIndex = fixture("artifact-index");
const workspaceManifest = fixture("workspace-manifest");
const workspaceJournal = fixture("workspace-journal");
const logEvent = fixture("log-event");
const error = fixture("error");

assert.equal(isCompatibilityPackManifest(pack), true);
assert.equal(isCompatibilityPackManifestV2(fabricPack), true);
assert.equal(isCompatibilityPackManifestV3(fabricJava17Pack), true);
assert.equal(isCompatibilityPackManifest(fabricPack), false, "v2 must not alias v1");
assert.equal(isCompatibilityPackManifestV2(pack), false, "v1 must not alias v2");
assert.equal(isCompatibilityPackManifestV2(fabricJava17Pack), false, "v3 must not alias v2");
assert.equal(isCompatibilityPackManifestV3(fabricPack), false, "v2 must not alias v3");
assert.equal(isCompatibilitySelectorV2({ minecraft: "26.2", loader: "fabric", java: 25 }), true);
assert.equal(isCompatibilitySelectorV2({ minecraft: "26.2", loader: "fabric", java: 25, path: "." }), false);
assert.equal(isCompatibilitySelectorV3({ minecraft: "1.20.1", loader: "fabric", java: 17 }), true);
assert.equal(isCompatibilitySelectorV3({ minecraft: "1.20.1", loader: "fabric", java: 21 }), false);
assert.equal(isCompatibilitySelectorV3({ minecraft: "1.20.1", loader: "neoforge", java: 17 }), false);
assert.equal(isBuildPlan(plan), true);
const fabricPlan = clone(plan) as Record<string, unknown>;
const fabricBuildNode = (fabricPlan.nodes as Record<string, unknown>[])
  .find((node) => node.kind === "gradle-clean-build");
assert.ok(fabricBuildNode !== undefined);
fabricBuildNode.policy = "fabric-1.20.1-phase0-v1";
assert.equal(isBuildPlan(fabricPlan), true, "Fabric 1.20.1 phase-0 builds use a closed runner policy");
fabricBuildNode.policy = "fabric-1.20.1-phase1-v1";
assert.equal(isBuildPlan(fabricPlan), true, "Fabric 1.20.1 phase-1 builds use a closed runner policy");
fabricBuildNode.policy = "fabric-latest";
assert.equal(isBuildPlan(fabricPlan), false, "unversioned Fabric runner policies are rejected");
assert.equal(isArtifactIndex(artifactIndex), true);
assert.equal(isWorkspaceManifest(workspaceManifest), true);
assert.equal(isWorkspaceJournal(workspaceJournal), true);
assert.equal(isLogEvent(logEvent), true);
assert.equal(isMcdevError(error), true);

const planBuildRequest = {
  contract: PLAN_BUILD_REQUEST_CONTRACT,
  kind: "mod",
  payload: "{}",
};
assert.equal(isPlanBuildRequest(planBuildRequest), true);
for (const forbiddenKey of ["profile", "packId", "packPath", "command", "env"]) {
  assert.equal(isPlanBuildRequest({ ...planBuildRequest, [forbiddenKey]: "forbidden" }), false, forbiddenKey);
}
assert.equal(isPlanBuildRequest({
  ...planBuildRequest,
  payload: "x".repeat(CONTRACT_LIMITS.inlineSpecBytes + 1),
}), false);
assert.equal(isPlanBuildRequest({ ...planBuildRequest, contract: APPLY_PLAN_REQUEST_CONTRACT }), false);

const applyPlanRequest = {
  contract: APPLY_PLAN_REQUEST_CONTRACT,
  workspaceRoot: "/confirmed/workspace",
  planId: "1111111111111111111111111111111111111111111111111111111111111111",
  kind: "mod",
  payload: "{}",
};
assert.equal(isApplyPlanRequest(applyPlanRequest), true);
assert.equal(isApplyPlanRequest({ ...applyPlanRequest, contract: PLAN_BUILD_REQUEST_CONTRACT }), false);
for (const forbiddenKey of ["force", "overwrite", "command", "args", "env"]) {
  assert.equal(isApplyPlanRequest({ ...applyPlanRequest, [forbiddenKey]: true }), false, forbiddenKey);
}

const planBuildSuccess = { contract: PLAN_BUILD_RESULT_CONTRACT, ok: true, plan };
const planBuildFailure = { contract: PLAN_BUILD_RESULT_CONTRACT, ok: false, errors: [error] };
assert.equal(isPlanBuildResult(planBuildSuccess), true);
assert.equal(isPlanBuildResult(planBuildFailure), true);
assert.equal(isPlanBuildResult({ ...planBuildSuccess, contract: APPLY_PLAN_RESULT_CONTRACT }), false);

const applyPlanSuccess = {
  contract: APPLY_PLAN_RESULT_CONTRACT,
  ok: true,
  status: "created",
  manifest: workspaceManifest,
  artifacts: artifactIndex,
};
const applyPlanFailure = { contract: APPLY_PLAN_RESULT_CONTRACT, ok: false, errors: [error] };
assert.equal(isApplyPlanResult(applyPlanSuccess), true);
assert.equal(isApplyPlanResult(applyPlanFailure), true);
assert.equal(isApplyPlanResult({ ...applyPlanSuccess, contract: PLAN_BUILD_RESULT_CONTRACT }), false);
assert.equal(isApplyPlanResult({
  ...applyPlanSuccess,
  artifacts: {
    ...(clone(artifactIndex) as object),
    planId: "9999999999999999999999999999999999999999999999999999999999999999",
  },
}), false, "result documents must identify one exact plan");
assert.equal(isApplyPlanResult({
  ...applyPlanSuccess,
  artifacts: {
    ...(clone(artifactIndex) as object),
    pack: {
      packId: "neoforge-26.1.2-java-25-other",
      revision: 2,
      treeSha256: "4444444444444444444444444444444444444444444444444444444444444444",
    },
  },
}), false, "result documents must identify one exact pack revision and tree");

const contractLiterals = [
  COMPATIBILITY_PACK_CONTRACT,
  COMPATIBILITY_PACK_V2_CONTRACT,
  COMPATIBILITY_PACK_V3_CONTRACT,
  BUILD_PLAN_CONTRACT,
  ARTIFACT_INDEX_CONTRACT,
  WORKSPACE_MANIFEST_CONTRACT,
  WORKSPACE_JOURNAL_CONTRACT,
  LOG_EVENT_CONTRACT,
  ERROR_CONTRACT,
  PLAN_BUILD_REQUEST_CONTRACT,
  PLAN_BUILD_RESULT_CONTRACT,
  APPLY_PLAN_REQUEST_CONTRACT,
  APPLY_PLAN_RESULT_CONTRACT,
];
assert.equal(new Set(contractLiterals).size, contractLiterals.length, "wire contracts must have distinct versions");

for (const wrongContract of contractLiterals.filter((value) => value !== BUILD_PLAN_CONTRACT)) {
  assert.equal(isBuildPlan({ ...(clone(plan) as object), contract: wrongContract }), false, wrongContract);
}
assert.equal(isCompatibilityPackManifest({ ...(clone(pack) as object), status: "production" }), false);
assert.equal(isCompatibilityPackManifest({ ...(clone(pack) as object), trusted: true }), false);
assert.equal(isCompatibilityPackManifest({ ...(clone(pack) as object), path: "../../fixture" }), false);
assert.equal(isCompatibilityPackManifestV2({ ...(clone(fabricPack) as object), status: "production" }), false);
assert.equal(isCompatibilityPackManifestV2({ ...(clone(fabricPack) as object), trusted: true }), false);
assert.equal(isCompatibilityPackManifestV2({ ...(clone(fabricPack) as object), path: "../../fixture" }), false);
const fabricPackWithNeoForgeKey = clone(fabricPack) as Record<string, unknown>;
(fabricPackWithNeoForgeKey.target as Record<string, unknown>).neoForge = "26.2.0";
assert.equal(isCompatibilityPackManifestV2(fabricPackWithNeoForgeKey), false);
const fabricPackWithoutLoaderVersion = clone(fabricPack) as Record<string, unknown>;
delete (fabricPackWithoutLoaderVersion.target as Record<string, unknown>).fabricLoader;
assert.equal(isCompatibilityPackManifestV2(fabricPackWithoutLoaderVersion), false);

const planWithCommand = clone(plan) as Record<string, unknown>;
const commandNodes = planWithCommand.nodes as Record<string, unknown>[];
commandNodes[0] = { ...commandNodes[0], command: "sh" };
assert.equal(containsForbiddenExecutionSurface(planWithCommand), true);
assert.equal(isBuildPlan(planWithCommand), false);

for (const forbidden of ["args", "command", "cwd", "env", "eval", "executable", "module", "script", "shell"]) {
  assert.equal(containsForbiddenExecutionSurface({ nested: [{ [forbidden]: "value" }] }), true, forbidden);
}
assert.equal(containsForbiddenExecutionSurface({ policy: "neoforge-phase1-v1" }), false);
assert.equal(containsForbiddenExecutionSurface({ policy: "fabric-1.20.1-phase0-v1" }), false);
assert.equal(containsForbiddenExecutionSurface({ policy: "fabric-1.20.1-phase1-v1" }), false);

const cyclic = clone(plan) as Record<string, unknown>;
const cyclicNodes = cyclic.nodes as Record<string, unknown>[];
const firstNode = cyclicNodes[0];
assert.ok(firstNode !== undefined);
firstNode.dependsOn = ["index-artifacts"];
assert.equal(isBuildPlan(cyclic), false, "cycle must be rejected");

const sparsePlan = clone(plan) as Record<string, unknown>;
const sparseNodes = sparsePlan.nodes as unknown[];
delete sparseNodes[0];
assert.equal(isBuildPlan(sparsePlan), false, "sparse arrays are not JSON documents");

const oversizedDependencies = clone(plan) as Record<string, unknown>;
const oversizedDependencyNodes = oversizedDependencies.nodes as Record<string, unknown>[];
const dependencyNode = oversizedDependencyNodes[0];
assert.ok(dependencyNode !== undefined);
dependencyNode.dependsOn = Array.from({ length: CONTRACT_LIMITS.buildPlanEdges + 1 }, (_, index) =>
  `node-${String(index).padStart(6, "0")}`);
let oversizedDependencyResult: boolean | undefined;
assert.doesNotThrow(() => {
  oversizedDependencyResult = isBuildPlan(oversizedDependencies);
});
assert.equal(oversizedDependencyResult, false, "oversized edge lists must fail without throwing");

const largeForbiddenScan = Array.from({ length: 200_000 }, () => null);
let largeForbiddenResult: boolean | undefined;
assert.doesNotThrow(() => {
  largeForbiddenResult = containsForbiddenExecutionSurface(largeForbiddenScan);
});
assert.equal(largeForbiddenResult, false, "iterative walker must not spread attacker-sized arrays");

const unknownNode = clone(plan) as Record<string, unknown>;
const unknownNodes = unknownNode.nodes as Record<string, unknown>[];
const firstUnknownNode = unknownNodes[0];
assert.ok(firstUnknownNode !== undefined);
firstUnknownNode.kind = "run-command";
assert.equal(isBuildPlan(unknownNode), false);

const excessiveOutputs = clone(plan) as Record<string, unknown>;
const excessiveNodes = excessiveOutputs.nodes as Record<string, unknown>[];
const contentNode = excessiveNodes.find((node) => node.nodeId === "generate-content");
assert.ok(contentNode !== undefined);
contentNode.outputs = Array.from({ length: CONTRACT_LIMITS.generatedFiles + 1 }, (_, index) => ({
  path: `generated/${String(index).padStart(4, "0")}`,
  mode: 420,
  size: 0,
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}));
assert.equal(isBuildPlan(excessiveOutputs), false, "generated file cap + 1 must fail");

const excessiveFile = clone(plan) as Record<string, unknown>;
const excessiveFileNodes = excessiveFile.nodes as Record<string, unknown>[];
const projectNode = excessiveFileNodes.find((node) => node.nodeId === "generate-project");
assert.ok(projectNode !== undefined);
const projectOutputs = projectNode.outputs as Record<string, unknown>[];
const projectOutput = projectOutputs[0];
assert.ok(projectOutput !== undefined);
projectOutput.size = CONTRACT_LIMITS.generatedFileBytes + 1;
assert.equal(isBuildPlan(excessiveFile), false, "single file cap + 1 must fail");

const caseCollidingPlan = clone(plan) as Record<string, unknown>;
const caseCollidingNodes = caseCollidingPlan.nodes as Record<string, unknown>[];
const collidingContentNode = caseCollidingNodes.find((node) => node.nodeId === "generate-content");
assert.ok(collidingContentNode !== undefined);
const collidingOutputs = collidingContentNode.outputs as Record<string, unknown>[];
const collidingOutput = collidingOutputs[0];
assert.ok(collidingOutput !== undefined);
collidingOutput.path = "BUILD.GRADLE";
assert.equal(isBuildPlan(caseCollidingPlan), false, "portable output paths must be case-fold unique");

const excessiveJournal = clone(workspaceJournal) as Record<string, unknown>;
excessiveJournal.files = Array.from({ length: 9 }, (_, index) => ({
  path: `generated/${String(index).padStart(2, "0")}`,
  mode: 420,
  size: CONTRACT_LIMITS.generatedFileBytes,
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}));
excessiveJournal.createdPaths = [];
assert.equal(isWorkspaceJournal(excessiveJournal), false, "journal must enforce the 128 MiB apply cap");

const hostileStringValue = {
  toString(): never {
    throw new Error("attacker toString executed");
  },
};
const hostileCases: readonly [string, () => boolean][] = [
  ["pack role", () => {
    const candidate = clone(pack) as Record<string, unknown>;
    const files = candidate.files as Record<string, unknown>[];
    const file = files[0];
    assert.ok(file !== undefined);
    file.role = hostileStringValue;
    return isCompatibilityPackManifest(candidate);
  }],
  ["plan node id", () => {
    const candidate = clone(plan) as Record<string, unknown>;
    const nodes = candidate.nodes as Record<string, unknown>[];
    const node = nodes[0];
    assert.ok(node !== undefined);
    node.nodeId = hostileStringValue;
    return isBuildPlan(candidate);
  }],
  ["artifact provenance", () => {
    const candidate = clone(artifactIndex) as Record<string, unknown>;
    const entries = candidate.entries as Record<string, unknown>[];
    const entry = entries[0];
    assert.ok(entry !== undefined);
    entry.provenance = hostileStringValue;
    return isArtifactIndex(candidate);
  }],
  ["journal state", () => isWorkspaceJournal({
    ...(clone(workspaceJournal) as object),
    state: hostileStringValue,
  })],
  ["log operation", () => isLogEvent({
    contract: LOG_EVENT_CONTRACT,
    sequence: 0,
    level: "info",
    code: "OPERATION_STARTED",
    operation: hostileStringValue,
  })],
  ["apply result status", () => isApplyPlanResult({
    ...applyPlanSuccess,
    status: hostileStringValue,
  })],
];
for (const [label, predicate] of hostileCases) {
  let result: boolean | undefined;
  assert.doesNotThrow(() => {
    result = predicate();
  }, label);
  assert.equal(result, false, label);
}

for (const invalidPath of [
  "/absolute",
  "../escape",
  "a//b",
  ".mcdev/state.json",
  ".MCDEV/state.json",
  "C:/drive",
  "a\\b",
  "nul",
  "a/COM1.txt",
  "a/trailing.",
]) {
  assert.equal(isPortableRelativePath(invalidPath), false, invalidPath);
}
assert.equal(isPortableRelativePath("src/main/java/Generated.java"), true);
assert.equal(isPortableRelativePath("a".repeat(CONTRACT_LIMITS.relativePathBytes)), true);
assert.equal(isPortableRelativePath("a".repeat(CONTRACT_LIMITS.relativePathBytes + 1)), false);

assert.equal(CONTRACT_LIMITS.buildPlanNodes, 128);
assert.equal(CONTRACT_LIMITS.buildPlanEdges, 512);
assert.equal(CONTRACT_LIMITS.generatedFiles, 2_048);
assert.equal(CONTRACT_LIMITS.inlineSpecBytes, 262_144);
assert.equal(CONTRACT_LIMITS.relativePathBytes, 240);
