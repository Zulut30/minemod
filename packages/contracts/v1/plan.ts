import {
  CONTRACT_LIMITS,
  containsForbiddenExecutionSurface,
  hasPortableCaseCollision,
  hasExactKeys,
  isBoundedJsonBytes,
  isDenseJsonArray,
  isFileMode,
  isPlainJsonObject,
  isPortableRelativePath,
  isPositiveSafeInteger,
  isSha256,
  isStrictlySortedUnique,
  type FileMode,
  type PortableRelativePath,
  type Sha256,
} from "./common.ts";
import { isCompatibilityPackRef, type CompatibilityPackRef } from "./pack.ts";

export const BUILD_PLAN_CONTRACT = "mcdev.build-plan/v1" as const;
export const BUILD_PLAN_WARNINGS = Object.freeze(["PLACEHOLDER_ASSETS_USED"] as const);
export type BuildPlanWarning = typeof BUILD_PLAN_WARNINGS[number];

export interface PlannedOutput {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly size: number;
  readonly sha256: Sha256;
}

interface BuildPlanNodeBase {
  readonly nodeId: string;
  readonly dependsOn: readonly string[];
  readonly inputDigest: Sha256;
  readonly cacheKey: Sha256;
  readonly outputs: readonly PlannedOutput[];
  readonly retryPolicy: "never";
  readonly logPolicy: "structured-redacted-v1";
}

export interface GenerateProjectNode extends BuildPlanNodeBase {
  readonly kind: "generate-project";
  readonly validatorPolicy: "sha256-outputs-v1";
  readonly provenance: "compiler-and-pack";
}

export interface GenerateContentNode extends BuildPlanNodeBase {
  readonly kind: "generate-content";
  readonly validatorPolicy: "sha256-outputs-v1";
  readonly provenance: "compiler";
}

export interface ApplyWorkspaceNode extends BuildPlanNodeBase {
  readonly kind: "apply-workspace";
  readonly policy: "create-only-cas-wal-v1";
  readonly validatorPolicy: "workspace-manifest-v1";
  readonly provenance: "workspace-transaction";
}

export interface GradleCleanBuildNode extends BuildPlanNodeBase {
  readonly kind: "gradle-clean-build";
  readonly policy: "fabric-1.20.1-phase0-v1" | "fabric-1.20.1-phase1-v1" | "neoforge-phase1-v1";
  readonly validatorPolicy: "sha256-outputs-v1";
  readonly provenance: "fixed-build-runner";
}

export interface IndexArtifactsNode extends BuildPlanNodeBase {
  readonly kind: "index-artifacts";
  readonly policy: "sha256-v1";
  readonly validatorPolicy: "artifact-index-v1";
  readonly provenance: "artifact-indexer";
}

export type BuildPlanNode = GenerateProjectNode | GenerateContentNode | ApplyWorkspaceNode |
  GradleCleanBuildNode | IndexArtifactsNode;

export interface BuildPlan {
  readonly contract: typeof BUILD_PLAN_CONTRACT;
  readonly planId: Sha256;
  readonly specDigest: Sha256;
  readonly pack: CompatibilityPackRef;
  readonly nodes: readonly BuildPlanNode[];
  readonly warnings: readonly BuildPlanWarning[];
}

function isPlannedOutput(value: unknown): value is PlannedOutput {
  return isPlainJsonObject(value) && hasExactKeys(value, ["path", "mode", "size", "sha256"]) &&
    isPortableRelativePath(value.path) && isFileMode(value.mode) &&
    isPositiveSafeInteger(value.size) && value.size <= CONTRACT_LIMITS.generatedFileBytes && isSha256(value.sha256);
}

