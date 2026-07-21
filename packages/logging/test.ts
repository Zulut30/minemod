import assert from "node:assert/strict";
import {
  CONTRACT_LIMITS,
  LOG_EVENT_CONTRACT,
  isLogEvent,
  type LogEvent,
} from "@mcdev/contracts";
import {
  StructuredLogError,
  createStructuredLogger,
  serializeLogEvent,
} from "./index.ts";

const serialized = serializeLogEvent({
  contract: LOG_EVENT_CONTRACT,
  sequence: 0,
  level: "warning",
  code: "PLACEHOLDER_ASSETS_USED",
});
assert.equal(serialized.endsWith("\n"), true);
assert.equal(serialized.slice(0, -1).includes("\n"), false, "one event must occupy exactly one JSON line");
assert.ok(Buffer.byteLength(serialized, "utf8") <= CONTRACT_LIMITS.logOrJournalRecordBytes);
assert.equal(isLogEvent(JSON.parse(serialized) as unknown), true);

for (const secretKey of ["token", "password", "authorization", "cookie", "apiKey", "metadata", "message"]) {
  assert.throws(
    () => serializeLogEvent({
      contract: LOG_EVENT_CONTRACT,
      sequence: 0,
      level: "warning",
      code: "PLACEHOLDER_ASSETS_USED",
      [secretKey]: `Bearer secret-${secretKey}\nsecond-line`,
    } as unknown as LogEvent),
    StructuredLogError,
    secretKey,
  );
}

const lines: string[] = [];
const logger = createStructuredLogger((line) => {
  lines.push(line);
});
logger.operationStarted("plan-build");
logger.placeholderAssetsUsed();
logger.nodeCompleted("generate-content");
logger.operationCompleted("plan-build");
logger.operationFailed("SPEC_UNSUPPORTED");

const events = lines.map((line) => JSON.parse(line) as unknown);
assert.equal(events.every(isLogEvent), true);
assert.deepEqual(events.map((event) => (event as LogEvent).sequence), [0, 1, 2, 3, 4]);
assert.deepEqual(events.map((event) => (event as LogEvent).code), [
  "OPERATION_STARTED",
  "PLACEHOLDER_ASSETS_USED",
  "NODE_COMPLETED",
  "OPERATION_COMPLETED",
  "OPERATION_FAILED",
]);
assert.equal(lines.every((line) => line.endsWith("\n") && line.slice(0, -1).includes("\n") === false), true);
assert.doesNotMatch(lines.join(""), /secret|password|token|authorization|cookie|apiKey/u);

const reentrantSequences: number[] = [];
let reentered = false;
const reentrantLogger = createStructuredLogger((line) => {
  reentrantSequences.push((JSON.parse(line) as LogEvent).sequence);
  if (!reentered) {
    reentered = true;
    reentrantLogger.placeholderAssetsUsed();
  }
});
reentrantLogger.operationStarted("plan-build");
assert.deepEqual(reentrantSequences, [0, 1], "reentrant sinks must receive unique ordered sequences");

const throwingSinkSequences: number[] = [];
let throwAfterFirstWrite = true;
const throwingSinkLogger = createStructuredLogger((line) => {
  throwingSinkSequences.push((JSON.parse(line) as LogEvent).sequence);
  if (throwAfterFirstWrite) {
    throwAfterFirstWrite = false;
    throw new Error("sink failed after write");
  }
});
assert.throws(() => throwingSinkLogger.placeholderAssetsUsed(), /sink failed after write/u);
throwingSinkLogger.placeholderAssetsUsed();
assert.deepEqual(
  throwingSinkSequences,
  [0, 1],
  "a sink failure after observing a line must consume that sequence",
);

assert.throws(() => logger.operationStarted("shell" as "plan-build"), StructuredLogError);
assert.throws(() => logger.nodeCompleted("../escape"), StructuredLogError);
assert.throws(() => logger.operationFailed("UNKNOWN" as "SPEC_INVALID"), StructuredLogError);
assert.throws(
  () => serializeLogEvent({
    contract: LOG_EVENT_CONTRACT,
    sequence: Number.MAX_SAFE_INTEGER + 1,
    level: "warning",
    code: "PLACEHOLDER_ASSETS_USED",
  }),
  StructuredLogError,
);

let eventGetterCalls = 0;
const eventWithAccessor = Object.defineProperty({
  sequence: 0,
  level: "warning",
  code: "PLACEHOLDER_ASSETS_USED",
}, "contract", {
  enumerable: true,
  get(): string {
    eventGetterCalls += 1;
    return LOG_EVENT_CONTRACT;
  },
});
assert.throws(
  () => serializeLogEvent(eventWithAccessor as unknown as LogEvent),
  StructuredLogError,
);
assert.equal(eventGetterCalls, 0, "log validation must not invoke event accessors");

let eventProxyTrapCalls = 0;
const proxiedEvent = new Proxy({}, {
  getPrototypeOf(): object {
    eventProxyTrapCalls += 1;
    return Object.prototype;
  },
  ownKeys(): never {
    eventProxyTrapCalls += 1;
    throw new Error("log proxy trap executed");
  },
});
assert.throws(() => serializeLogEvent(proxiedEvent as unknown as LogEvent), StructuredLogError);
assert.equal(eventProxyTrapCalls, 0, "log event proxies must be rejected before reflection");

const eventWithHiddenSecret = Object.defineProperty({
  contract: LOG_EVENT_CONTRACT,
  sequence: 0,
  level: "warning",
  code: "PLACEHOLDER_ASSETS_USED",
}, "token", { value: "hidden-secret" });
assert.throws(
  () => serializeLogEvent(eventWithHiddenSecret as unknown as LogEvent),
  StructuredLogError,
  "non-enumerable fields violate the closed event shape",
);
assert.throws(
  () => serializeLogEvent({
    contract: LOG_EVENT_CONTRACT,
    sequence: 0,
    level: "warning",
    code: "PLACEHOLDER_ASSETS_USED",
    [Symbol("secret")]: "hidden-secret",
  } as unknown as LogEvent),
  StructuredLogError,
  "symbol fields violate the closed event shape",
);
