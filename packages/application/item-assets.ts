import { createHash } from "node:crypto";
import {
  compileMinecraftItemModel,
  compileMinecraftItemBlockbenchModel,
  compilePaintedMinecraftItemAssets,
  MinecraftItemModelError,
} from "@mcdev/assets-core";

export const MAX_ITEM_ASSET_PAYLOAD_BYTES = 262_144;

export interface ItemAssetFile {
  readonly path: string;
  readonly encoding: "utf8" | "base64";
  readonly content: string;
  readonly sha256: string;
}

export interface ItemAssetBundle {
  readonly kind: "minecraft-item-asset-bundle";
  readonly minecraft: "1.20.1";
  readonly elements: number;
  readonly reviewRequired: true;
  readonly files: readonly ItemAssetFile[];
}

export function itemAssetDiagnostic(error: unknown): { readonly code: string; readonly message: string } {
  return error instanceof MinecraftItemModelError
    ? { code: error.code, message: error.message.slice(0, 512) }
    : { code: "INTERNAL_ERROR", message: "Item asset compilation failed safely." };
}

export function compileItemAssetPayload(payload: string): ItemAssetBundle {
  if (typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > MAX_ITEM_ASSET_PAYLOAD_BYTES) {
    throw new MinecraftItemModelError("Item asset payload exceeds the bounded inline JSON limit.");
  }
  let value: unknown;
  try { value = JSON.parse(payload) as unknown; }
  catch { throw new MinecraftItemModelError("Item asset payload must be valid JSON."); }
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "kind,model,schemaVersion,texturePlan") {
    throw new MinecraftItemModelError("Item asset payload requires only schemaVersion, kind, model and texturePlan.");
  }
  const request = value as Record<string, unknown>;
  if (request.schemaVersion !== 0 || request.kind !== "minecraft-item-asset") {
    throw new MinecraftItemModelError("Item asset payload requires schemaVersion 0 and kind minecraft-item-asset.");
  }
  let native: ReturnType<typeof compileMinecraftItemModel>;
  let editable: ReturnType<typeof compileMinecraftItemBlockbenchModel>;
  try {
    if (typeof request.texturePlan === "object" && request.texturePlan !== null &&
      "kind" in request.texturePlan && request.texturePlan.kind === "item-pixel-texture-plan") {
      ({ native, editable } = compilePaintedMinecraftItemAssets(request.model, request.texturePlan));
    } else {
      native = compileMinecraftItemModel(request.model);
      editable = compileMinecraftItemBlockbenchModel(request.model, request.texturePlan);
    }
  }
  catch (error) {
    if (error instanceof TypeError) throw new MinecraftItemModelError(error.message.slice(0, 512));
    throw error;
  }
  const editablePath = `editable/${native.modelPath.slice("assets/".length).replace("/models/item/", "/").replace(/\.json$/u, ".bbmodel")}`;
  const files: ItemAssetFile[] = [
    { path: native.modelPath, encoding: "utf8", content: native.text, sha256: native.sha256 },
    { path: native.texturePath, encoding: "base64", content: Buffer.from(editable.texture.bytes).toString("base64"), sha256: editable.texture.sha256 },
    { path: editablePath, encoding: "utf8", content: editable.text, sha256: editable.sha256 },
  ];
  for (const file of files) {
    const bytes = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Item asset bundle integrity failed.");
    Object.freeze(file);
  }
  return Object.freeze({ kind: "minecraft-item-asset-bundle", minecraft: "1.20.1", elements: native.elements,
    reviewRequired: true, files: Object.freeze(files) });
}
