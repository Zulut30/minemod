import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { validModFixture } from "../../fixtures/specs/validation.ts";
import { MAX_INLINE_SPEC_BYTES, validateInlineSpec } from "@mcdev/validation";
import {
  BoundedJsonLineInput,
  createMcpServer,
  MAX_MCP_STDIO_FRAME_BYTES,
  MCP_FABRIC_BUILD_TOOL_NAME,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_VALIDATE_TOOL_NAME,
} from "./index.ts";

type JsonObject = Record<string, unknown>;
type ExitResult = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

interface SpawnedServer {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<ExitResult>;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function asObject(value: unknown, label: string): JsonObject {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
  return value as JsonObject;
}

function parseProtocolLine(line: string): JsonObject {
  const message = asObject(JSON.parse(line) as unknown, "stdout message");
  assert.equal(message.jsonrpc, "2.0", "stdout must contain only JSON-RPC 2.0 messages");
  return message;
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function spawnStdioServer(): SpawnedServer {
  const entrypoint = fileURLToPath(new URL("./index.ts", import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", entrypoint], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  // An expected fail-closed subprocess can close stdin while the test is still writing.
  child.stdin.on("error", () => undefined);

  return {
    child,
    exited: new Promise((resolveExit) => {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    }),
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function writeInput(child: ChildProcessWithoutNullStreams, input: string): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    child.stdin.write(input, (error) => {
      if (error === null || error === undefined) resolveWrite();
      else rejectWrite(error);
    });
  });
}

async function transformOneByteFragmentedFrame(frame: string): Promise<string> {
  const boundary = new BoundedJsonLineInput();
  const outputPromise = (async (): Promise<string> => {
    const output: Buffer[] = [];
    for await (const chunk of boundary) {
      output.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk)));
    }
    return Buffer.concat(output).toString("utf8");
  })();
  const bytes = Buffer.from(frame, "utf8");
  for (let offset = 0; offset < bytes.byteLength; offset += 1) {
    if (!boundary.write(bytes.subarray(offset, offset + 1))) await once(boundary, "drain");
  }
  boundary.end();
  return withTimeout(outputPromise, "one-byte fragmented bounded frame");
}

async function transformCompleteFrame(frame: string): Promise<string> {
  const boundary = new BoundedJsonLineInput();
  const outputPromise = (async (): Promise<string> => {
    const output: Buffer[] = [];
    for await (const chunk of boundary) {
      output.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk)));
    }
    return Buffer.concat(output).toString("utf8");
  })();
  boundary.end(Buffer.from(frame, "utf8"));
  return withTimeout(outputPromise, "complete bounded frame");
}

async function stopServer(server: SpawnedServer): Promise<void> {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill();
  try {
    await withTimeout(server.exited, "MCP subprocess cleanup");
  } catch {
    server.child.kill("SIGKILL");
    await server.exited;
  }
}

