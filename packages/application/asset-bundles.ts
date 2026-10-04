import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { AssetBundleV1Schema, ASSET_BUNDLE_LIMITS, type AssetBundleV1, type AssetBundleManifestV1 } from "@mcdev/assets-contracts";
import { canonicalJsonFileBytes } from "@mcdev/codegen-core";
import { MinecraftItemModelError } from "@mcdev/assets-core";
import { compileItemAssetPayload } from "./item-assets.ts";
import { verifyBundlePng } from "./bundle-png.ts";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function invalid(message: string): never { throw new MinecraftItemModelError(message); }
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Проверяет целостность данных, не выдаёт human approval и не запускает renderer. */
export function verifyAssetBundleV1(value: unknown): AssetBundleV1 {
  const parsed = AssetBundleV1Schema.safeParse(value);
  if (!parsed.success) invalid(`Некорректный asset bundle: ${parsed.error.issues[0]?.message ?? "schema"}`);
  const bundle = parsed.data;
  if (digest(canonicalJsonFileBytes(bundle.manifest)) !== bundle.manifestSha256) invalid("Manifest SHA-256 не совпадает.");
  const descriptors = new Map(bundle.manifest.files.map((f) => [f.path, f]));
  if (bundle.files.length !== descriptors.size || new Set(bundle.files.map((f) => f.path)).size !== bundle.files.length)
    invalid("Набор содержимого не совпадает с manifest files.");
  for (const file of bundle.files) {
    const descriptor = descriptors.get(file.path);
    if (!descriptor || descriptor.encoding !== file.encoding) invalid("Отсутствует file descriptor или encoding не совпадает.");
    if (file.encoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.content))
      invalid("File content требует canonical base64.");
    const bytes = Buffer.from(file.content, file.encoding);
    if (bytes.toString(file.encoding) !== file.content || bytes.length !== descriptor.bytes || digest(bytes) !== descriptor.sha256)
      invalid("File bytes, encoding или SHA-256 не совпадают.");
    if (file.encoding === "utf8") {
      let json: unknown;
      try { json = JSON.parse(file.content); } catch { invalid("JSON/Blockbench resource повреждён."); }
      if (typeof json !== "object" || json === null || Array.isArray(json)) invalid("JSON resource требует object root.");
    } else {
      verifyBundlePng(bytes);
    }
  }
  return freeze(bundle);
}
export function verifyAssetBundlePayloadV1(payload: string): AssetBundleV1 {
  if (typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > ASSET_BUNDLE_LIMITS.payloadBytes)
    invalid("Asset bundle превышает bounded JSON limit.");
  let value: unknown;
  try { value = JSON.parse(payload); } catch { invalid("Asset bundle требует корректный JSON."); }
  return verifyAssetBundleV1(value);
}

/** Текущий exporter выпускает held-item; другие классы manifest не включают новые renderer capabilities. */
export function compileItemAssetBundleV1(payload: string): AssetBundleV1 {
  const legacy = compileItemAssetPayload(payload);
  const request = JSON.parse(payload) as { model: { id: string } };
  const id = request.model.id, [ns, name] = id.split(":");
  const source = { path: `source/${ns}/${name}.item-asset.json`, encoding: "utf8" as const, content: payload };
  const files = [...legacy.files.map(({ path, encoding, content }) => ({ path, encoding, content })), source];
  const manifest: AssetBundleManifestV1 = {
    schemaVersion: 1, kind: "mcdev-asset-bundle-manifest",
    target: { minecraft: "1.20.1", loader: "fabric", java: 17 }, reviewRequired: true,
    modSpecSha256: null, artSpecSha256: null, namespaces: [ns!],
    files: files.map((file, i) => {
      const bytes = Buffer.from(file.content, file.encoding);
      return { path: file.path, encoding: file.encoding,
        role: (["model", "texture", "editable", "source"] as const)[i]!, bytes: bytes.length, sha256: digest(bytes) };
    }),
    assets: [{ kind: "held-item", id, source: source.path, editable: [files[2]!.path],
      references: [{ collection: "items", id }], runtime: { model: files[0]!.path, textures: [files[1]!.path] } }],
  };
  return verifyAssetBundleV1({ schemaVersion: 1, kind: "mcdev-asset-bundle", manifest,
    manifestSha256: digest(canonicalJsonFileBytes(manifest)), files });
}
