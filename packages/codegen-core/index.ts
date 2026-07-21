import { createHash } from "node:crypto";
import { isProxy, isSharedArrayBuffer, isUint8Array } from "node:util/types";
import {
  CONTRACT_LIMITS,
  isFileMode,
  isPlainJsonObject,
  isPortableRelativePath,
  type FileMode,
  type PortableRelativePath,
  type Sha256,
} from "@mcdev/contracts";

export type CanonicalJsonValue = null | boolean | number | string |
  readonly CanonicalJsonValue[] | { readonly [key: string]: CanonicalJsonValue };

export const CANONICAL_JSON_LIMITS = Object.freeze({
  maximumBytes: CONTRACT_LIMITS.buildPlanBytes,
  maximumDepth: 64,
  maximumNodes: 32_768,
} as const);

export const GENERATED_FILE_ORIGINS = Object.freeze(["compiler", "pack"] as const);
export type GeneratedFileOrigin = typeof GENERATED_FILE_ORIGINS[number];

export interface GeneratedFileInput {
  readonly path: string;
  readonly mode: FileMode;
  readonly bytes: Uint8Array;
  readonly origin: GeneratedFileOrigin;
}

export interface TextGeneratedFileInput {
  readonly path: string;
  readonly mode: FileMode;
  readonly text: string;
  readonly origin: GeneratedFileOrigin;
}

export interface GeneratedFile {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly bytes: Uint8Array;
  readonly sha256: Sha256;
  readonly origin: GeneratedFileOrigin;
}

const typedArrayIntrinsics = (() => {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
  const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
  if (byteLength === undefined || buffer === undefined) {
    throw new Error("The Uint8Array intrinsics are unavailable.");
  }
  return Object.freeze({ byteLength, buffer });
})();

function safeByteLength(value: Uint8Array): number {
  return Reflect.apply(typedArrayIntrinsics.byteLength, value, []) as number;
}

function hasSharedBackingStore(value: Uint8Array): boolean {
  const buffer = Reflect.apply(typedArrayIntrinsics.buffer, value, []) as ArrayBufferLike;
  return isSharedArrayBuffer(buffer);
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function invalidJson(message: string): never {
  throw new TypeError(`Canonical JSON accepts finite JSON data only: ${message}`);
}

interface CanonicalBudget {
  bytes: number;
  nodes: number;
}

function accountBytes(budget: CanonicalBudget, value: string | number): void {
  budget.bytes += typeof value === "number" ? value : Buffer.byteLength(value, "utf8");
  if (budget.bytes > CANONICAL_JSON_LIMITS.maximumBytes) {
    invalidJson(`byte limit is ${CANONICAL_JSON_LIMITS.maximumBytes}.`);
  }
}

function enterNode(budget: CanonicalBudget, depth: number): void {
  budget.nodes += 1;
  if (budget.nodes > CANONICAL_JSON_LIMITS.maximumNodes) {
    invalidJson(`node limit is ${CANONICAL_JSON_LIMITS.maximumNodes}.`);
  }
  if (depth > CANONICAL_JSON_LIMITS.maximumDepth) {
    invalidJson(`depth limit is ${CANONICAL_JSON_LIMITS.maximumDepth}.`);
  }
}

function canonicalNumber(value: number, budget: CanonicalBudget): string {
  if (!Number.isFinite(value)) return invalidJson("numbers must be finite.");
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return invalidJson("number serialization failed.");
  accountBytes(budget, serialized);
  return serialized;
}

function serializedJsonString(value: string, budget: CanonicalBudget): string {
  const remaining = CANONICAL_JSON_LIMITS.maximumBytes - budget.bytes;
  if (value.length + 2 > remaining) invalidJson(`byte limit is ${CANONICAL_JSON_LIMITS.maximumBytes}.`);
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a ||
      code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) {
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 6;
        }
      } else {
        bytes += 6;
      }
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > remaining) invalidJson(`byte limit is ${CANONICAL_JSON_LIMITS.maximumBytes}.`);
  }
  accountBytes(budget, bytes);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return invalidJson("string serialization failed.");
  return serialized;
}

