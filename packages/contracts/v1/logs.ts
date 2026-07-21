import { hasExactKeys, isPlainJsonObject, isPositiveSafeInteger } from "./common.ts";
import { isDomainErrorCode, type DomainErrorCode } from "./errors.ts";

export const LOG_EVENT_CONTRACT = "mcdev.log-event/v1" as const;
export const LOG_EVENT_CODES = Object.freeze([
  "NODE_COMPLETED",
  "OPERATION_COMPLETED",
  "OPERATION_FAILED",
  "OPERATION_STARTED",
  "PLACEHOLDER_ASSETS_USED",
] as const);
export type LogEventCode = typeof LOG_EVENT_CODES[number];

interface LogEventBase {
  readonly contract: typeof LOG_EVENT_CONTRACT;
  readonly sequence: number;
  readonly level: "info" | "warning" | "error";
  readonly code: LogEventCode;
}

export interface OperationStartedLogEvent extends LogEventBase {
  readonly code: "OPERATION_STARTED";
  readonly level: "info";
  readonly operation: "plan-build" | "apply-plan" | "gradle-clean-build";
}

export interface NodeCompletedLogEvent extends LogEventBase {
  readonly code: "NODE_COMPLETED";
  readonly level: "info";
  readonly nodeId: string;
}

export interface PlaceholderAssetsLogEvent extends LogEventBase {
  readonly code: "PLACEHOLDER_ASSETS_USED";
  readonly level: "warning";
}

export interface OperationCompletedLogEvent extends LogEventBase {
  readonly code: "OPERATION_COMPLETED";
  readonly level: "info";
  readonly operation: "plan-build" | "apply-plan" | "gradle-clean-build";
}

export interface OperationFailedLogEvent extends LogEventBase {
  readonly code: "OPERATION_FAILED";
  readonly level: "error";
  readonly errorCode: DomainErrorCode;
}

export type LogEvent = OperationStartedLogEvent | NodeCompletedLogEvent | PlaceholderAssetsLogEvent |
  OperationCompletedLogEvent | OperationFailedLogEvent;

export function isLogEvent(value: unknown): value is LogEvent {
  if (!isPlainJsonObject(value) || value.contract !== LOG_EVENT_CONTRACT ||
    !isPositiveSafeInteger(value.sequence) || typeof value.code !== "string" ||
    !(LOG_EVENT_CODES as readonly string[]).includes(value.code)) return false;
  switch (value.code) {
    case "OPERATION_STARTED":
    case "OPERATION_COMPLETED":
      return hasExactKeys(value, ["contract", "sequence", "level", "code", "operation"]) &&
        value.level === "info" && typeof value.operation === "string" &&
        ["plan-build", "apply-plan", "gradle-clean-build"].includes(value.operation);
    case "NODE_COMPLETED":
      return hasExactKeys(value, ["contract", "sequence", "level", "code", "nodeId"]) &&
        value.level === "info" && typeof value.nodeId === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(value.nodeId);
    case "PLACEHOLDER_ASSETS_USED":
      return hasExactKeys(value, ["contract", "sequence", "level", "code"]) && value.level === "warning";
    case "OPERATION_FAILED":
      return hasExactKeys(value, ["contract", "sequence", "level", "code", "errorCode"]) &&
        value.level === "error" && isDomainErrorCode(value.errorCode);
    default:
      return false;
  }
}
