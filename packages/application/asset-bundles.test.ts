import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { canonicalJsonFileBytes } from "@mcdev/codegen-core";
import { ASSET_BUNDLE_LIMITS, type AssetBundleV1 } from "@mcdev/assets-contracts";
import { compileItemAssetPayload } from "./item-assets.ts";
import { compileItemAssetBundleV1, verifyAssetBundleV1, verifyAssetBundlePayloadV1 } from "./asset-bundles.ts";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const clone = (b: AssetBundleV1): AssetBundleV1 => structuredClone(b);
function sign(b: AssetBundleV1): void { b.manifestSha256 = hash(canonicalJsonFileBytes(b.manifest)); }
function replaceContent(b: AssetBundleV1, index: number, content: string): void {
  const f = b.files[index]!; f.content = content;
  const bytes = Buffer.from(content, f.encoding), d = b.manifest.files.find((d) => d.path === f.path)!;
  d.bytes = bytes.length; d.sha256 = hash(bytes); sign(b);
}
let rejected = 0;
function rejects(value: unknown, message?: RegExp): void {
  assert.throws(() => verifyAssetBundleV1(value), message ?? { code: "SPEC_UNSUPPORTED" }); rejected++;
}
const payload = readFileSync(new URL("../../fixtures/assets/aurora-longsword.item-asset.json", import.meta.url), "utf8");
const bundle = compileItemAssetBundleV1(payload), legacy = compileItemAssetPayload(payload);
assert.deepEqual(bundle.manifest.target, { minecraft: "1.20.1", loader: "fabric", java: 17 });
assert.equal(bundle.manifest.reviewRequired, true);
assert.equal(bundle.manifest.modSpecSha256, null, "Unbound source cannot claim a ModSpec digest.");
assert.equal(bundle.manifest.artSpecSha256, null);
assert.equal(bundle.manifestSha256, hash(canonicalJsonFileBytes(bundle.manifest)));
assert.deepEqual(compileItemAssetBundleV1(payload), bundle);
assert.equal(bundle.files.length, 4);
assert.equal(bundle.files[3]!.content, payload, "Source bytes must be preserved including whitespace.");
assert.deepEqual(bundle.manifest.assets[0]?.references, [{ collection: "items", id: "mcdev:aurora_longsword" }]);
assert.deepEqual(verifyAssetBundlePayloadV1(JSON.stringify(bundle)), bundle);
assert.equal(Object.isFrozen(bundle), true);
assert.equal(Object.isFrozen(bundle.manifest.assets[0]?.runtime), true);
for (let i = 0; i < bundle.files.length; i++) {
  const file = bundle.files[i]!, descriptor = bundle.manifest.files[i]!, bytes = Buffer.from(file.content, file.encoding);
  assert.equal(hash(bytes), descriptor.sha256); assert.equal(bytes.length, descriptor.bytes);
  if (i < 3) assert.equal(descriptor.sha256, legacy.files[i]!.sha256, "Legacy runtime bytes must remain identical.");
  const changed = clone(bundle); changed.files[i]!.content += "x"; rejects(changed, /bytes|base64/u);
}
const paintedPayload = readFileSync(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8");
assert.equal(Buffer.from(compileItemAssetBundleV1(paintedPayload).files[1]!.content, "base64").readUInt32BE(16), 256);
const nested = JSON.parse(payload) as { model: { id: string }; texturePlan: { modelId: string } };
nested.model.id = nested.texturePlan.modelId = "mcdev:weapons/aurora_longsword";
assert.equal(compileItemAssetBundleV1(JSON.stringify(nested)).manifest.assets[0]?.source, "source/mcdev/weapons/aurora_longsword.item-asset.json");
const wrongDigest = clone(bundle); wrongDigest.manifestSha256 = "0".repeat(64); rejects(wrongDigest, /Manifest SHA/u);
const missing = clone(bundle); missing.files.pop(); rejects(missing, /Набор/u);
const duplicate = clone(bundle); duplicate.files[3] = duplicate.files[0]!; rejects(duplicate, /Набор/u);
const wrongPath = clone(bundle); wrongPath.files[3]!.path = "source/mcdev/other.json"; rejects(wrongPath, /descriptor/u);
const wrongEncoding = clone(bundle); wrongEncoding.files[3]!.encoding = "base64"; rejects(wrongEncoding, /encoding/u);
const missingResource = clone(bundle); missingResource.manifest.files.pop(); sign(missingResource); rejects(missingResource, /Отсутствует/u);
const wrongRole = clone(bundle); wrongRole.manifest.files[0]!.role = "source"; sign(wrongRole); rejects(wrongRole, /не совпадает|Отсутствует/u);
rejects({ ...bundle, schemaVersion: 2 });
rejects({ ...bundle, humanApproved: true });
rejects({ ...bundle, manifest: { ...bundle.manifest, reviewRequired: false } });
for (const json of ["null", "[]", "{", '"string"']) {
  const b = clone(bundle); replaceContent(b, 0, json); rejects(b, /JSON/u);
}
const surrogate = clone(bundle); replaceContent(surrogate, 3, '{"name":"\ud800"}'); rejects(surrogate, /encoding/u);
const nonCanonical = clone(bundle); nonCanonical.files[1]!.content += "\n"; rejects(nonCanonical, /base64/u);
const badCrc = clone(bundle), corruptPng = Buffer.from(badCrc.files[1]!.content, "base64");
corruptPng[corruptPng.length - 1]! ^= 1;
replaceContent(badCrc, 1, corruptPng.toString("base64")); rejects(badCrc, /PNG/u);
const truncated = clone(bundle); replaceContent(truncated, 1, corruptPng.subarray(0, 33).toString("base64")); rejects(truncated, /PNG/u);

// Корректные CRC/хеши не должны скрывать decompression bomb, неверные scanlines или trailing streams.
function chunk(type: string, data: Buffer): Buffer {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4, "ascii"); data.copy(b, 8);
  let crc = 0xffffffff;
  for (const byte of b.subarray(4, b.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b;
}
const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
function png(scanlines: Buffer, suffix = Buffer.alloc(0)): string {
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", Buffer.concat([deflateSync(scanlines), suffix])), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
const tiny = clone(bundle); replaceContent(tiny, 1, png(Buffer.alloc(5))); verifyAssetBundleV1(tiny);
for (const content of [png(Buffer.alloc(1_000_000)), png(Buffer.alloc(4)), png(Buffer.from([5, 0, 0, 0, 0])), png(Buffer.alloc(5), Buffer.from([1]))]) {
  const b = clone(bundle); replaceContent(b, 1, content); rejects(b, /PNG/u);
}
for (const invalid of ["{", "[]", "{}", "я".repeat(ASSET_BUNDLE_LIMITS.payloadBytes / 2 + 1)]) {
  assert.throws(() => verifyAssetBundlePayloadV1(invalid), { code: "SPEC_UNSUPPORTED" }); rejected++;
}
assert.throws(() => compileItemAssetBundleV1("{}"), { code: "SPEC_UNSUPPORTED" });
process.stdout.write(`Asset bundle v1 integrity: PASS (native/painted/nested source, ${rejected} rejected payloads).\n`);
