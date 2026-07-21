export const CONTRACT_LIMITS = Object.freeze({
  buildPlanBytes: 2_097_152,
  buildPlanEdges: 512,
  buildPlanNodes: 128,
  generatedFiles: 2_048,
  generatedFileBytes: 16_777_216,
  generatedTotalBytes: 134_217_728,
  inlineSpecBytes: 262_144,
  logOrJournalRecordBytes: 16_384,
  relativePathBytes: 240,
} as const);

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const SAFE_RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!\.mcdev(?:\/|$))[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/iu;

export type Sha256 = string;
export type PortableRelativePath = string;
export type FileMode = 420 | 493;
export type JsonObject = Record<string, unknown>;

export function isPlainJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

export function hasExactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

export function isDenseJsonArray(value: unknown): value is unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Object.keys(value);
    return keys.length === value.length && keys.every((key, index) => key === String(index));
  } catch {
    return false;
  }
}

export function isSha256(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isPortableRelativePath(value: unknown): value is PortableRelativePath {
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= CONTRACT_LIMITS.relativePathBytes &&
    SAFE_RELATIVE_PATH_PATTERN.test(value) &&
    !value.split("/").some((part) =>
      part.endsWith(".") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
}

export function isFileMode(value: unknown): value is FileMode {
  return value === 420 || value === 493;
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isBoundedJsonBytes(value: unknown, maximumBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maximumBytes;
  } catch {
    return false;
  }
}

export function isStrictlySortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? "") < value);
}

export function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) return true;
  }
  return false;
}

export function hasPortableCaseCollision(values: readonly string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size !== values.length;
}

export const FORBIDDEN_EXECUTION_KEYS = Object.freeze([
  "args",
  "command",
  "cwd",
  "env",
  "eval",
  "executable",
  "module",
  "script",
  "shell",
] as const);

export function containsForbiddenExecutionSurface(value: unknown): boolean {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      if (visited.has(current)) continue;
      visited.add(current);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    if (!isPlainJsonObject(current)) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const [key, child] of Object.entries(current)) {
      if ((FORBIDDEN_EXECUTION_KEYS as readonly string[]).includes(key)) return true;
      pending.push(child);
    }
  }
  return false;
}
