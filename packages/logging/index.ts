import { isProxy } from "node:util/types";
import {
  CONTRACT_LIMITS,
  LOG_EVENT_CONTRACT,
  isDomainErrorCode,
  isLogEvent,
  isPlainJsonObject,
  type DomainErrorCode,
  type LogEvent,
} from "@mcdev/contracts";

export type LoggedOperation = "plan-build" | "apply-plan" | "gradle-clean-build";
export type LogLineSink = (line: string) => void;

export interface StructuredLogger {
  readonly operationStarted: (operation: LoggedOperation) => void;
  readonly nodeCompleted: (nodeId: string) => void;
  readonly placeholderAssetsUsed: () => void;
  readonly operationCompleted: (operation: LoggedOperation) => void;
  readonly operationFailed: (errorCode: DomainErrorCode) => void;
}

export class StructuredLogError extends Error {
  readonly code = "INVALID_REQUEST" as const;

  constructor(message: string) {
    super(message);
    this.name = "StructuredLogError";
  }
}

function normalizedEvent(event: LogEvent): LogEvent {
  switch (event.code) {
    case "OPERATION_STARTED":
      return {
        contract: LOG_EVENT_CONTRACT,
        sequence: event.sequence,
        level: "info",
        code: "OPERATION_STARTED",
        operation: event.operation,
      };
    case "NODE_COMPLETED":
      return {
        contract: LOG_EVENT_CONTRACT,
        sequence: event.sequence,
        level: "info",
        code: "NODE_COMPLETED",
        nodeId: event.nodeId,
      };
    case "PLACEHOLDER_ASSETS_USED":
      return {
        contract: LOG_EVENT_CONTRACT,
        sequence: event.sequence,
        level: "warning",
        code: "PLACEHOLDER_ASSETS_USED",
      };
    case "OPERATION_COMPLETED":
      return {
        contract: LOG_EVENT_CONTRACT,
        sequence: event.sequence,
        level: "info",
        code: "OPERATION_COMPLETED",
        operation: event.operation,
      };
    case "OPERATION_FAILED":
      return {
        contract: LOG_EVENT_CONTRACT,
        sequence: event.sequence,
        level: "error",
        code: "OPERATION_FAILED",
        errorCode: event.errorCode,
      };
  }
}

function readLogEvent(value: unknown): LogEvent | undefined {
  if (isProxy(value) || !isPlainJsonObject(value)) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return undefined;
  if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !("value" in descriptor))) {
    return undefined;
  }
  const codeDescriptor = descriptors.code;
  if (codeDescriptor === undefined || !("value" in codeDescriptor) || typeof codeDescriptor.value !== "string") {
    return undefined;
  }
  const common = ["contract", "sequence", "level", "code"];
  const expectedKeys = codeDescriptor.value === "OPERATION_STARTED" || codeDescriptor.value === "OPERATION_COMPLETED"
    ? [...common, "operation"]
    : codeDescriptor.value === "NODE_COMPLETED"
      ? [...common, "nodeId"]
      : codeDescriptor.value === "OPERATION_FAILED"
        ? [...common, "errorCode"]
        : codeDescriptor.value === "PLACEHOLDER_ASSETS_USED"
          ? common
          : undefined;
  if (expectedKeys === undefined) return undefined;
  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])) return undefined;
  const field = (key: string): unknown => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  };
  const candidate = codeDescriptor.value === "OPERATION_STARTED" || codeDescriptor.value === "OPERATION_COMPLETED"
    ? {
      contract: field("contract"), sequence: field("sequence"), level: field("level"),
      code: codeDescriptor.value, operation: field("operation"),
    }
    : codeDescriptor.value === "NODE_COMPLETED"
      ? {
        contract: field("contract"), sequence: field("sequence"), level: field("level"),
        code: codeDescriptor.value, nodeId: field("nodeId"),
      }
      : codeDescriptor.value === "OPERATION_FAILED"
        ? {
          contract: field("contract"), sequence: field("sequence"), level: field("level"),
          code: codeDescriptor.value, errorCode: field("errorCode"),
        }
        : {
          contract: field("contract"), sequence: field("sequence"), level: field("level"),
          code: codeDescriptor.value,
        };
  return isLogEvent(candidate) ? candidate : undefined;
}

export function serializeLogEvent(event: unknown): string {
  const parsed = readLogEvent(event);
  if (parsed === undefined) throw new StructuredLogError("Structured log event violates the closed v1 contract.");
  const line = `${JSON.stringify(normalizedEvent(parsed))}\n`;
  if (Buffer.byteLength(line, "utf8") > CONTRACT_LIMITS.logOrJournalRecordBytes) {
    throw new StructuredLogError("Structured log event exceeds the v1 byte limit.");
  }
  return line;
}

export function createStructuredLogger(sink: LogLineSink): StructuredLogger {
  if (typeof sink !== "function") throw new StructuredLogError("Structured log sink must be a function.");
  let sequence = 0;
  const emit = (event: LogEvent): void => {
    if (!Number.isSafeInteger(sequence)) throw new StructuredLogError("Structured log sequence is exhausted.");
    const line = serializeLogEvent(event);
    sequence += 1;
    sink(line);
  };
  return Object.freeze({
    operationStarted(operation: LoggedOperation): void {
      emit({ contract: LOG_EVENT_CONTRACT, sequence, level: "info", code: "OPERATION_STARTED", operation });
    },
    nodeCompleted(nodeId: string): void {
      emit({ contract: LOG_EVENT_CONTRACT, sequence, level: "info", code: "NODE_COMPLETED", nodeId });
    },
    placeholderAssetsUsed(): void {
      emit({ contract: LOG_EVENT_CONTRACT, sequence, level: "warning", code: "PLACEHOLDER_ASSETS_USED" });
    },
    operationCompleted(operation: LoggedOperation): void {
      emit({ contract: LOG_EVENT_CONTRACT, sequence, level: "info", code: "OPERATION_COMPLETED", operation });
    },
    operationFailed(errorCode: DomainErrorCode): void {
      if (!isDomainErrorCode(errorCode)) throw new StructuredLogError("Structured log error code is unknown.");
      emit({ contract: LOG_EVENT_CONTRACT, sequence, level: "error", code: "OPERATION_FAILED", errorCode });
    },
  });
}
