import type { Buffer } from "node:buffer";
export function pngChunk(type: string, body?: Buffer): Buffer;
export function conceptFixture(options?: {width?: number; height?: number; filter?: number; interlace?: number; color?: number; extra?: Buffer[]}): Buffer;
