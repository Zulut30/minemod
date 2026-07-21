import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACT_LIMITS } from "@mcdev/contracts";
import {
  CANONICAL_JSON_LIMITS,
  canonicalJson,
  canonicalJsonBytes,
  canonicalJsonFileBytes,
  createGeneratedFile,
  createTextGeneratedFile,
  ensureFinalNewline,
  finalizeGeneratedFiles,
  normalizeLf,
  sha256Hex,
  utf8FileBytes,
  type GeneratedFileInput,
} from "./index.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

const canonicalFixture = {
  z: null,
  a: { z: 2, a: true },
  list: [{ b: 2, a: 1 }, "line\nfeed", -0],
  2: "two",
  10: "ten",
  A: "upper",
  _: "underscore",
};
assert.equal(
  canonicalJson(canonicalFixture),
  '{"10":"ten","2":"two","A":"upper","_":"underscore","a":{"a":true,"z":2},"list":[{"a":1,"b":2},"line\\nfeed",0],"z":null}',
  "object keys use recursive ASCII order, including integer-like keys",
);
assert.equal(
  canonicalJson({ list: canonicalFixture.list, _: "underscore", A: "upper", 10: "ten", 2: "two", a: canonicalFixture.a, z: null }),
  canonicalJson(canonicalFixture),
  "insertion order must not affect canonical JSON",
);
assert.deepEqual(canonicalJsonBytes(canonicalFixture), Buffer.from(canonicalJson(canonicalFixture), "utf8"));
assert.equal(decoder.decode(canonicalJsonFileBytes({ b: 2, a: 1 })), '{"a":1,"b":2}\n');
assert.equal(canonicalJson(1.25), "1.25");
assert.equal(canonicalJson("Ж"), '"Ж"');
assert.throws(
  () => canonicalJson(Array.from({ length: CANONICAL_JSON_LIMITS.maximumDepth + 1 }).reduce<unknown>(
    (nested) => [nested],
    null,
  )),
  /depth limit/u,
);
assert.throws(
  () => canonicalJson("x".repeat(CANONICAL_JSON_LIMITS.maximumBytes + 1)),
  /byte limit/u,
);
assert.throws(
  () => canonicalJson("\0".repeat(CANONICAL_JSON_LIMITS.maximumBytes)),
  /byte limit/u,
  "escaped string bytes must be capped before serialization",
);
assert.throws(
  () => canonicalJson(Array.from({ length: CANONICAL_JSON_LIMITS.maximumNodes }, () => null)),
  /node limit/u,
);

for (const [label, value] of [
  ["undefined root", undefined],
  ["undefined property", { value: undefined }],
  ["NaN", Number.NaN],
  ["positive infinity", Number.POSITIVE_INFINITY],
  ["negative infinity", Number.NEGATIVE_INFINITY],
  ["bigint", 1n],
  ["function", () => undefined],
  ["symbol", Symbol("x")],
  ["date", new Date(0)],
  ["null prototype", Object.assign(Object.create(null) as object, { a: 1 })],
] as const) {
  assert.throws(() => canonicalJson(value), TypeError, label);
}

const sparse: unknown[] = [];
sparse.length = 1;
assert.throws(() => canonicalJson(sparse), /dense JSON array/u);
const arrayWithExtra = [1] as unknown[] & Record<string, unknown>;
arrayWithExtra.extra = true;
assert.throws(() => canonicalJson(arrayWithExtra), /dense JSON array/u);
const cycle: Record<string, unknown> = {};
cycle.self = cycle;
assert.throws(() => canonicalJson(cycle), /cyclic/u);
const shared = { b: 2, a: 1 };
assert.equal(
  canonicalJson({ y: shared, x: shared }),
  '{"x":{"a":1,"b":2},"y":{"a":1,"b":2}}',
  "shared acyclic subtrees remain valid JSON values",
);
assert.equal(
  canonicalJson(JSON.parse('{"__proto__":{"safe":true}}') as unknown),
  '{"__proto__":{"safe":true}}',
  "an own JSON __proto__ key is serialized as data without assignment",
);

