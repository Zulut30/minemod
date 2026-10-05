import {
  CONTRACT_LIMITS, hasExactKeys, hasPortableCaseCollision, isBoundedJsonBytes,
  isDenseJsonArray, isPlainJsonObject, isPortableRelativePath, isPositiveSafeInteger,
  isSha256, isStrictlySortedUnique, type Sha256,
} from "./common.ts";
import { isCompatibilityPackRef, type CompatibilityPackRef } from "./pack.ts";
import { isMcdevError, type McdevError } from "./errors.ts";

export const OPERATION_EVIDENCE_CONTRACT = "mcdev.operation-evidence/v1" as const;
export const EVIDENCE_INPUT_BYTES = 8_388_608;
export const EVIDENCE_COMMANDS = Object.freeze([
  "asset-item-export", "asset-bundle-export", "asset-bundle-verify", "fabric-build",
] as const);
export type EvidenceCommand = typeof EVIDENCE_COMMANDS[number];
export type EvidenceRevision =
  | { readonly kind: "input"; readonly sha256: Sha256 | null }
  | { readonly kind: "plan"; readonly planId: Sha256 }
  | { readonly kind: "editor"; readonly projectId: string; readonly revision: number };
export interface EvidenceArtifact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}
export interface OperationEvidence {
  readonly contract: typeof OPERATION_EVIDENCE_CONTRACT;
  readonly input: { readonly bytes: number | null; readonly sha256: Sha256 | null };
  readonly revision: EvidenceRevision;
  readonly pack: CompatibilityPackRef | null;
  readonly command: EvidenceCommand;
  readonly technical: {
    readonly status: "pass" | "fail";
    readonly scope: "asset-export-integrity" | "asset-bundle-integrity" | "fabric-clean-build";
    readonly error: McdevError | null;
  };
  // Этот автоматический producer не имеет полномочий human/game approval.
  readonly artistic: { readonly status: "requires-human-review" };
  readonly game: { readonly status: "not-run" };
  readonly artifacts: readonly EvidenceArtifact[];
}

function isRevision(value: unknown): value is EvidenceRevision {
  if (!isPlainJsonObject(value)) return false;
  if (value.kind === "input") return hasExactKeys(value, ["kind", "sha256"]) &&
    (value.sha256 === null || isSha256(value.sha256));
  if (value.kind === "plan") return hasExactKeys(value, ["kind", "planId"]) && isSha256(value.planId);
  return value.kind === "editor" && hasExactKeys(value, ["kind", "projectId", "revision"]) &&
    typeof value.projectId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.projectId) &&
    Number.isSafeInteger(value.revision) && (value.revision as number) >= 0;
}
function isArtifact(value: unknown): value is EvidenceArtifact {
  return isPlainJsonObject(value) && hasExactKeys(value, ["path", "bytes", "sha256"]) &&
    isPortableRelativePath(value.path) && isPositiveSafeInteger(value.bytes) &&
    value.bytes > 0 && value.bytes <= CONTRACT_LIMITS.generatedFileBytes && isSha256(value.sha256);
}
/** Валидирует transport shape и границы, не удостоверяет автора или истинность PASS. */
export function isOperationEvidence(value: unknown): value is OperationEvidence {
  if (!isPlainJsonObject(value) || !hasExactKeys(value, ["contract", "input", "revision", "pack", "command", "technical", "artistic", "game", "artifacts"]) ||
      value.contract !== OPERATION_EVIDENCE_CONTRACT ||
      !(EVIDENCE_COMMANDS as readonly unknown[]).includes(value.command) || !isRevision(value.revision) ||
      !(value.pack === null || isCompatibilityPackRef(value.pack))) return false;
  const { input, technical, artistic, game, artifacts } = value;
  if (!isPlainJsonObject(input) || !hasExactKeys(input, ["bytes", "sha256"]) ||
      !(input.bytes === null || (Number.isSafeInteger(input.bytes) && (input.bytes as number) >= 0)) ||
      !(input.sha256 === null || isSha256(input.sha256)) ||
      !isPlainJsonObject(technical) || !hasExactKeys(technical, ["status", "scope", "error"]) ||
      !["pass", "fail"].includes(technical.status as string) ||
      technical.scope !== (value.command === "fabric-build" ? "fabric-clean-build" :
        value.command === "asset-bundle-verify" ? "asset-bundle-integrity" : "asset-export-integrity") ||
      !(technical.status === "pass" ? technical.error === null : isMcdevError(technical.error)) ||
      !isPlainJsonObject(artistic) || !hasExactKeys(artistic, ["status"]) || artistic.status !== "requires-human-review" ||
      !isPlainJsonObject(game) || !hasExactKeys(game, ["status"]) || game.status !== "not-run" ||
      !isDenseJsonArray(artifacts) || artifacts.length > CONTRACT_LIMITS.generatedFiles || !artifacts.every(isArtifact)) return false;
  if (technical.status === "pass" && (input.sha256 === null || typeof input.bytes !== "number" || input.bytes > EVIDENCE_INPUT_BYTES || artifacts.length === 0)) return false;
  if (input.sha256 !== null && (typeof input.bytes !== "number" || input.bytes > EVIDENCE_INPUT_BYTES)) return false;
  if (value.revision.kind === "input" && value.revision.sha256 !== input.sha256) return false;
  if (value.command === "fabric-build") {
    if (technical.status === "pass" && (value.pack === null || value.revision.kind !== "plan")) return false;
    if (value.pack === null ? value.revision.kind !== "input" : value.revision.kind !== "plan") return false;
  } else if (value.pack !== null || value.revision.kind === "plan") return false;
  return (technical.status === "pass" || artifacts.length === 0) &&
    artifacts.reduce((total, file) => total + file.bytes, 0) <= CONTRACT_LIMITS.generatedTotalBytes &&
    isStrictlySortedUnique(artifacts.map(file => file.path)) && !hasPortableCaseCollision(artifacts.map(file => file.path)) &&
    isBoundedJsonBytes(value, CONTRACT_LIMITS.buildPlanBytes);
}