function isBuildPlanNode(value: unknown): value is BuildPlanNode {
  if (!isPlainJsonObject(value) || typeof value.kind !== "string") return false;
  const withPolicy = ["apply-workspace", "gradle-clean-build", "index-artifacts"].includes(value.kind);
  if (!hasExactKeys(
    value,
    withPolicy
      ? [
        "nodeId",
        "kind",
        "dependsOn",
        "inputDigest",
        "cacheKey",
        "outputs",
        "retryPolicy",
        "logPolicy",
        "validatorPolicy",
        "provenance",
        "policy",
      ]
      : [
        "nodeId",
        "kind",
        "dependsOn",
        "inputDigest",
        "cacheKey",
        "outputs",
        "retryPolicy",
        "logPolicy",
        "validatorPolicy",
        "provenance",
      ],
  )) return false;
  if (typeof value.nodeId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.nodeId) ||
    !isDenseJsonArray(value.dependsOn) || value.dependsOn.length > CONTRACT_LIMITS.buildPlanEdges ||
    !value.dependsOn.every((entry) => typeof entry === "string") ||
    !isStrictlySortedUnique(value.dependsOn) || !isSha256(value.inputDigest) || !isSha256(value.cacheKey) ||
    !isDenseJsonArray(value.outputs) || value.outputs.length > CONTRACT_LIMITS.generatedFiles ||
    !value.outputs.every(isPlannedOutput) ||
    !isStrictlySortedUnique(value.outputs.map((output) => output.path)) || value.retryPolicy !== "never" ||
    value.logPolicy !== "structured-redacted-v1") {
    return false;
  }
  switch (value.kind) {
    case "generate-project":
      return value.validatorPolicy === "sha256-outputs-v1" && value.provenance === "compiler-and-pack";
    case "generate-content":
      return value.validatorPolicy === "sha256-outputs-v1" && value.provenance === "compiler";
    case "apply-workspace":
      return value.policy === "create-only-cas-wal-v1" &&
        value.validatorPolicy === "workspace-manifest-v1" && value.provenance === "workspace-transaction";
    case "gradle-clean-build":
      return (value.policy === "fabric-1.20.1-phase0-v1" || value.policy === "fabric-1.20.1-phase1-v1" ||
        value.policy === "neoforge-phase1-v1") &&
        value.validatorPolicy === "sha256-outputs-v1" && value.provenance === "fixed-build-runner";
    case "index-artifacts":
      return value.policy === "sha256-v1" &&
        value.validatorPolicy === "artifact-index-v1" && value.provenance === "artifact-indexer";
    default:
      return false;
  }
}

function isAcyclic(nodes: readonly BuildPlanNode[]): boolean {
  const dependencies = new Map(nodes.map((node) => [node.nodeId, node.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return false;
    if (visited.has(nodeId)) return true;
    const dependsOn = dependencies.get(nodeId);
    if (dependsOn === undefined) return false;
    visiting.add(nodeId);
    for (const dependency of dependsOn) {
      if (!dependencies.has(dependency) || !visit(dependency)) return false;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };
  return nodes.every((node) => visit(node.nodeId));
}

function isBuildPlanWarningList(value: unknown): value is BuildPlanWarning[] {
  return isDenseJsonArray(value) && value.every((warning): warning is BuildPlanWarning =>
    typeof warning === "string" && (BUILD_PLAN_WARNINGS as readonly string[]).includes(warning));
}

export function isBuildPlan(value: unknown): value is BuildPlan {
  if (!isPlainJsonObject(value) || hasExactKeys(value, ["contract", "planId", "specDigest", "pack", "nodes", "warnings"]) === false ||
    value.contract !== BUILD_PLAN_CONTRACT || !isSha256(value.planId) || !isSha256(value.specDigest) ||
    !isCompatibilityPackRef(value.pack) || !isDenseJsonArray(value.nodes) || value.nodes.length === 0 ||
    value.nodes.length > CONTRACT_LIMITS.buildPlanNodes || !value.nodes.every(isBuildPlanNode) ||
    !isBuildPlanWarningList(value.warnings) || !isStrictlySortedUnique(value.warnings) ||
    !isBoundedJsonBytes(value, CONTRACT_LIMITS.buildPlanBytes) || containsForbiddenExecutionSurface(value)) {
    return false;
  }
  const nodeIds = value.nodes.map((node) => node.nodeId);
  const edgeCount = value.nodes.reduce((total, node) => total + node.dependsOn.length, 0);
  const outputPaths = value.nodes.flatMap((node) => node.outputs.map((output) => output.path));
  return isStrictlySortedUnique(nodeIds) && edgeCount <= CONTRACT_LIMITS.buildPlanEdges &&
    outputPaths.length <= CONTRACT_LIMITS.generatedFiles && new Set(outputPaths).size === outputPaths.length &&
    !hasPortableCaseCollision(outputPaths) &&
    value.nodes.reduce(
      (total, node) => total + node.outputs.reduce((nodeTotal, output) => nodeTotal + output.size, 0),
      0,
    ) <= CONTRACT_LIMITS.generatedTotalBytes && isAcyclic(value.nodes);
}
