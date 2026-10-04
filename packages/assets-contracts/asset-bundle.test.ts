import assert from "node:assert/strict";
import { AssetBundleManifestV1Schema, AssetBundleManifestV1JsonSchema, ASSET_BUNDLE_LIMITS, type AssetBundleManifestV1 } from "./asset-bundle.ts";

const header = { schemaVersion: 1 as const, kind: "mcdev-asset-bundle-manifest" as const,
  target: { minecraft: "1.20.1" as const, loader: "fabric" as const, java: 17 as const },
  reviewRequired: true as const, modSpecSha256: null, artSpecSha256: null, namespaces: ["mcdev"] };
type Asset = AssetBundleManifestV1["assets"][number];
const common = { id: "mcdev:test", source: "source/mcdev/test.json", editable: ["editable/mcdev/test.bbmodel"] };
const item: Asset = { ...common, kind: "held-item", references: [{ collection: "items", id: common.id }],
  runtime: { model: "assets/mcdev/models/item/test.json", textures: ["assets/mcdev/textures/item/test.png"] } };
const block: Asset = { ...common, kind: "block", references: [{ collection: "blocks", id: common.id }],
  runtime: { model: "assets/mcdev/models/block/test.json", inventoryModel: "assets/mcdev/models/item/test.json",
    blockstate: "assets/mcdev/blockstates/test.json", textures: ["assets/mcdev/textures/block/test.png"] } };
const armor: Asset = { ...common, kind: "armor", references: [{ collection: "items", id: common.id }],
  runtime: { layer1: "assets/mcdev/textures/models/armor/test_layer_1.png", layer2: "assets/mcdev/textures/models/armor/test_layer_2.png" } };
const entity: Asset = { ...common, kind: "animated-entity", references: [{ collection: "entities", id: common.id }],
  runtime: { geometry: "assets/mcdev/geo/test.geo.json", textures: ["assets/mcdev/textures/entity/test.png"],
    animations: ["assets/mcdev/animations/test.animation.json"], renderer: { id: "mcdev:renderer", version: "1.0.0" } } };
function manifest(asset: Asset): AssetBundleManifestV1 {
  const runtimePaths = Object.values(asset.runtime).flatMap((v) => typeof v === "string" ? [v] : Array.isArray(v) ? v : []);
  const paths = [asset.source, ...asset.editable, ...runtimePaths];
  return { ...header, assets: [asset], files: paths.map((path) => ({ path,
    role: path.startsWith("source/") ? "source" : path.startsWith("editable/") ? "editable" :
      path.endsWith(".png") ? "texture" : path.includes("/blockstates/") ? "blockstate" :
      path.includes("/animations/") ? "animation" : "model",
    encoding: path.endsWith(".png") ? "base64" : "utf8", bytes: 32, sha256: "0".repeat(64) })) };
}
const samples = [item, block, armor, entity].map(manifest);
for (const m of samples) assert.deepEqual(AssetBundleManifestV1Schema.parse(m), m);
let rejected = 0;
function rejects(value: unknown): void {
  assert.equal(AssetBundleManifestV1Schema.safeParse(value).success, false);
  rejected++;
}
for (const m of samples) {
  rejects({ ...m, files: m.files.slice(1) });
  rejects({ ...m, files: m.files.map((f) => ({ ...f, role: "source" })) });
  rejects({ ...m, files: [...m.files, m.files[0]] });
  rejects({ ...m, assets: [...m.assets, m.assets[0]] });
  rejects({ ...m, namespaces: ["other"] });
  rejects({ ...m, namespaces: ["mcdev", "mcdev"] });
  rejects({ ...m, assets: [{ ...m.assets[0], references: [{ collection: "wrong", id: common.id }] }] });
  rejects({ ...m, assets: [{ ...m.assets[0], references: [{ collection: m.assets[0]!.references[0]!.collection, id: "other:test" }] }] });
  rejects({ ...m, files: [...m.files, { ...m.files[0], path: "source/mcdev/unused.json" }] });
  rejects({ ...m, reviewRequired: false });
  rejects({ ...m, humanApproved: true });
  rejects({ ...m, schemaVersion: 2 });
}
const base = samples[0]!;
for (const id of ["", "missing-colon", ":", ".:test", "..:test", "mcdev:../test", "mcdev:a//test"]) {
  rejects({ ...base, assets: [{ ...item, id }] });
  rejects({ ...base, assets: [{ ...item, references: [{ collection: "items", id }] }] });
}
for (const path of ["source/mcdev/../test.json", "source//test.json", "source/mcdev/./test.json", "C:/test.json",
  "source/mcdev/con.json", "source/mcdev/lpt1.json", "source/mcdev/nul/test.json", "source/mcdev/a./test.json",
  "source/mcdev/test.JSON", "source/mcdev/test\\x.json", "source/mcdev/test.json:ads", "/source/mcdev/test.json"]) {
  rejects({ ...base, files: [{ ...base.files[0], path }, ...base.files.slice(1)], assets: [{ ...item, source: path }] });
}
rejects({ ...base, files: base.files.map((f) => ({ ...f, bytes: ASSET_BUNDLE_LIMITS.fileBytes })) });
rejects({ ...base, files: base.files.map((f) => ({ ...f, encoding: f.encoding === "base64" ? "utf8" : "base64" })) });
rejects({ ...base, assets: [{ ...item, kind: "armor" }] });
rejects({ ...base, assets: [{ ...item, references: [{ collection: "blocks", id: common.id }] }] });
rejects({ ...base, assets: [{ ...item, runtime: { ...item.runtime, model: block.runtime.model } }] });
rejects({ ...samples[1], assets: [{ ...block, runtime: { ...block.runtime, inventoryModel: block.runtime.model } }] });
rejects({ ...samples[2], assets: [{ ...armor, runtime: { ...armor.runtime, layer2: armor.runtime.layer1 } }] });
rejects({ ...samples[3], assets: [{ ...entity, runtime: { ...entity.runtime, renderer: { id: "mcdev:renderer", version: "latest" } } }] });
rejects({ ...samples[3], assets: [{ ...entity, runtime: { ...entity.runtime, geometry: item.runtime.model } }] });
assert.equal(AssetBundleManifestV1JsonSchema.$id.endsWith("asset-bundle-manifest-v1.json"), true);
process.stdout.write(`Asset bundle v1 contract: PASS (4 classes, ${rejected} rejected manifests).\n`);
