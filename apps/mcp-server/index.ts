#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Transform, type TransformCallback } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  MAX_INLINE_SPEC_BYTES,
  validateInlineSpec,
} from "@mcdev/validation";

export const MCP_SERVER_NAME = "@mcdev/mcp-server";
export const MCP_SERVER_VERSION = "0.0.0-phase.0";
export const MCP_VALIDATE_TOOL_NAME = "mcdev_spec_validate";
// A payload can expand by up to 6x when control characters are escaped in the
// outer JSON-RPC string. Two MiB admits that worst case plus a bounded envelope.
export const MAX_MCP_STDIO_FRAME_BYTES = 2 * 1024 * 1024;
const MCP_STDIO_NEWLINE = Buffer.from("\n");
// Same UTF-8/key length as `__proto__`, but not special-cased by the SDK's
// generic JSON-RPC Zod parser. The public strict tool schema rejects it.
const MCP_RESERVED_ARGUMENT_SENTINEL = "__proto_x";

function asParsedJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parsedOwnValue(object: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function guardOriginalMcpArguments(frame: Buffer, maxFrameBytes: number): Buffer {
  let message: unknown;
  try {
    message = JSON.parse(frame.toString("utf8")) as unknown;
  } catch {
    return frame;
  }
  const request = asParsedJsonObject(message);
  if (request === undefined || parsedOwnValue(request, "method") !== "tools/call") return frame;
  const params = asParsedJsonObject(parsedOwnValue(request, "params"));
  const args = params === undefined ? undefined : asParsedJsonObject(parsedOwnValue(params, "arguments"));
  if (args === undefined || !Object.hasOwn(args, "__proto__")) return frame;

  // The boundary value came directly from JSON.parse, so it has no proxies or
  // accessors. Never stringify attacker-controlled values again: compact JSON
  // numbers such as 1e20 can expand dramatically. Instead, forward a small
  // canonical request that preserves only an SDK-valid scalar request id. A
  // missing/invalid id remains notification-like (no response correlation).
  const requestId = parsedOwnValue(request, "id");
  const hasValidRequestId = typeof requestId === "string" ||
    (typeof requestId === "number" && Number.isFinite(requestId));
  const guardedMessage: Record<string, unknown> = {
    jsonrpc: "2.0",
    ...(hasValidRequestId ? { id: requestId } : {}),
    method: "tools/call",
    params: {
      name: MCP_VALIDATE_TOOL_NAME,
      arguments: { [MCP_RESERVED_ARGUMENT_SENTINEL]: true },
    },
  };
  const guardedFrame = Buffer.from(JSON.stringify(guardedMessage), "utf8");
  if (guardedFrame.byteLength > maxFrameBytes) {
    throw new Error(`MCP guarded frame exceeds ${maxFrameBytes} bytes.`);
  }
  return guardedFrame;
}

export class BoundedJsonLineInput extends Transform {
  readonly #maxFrameBytes: number;
  readonly #frameBuffer: Buffer;
  #frameBytes = 0;

  constructor(maxFrameBytes = MAX_MCP_STDIO_FRAME_BYTES) {
    super();
    if (
      !Number.isSafeInteger(maxFrameBytes) ||
      maxFrameBytes < 1 ||
      maxFrameBytes > MAX_MCP_STDIO_FRAME_BYTES
    ) {
      throw new RangeError(`MCP stdio frame limit must be between 1 and ${MAX_MCP_STDIO_FRAME_BYTES} bytes.`);
    }
    this.#maxFrameBytes = maxFrameBytes;
    // One fixed allocation makes retained memory and object count independent
    // of attacker-controlled chunk fragmentation.
    this.#frameBuffer = Buffer.allocUnsafe(maxFrameBytes);
  }

  #append(source: Buffer, start: number, end: number): boolean {
    const segmentBytes = end - start;
    if (this.#frameBytes + segmentBytes > this.#maxFrameBytes) return false;
    if (segmentBytes > 0) {
      source.copy(this.#frameBuffer, this.#frameBytes, start, end);
      this.#frameBytes += segmentBytes;
    }
    return true;
  }

  #emitFrame(): void {
    if (this.#frameBytes > 0) {
      const frame = Buffer.allocUnsafe(this.#frameBytes);
      this.#frameBuffer.copy(frame, 0, 0, this.#frameBytes);
      this.push(guardOriginalMcpArguments(frame, this.#maxFrameBytes));
    }
    this.push(MCP_STDIO_NEWLINE);
    this.#frameBytes = 0;
  }

  override _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    let offset = 0;

    while (offset < bytes.byteLength) {
      const newlineIndex = bytes.indexOf(0x0a, offset);
      const segmentEnd = newlineIndex === -1 ? bytes.byteLength : newlineIndex;
      if (!this.#append(bytes, offset, segmentEnd)) {
        callback(new Error(`MCP stdio frame exceeds ${this.#maxFrameBytes} bytes.`));
        return;
      }
      if (newlineIndex === -1) {
        callback();
        return;
      }
      try {
        this.#emitFrame();
      } catch (error) {
        callback(error instanceof Error ? error : new Error("MCP guarded frame construction failed."));
        return;
      }
      offset = newlineIndex + 1;
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    if (this.#frameBytes > 0) {
      callback(new Error("MCP stdio ended with an incomplete JSON-RPC frame."));
      return;
    }
    callback();
  }
}

export const McpValidateInputSchema = z.strictObject({
  // Zod 4.4.2 deliberately skips `__proto__` in strict-object unknown-key
  // handling. For ordinary parsed JSON, a missing key resolves to the inherited
  // Object.prototype object; every own JSON value is distinct and is rejected
  // here while Zod is still reading the original arguments. The optional
  // unknown refinement is omitted by z.toJSONSchema, so tools/list continues to
  // declare only the two supported public properties.
  ["__proto__"]: z.unknown()
    .refine((value) => value === Object.prototype, "Reserved argument \"__proto__\" is not allowed.")
    .optional(),
  kind: z.enum(["auto", "mod", "art"]).default("auto"),
  payload: z.string().max(MAX_INLINE_SPEC_BYTES),
});

type McpValidate = (
  payload: string,
  kind: "auto" | "mod" | "art",
) => ReturnType<typeof validateInlineSpec>;

export function createMcpServer(
  validate: McpValidate = validateInlineSpec,
): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
  server.registerTool(
    MCP_VALIDATE_TOOL_NAME,
    {
      description: "Validate one bounded inline ModSpec v0 or ArtSpec v0 locally with loader-neutral validation.",
      inputSchema: McpValidateInputSchema,
    },
    ({ kind, payload }) => {
      const result = validate(payload, kind);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );
  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const boundedInput = new BoundedJsonLineInput();
  const transport = new StdioServerTransport(boundedInput, process.stdout);
  const inputFinished = new Promise<void>((resolve, reject) => {
    boundedInput.once("end", resolve);
    boundedInput.once("error", reject);
  });
  // Keep a rejection handler attached even if SDK startup itself fails first.
  void inputFinished.catch(() => undefined);

  process.stdin.pipe(boundedInput);
  try {
    await server.connect(transport);
    await inputFinished;
  } finally {
    process.stdin.unpipe(boundedInput);
    // This process owns stdio; closing the hostile input handle is required so
    // an unterminated oversized writer cannot keep the fail-closed process alive.
    process.stdin.destroy();
    await server.close();
    boundedInput.destroy();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMcpServer().catch((error: unknown) => {
    process.stderr.write(`mcdev MCP server failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
