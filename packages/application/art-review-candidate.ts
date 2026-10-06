import { createHash } from "node:crypto";
import { ART_CRITERIA, ART_RUBRIC_VERSION, type ArtReviewCandidateV1 } from "@mcdev/assets-contracts";
import { verifyArtCandidateContents } from "@mcdev/assets-core";
import { MAX_INLINE_SPEC_BYTES, validateInlineSpec } from "@mcdev/validation";
import { compileItemAssetBundleV1 } from "./asset-bundles.ts";
import { inspectArtReviewInputs } from "./art-review.ts";
import type { ArtReviewDocuments } from "./art-review-history.ts";

export const ART_REVIEW_VIEWS = ["front", "back", "left", "right", "top", "bottom", "perspective", "rear-perspective"] as const;
export interface ArtReviewContent { readonly path: string; readonly bytes: Uint8Array }
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** Экспорт перед captures; оценки человека и игровой PASS здесь не создаются. */
export function prepareArtReviewExport(assetPayload: string, artSpec: string) {
  if (typeof artSpec !== "string" || Buffer.byteLength(artSpec) > MAX_INLINE_SPEC_BYTES) throw new Error("ArtSpec превышает предел.");
  const validation = validateInlineSpec(artSpec, "art");
  if (!validation.valid || validation.value?.kind !== "art") throw new Error("Выберите валидный ArtSpec.");
  if (validation.value.assetClass !== "cuboid-model") throw new Error("Этот review exporter поддерживает только cuboid item.");
  const target = validation.value.targetMatrix[0]!;
  if (validation.value.targetMatrix.length !== 1 || target.minecraft !== "1.20.1" || target.loader !== "fabric" || target.loaderVersion !== "0.19.3" ||
    target.java !== 17 || target.runtime.id !== "java" || target.runtime.version !== "17" || target.renderer.id !== "minecraft-native-item" || target.renderer.version !== "1.20.1")
    throw new Error("Review exporter требует один native Fabric 1.20.1 / Loader 0.19.3 / Java 17 target.");
  return { spec: validation.value, bundle: compileItemAssetBundleV1(assetPayload) };
}

export function prepareArtReviewCandidate(project: string, assetPayload: string, artSpec: string, rubric: string,
  captures: readonly { readonly view: typeof ART_REVIEW_VIEWS[number]; readonly bytes: Uint8Array }[]) {
  if (typeof project !== "string" || Buffer.byteLength(project) > 2_097_152 || typeof rubric !== "string" || Buffer.byteLength(rubric) > 65_536)
    throw new Error("Review source превышает предел.");
  const { spec, bundle } = prepareArtReviewExport(assetPayload, artSpec);
  if (captures.length !== ART_REVIEW_VIEWS.length || new Set(captures.map(capture => capture.view)).size !== ART_REVIEW_VIEWS.length)
    throw new Error("Нужны восемь разных нейтральных ракурсов.");
  const files: { path: string; role: ArtReviewCandidateV1["files"][number]["role"]; bytes: Buffer }[] = [];
  const add = (path: string, role: typeof files[number]["role"], bytes: string | Uint8Array) => files.push({ path, role, bytes: Buffer.from(bytes) });
  add("source/editor.json", "source", project); add("source/artspec.json", "source", artSpec); add("source/rubric.md", "source", rubric);
  for (const file of bundle.files) {
    const runtime = file.path.startsWith("assets/");
    add(`${runtime ? "runtime" : "source/export"}/${file.path}`, runtime ? "runtime" : "source", Buffer.from(file.content, file.encoding));
  }
  add("qa/export-manifest.json", "technical", json(bundle.manifest));
  add("qa/technical.json", "technical", json({ kind: "mcdev-studio-review-export-check", bundleManifestSha256: bundle.manifestSha256,
    exporterTarget: bundle.manifest.target, exportedFiles: bundle.files.length, exactExportBytes: "PASS", exportedTextureCodec: "PASS",
    captureCheck: "bounded-png-header-only", modelMeasurements: "NOT_RUN", inGame: "NOT_RUN", artisticApproval: "NOT_PERFORMED" }));
  for (const view of ART_REVIEW_VIEWS) {
    const capture = captures.find(capture => capture.view === view), bytes = Buffer.from(capture?.bytes ?? []);
    // Captures поступают от private Electron renderer. Это bounded header check, а не полноценный PNG codec validator.
    if (bytes.length < 33 || bytes.length > 1_572_864 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== 1024 || bytes.readUInt32BE(20) !== 768)
      throw new Error("Capture требует bounded PNG 1024×768.");
    add(`qa/views/${view}.png`, "preview", bytes);
  }
  const candidate = json({ schemaVersion: 1, kind: "mcdev-art-review-candidate", assetId: bundle.manifest.assets[0]!.id,
    assetClass: "cuboid-model", rubricVersion: ART_RUBRIC_VERSION, rubricSha256: sha(rubric), artSpecSha256: sha(artSpec),
    targetMatrix: spec.targetMatrix, files: files.map(file => ({ path: file.path, role: file.role, bytes: file.bytes.length, sha256: sha(file.bytes) })) });
  const scorecard = json({ schemaVersion: 1, kind: "mcdev-art-review-scorecard", rubricVersion: ART_RUBRIC_VERSION,
    rubricSha256: sha(rubric), artSpecSha256: sha(artSpec), candidateManifestSha256: sha(candidate), reviewRequested: false,
    criteria: ART_CRITERIA.map(({ id }) => ({ id, assessment: { status: "not-rated" } })), blockers: [] });
  const documents: ArtReviewDocuments = { candidate, scorecard, artSpec, rubric }, contents = files.map(({ path, bytes }) => ({ path, bytes }));
  const integrity = verifyArtCandidateContents(candidate, contents);
  return { documents, contents, integrity, inspection: inspectArtReviewInputs(candidate, scorecard, artSpec, rubric) };
}

export function verifyArtReviewContents(candidate: string, contents: readonly ArtReviewContent[]) { return verifyArtCandidateContents(candidate, contents); }
