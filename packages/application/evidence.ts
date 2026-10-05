import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { isProxy } from "node:util/types";
import {
  EVIDENCE_INPUT_BYTES, OPERATION_EVIDENCE_CONTRACT, isArtifactIndex, isDomainErrorCode,
  isOperationEvidence, mcdevError, type ArtifactIndex, type EvidenceCommand,
  type CompatibilityPackRef, type DomainErrorCode, type EvidenceRevision, type OperationEvidence,
} from "@mcdev/contracts";
import { compileItemAssetPayload, itemAssetDiagnostic } from "./item-assets.ts";
import { compileItemAssetBundleV1, verifyAssetBundlePayloadV1 } from "./asset-bundles.ts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function base(payload: string, command: EvidenceCommand, revision?: EvidenceRevision) {
  const bytes = typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : null;
  const sha256 = bytes !== null && bytes <= EVIDENCE_INPUT_BYTES ? digest(payload) : null;
  return { contract: OPERATION_EVIDENCE_CONTRACT, input: { bytes, sha256 },
    revision: revision ? { ...revision } : { kind: "input" as const, sha256 }, command,
    artistic: { status: "requires-human-review" as const }, game: { status: "not-run" as const } };
}
function finish(value: OperationEvidence): OperationEvidence {
  if (!isOperationEvidence(value)) throw new TypeError("Invalid bounded operation evidence.");
  return freeze(value);
}
function errorCode(error: unknown): DomainErrorCode {
  const code = typeof error === "object" && error !== null && !isProxy(error)
    ? Object.getOwnPropertyDescriptor(error, "code") : undefined;
  return code && "value" in code && isDomainErrorCode(code.value) ? code.value : "INTERNAL_ERROR";
}
function failure(payload: string, command: EvidenceCommand, error: unknown, revision?: EvidenceRevision, pack: CompatibilityPackRef | null = null): OperationEvidence {
  return finish({ ...base(payload, command, revision), pack: pack ? { ...pack } : null,
    technical: { status: "fail", scope: command === "fabric-build" ? "fabric-clean-build" :
      command === "asset-bundle-verify" ? "asset-bundle-integrity" : "asset-export-integrity",
      error: mcdevError(errorCode(error), "Operation failed; no artistic or game acceptance was performed.") }, artifacts: [] });
}
/** Bound к одному фактическому request/plan; original exception остаётся только во внутреннем cause. */
export class FabricBuildOperationError extends Error {
  readonly code: DomainErrorCode;
  readonly evidence: OperationEvidence;
  constructor(payload: string, cause: unknown, plan?: { readonly planId: string; readonly pack: CompatibilityPackRef }) {
    super("Fabric build failed safely.", { cause });
    this.name = "FabricBuildOperationError";
    this.code = errorCode(cause);
    this.evidence = failure(payload, "fabric-build", cause,
      plan ? { kind: "plan", planId: plan.planId } : undefined, plan?.pack ?? null);
  }
}
/** Не сохраняет stack, request content, workspace/Java paths или произвольные exception fields. */
export function operationFailureEvidence(payload: string, command: EvidenceCommand, error: unknown, revision?: EvidenceRevision): OperationEvidence {
  if (command === "fabric-build" && !isProxy(error) && error instanceof FabricBuildOperationError) {
    const input = base(payload, command).input;
    if (input.sha256 !== null && input.sha256 === error.evidence.input.sha256 && input.bytes === error.evidence.input.bytes) return error.evidence;
  }
  return failure(payload, command, error, revision);
}
export function fabricBuildEvidence(payload: string, artifacts: ArtifactIndex): OperationEvidence {
  if (!isArtifactIndex(artifacts) || !artifacts.entries.some(file => file.kind === "build-output" && file.provenance === "build" && file.path.endsWith(".jar") && file.size > 0))
    throw new TypeError("Verified artifact index with a build JAR required.");
  return finish({ ...base(payload, "fabric-build", { kind: "plan", planId: artifacts.planId }), pack: { ...artifacts.pack },
    technical: { status: "pass", scope: "fabric-clean-build", error: null },
    artifacts: artifacts.entries.map(file => ({ path: file.path, bytes: file.size, sha256: file.sha256 })) });
}
/** Выполняет существующий bounded exporter/verifier; отчёт добавляется рядом с неизменённым bundle. */
export function assetOperationWithEvidence(payload: string, command: Exclude<EvidenceCommand, "fabric-build">, revision?: EvidenceRevision) {
  try {
    const bundle = command === "asset-bundle-export" ? compileItemAssetBundleV1(payload) :
      command === "asset-bundle-verify" ? verifyAssetBundlePayloadV1(payload) : compileItemAssetPayload(payload);
    const descriptors = "manifest" in bundle ? bundle.manifest.files : bundle.files.map(file => ({
      path: file.path, bytes: Buffer.byteLength(file.content, file.encoding), sha256: file.sha256,
    }));
    const evidence = finish({ ...base(payload, command, revision), pack: null,
      technical: { status: "pass", scope: command === "asset-bundle-verify" ? "asset-bundle-integrity" : "asset-export-integrity", error: null },
      artifacts: descriptors.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
    return freeze({ ok: true as const, bundle, evidence });
  } catch (error) {
    return freeze({ ok: false as const, error: itemAssetDiagnostic(error), evidence: operationFailureEvidence(payload, command, error, revision) });
  }
}
