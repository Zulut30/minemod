import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { compileItemAssetPayload } from "../packages/application/item-assets.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(process.argv[2] ?? resolve(root, "fixtures/assets/aurora-longsword-v2.item-asset.json"));
const destination = resolve(process.argv[3] ?? resolve(root, "output/item-preview-v2"));
const payload = readFileSync(source, "utf8");
const request = JSON.parse(payload);
const bundle = compileItemAssetPayload(payload);
mkdirSync(destination, { recursive: true });
for (const file of bundle.files) {
  const target = resolve(destination, file.path);
  if (!target.startsWith(destination + sep)) throw new Error("Asset path escaped output directory.");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(file.content, file.encoding));
}
const native = bundle.files.find(({ path }) => path.endsWith(".json"));
const texture = bundle.files.find(({ path }) => path.endsWith(".png"));
const editable = bundle.files.find(({ path }) => path.endsWith(".bbmodel"));
if (!native || !texture || !editable) throw new Error("Asset bundle is incomplete.");
const data = {
  name: request.model.name,
  colors: request.texturePlan.kind === "item-pixel-texture-plan"
    ? request.texturePlan.palette.map(entry => entry.color)
    : request.texturePlan.materials.map(material => material.colors.base),
  model: JSON.parse(native.content),
  texture: `data:image/png;base64,${texture.content}`,
  files: { model: native.path, texture: texture.path, editable: editable.path },
};
// Экранирование не позволяет имени модели закрыть script-тег в автономном HTML.
const safeData = JSON.stringify(data).replaceAll("<", "\\u003c");
const template = readFileSync(new URL("../templates/item-preview.html", import.meta.url), "utf8");
writeFileSync(resolve(destination, "preview.html"), template.replace("%%ASSET_DATA%%", safeData));
writeFileSync(resolve(destination, "source.item-asset.json"), payload);
writeFileSync(resolve(destination, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
process.stdout.write(JSON.stringify({ preview: resolve(destination, "preview.html"), elements: bundle.elements,
  files: bundle.files.map(({ path, sha256 }) => ({ path, sha256 })), reviewRequired: true }, null, 2) + "\n");
