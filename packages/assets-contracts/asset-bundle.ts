import { z } from "zod";

export const ASSET_BUNDLE_LIMITS = Object.freeze({
  files: 64,
  assets: 16,
  fileBytes: 2_097_152,
  totalBytes: 4_194_304,
  payloadBytes: 8_388_608,
});
const namespace = z.string().regex(/^[a-z0-9_.-]{1,64}$/u)
  .refine((s) => s !== "." && s !== "..");
const resource = z.string().max(193).regex(/^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,128}$/u)
  .refine((s) => {
    const [ns, name] = s.split(":");
    return ns !== "." && ns !== ".." && name !== undefined &&
      name.split("/").every((part) => part && part !== "." && part !== "..");
  });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const path = z.string().max(256).regex(/^(source|editable|assets)\/[a-z0-9_./-]+$/u)
  .refine((s) => s.split("/").every((part) => part && part !== "." && part !== ".." &&
    !part.endsWith(".") && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u.test(part)),
  "Путь содержит traversal, пустой сегмент или неподдерживаемое Windows-имя.");
const common = {
  id: resource,
  source: path,
  editable: z.array(path).min(1).max(8),
  references: z.array(z.strictObject({
    collection: z.enum(["items", "blocks", "entities"]),
    id: resource,
  })).min(1).max(32),
};
const textures = z.array(path).min(1).max(16);
const AssetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("held-item"),
    runtime: z.strictObject({ model: path, textures }),
  }),
  z.strictObject({ ...common, kind: z.literal("block"),
    runtime: z.strictObject({ model: path, blockstate: path, inventoryModel: path, textures }),
  }),
  z.strictObject({ ...common, kind: z.literal("armor"),
    runtime: z.strictObject({ layer1: path, layer2: path }),
  }),
  z.strictObject({ ...common, kind: z.literal("animated-entity"),
    runtime: z.strictObject({ geometry: path, textures, animations: z.array(path).min(1).max(32),
      renderer: z.strictObject({ id: resource,
        version: z.string().max(64).regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u),
      }),
    }),
  }),
]);
export const AssetBundleManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("mcdev-asset-bundle-manifest"),
  target: z.strictObject({ minecraft: z.literal("1.20.1"), loader: z.literal("fabric"), java: z.literal(17) }),
  reviewRequired: z.literal(true),
  modSpecSha256: sha256.nullable(),
  artSpecSha256: sha256.nullable(),
  namespaces: z.array(namespace).min(1).max(16),
  files: z.array(z.strictObject({
    path, role: z.enum(["source", "editable", "model", "texture", "blockstate", "animation"]),
    encoding: z.enum(["utf8", "base64"]), bytes: z.number().int().min(1).max(ASSET_BUNDLE_LIMITS.fileBytes), sha256,
  })).min(1).max(ASSET_BUNDLE_LIMITS.files),
  assets: z.array(AssetSchema).min(1).max(ASSET_BUNDLE_LIMITS.assets),
}).superRefine((m, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const files = new Map(m.files.map((f) => [f.path, f]));
  if (files.size !== m.files.length) issue("Пути файлов должны быть уникальны.");
  if (new Set(m.namespaces).size !== m.namespaces.length) issue("Namespaces должны быть уникальны.");
  if (new Set(m.assets.map((a) => `${a.kind}:${a.id}`)).size !== m.assets.length) issue("Asset IDs должны быть уникальны внутри класса.");
  if (m.files.reduce((n, f) => n + f.bytes, 0) > ASSET_BUNDLE_LIMITS.totalBytes) issue("Bundle превышает бюджет decoded bytes.");
  const referenced = new Set<string>(), usedNamespaces = new Set<string>();
  const use = (name: string, role: string, ns: string) => {
    referenced.add(name);
    const file = files.get(name);
    if (!file || file.role !== role) issue(`Отсутствует ${role} resource: ${name}`);
    const prefix = role === "source" ? `source/${ns}/` : role === "editable" ? `editable/${ns}/` : `assets/${ns}/`;
    if (!name.startsWith(prefix)) issue(`Resource namespace не совпадает: ${name}`);
  };
  for (const file of m.files) {
    const p = file.path;
    const valid = file.role === "source" ? p.startsWith("source/") && p.endsWith(".json") :
      file.role === "editable" ? p.startsWith("editable/") && /\.(bbmodel|json|png)$/u.test(p) :
      file.role === "model" ? /^assets\/[^/]+\/(models|geo)\/.+\.json$/u.test(p) :
      file.role === "texture" ? /^assets\/[^/]+\/textures\/.+\.png$/u.test(p) :
      file.role === "blockstate" ? /^assets\/[^/]+\/blockstates\/.+\.json$/u.test(p) :
      /^assets\/[^/]+\/animations\/.+\.json$/u.test(p);
    if (!valid || file.encoding !== (p.endsWith(".png") ? "base64" : "utf8")) issue(`Тип или encoding файла не совпадает: ${p}`);
  }
  for (const asset of m.assets) {
    const ns = asset.id.split(":")[0]!;
    usedNamespaces.add(ns);
    use(asset.source, "source", ns);
    for (const editable of asset.editable) use(editable, "editable", ns);
    if (new Set(asset.editable).size !== asset.editable.length) issue("Editable references должны быть уникальны.");
    const collection = asset.kind === "block" ? "blocks" : asset.kind === "animated-entity" ? "entities" : "items";
    for (const reference of asset.references) {
      if (reference.collection !== collection || reference.id.split(":")[0] !== ns) issue("Неверный тип или namespace ModSpec reference.");
    }
    if (new Set(asset.references.map((r) => `${r.collection}:${r.id}`)).size !== asset.references.length) issue("ModSpec references должны быть уникальны.");
    if (asset.kind === "armor") {
      use(asset.runtime.layer1, "texture", ns); use(asset.runtime.layer2, "texture", ns);
      if (asset.runtime.layer1 === asset.runtime.layer2) issue("Armor layers должны иметь разные paths.");
    } else {
      for (const texture of asset.runtime.textures) use(texture, "texture", ns);
      if (new Set(asset.runtime.textures).size !== asset.runtime.textures.length) issue("Texture references должны быть уникальны.");
      if (asset.kind === "animated-entity") {
        use(asset.runtime.geometry, "model", ns);
        if (!asset.runtime.geometry.startsWith(`assets/${ns}/geo/`)) issue("Animated geometry требует geo path.");
        for (const animation of asset.runtime.animations) use(animation, "animation", ns);
        if (new Set(asset.runtime.animations).size !== asset.runtime.animations.length) issue("Animation references должны быть уникальны.");
      } else {
        use(asset.runtime.model, "model", ns);
        const category = asset.kind === "held-item" ? "item" : "block";
        if (!asset.runtime.model.startsWith(`assets/${ns}/models/${category}/`)) issue("Model path не соответствует классу ассета.");
        if (asset.kind === "block") {
          use(asset.runtime.blockstate, "blockstate", ns); use(asset.runtime.inventoryModel, "model", ns);
          if (!asset.runtime.inventoryModel.startsWith(`assets/${ns}/models/item/`)) issue("Block inventory model требует item path.");
        }
      }
    }
  }
  if (m.namespaces.length !== usedNamespaces.size || m.namespaces.some((ns) => !usedNamespaces.has(ns))) issue("Declared namespaces не совпадают с ассетами.");
  for (const name of files.keys()) if (!referenced.has(name)) issue(`Файл не связан с ассетом: ${name}`);
});
export type AssetBundleManifestV1 = z.infer<typeof AssetBundleManifestV1Schema>;
export const AssetBundleV1Schema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("mcdev-asset-bundle"),
  manifest: AssetBundleManifestV1Schema, manifestSha256: sha256,
  files: z.array(z.strictObject({ path, encoding: z.enum(["utf8", "base64"]),
    content: z.string().min(1).max(ASSET_BUNDLE_LIMITS.fileBytes * 2),
  })).min(1).max(ASSET_BUNDLE_LIMITS.files),
});
export type AssetBundleV1 = z.infer<typeof AssetBundleV1Schema>;
export const AssetBundleManifestV1JsonSchema = Object.freeze({
  ...z.toJSONSchema(AssetBundleManifestV1Schema),
  $id: "https://mcdev.local/schemas/asset-bundle-manifest-v1.json",
});