function readDenseDataArray(value: unknown, maximumLength: number): readonly unknown[] | undefined {
  if (isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 || lengthDescriptor.value > maximumLength) return undefined;
  const length = lengthDescriptor.value;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string") || ownKeys.length !== length + 1) return undefined;
  const normalized: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    normalized.push(descriptor.value);
  }
  return normalized;
}

function canonicalValue(
  value: unknown,
  active: WeakSet<object>,
  budget: CanonicalBudget,
  depth: number,
): string {
  enterNode(budget, depth);
  if (value === null) {
    accountBytes(budget, 4);
    return "null";
  }
  switch (typeof value) {
    case "boolean": {
      const serialized = value ? "true" : "false";
      accountBytes(budget, serialized.length);
      return serialized;
    }
    case "number":
      return canonicalNumber(value, budget);
    case "string":
      return serializedJsonString(value, budget);
    case "object":
      break;
    default:
      return invalidJson(`unsupported ${typeof value} value.`);
  }

  if (isProxy(value)) return invalidJson("Proxy values are not allowed.");
  if (active.has(value)) return invalidJson("cyclic values are not allowed.");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor !== undefined && "value" in lengthDescriptor &&
        typeof lengthDescriptor.value === "number" &&
        lengthDescriptor.value > CANONICAL_JSON_LIMITS.maximumNodes - budget.nodes) {
        return invalidJson(`node limit is ${CANONICAL_JSON_LIMITS.maximumNodes}.`);
      }
      const entriesToSerialize = readDenseDataArray(
        value,
        CANONICAL_JSON_LIMITS.maximumNodes - budget.nodes,
      );
      if (entriesToSerialize === undefined) return invalidJson("arrays must be ordinary dense JSON arrays.");
      accountBytes(budget, 2 + Math.max(0, entriesToSerialize.length - 1));
      const entries: string[] = [];
      for (const entry of entriesToSerialize) {
        entries.push(canonicalValue(entry, active, budget, depth + 1));
      }
      return `[${entries.join(",")}]`;
    }

    if (!isPlainJsonObject(value)) return invalidJson("objects must use the ordinary JSON object prototype.");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      return invalidJson("objects must contain enumerable string data properties only.");
    }
    if (ownKeys.length > CANONICAL_JSON_LIMITS.maximumNodes - budget.nodes) {
      return invalidJson(`node limit is ${CANONICAL_JSON_LIMITS.maximumNodes}.`);
    }
    const keys = (ownKeys as string[]).sort(compareAscii);
    const entries: string[] = [];
    accountBytes(budget, 2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidJson("objects must contain enumerable string data properties only.");
      }
      const serializedKey = serializedJsonString(key, budget);
      accountBytes(budget, 1);
      entries.push(`${serializedKey}:${canonicalValue(descriptor.value, active, budget, depth + 1)}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    active.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new WeakSet<object>(), { bytes: 0, nodes: 0 }, 0);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function canonicalJsonFileBytes(value: unknown): Uint8Array {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function digestBytes(value: string | Uint8Array): Sha256 {
  return createHash("sha256").update(value).digest("hex");
}

function copyDeterministicBytes(value: unknown): Uint8Array {
  if (isProxy(value)) throw new TypeError("Byte content must not be a Proxy.");
  if (!isUint8Array(value)) throw new TypeError("Byte content must be a Uint8Array.");
  if (hasSharedBackingStore(value)) {
    throw new TypeError("SharedArrayBuffer-backed byte content is not deterministic.");
  }
  try {
    return new Uint8Array(value);
  } catch {
    throw new TypeError("Byte content must reference an accessible backing store.");
  }
}

export function sha256Hex(value: string | Uint8Array): Sha256 {
  if (typeof value === "string") return digestBytes(value);
  return digestBytes(copyDeterministicBytes(value));
}

export function normalizeLf(value: string): string {
  if (typeof value !== "string") throw new TypeError("Text content must be a string.");
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function ensureFinalNewline(value: string): string {
  const normalized = normalizeLf(value);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function boundedNormalizedTextByteLength(value: string): number {
  const limit = CONTRACT_LIMITS.generatedFileBytes;
  if (value.length > limit * 2) throw new RangeError(`Generated text file byte limit is ${limit}.`);
  let bytes = 0;
  let endsWithNewline = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x0d) {
      if (value.charCodeAt(index + 1) === 0x0a) index += 1;
      bytes += 1;
      endsWithNewline = true;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
      endsWithNewline = false;
    } else {
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
      endsWithNewline = code === 0x0a;
    }
    if (bytes > limit) throw new RangeError(`Generated text file byte limit is ${limit}.`);
  }
  if (!endsWithNewline) bytes += 1;
  if (bytes > limit) throw new RangeError(`Generated text file byte limit is ${limit}.`);
  return bytes;
}

export function utf8FileBytes(value: string): Uint8Array {
  if (typeof value !== "string") throw new TypeError("Text content must be a string.");
  const expectedBytes = boundedNormalizedTextByteLength(value);
  const bytes = Buffer.from(ensureFinalNewline(value), "utf8");
  if (safeByteLength(bytes) !== expectedBytes) {
    throw new TypeError("Generated text encoding was not deterministic.");
  }
  return bytes;
}

function readClosedDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (isProxy(value)) throw new TypeError("Generated file input must not be a Proxy.");
  if (!isPlainJsonObject(value)) throw new TypeError("Generated file input must be a plain object.");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError("Generated file input must use the closed shape.");
  }
  const actualKeys = (ownKeys as string[]).sort(compareAscii);
  const sortedExpected = [...expectedKeys].sort(compareAscii);
  if (actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError("Generated file input must use the closed shape.");
  }
  const normalized: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("Generated file input must contain enumerable data properties only.");
    }
    normalized[key] = descriptor.value;
  }
  return normalized;
}

interface NormalizedGeneratedFileInput {
  readonly path: PortableRelativePath;
  readonly mode: FileMode;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly origin: GeneratedFileOrigin;
}

interface InspectedGeneratedFileInput extends Omit<NormalizedGeneratedFileInput, "bytes"> {
  readonly bytes: Uint8Array;
}

function normalizeGeneratedMetadata(
  path: unknown,
  mode: unknown,
  origin: unknown,
): Pick<NormalizedGeneratedFileInput, "path" | "mode" | "origin"> {
  if (!isPortableRelativePath(path)) {
    throw new TypeError("Generated file path must be a portable relative path.");
  }
  if (!isFileMode(mode)) throw new TypeError("Generated file mode must be 0644 or 0755.");
  if (!(GENERATED_FILE_ORIGINS as readonly unknown[]).includes(origin)) {
    throw new TypeError("Generated file origin must be compiler or pack.");
  }
  return { path, mode, origin: origin as GeneratedFileOrigin };
}

function inspectGeneratedFileInput(input: unknown): InspectedGeneratedFileInput {
  const normalized = readClosedDataObject(input, ["path", "mode", "bytes", "origin"]);
  const { path, mode, bytes, origin } = normalized;
  const metadata = normalizeGeneratedMetadata(path, mode, origin);
  if (isProxy(bytes)) throw new TypeError("Generated file bytes must not be a Proxy.");
  if (!isUint8Array(bytes)) throw new TypeError("Generated file bytes must be a Uint8Array.");
  if (hasSharedBackingStore(bytes)) {
    throw new TypeError("Generated file bytes must not use a SharedArrayBuffer backing store.");
  }
  const byteLength = safeByteLength(bytes);
  if (byteLength > CONTRACT_LIMITS.generatedFileBytes) {
    throw new RangeError(`Generated file byte limit is ${CONTRACT_LIMITS.generatedFileBytes}.`);
  }
  return { ...metadata, bytes, byteLength };
}

function copyInspectedGeneratedFile(input: InspectedGeneratedFileInput): NormalizedGeneratedFileInput {
  const copiedBytes = copyDeterministicBytes(input.bytes);
  if (safeByteLength(copiedBytes) !== input.byteLength) {
    throw new TypeError("Generated file bytes changed while being copied.");
  }
  return { ...input, bytes: copiedBytes };
}

function materializeGeneratedFile(input: NormalizedGeneratedFileInput): GeneratedFile {
  const bytes = input.bytes;
  return Object.freeze({
    path: input.path,
    mode: input.mode,
    get bytes(): Uint8Array {
      return new Uint8Array(bytes);
    },
    sha256: digestBytes(bytes),
    origin: input.origin,
  });
}

export function createGeneratedFile(input: GeneratedFileInput): GeneratedFile {
  return materializeGeneratedFile(copyInspectedGeneratedFile(inspectGeneratedFileInput(input)));
}

export function createTextGeneratedFile(input: TextGeneratedFileInput): GeneratedFile {
  const normalized = readClosedDataObject(input, ["path", "mode", "text", "origin"]);
  const metadata = normalizeGeneratedMetadata(normalized.path, normalized.mode, normalized.origin);
  if (typeof normalized.text !== "string") {
    throw new TypeError("Generated text file input must be a plain object with string text.");
  }
  const bytes = utf8FileBytes(normalized.text);
  return materializeGeneratedFile({
    ...metadata,
    bytes,
    byteLength: safeByteLength(bytes),
  });
}

type TreeNodeKind = "directory" | "file";

function registerPortableTreePath(
  path: string,
  exactNodes: Map<string, TreeNodeKind>,
  foldedNodes: Map<string, string>,
): void {
  const parts = path.split("/");
  let nodePath = "";
  for (let index = 0; index < parts.length; index += 1) {
    nodePath = nodePath === "" ? (parts[index] ?? "") : `${nodePath}/${parts[index] ?? ""}`;
    const kind: TreeNodeKind = index === parts.length - 1 ? "file" : "directory";
    const existingKind = exactNodes.get(nodePath);
    if (existingKind !== undefined && (existingKind === "file" || kind === "file")) {
      if (existingKind === "file" && kind === "file") throw new TypeError(`Duplicate generated path: ${path}`);
      throw new TypeError(`Generated path has an ancestor collision: ${path}`);
    }
    const folded = nodePath.toLowerCase();
    const colliding = foldedNodes.get(folded);
    if (colliding !== undefined && colliding !== nodePath) {
      throw new TypeError(`Case-colliding generated paths: ${colliding} and ${nodePath}`);
    }
    if (existingKind === undefined) exactNodes.set(nodePath, kind);
    if (colliding === undefined) foldedNodes.set(folded, nodePath);
  }
}

export function finalizeGeneratedFiles(inputs: readonly GeneratedFileInput[]): readonly GeneratedFile[] {
  if (isProxy(inputs) || !Array.isArray(inputs) || Object.getPrototypeOf(inputs) !== Array.prototype) {
    throw new TypeError("Generated files must be an ordinary dense array.");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(inputs, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value)) {
    throw new TypeError("Generated files must be an ordinary dense array.");
  }
  if (lengthDescriptor.value > CONTRACT_LIMITS.generatedFiles) {
    throw new RangeError(`Generated file count limit is ${CONTRACT_LIMITS.generatedFiles}.`);
  }
  const rawInputs = readDenseDataArray(inputs, CONTRACT_LIMITS.generatedFiles);
  if (rawInputs === undefined) throw new TypeError("Generated files must be an ordinary dense array.");

  let totalBytes = 0;
  const exactNodes = new Map<string, TreeNodeKind>();
  const foldedNodes = new Map<string, string>();
  const inspectedInputs: InspectedGeneratedFileInput[] = [];
  for (const rawInput of rawInputs) {
    const input = inspectGeneratedFileInput(rawInput);
    totalBytes += input.byteLength;
    if (totalBytes > CONTRACT_LIMITS.generatedTotalBytes) {
      throw new RangeError(`Generated total byte limit is ${CONTRACT_LIMITS.generatedTotalBytes}.`);
    }
    registerPortableTreePath(input.path, exactNodes, foldedNodes);
    inspectedInputs.push(input);
  }

  const normalizedInputs: NormalizedGeneratedFileInput[] = [];
  for (const input of inspectedInputs) normalizedInputs.push(copyInspectedGeneratedFile(input));

  return Object.freeze(
    normalizedInputs
      .sort((left, right) => compareAscii(left.path, right.path))
      .map((input) => materializeGeneratedFile(input)),
  );
}
