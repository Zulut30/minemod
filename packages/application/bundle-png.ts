import { Buffer } from "node:buffer";
import { inflateSync, type Inflate } from "node:zlib";
import { MinecraftItemModelError } from "@mcdev/assets-core";

function invalid(): never { throw new MinecraftItemModelError("Texture требует целый bounded RGBA8 PNG: IHDR/IDAT/IEND, 1..256 px."); }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Профиль нашего exporter: RGBA8, без interlace/ancillary chunks; bounded inflate. */
export function verifyBundlePng(bytes: Buffer): void {
  if (bytes.length < 57 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") invalid();
  let offset = 8, width = 0, height = 0, ended = false, chunks = 0;
  const data: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length || ++chunks > 1024) invalid();
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) invalid();
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      if (width < 1 || width > 256 || height < 1 || height > 256 ||
        bytes[offset + 16] !== 8 || bytes[offset + 17] !== 6 ||
        bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) invalid();
    } else if (type === "IDAT") {
      if (!width || ended) invalid();
      data.push(bytes.subarray(offset + 8, end - 4));
    } else if (type === "IEND") {
      if (!width || !data.length || length !== 0 || end !== bytes.length) invalid();
      ended = true;
    } else invalid();
    offset = end;
  }
  if (!ended) invalid();
  const compressed = Buffer.concat(data), expected = (width * 4 + 1) * height;
  let result: { buffer: Buffer; engine: Inflate };
  try {
    // Node возвращает объект при info=true; @types/node не моделирует этот overload.
    result = inflateSync(compressed, { maxOutputLength: expected, info: true }) as unknown as typeof result;
  } catch { invalid(); }
  if (result.buffer.length !== expected || result.engine.bytesWritten !== compressed.length) invalid();
  for (let y = 0; y < height; y++) if (result.buffer[y * (width * 4 + 1)]! > 4) invalid();
}
