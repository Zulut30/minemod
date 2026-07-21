import {
  ERROR_CONTRACT,
  isDomainErrorCode,
  mcdevError,
  type DomainErrorCode,
  type McdevError,
} from "@mcdev/contracts";
import { isProxy } from "node:util/types";

function boundedMessage(message: string): string {
  const normalized = message.length === 0 ? "NeoForge compilation failed." : message;
  return normalized.length <= 512 ? normalized : `${normalized.slice(0, 509)}...`;
}

export function boundedMcdevError(
  code: DomainErrorCode,
  message: string,
  path?: string,
): McdevError {
  const safePath = typeof path === "string" && path.length <= 240 ? path : undefined;
  return mcdevError(code, boundedMessage(message), safePath);
}

function copyError(value: unknown, expectedCode: DomainErrorCode): McdevError | undefined {
  if (isProxy(value) || typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return undefined;
  const hasPath = keys.includes("path");
  const expectedKeys = hasPath
    ? ["code", "contract", "message", "path"]
    : ["code", "contract", "message"];
  const sorted = (keys as string[]).sort();
  if (sorted.length !== expectedKeys.length || sorted.some((key, index) => key !== expectedKeys[index])) {
    return undefined;
  }
  const values: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    values[key] = descriptor.value;
  }
  if (values.contract !== ERROR_CONTRACT || values.code !== expectedCode ||
    typeof values.message !== "string" || values.message.length === 0 ||
    (hasPath && typeof values.path !== "string")) return undefined;
  return boundedMcdevError(expectedCode, values.message, hasPath ? values.path as string : undefined);
}

function copyErrors(code: unknown, errors: unknown): readonly McdevError[] {
  if (!isDomainErrorCode(code) || isProxy(errors) || !Array.isArray(errors) ||
    Object.getPrototypeOf(errors) !== Array.prototype) {
    return Object.freeze([mcdevError("INTERNAL_ERROR", "NeoForge compilation failed safely.")]);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(errors, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 1 || lengthDescriptor.value > 100 ||
    Reflect.ownKeys(errors).length !== lengthDescriptor.value + 1) {
    return Object.freeze([mcdevError("INTERNAL_ERROR", "NeoForge compilation failed safely.")]);
  }
  const copied: McdevError[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(errors, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return Object.freeze([mcdevError("INTERNAL_ERROR", "NeoForge compilation failed safely.")]);
    }
    const error = copyError(descriptor.value, code);
    if (error === undefined) {
      return Object.freeze([mcdevError("INTERNAL_ERROR", "NeoForge compilation failed safely.")]);
    }
    copied.push(error);
  }
  return Object.freeze(copied);
}

export class CompilerError extends Error {
  readonly code: DomainErrorCode;
  readonly errors: readonly McdevError[];

  constructor(code: DomainErrorCode, errors: readonly McdevError[]) {
    const copied = copyErrors(code, errors);
    super(copied[0]?.message ?? "NeoForge compilation failed safely.");
    this.name = "CompilerError";
    this.code = copied[0]?.code ?? "INTERNAL_ERROR";
    this.errors = copied;
    Object.freeze(this);
  }
}

export function compilerError(
  code: DomainErrorCode,
  message: string,
  path?: string,
): CompilerError {
  return new CompilerError(code, [boundedMcdevError(code, message, path)]);
}
