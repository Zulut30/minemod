import { isArtifactIndex, type ArtifactIndex } from "./artifacts.ts";
import {
  CONTRACT_LIMITS,
  containsControlCharacters,
  hasExactKeys,
  isDenseJsonArray,
  isPlainJsonObject,
  isSha256,
  type Sha256,
} from "./common.ts";
import { isMcdevError, type McdevError } from "./errors.ts";
import { isBuildPlan, type BuildPlan } from "./plan.ts";
import { isWorkspaceManifest, type WorkspaceManifest } from "./workspace.ts";

export const PLAN_BUILD_REQUEST_CONTRACT = "mcdev.plan-build-request/v1" as const;
export const PLAN_BUILD_RESULT_CONTRACT = "mcdev.plan-build-result/v1" as const;
export const APPLY_PLAN_REQUEST_CONTRACT = "mcdev.apply-plan-request/v1" as const;
export const APPLY_PLAN_RESULT_CONTRACT = "mcdev.apply-plan-result/v1" as const;

export interface PlanBuildRequest {
  readonly contract: typeof PLAN_BUILD_REQUEST_CONTRACT;
  readonly kind: "mod";
  readonly payload: string;
}

export type PlanBuildResult = {
  readonly contract: typeof PLAN_BUILD_RESULT_CONTRACT;
  readonly ok: true;
  readonly plan: BuildPlan;
} | {
  readonly contract: typeof PLAN_BUILD_RESULT_CONTRACT;
  readonly ok: false;
  readonly errors: readonly McdevError[];
};

export interface ApplyPlanRequest {
  readonly contract: typeof APPLY_PLAN_REQUEST_CONTRACT;
  readonly workspaceRoot: string;
  readonly planId: Sha256;
  readonly kind: "mod";
  readonly payload: string;
}

export type ApplyPlanResult = {
  readonly contract: typeof APPLY_PLAN_RESULT_CONTRACT;
  readonly ok: true;
  readonly status: "created" | "noop";
  readonly manifest: WorkspaceManifest;
  readonly artifacts: ArtifactIndex;
} | {
  readonly contract: typeof APPLY_PLAN_RESULT_CONTRACT;
  readonly ok: false;
  readonly errors: readonly McdevError[];
};

function isBoundedPayload(value: unknown): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= CONTRACT_LIMITS.inlineSpecBytes;
}

function isErrorList(value: unknown): value is readonly McdevError[] {
  return isDenseJsonArray(value) && value.length >= 1 && value.length <= 100 && value.every(isMcdevError);
}

function hasSamePackRef(manifest: WorkspaceManifest, artifacts: ArtifactIndex): boolean {
  return manifest.pack.packId === artifacts.pack.packId &&
    manifest.pack.revision === artifacts.pack.revision &&
    manifest.pack.treeSha256 === artifacts.pack.treeSha256;
}

export function isPlanBuildRequest(value: unknown): value is PlanBuildRequest {
  return isPlainJsonObject(value) && hasExactKeys(value, ["contract", "kind", "payload"]) &&
    value.contract === PLAN_BUILD_REQUEST_CONTRACT && value.kind === "mod" && isBoundedPayload(value.payload);
}

export function isPlanBuildResult(value: unknown): value is PlanBuildResult {
  if (!isPlainJsonObject(value) || value.contract !== PLAN_BUILD_RESULT_CONTRACT || typeof value.ok !== "boolean") {
    return false;
  }
  return value.ok
    ? hasExactKeys(value, ["contract", "ok", "plan"]) && isBuildPlan(value.plan)
    : hasExactKeys(value, ["contract", "ok", "errors"]) && isErrorList(value.errors);
}

export function isApplyPlanRequest(value: unknown): value is ApplyPlanRequest {
  return isPlainJsonObject(value) &&
    hasExactKeys(value, ["contract", "workspaceRoot", "planId", "kind", "payload"]) &&
    value.contract === APPLY_PLAN_REQUEST_CONTRACT && typeof value.workspaceRoot === "string" &&
    value.workspaceRoot.length >= 1 && value.workspaceRoot.length <= 4_096 &&
    !containsControlCharacters(value.workspaceRoot) &&
    isSha256(value.planId) && value.kind === "mod" && isBoundedPayload(value.payload);
}

export function isApplyPlanResult(value: unknown): value is ApplyPlanResult {
  if (!isPlainJsonObject(value) || value.contract !== APPLY_PLAN_RESULT_CONTRACT || typeof value.ok !== "boolean") {
    return false;
  }
  return value.ok
    ? hasExactKeys(value, ["contract", "ok", "status", "manifest", "artifacts"]) &&
      typeof value.status === "string" && ["created", "noop"].includes(value.status) &&
      isWorkspaceManifest(value.manifest) &&
      isArtifactIndex(value.artifacts) && value.manifest.planId === value.artifacts.planId &&
      hasSamePackRef(value.manifest, value.artifacts)
    : hasExactKeys(value, ["contract", "ok", "errors"]) && isErrorList(value.errors);
}