async function testLinkedInMemoryProtocol(): Promise<void> {
  let handlerCalls = 0;
  let buildCalls = 0;
  let buildConfig: unknown;
  let buildRequest: unknown;
  const server = createMcpServer(function validateForMcpTest(payload, kind) {
    assert.equal(arguments.length, 2, "MCP must pass only payload and kind to loader-neutral validation");
    handlerCalls += 1;
    return validateInlineSpec(payload, kind);
  }, (config) => {
    buildConfig = config;
    return {
      build: async (request) => {
        buildCalls += 1;
        buildRequest = request;
        return {
          planId: "1".repeat(64),
          workspaceStatus: "created",
          artifacts: {
            contract: "mcdev.artifact-index/v1",
            planId: "1".repeat(64),
            pack: {
              packId: "fabric-1.20.1-java-17",
              revision: 2,
              treeSha256: "2".repeat(64),
            },
            entries: [],
          },
        };
      },
    };
  });
  const client = new Client({ name: "mcdev-phase-0-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    assert.deepEqual(client.getServerVersion(), {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    });
    const linkedCapabilities = asObject(client.getServerCapabilities(), "linked initialize capabilities");
    assert.equal(linkedCapabilities.resources, undefined, "server must not advertise MCP resources");
    assert.equal(linkedCapabilities.prompts, undefined, "server must not advertise MCP prompts");

    const listResult = await client.listTools();
    assert.deepEqual(
      listResult.tools.map(({ name }) => name),
      [MCP_VALIDATE_TOOL_NAME, MCP_FABRIC_BUILD_TOOL_NAME],
      "tools/list must expose only the validator and approved Fabric builder",
    );
    const validateTool = listResult.tools.find(({ name }) => name === MCP_VALIDATE_TOOL_NAME);
    const linkedInputSchema = asObject(validateTool?.inputSchema, "linked tool input schema");
    assert.equal(linkedInputSchema.additionalProperties, false);
    const linkedProperties = asObject(linkedInputSchema.properties, "linked tool input properties");
    assert.deepEqual(Object.keys(linkedProperties).sort(), ["kind", "payload"]);
    assert.equal(Object.hasOwn(linkedProperties, "__proto__"), false);

    const callResult = await client.callTool({
      name: MCP_VALIDATE_TOOL_NAME,
      arguments: {
        kind: "mod",
        payload: JSON.stringify(validModFixture),
      },
    });
    const content = asObject(callResult, "tools/call result").content;
    assert.ok(Array.isArray(content));
    const textContent = content.map((entry) => asObject(entry, "content entry"))
      .find((entry) => entry.type === "text");
    assert.ok(textContent !== undefined);
    const text = textContent.text;
    assert.ok(typeof text === "string");
    const validation = asObject(JSON.parse(text) as unknown, "tool result");
    assert.equal(validation.valid, true);
    assert.equal(validation.kind, "mod");
    assert.equal(handlerCalls, 1);

    const buildCall = await client.callTool({
      name: MCP_FABRIC_BUILD_TOOL_NAME,
      arguments: {
        approved: true,
        artifactCacheRoot: "/fixed/cache",
        java17Home: "/fixed/jdk-17",
        payload: JSON.stringify(validModFixture),
        workspaceRoot: "/approved/workspace",
      },
    });
    const buildContent = asObject(buildCall, "Fabric build tool result").content;
    assert.ok(Array.isArray(buildContent));
    const buildText = buildContent.map((entry) => asObject(entry, "Fabric build content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof buildText === "string");
    assert.equal(asObject(JSON.parse(buildText) as unknown, "Fabric build result").workspaceStatus, "created");
    assert.deepEqual(buildConfig, { artifactCacheRoot: "/fixed/cache", java17Home: "/fixed/jdk-17" });
    assert.deepEqual(buildRequest, {
      payload: JSON.stringify(validModFixture),
      workspaceRoot: "/approved/workspace",
    });
    assert.equal(buildCalls, 1);

    const unapprovedBuild = asObject(await client.callTool({
      name: MCP_FABRIC_BUILD_TOOL_NAME,
      arguments: {
        approved: false,
        artifactCacheRoot: "/fixed/cache",
        java17Home: "/fixed/jdk-17",
        payload: JSON.stringify(validModFixture),
        workspaceRoot: "/approved/workspace",
      },
    }), "unapproved Fabric build result");
    assert.equal(unapprovedBuild.isError, true);
    assert.equal(buildCalls, 1, "unapproved MCP builds must stop before the application factory");

    const fabricFixture = {
      ...validModFixture,
      target: { minecraft: "26.2", loader: "fabric", java: 25 },
    };
    const defaultFabricCall = await client.callTool({
      name: MCP_VALIDATE_TOOL_NAME,
      arguments: { kind: "mod", payload: JSON.stringify(fabricFixture) },
    });
    const defaultFabricContent = asObject(defaultFabricCall, "loader-neutral tool result").content;
    assert.ok(Array.isArray(defaultFabricContent));
    const defaultFabricText = defaultFabricContent.map((entry) => asObject(entry, "loader-neutral content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof defaultFabricText === "string");
    assert.equal(asObject(JSON.parse(defaultFabricText) as unknown, "loader-neutral validation").valid, true);
    assert.equal(handlerCalls, 2);

    const rejectedProfile = asObject(await client.callTool({
      name: MCP_VALIDATE_TOOL_NAME,
      arguments: {
        kind: "mod",
        profile: "neoforge-26.1.2-java-25",
        payload: JSON.stringify(fabricFixture),
      },
    }), "public profile rejection");
    assert.equal(rejectedProfile.isError, true);
    assert.ok(Array.isArray(rejectedProfile.content));
    const rejectedProfileText = rejectedProfile.content
      .map((entry) => asObject(entry, "profile rejection content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof rejectedProfileText === "string");
    assert.match(rejectedProfileText, /Input validation error/u);
    assert.match(rejectedProfileText, /unrecognized key/iu);
    assert.match(rejectedProfileText, /profile/u);
    assert.doesNotMatch(rejectedProfileText, /INCOMPATIBLE_TARGET/u);
    assert.equal(handlerCalls, 2, "attacker-supplied profiles must be rejected before the handler");

    const rejectedUnknown = asObject(await client.callTool({
      name: MCP_VALIDATE_TOOL_NAME,
      arguments: {
        kind: "mod",
        payload: JSON.stringify(validModFixture),
        unknown: "below-frame-cap",
      },
    }), "strict unknown-argument result");
    assert.equal(rejectedUnknown.isError, true, "strict validation must reject before invoking the tool handler");
    assert.ok(Array.isArray(rejectedUnknown.content));
    const rejectionText = rejectedUnknown.content
      .map((entry) => asObject(entry, "strict rejection content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof rejectionText === "string");
    assert.match(rejectionText, /Input validation error/u);
    assert.match(rejectionText, /unrecognized key/iu);
    assert.doesNotMatch(rejectionText, /"valid":true/u, "the validation handler must not run");
    assert.equal(handlerCalls, 2, "unknown input must not invoke the validation handler");

    const rawReservedFrame =
      `{"jsonrpc":"2.0","id":77,"method":"tools/call","params":{"name":${JSON.stringify(MCP_VALIDATE_TOOL_NAME)},"arguments":{"kind":"mod","payload":${JSON.stringify(JSON.stringify(validModFixture))},"__proto__":true}}}\n`;
    const rawReservedMessage = asObject(JSON.parse(rawReservedFrame) as unknown, "raw reserved frame");
    const rawReservedArguments = asObject(
      asObject(rawReservedMessage.params, "raw reserved params").arguments,
      "raw reserved arguments",
    );
    assert.equal(Object.hasOwn(rawReservedArguments, "__proto__"), true);
    const guardedFrame = await transformOneByteFragmentedFrame(rawReservedFrame);
    const guardedMessage = asObject(JSON.parse(guardedFrame) as unknown, "guarded reserved frame");
    const guardedArguments = asObject(
      asObject(guardedMessage.params, "guarded reserved params").arguments,
      "guarded reserved arguments",
    );
    assert.equal(Object.hasOwn(guardedArguments, "__proto__"), false);
    assert.equal(Object.hasOwn(guardedArguments, "__proto_x"), true);
    assert.deepEqual(Object.keys(guardedArguments), ["__proto_x"]);
    assert.equal(guardedMessage.id, 77, "canonical guard must preserve a valid scalar request id");
    const rejectedReserved = asObject(await client.callTool({
      name: MCP_VALIDATE_TOOL_NAME,
      arguments: guardedArguments,
    }), "guarded reserved-argument result");
    assert.equal(rejectedReserved.isError, true);
    assert.equal(handlerCalls, 2, "fragmented reserved input must leave the validation handler count unchanged");

    const guardedNotification = asObject(JSON.parse(await transformCompleteFrame(
      `{"jsonrpc":"2.0","method":"tools/call","params":{"name":${JSON.stringify(MCP_VALIDATE_TOOL_NAME)},"arguments":{"__proto__":true}}}\n`,
    )) as unknown, "guarded reserved notification");
    assert.equal(Object.hasOwn(guardedNotification, "id"), false, "notification must remain uncorrelated");
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

function nearCapExponentReservedFrame(id: number, targetFrameBytes: number): string {
  const prefix =
    `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":${JSON.stringify(MCP_VALIDATE_TOOL_NAME)},"arguments":{"kind":"mod","payload":"{}","amplification":[`;
  const between = `],"padding":"`;
  const suffix = `","__proto__":true}}}`;
  const fixedBytes = Buffer.byteLength(`${prefix}${between}${suffix}`, "utf8");
  const availableBytes = targetFrameBytes - fixedBytes;
  const exponentCount = Math.floor((availableBytes + 1) / 5);
  assert.ok(exponentCount > 0);
  const amplification = `${"1e20,".repeat(exponentCount - 1)}1e20`;
  const paddingBytes = availableBytes - Buffer.byteLength(amplification, "utf8");
  assert.ok(paddingBytes >= 0 && paddingBytes < 5);
  const frame = `${prefix}${amplification}${between}${"x".repeat(paddingBytes)}${suffix}`;
  assert.equal(Buffer.byteLength(frame, "utf8"), targetFrameBytes);
  return `${frame}\n`;
}

async function testStdioStdoutPurity(): Promise<void> {
  const subprocess = spawnStdioServer();
  const { child } = subprocess;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const send = async (message: unknown): Promise<void> => {
    await writeInput(child, `${JSON.stringify(message)}\n`);
  };
  const readResponse = async (): Promise<JsonObject> => {
    const next = await withTimeout(iterator.next(), "MCP stdio response");
    assert.equal(next.done, false, `MCP server closed stdout early: ${subprocess.stderr()}`);
    return parseProtocolLine(next.value);
  };

  try {
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcdev-stdio-purity-test", version: "1.0.0" },
      },
    });
    const initialized = await readResponse();
    assert.equal(initialized.id, 1);
    const initializeResult = asObject(initialized.result, "initialize result");
    assert.equal(initializeResult.protocolVersion, LATEST_PROTOCOL_VERSION);
    const initializeCapabilities = asObject(initializeResult.capabilities, "initialize capabilities");
    assert.equal(initializeCapabilities.resources, undefined, "initialize must not advertise resources");
    assert.equal(initializeCapabilities.prompts, undefined, "initialize must not advertise prompts");

    await send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await readResponse();
    assert.equal(listed.id, 2);
    const tools = asObject(listed.result, "tools/list result").tools;
    assert.ok(Array.isArray(tools));
    assert.deepEqual(tools.map((tool) => asObject(tool, "tool").name), [
      MCP_VALIDATE_TOOL_NAME,
      MCP_FABRIC_BUILD_TOOL_NAME,
    ]);
    const rawValidateTool = tools.map((tool) => asObject(tool, "tool"))
      .find((tool) => tool.name === MCP_VALIDATE_TOOL_NAME);
    const listedInputSchema = asObject(
      rawValidateTool?.inputSchema,
      "listed input schema",
    );
    assert.equal(listedInputSchema.additionalProperties, false);
    const listedProperties = asObject(listedInputSchema.properties, "listed input properties");
    assert.deepEqual(Object.keys(listedProperties).sort(), ["kind", "payload"]);
    assert.equal(Object.hasOwn(listedProperties, "__proto__"), false);

    await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: MCP_VALIDATE_TOOL_NAME,
        arguments: { kind: "mod", payload: JSON.stringify(validModFixture) },
      },
    });
    const called = await readResponse();
    assert.equal(called.id, 3);
    assert.equal(called.error, undefined);

    const attackerProfileCall = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: MCP_VALIDATE_TOOL_NAME,
        arguments: {
          kind: "mod",
          payload: JSON.stringify(validModFixture),
          profile: "neoforge-26.1.2-java-25",
        },
      },
    };
    assert.ok(Buffer.byteLength(JSON.stringify(attackerProfileCall), "utf8") < MAX_MCP_STDIO_FRAME_BYTES);
    await send(attackerProfileCall);
    const rejectedProfile = await readResponse();
    assert.equal(rejectedProfile.id, 4);
    assert.equal(rejectedProfile.error, undefined, "SDK 1.29 returns tool validation failures as CallToolResult");
    const rejectedResult = asObject(rejectedProfile.result, "strict raw profile result");
    assert.equal(rejectedResult.isError, true, "strict profile rejection must stop before the handler");
    assert.ok(Array.isArray(rejectedResult.content));
    const rejectedText = rejectedResult.content
      .map((entry) => asObject(entry, "strict profile rejection content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof rejectedText === "string");
    assert.match(rejectedText, /Input validation error/u);
    assert.match(rejectedText, /unrecognized key/iu);
    assert.match(rejectedText, /profile/u);
    assert.doesNotMatch(rejectedText, /"valid":true/u, "the validation handler must not run");

    const maximallyEscapedPayload = "\0".repeat(MAX_INLINE_SPEC_BYTES);
    const escapedCall = {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: MCP_VALIDATE_TOOL_NAME,
        arguments: { kind: "auto", payload: maximallyEscapedPayload },
      },
    };
    const escapedFrameBytes = Buffer.byteLength(JSON.stringify(escapedCall), "utf8");
    assert.ok(escapedFrameBytes > MAX_INLINE_SPEC_BYTES * 5, "test must exercise outer JSON escaping");
    assert.ok(escapedFrameBytes < MAX_MCP_STDIO_FRAME_BYTES, "legitimate max payload must fit frame cap");
    await send(escapedCall);
    const escapedResponse = await readResponse();
    assert.equal(escapedResponse.id, 5);
    assert.equal(escapedResponse.error, undefined);
    const escapedContent = asObject(escapedResponse.result, "escaped tools/call result").content;
    assert.ok(Array.isArray(escapedContent));
    const escapedText = escapedContent.map((entry) => asObject(entry, "escaped content entry"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof escapedText === "string");
    const escapedValidation = asObject(JSON.parse(escapedText) as unknown, "escaped validation result");
    assert.equal(escapedValidation.valid, false);
    assert.ok(Array.isArray(escapedValidation.diagnostics));
    assert.equal(
      asObject(escapedValidation.diagnostics[0], "escaped diagnostic").code,
      "INVALID_JSON",
    );

    const amplificationPayload = JSON.stringify({
      ...validModFixture,
      gameplay: {
        ...validModFixture.gameplay,
        items: Array.from({ length: 40_000 }, () => ({})),
      },
    });
    assert.ok(
      Buffer.byteLength(amplificationPayload, "utf8") <= MAX_INLINE_SPEC_BYTES,
      "the issue-amplification payload must stay within the public payload cap",
    );
    await send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: MCP_VALIDATE_TOOL_NAME,
        arguments: { kind: "mod", payload: amplificationPayload },
      },
    });
    const amplificationResponse = await readResponse();
    assert.equal(amplificationResponse.id, 6);
    assert.equal(amplificationResponse.error, undefined);
    const amplificationContent = asObject(
      amplificationResponse.result,
      "amplification tools/call result",
    ).content;
    assert.ok(Array.isArray(amplificationContent));
    const amplificationText = amplificationContent
      .map((entry) => asObject(entry, "amplification content entry"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof amplificationText === "string");
    const amplificationValidation = asObject(
      JSON.parse(amplificationText) as unknown,
      "amplification validation result",
    );
    assert.equal(amplificationValidation.valid, false);
    assert.ok(Array.isArray(amplificationValidation.diagnostics));
    assert.deepEqual(amplificationValidation.diagnostics, [{
      code: "STRUCTURE_LIMIT_EXCEEDED",
      path: "/gameplay/items",
      message: "Array contains 40000 items; maximum structural limit is 64.",
    }], "preflight must return one structural diagnostic, not a truncated Zod issue list");

    const reservedArgumentsJson =
      `{"kind":"mod","payload":${JSON.stringify(JSON.stringify(validModFixture))},"__proto__":true}`;
    const reservedCallFrame =
      `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":${JSON.stringify(MCP_VALIDATE_TOOL_NAME)},"arguments":${reservedArgumentsJson}}}\n`;
    const parsedReservedCall = asObject(JSON.parse(reservedCallFrame) as unknown, "reserved raw call");
    const parsedReservedParams = asObject(parsedReservedCall.params, "reserved raw call params");
    const parsedReservedArguments = asObject(parsedReservedParams.arguments, "reserved raw call arguments");
    assert.equal(
      Object.hasOwn(parsedReservedArguments, "__proto__"),
      true,
      "regression must exercise JSON.parse own-key semantics",
    );
    await writeInput(child, reservedCallFrame);
    const rejectedReserved = await readResponse();
    assert.equal(rejectedReserved.id, 7);
    assert.equal(rejectedReserved.error, undefined);
    const reservedResult = asObject(rejectedReserved.result, "reserved raw call result");
    assert.equal(reservedResult.isError, true, "reserved argument must stop before the handler");
    assert.ok(Array.isArray(reservedResult.content));
    const reservedText = reservedResult.content
      .map((entry) => asObject(entry, "reserved rejection content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof reservedText === "string");
    assert.match(reservedText, /Input validation error/u);
    assert.match(reservedText, /__proto/u);
    assert.doesNotMatch(reservedText, /"valid":true/u, "the validation handler must not run");

    const escapedReservedArgumentsJson =
      `{"kind":"mod","payload":${JSON.stringify(JSON.stringify(validModFixture))},"\\u005f_proto__":true}`;
    const escapedReservedFrame =
      `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":${JSON.stringify(MCP_VALIDATE_TOOL_NAME)},"arguments":${escapedReservedArgumentsJson}}}\n`;
    const parsedEscapedCall = asObject(JSON.parse(escapedReservedFrame) as unknown, "escaped reserved call");
    const parsedEscapedArguments = asObject(
      asObject(parsedEscapedCall.params, "escaped reserved params").arguments,
      "escaped reserved arguments",
    );
    assert.equal(Object.hasOwn(parsedEscapedArguments, "__proto__"), true, "JSON escape must normalize");
    await writeInput(child, escapedReservedFrame);
    const rejectedEscapedReserved = await readResponse();
    assert.equal(rejectedEscapedReserved.id, 8);
    const escapedReservedResult = asObject(rejectedEscapedReserved.result, "escaped reserved result");
    assert.equal(escapedReservedResult.isError, true);
    assert.ok(Array.isArray(escapedReservedResult.content));
    const escapedReservedText = escapedReservedResult.content
      .map((entry) => asObject(entry, "escaped reserved content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof escapedReservedText === "string");
    assert.match(escapedReservedText, /__proto/u);
    assert.doesNotMatch(escapedReservedText, /"valid":true/u);

    const validModJson = JSON.stringify(validModFixture);
    const payloadContainingReservedText = `{"__proto__":true,${validModJson.slice(1)}`;
    assert.match(payloadContainingReservedText, /"__proto__"/u);
    await send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: MCP_VALIDATE_TOOL_NAME,
        arguments: { kind: "mod", payload: payloadContainingReservedText },
      },
    });
    const payloadTextResponse = await readResponse();
    assert.equal(payloadTextResponse.id, 9);
    const payloadTextResult = asObject(payloadTextResponse.result, "payload text call result");
    assert.equal(payloadTextResult.isError, undefined, "payload text must reach the validator handler");
    assert.ok(Array.isArray(payloadTextResult.content));
    const payloadText = payloadTextResult.content
      .map((entry) => asObject(entry, "payload text content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof payloadText === "string");
    const payloadValidation = asObject(JSON.parse(payloadText) as unknown, "payload text validation");
    assert.equal(payloadValidation.valid, false);
    assert.ok(Array.isArray(payloadValidation.diagnostics));
    assert.equal(asObject(payloadValidation.diagnostics[0], "payload diagnostic").path, "/__proto__");

    const nestedReservedArgumentsJson =
      `{"kind":"mod","payload":${JSON.stringify(JSON.stringify(validModFixture))},"meta":{"__proto__":true}}`;
    const nestedReservedFrame =
      `{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":${JSON.stringify(MCP_VALIDATE_TOOL_NAME)},"arguments":${nestedReservedArgumentsJson}}}\n`;
    const parsedNestedCall = asObject(JSON.parse(nestedReservedFrame) as unknown, "nested reserved call");
    const parsedNestedArguments = asObject(
      asObject(parsedNestedCall.params, "nested reserved params").arguments,
      "nested reserved arguments",
    );
    const parsedNestedMeta = asObject(parsedNestedArguments.meta, "nested reserved meta");
    assert.equal(Object.hasOwn(parsedNestedMeta, "__proto__"), true);
    await writeInput(child, nestedReservedFrame);
    const rejectedNestedReserved = await readResponse();
    assert.equal(rejectedNestedReserved.id, 10);
    const nestedReservedResult = asObject(rejectedNestedReserved.result, "nested reserved result");
    assert.equal(nestedReservedResult.isError, true);
    assert.ok(Array.isArray(nestedReservedResult.content));
    const nestedReservedText = nestedReservedResult.content
      .map((entry) => asObject(entry, "nested reserved content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof nestedReservedText === "string");
    assert.match(nestedReservedText, /meta/u);
    assert.doesNotMatch(nestedReservedText, /"valid":true/u);

    const nearCapFrameBytes = MAX_MCP_STDIO_FRAME_BYTES - 15;
    const nearCapFrame = nearCapExponentReservedFrame(11, nearCapFrameBytes);
    const parsedNearCapCall = asObject(JSON.parse(nearCapFrame) as unknown, "near-cap reserved call");
    const parsedNearCapArguments = asObject(
      asObject(parsedNearCapCall.params, "near-cap reserved params").arguments,
      "near-cap reserved arguments",
    );
    assert.equal(Object.hasOwn(parsedNearCapArguments, "__proto__"), true);
    const naiveReserializedBytes = Buffer.byteLength(JSON.stringify(parsedNearCapCall), "utf8");
    assert.ok(
      naiveReserializedBytes > MAX_MCP_STDIO_FRAME_BYTES * 4,
      "compact exponent values must reproduce post-parse stringify amplification",
    );
    const guardedNearCapFrame = await transformCompleteFrame(nearCapFrame);
    const forwardedNearCapBytes = Buffer.byteLength(guardedNearCapFrame.trimEnd(), "utf8");
    assert.ok(forwardedNearCapBytes <= MAX_MCP_STDIO_FRAME_BYTES);
    const guardedNearCapCall = asObject(JSON.parse(guardedNearCapFrame) as unknown, "guarded near-cap call");
    assert.equal(guardedNearCapCall.id, 11);
    const guardedNearCapArguments = asObject(
      asObject(guardedNearCapCall.params, "guarded near-cap params").arguments,
      "guarded near-cap arguments",
    );
    assert.deepEqual(Object.keys(guardedNearCapArguments), ["__proto_x"]);
    await writeInput(child, nearCapFrame);
    const rejectedNearCap = await readResponse();
    assert.equal(rejectedNearCap.id, 11, "canonical guard must preserve response correlation");
    assert.equal(rejectedNearCap.error, undefined);
    const nearCapResult = asObject(rejectedNearCap.result, "near-cap reserved result");
    assert.equal(nearCapResult.isError, true);
    assert.ok(Array.isArray(nearCapResult.content));
    const nearCapText = nearCapResult.content
      .map((entry) => asObject(entry, "near-cap reserved content"))
      .find((entry) => entry.type === "text")?.text;
    assert.ok(typeof nearCapText === "string");
    assert.doesNotMatch(nearCapText, /"valid":true/u, "near-cap request must not invoke the handler");

    child.stdin.end();
    const exit = await withTimeout(subprocess.exited, "MCP stdio process exit");
    assert.equal(exit.signal, null);
    assert.equal(exit.code, 0, subprocess.stderr());

    const stdout = subprocess.stdout();
    const stdoutLines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
    assert.equal(stdoutLines.length, 11, `unexpected stdout: ${stdout}`);
    for (const line of stdoutLines) parseProtocolLine(line);
  } finally {
    lines.close();
    await stopServer(subprocess);
  }
}

function completeUnknownArgumentFrame(targetBytes: number): string {
  const request = {
    jsonrpc: "2.0",
    id: 99,
    method: "tools/call",
    params: {
      name: MCP_VALIDATE_TOOL_NAME,
      arguments: { kind: "auto", payload: "{}", unknown: "" },
    },
  };
  const emptyBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  assert.ok(targetBytes > emptyBytes);
  request.params.arguments.unknown = "x".repeat(targetBytes - emptyBytes);
  const frame = JSON.stringify(request);
  assert.equal(Buffer.byteLength(frame, "utf8"), targetBytes);
  assert.doesNotThrow(() => JSON.parse(frame) as unknown);
  return frame;
}

async function assertOversizedFrameFailsClosed(input: string, label: string, endInput: boolean): Promise<void> {
  const subprocess = spawnStdioServer();
  try {
    const write = writeInput(subprocess.child, input).catch(() => undefined);
    if (endInput) subprocess.child.stdin.end();
    const exit = await withTimeout(subprocess.exited, label);
    await write;
    assert.equal(exit.signal, null, `${label}: process must exit normally with a failure code`);
    assert.notEqual(exit.code, 0, `${label}: process must fail closed`);
    assert.equal(subprocess.stdout(), "", `${label}: failure must preserve stdout purity`);
    assert.match(
      subprocess.stderr(),
      new RegExp(`MCP stdio frame exceeds ${MAX_MCP_STDIO_FRAME_BYTES} bytes\\.`),
      `${label}: bounded diagnostic missing`,
    );
  } finally {
    await stopServer(subprocess);
  }
}

async function testOversizedStdioFrames(): Promise<void> {
  const targetBytes = MAX_MCP_STDIO_FRAME_BYTES + 1;
  const completeFrame = completeUnknownArgumentFrame(targetBytes);
  await assertOversizedFrameFailsClosed(
    `${completeFrame}\n`,
    "complete oversized unknown argument frame",
    true,
  );

  const unterminatedFrame = "x".repeat(targetBytes);
  assert.equal(Buffer.byteLength(unterminatedFrame, "utf8"), targetBytes);
  await assertOversizedFrameFailsClosed(
    unterminatedFrame,
    "unterminated oversized frame",
    false,
  );
}

async function testHeavilyFragmentedFrame(): Promise<void> {
  const frame = Buffer.from(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: { padding: "x".repeat(32 * 1024) },
  })}\n`, "utf8");
  const boundary = new BoundedJsonLineInput(frame.byteLength - 1);
  const outputPromise = (async (): Promise<Buffer> => {
    const output: Buffer[] = [];
    for await (const chunk of boundary) {
      output.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk)));
    }
    return Buffer.concat(output);
  })();

  for (let offset = 0; offset < frame.byteLength; offset += 1) {
    if (!boundary.write(frame.subarray(offset, offset + 1))) {
      await once(boundary, "drain");
    }
  }
  boundary.end();
  const output = await withTimeout(outputPromise, "heavily fragmented frame");
  assert.deepEqual(output, frame, "one-byte fragmentation must not change the complete frame");
  parseProtocolLine(output.subarray(0, -1).toString("utf8"));

  const smallCap = 32;
  const fragmentedOverflow = new BoundedJsonLineInput(smallCap);
  const overflowError = once(fragmentedOverflow, "error");
  for (let index = 0; index < smallCap + 1; index += 1) {
    fragmentedOverflow.write(Buffer.from("x"));
  }
  const [error] = await withTimeout(overflowError, "fragmented cap+1 frame");
  assert.ok(error instanceof Error);
  assert.equal(error.message, `MCP stdio frame exceeds ${smallCap} bytes.`);
  fragmentedOverflow.destroy();
}

function testWorkspaceRuntimeContract(): void {
  const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const expectedPackageManager =
    "pnpm@11.8.0+sha512.c1f5e7c4cb241c8f174b743851d82f42b802324afc8b0f116b96adb15aa06664948dde36960a3ba1079ba5b4b29dd0140135b94b5b5f5263592249d68e555f26";
  const expectedRegistryIntegrity =
    "sha512-wfXnxMskHI8XS3Q4UdgvQrgCMkr8iw8Ra5atsVqgZmSUjd42lgo7oQebpbSyndAUATW5S1tfUmNZIknWjlVfJg==";
  const packageJson = asObject(
    JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8")) as unknown,
    "root package.json",
  );
  assert.equal(packageJson.packageManager, expectedPackageManager);
  assert.deepEqual(asObject(packageJson.engines, "root engines"), { node: "24.11.0", pnpm: "11.8.0" });
  assert.equal(
    asObject(packageJson.scripts, "root scripts").typecheck,
    "tsc --project tsconfig.json",
    "typecheck must use the project include rather than an explicit root-file list",
  );
  const tsconfig = asObject(
    JSON.parse(readFileSync(resolve(workspaceRoot, "tsconfig.json"), "utf8")) as unknown,
    "root tsconfig",
  );
  assert.deepEqual(tsconfig.include, ["apps/**/*.ts", "fixtures/**/*.ts", "packages/**/*.ts"]);

  const workspaceConfig = readFileSync(resolve(workspaceRoot, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspaceConfig, /^engineStrict: true$/mu);

  const provenance = asObject(
    JSON.parse(
      readFileSync(resolve(workspaceRoot, "docs/provenance/control-plane-dependencies.json"), "utf8"),
    ) as unknown,
    "control-plane provenance",
  );
  assert.ok(Array.isArray(provenance.entries));
  const pnpmEntry = provenance.entries
    .map((entry) => asObject(entry, "provenance entry"))
    .find((entry) => entry.name === "pnpm");
  assert.ok(pnpmEntry !== undefined);
  assert.equal(pnpmEntry.corepackPackageManager, expectedPackageManager);
  assert.equal(pnpmEntry.integrity, expectedRegistryIntegrity);
  assert.equal(pnpmEntry.registryTarball, "https://registry.npmjs.org/pnpm/-/pnpm-11.8.0.tgz");
  const corepackDigest = expectedPackageManager.split("+sha512.")[1];
  assert.ok(corepackDigest !== undefined);
  assert.equal(
    Buffer.from(expectedRegistryIntegrity.slice("sha512-".length), "base64").toString("hex"),
    corepackDigest,
    "Corepack hex digest and registry SRI must identify the same tarball",
  );

  const corepack = resolve(dirname(process.execPath), process.platform === "win32" ? "corepack.cmd" : "corepack");
  const negative = spawnSync(
    corepack,
    [
      "pnpm",
      "--config.node-version=22.22.2",
      "install",
      "--frozen-lockfile",
      "--offline",
      "--ignore-scripts",
    ],
    { cwd: workspaceRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  assert.equal(negative.error, undefined);
  assert.notEqual(negative.status, 0, "engineStrict must reject a deterministic incompatible Node version");
  assert.match(`${negative.stdout}${negative.stderr}`, /ERR_PNPM_UNSUPPORTED_ENGINE/u);
  assert.match(`${negative.stdout}${negative.stderr}`, /Got: 22\.22\.2/u);
}

testWorkspaceRuntimeContract();
await testLinkedInMemoryProtocol();
await testStdioStdoutPurity();
await testOversizedStdioFrames();
await testHeavilyFragmentedFrame();