let getterCalls = 0;
const accessor = Object.defineProperty({}, "value", {
  enumerable: true,
  get(): number {
    getterCalls += 1;
    return 1;
  },
});
assert.throws(() => canonicalJson(accessor), /data properties/u);
assert.equal(getterCalls, 0, "canonicalization must not invoke accessors");
const hidden = Object.defineProperty({ visible: true }, "hidden", { value: true });
assert.throws(() => canonicalJson(hidden), /data properties/u);
const symbolProperty = { visible: true, [Symbol("hidden")]: true };
assert.throws(() => canonicalJson(symbolProperty), /data properties/u);

let arrayGetterCalls = 0;
const arrayAccessor = [0];
Object.defineProperty(arrayAccessor, "0", {
  enumerable: true,
  get(): number {
    arrayGetterCalls += 1;
    return 1;
  },
});
assert.throws(() => canonicalJson(arrayAccessor), /dense JSON array/u);
assert.equal(arrayGetterCalls, 0, "canonicalization must not invoke array accessors");

let proxyTrapCalls = 0;
const hostileProxy = new Proxy({}, {
  ownKeys(): never {
    proxyTrapCalls += 1;
    throw new Error("proxy trap executed");
  },
});
assert.throws(() => canonicalJson(hostileProxy), /Proxy/u);
assert.equal(proxyTrapCalls, 0, "proxy rejection must happen before reflective traversal");

