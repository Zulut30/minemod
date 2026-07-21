import { hasExactKeys, isPlainJsonObject, type JsonObject } from "./common.ts";

export const ERROR_CONTRACT = "mcdev.error/v1" as const;

export const DOMAIN_ERROR_CODES = Object.freeze([
  "ARTIFACT_INTEGRITY_FAILED",
  "BUILD_FAILED",
  "BUILD_OUTPUT_LIMIT",
  "BUILD_TIMEOUT",
  "CAS_INTEGRITY_FAILED",
  "INTERNAL_ERROR",
  "INVALID_REQUEST",
  "PACK_INTEGRITY_FAILED",
  "PACK_NOT_FOUND",
  "PLAN_ID_MISMATCH",
  "PLAN_INVALID",
  "SPEC_INVALID",
  "SPEC_UNSUPPORTED",
  "UNSUPPORTED_CONTRACT",
  "WORKSPACE_BUSY",
  "WORKSPACE_CONFLICT",
  "WORKSPACE_INVALID",
  "WORKSPACE_MANAGED_FILE_MODIFIED",
  "WORKSPACE_RECOVERY_REQUIRED",
] as const);

export type DomainErrorCode = typeof DOMAIN_ERROR_CODES[number];

export interface McdevError {
  readonly contract: typeof ERROR_CONTRACT;
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly path?: string;
}

export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return typeof value === "string" && (DOMAIN_ERROR_CODES as readonly string[]).includes(value);
}

export function isMcdevError(value: unknown): value is McdevError {
  if (!isPlainJsonObject(value)) return false;
  const hasPath = Object.hasOwn(value, "path");
  if (!hasExactKeys(value, hasPath ? ["contract", "code", "message", "path"] : ["contract", "code", "message"])) {
    return false;
  }
  return value.contract === ERROR_CONTRACT && isDomainErrorCode(value.code) &&
    typeof value.message === "string" && value.message.length >= 1 && value.message.length <= 512 &&
    (!hasPath || (typeof value.path === "string" && value.path.length <= 240));
}

export function mcdevError(code: DomainErrorCode, message: string, path?: string): McdevError {
  const candidate: JsonObject = {
    contract: ERROR_CONTRACT,
    code,
    message,
    ...(path === undefined ? {} : { path }),
  };
  if (!isMcdevError(candidate)) throw new TypeError("Invalid bounded mcdev error.");
  return Object.freeze(candidate) as unknown as McdevError;
}