assert.equal(
  sha256Hex("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
assert.equal(sha256Hex(Buffer.from("abc")), sha256Hex("abc"));
assert.equal(normalizeLf("a\r\nb\rc\n"), "a\nb\nc\n");
assert.equal(ensureFinalNewline("a\r\nb"), "a\nb\n");
assert.equal(ensureFinalNewline("a\n\n"), "a\n\n", "existing trailing blank lines remain meaningful");
assert.equal(ensureFinalNewline(""), "\n");
assert.equal(decoder.decode(utf8FileBytes("Ж\r\nline")), "Ж\nline\n");

const mutableInput = Buffer.from("hello\r\n", "utf8");
const sourceFile = createGeneratedFile({
  path: "src/main/java/Example.java",
  mode: 420,
  bytes: mutableInput,
  origin: "compiler",
});
mutableInput.fill(0);
assert.deepEqual(Object.keys(sourceFile), ["path", "mode", "bytes", "sha256", "origin"]);
assert.equal(sourceFile.path, "src/main/java/Example.java");
assert.equal(sourceFile.mode, 420);
assert.equal(decoder.decode(sourceFile.bytes), "hello\r\n", "the caller's mutable input must be copied");
assert.equal(sourceFile.sha256, sha256Hex(sourceFile.bytes));
assert.equal(sourceFile.origin, "compiler");
assert.equal(Object.isFrozen(sourceFile), true);
sourceFile.bytes.fill(0);
assert.equal(decoder.decode(sourceFile.bytes), "hello\r\n", "returned bytes must be defensive copies");
assert.equal(sourceFile.sha256, sha256Hex(sourceFile.bytes), "content and digest must remain inseparable");

const textFile = createTextGeneratedFile({
  path: "src/main/resources/example.json",
  mode: 420,
  text: "{\r\n  \"ok\": true\r\n}",
  origin: "compiler",
});
assert.equal(decoder.decode(textFile.bytes), "{\n  \"ok\": true\n}\n");
assert.equal(textFile.sha256, sha256Hex(textFile.bytes));

for (const invalidPath of ["/absolute", "../escape", "a//b", ".mcdev/state", "A/../b", "C:/drive", "a\\b"] as const) {
  assert.throws(() => createGeneratedFile({
    path: invalidPath,
    mode: 420,
    bytes: new Uint8Array(),
    origin: "compiler",
  }), /portable relative path/u, invalidPath);
}
assert.throws(() => createGeneratedFile({
  path: "file.txt",
  mode: 511 as 420,
  bytes: new Uint8Array(),
  origin: "compiler",
}), /mode/u);
assert.throws(() => createGeneratedFile({
  path: "file.txt",
  mode: 420,
  bytes: new Uint8Array(),
  origin: "build" as "compiler",
}), /origin/u);
assert.throws(() => createGeneratedFile({
  path: "large.bin",
  mode: 420,
  bytes: new Uint8Array(CONTRACT_LIMITS.generatedFileBytes + 1),
  origin: "pack",
}), /file byte limit/u);
assert.throws(() => createGeneratedFile({
  path: "unknown-field",
  mode: 420,
  bytes: new Uint8Array(),
  origin: "compiler",
  command: "sh",
} as GeneratedFileInput), /closed shape/u);

let inputGetterCalls = 0;
const accessorInput = Object.defineProperty({
  mode: 420,
  bytes: new Uint8Array(),
  origin: "compiler",
}, "path", {
  enumerable: true,
  get(): string {
    inputGetterCalls += 1;
    return "accessor";
  },
});
assert.throws(() => createGeneratedFile(accessorInput as GeneratedFileInput), /data properties/u);
assert.equal(inputGetterCalls, 0, "generated-file parsing must not invoke accessors");

let byteProxyTrapCalls = 0;
const proxiedBytes = new Proxy(new Uint8Array(), {
  getPrototypeOf(): object {
    byteProxyTrapCalls += 1;
    throw new Error("typed-array proxy trap executed");
  },
});
assert.throws(() => createGeneratedFile({
  path: "proxied-bytes",
  mode: 420,
  bytes: proxiedBytes,
  origin: "compiler",
}), /Proxy/u);
assert.equal(byteProxyTrapCalls, 0, "byte proxies must be rejected before reflection");

let byteIteratorCalls = 0;
const bytesWithHostileIterator = new Uint8Array([1, 2, 3]);
Object.defineProperty(bytesWithHostileIterator, Symbol.iterator, {
  value(): never {
    byteIteratorCalls += 1;
    throw new Error("typed-array iterator executed");
  },
});
const iteratorSafeFile = createGeneratedFile({
  path: "iterator-safe",
  mode: 420,
  bytes: bytesWithHostileIterator,
  origin: "compiler",
});
assert.deepEqual(iteratorSafeFile.bytes, new Uint8Array([1, 2, 3]));
assert.equal(byteIteratorCalls, 0, "typed-array copying must not invoke a caller iterator");

let byteLengthGetterCalls = 0;
const bytesWithHostileLength = new Uint8Array([1, 2, 3]);
Object.defineProperty(bytesWithHostileLength, "byteLength", {
  get(): number {
    byteLengthGetterCalls += 1;
    throw new Error("typed-array byteLength getter executed");
  },
});
const lengthSafeFile = createGeneratedFile({
  path: "length-safe",
  mode: 420,
  bytes: bytesWithHostileLength,
  origin: "compiler",
});
assert.equal(lengthSafeFile.bytes.byteLength, 3);
assert.equal(byteLengthGetterCalls, 0, "typed-array sizing must use the intrinsic getter");

let byteBufferGetterCalls = 0;
const sharedBytes = new Uint8Array(new SharedArrayBuffer(3));
Object.defineProperty(sharedBytes, "buffer", {
  get(): never {
    byteBufferGetterCalls += 1;
    throw new Error("typed-array buffer getter executed");
  },
});
assert.throws(() => createGeneratedFile({
  path: "shared-bytes",
  mode: 420,
  bytes: sharedBytes,
  origin: "compiler",
}), /SharedArrayBuffer/u);
assert.throws(() => sha256Hex(sharedBytes), /SharedArrayBuffer/u);
assert.equal(byteBufferGetterCalls, 0, "shared backing-store checks must use typed-array intrinsics");

const unsortedInputs: readonly GeneratedFileInput[] = [
  { path: "z.txt", mode: 420, bytes: Buffer.from("z"), origin: "compiler" },
  { path: "B.txt", mode: 420, bytes: Buffer.from("B"), origin: "pack" },
  { path: "a.txt", mode: 493, bytes: Buffer.from("a"), origin: "compiler" },
];
const sorted = finalizeGeneratedFiles(unsortedInputs);
assert.deepEqual(sorted.map(({ path }) => path), ["B.txt", "a.txt", "z.txt"]);
assert.equal(Object.isFrozen(sorted), true);
const inputArrayWithExtra = [...unsortedInputs] as GeneratedFileInput[] & Record<string, unknown>;
inputArrayWithExtra.command = "sh";
assert.throws(() => finalizeGeneratedFiles(inputArrayWithExtra), /ordinary dense array/u);

let arrayIndexGetterCalls = 0;
const arrayWithAccessor = [...unsortedInputs];
Object.defineProperty(arrayWithAccessor, "0", {
  enumerable: true,
  get(): GeneratedFileInput {
    arrayIndexGetterCalls += 1;
    throw new Error("generated-file array index getter executed");
  },
});
assert.throws(() => finalizeGeneratedFiles(arrayWithAccessor), /ordinary dense array/u);
assert.equal(arrayIndexGetterCalls, 0, "generated-file arrays must not execute index accessors");

let arrayMapGetterCalls = 0;
const arrayWithHostileMap = [...unsortedInputs];
Object.defineProperty(arrayWithHostileMap, "map", {
  get(): never {
    arrayMapGetterCalls += 1;
    throw new Error("generated-file array map getter executed");
  },
});
assert.throws(() => finalizeGeneratedFiles(arrayWithHostileMap), /ordinary dense array/u);
assert.equal(arrayMapGetterCalls, 0, "generated-file arrays must not execute own methods");

const arrayWithSymbol = [...unsortedInputs] as GeneratedFileInput[] & { [key: symbol]: unknown };
arrayWithSymbol[Symbol("command")] = "sh";
assert.throws(() => finalizeGeneratedFiles(arrayWithSymbol), /ordinary dense array/u);

for (const [label, inputs] of [
  ["exact collision", [
    { path: "same.txt", mode: 420, bytes: Buffer.from("1"), origin: "compiler" },
    { path: "same.txt", mode: 420, bytes: Buffer.from("2"), origin: "compiler" },
  ]],
  ["portable case collision", [
    { path: "README.md", mode: 420, bytes: Buffer.from("1"), origin: "compiler" },
    { path: "readme.md", mode: 420, bytes: Buffer.from("2"), origin: "compiler" },
  ]],
] as const) {
  assert.throws(
    () => finalizeGeneratedFiles(inputs as readonly GeneratedFileInput[]),
    label === "exact collision" ? /duplicate generated path/iu : /case-colliding generated paths/iu,
    label,
  );
}

for (const paths of [
  ["a", "a/b"],
  ["A", "a/b"],
  ["A/x", "a/y"],
] as const) {
  assert.throws(
    () => finalizeGeneratedFiles(paths.map((path) => ({
      path,
      mode: 420 as const,
      bytes: new Uint8Array(),
      origin: "compiler" as const,
    }))),
    /ancestor|case-colliding/iu,
    paths.join(" + "),
  );
}

const emptyInput: GeneratedFileInput = {
  path: "placeholder",
  mode: 420,
  bytes: new Uint8Array(),
  origin: "compiler",
};
assert.equal(
  finalizeGeneratedFiles(Array.from({ length: CONTRACT_LIMITS.generatedFiles }, (_, index) => ({
    ...emptyInput,
    path: `generated/${String(index).padStart(4, "0")}`,
  }))).length,
  CONTRACT_LIMITS.generatedFiles,
);
assert.throws(
  () => finalizeGeneratedFiles(Array.from({ length: CONTRACT_LIMITS.generatedFiles + 1 }, (_, index) => ({
    ...emptyInput,
    path: `generated/${String(index).padStart(4, "0")}`,
  }))),
  /file count limit/u,
);

const maximumFile = new Uint8Array(CONTRACT_LIMITS.generatedFileBytes);
assert.equal(createGeneratedFile({
  path: "maximum.bin",
  mode: 420,
  bytes: maximumFile,
  origin: "pack",
}).bytes.byteLength, CONTRACT_LIMITS.generatedFileBytes);
assert.throws(
  () => finalizeGeneratedFiles(Array.from({ length: 9 }, (_, index) => ({
    path: `large/${index}.bin`,
    mode: 420 as const,
    bytes: maximumFile,
    origin: "pack" as const,
  }))),
  /total byte limit/u,
  "nine 16 MiB files exceed the 128 MiB transaction cap before cloning inputs",
);

const productionSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const imports = [...productionSource.matchAll(/(?:from\s+|import\s+)"([^"]+)"/gu)].map((match) => match[1]);
assert.deepEqual(
  [...new Set(imports)].sort(),
  ["@mcdev/contracts", "node:crypto", "node:util/types"],
  "production imports are restricted to contracts and deterministic Node builtins",
);
assert.doesNotMatch(productionSource, /\bimport\s*\(/u, "dynamic imports are not a codegen primitive");
assert.doesNotMatch(
  productionSource,
  /\b(?:Date|WebSocket|fetch|performance|process|setInterval|setTimeout)\b|Math\.random|\brandom(?:Bytes|Fill|Int|UUID)\b/u,
);

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { readonly dependencies?: Record<string, string> };
assert.deepEqual(packageJson.dependencies, { "@mcdev/contracts": "workspace:*" });
