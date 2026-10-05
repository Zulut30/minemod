import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, release, arch } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { EditorSession, projectFromAsset, cubes, assetRequest } from "../packages/editor-core/index.ts";
import { compileItemAssetPayload } from "../packages/application/item-assets.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const policyText = await readFile(join(root, "docs/production/acceptance-policy.v1.json"), "utf8");
const policy = JSON.parse(policyText);
assert.equal(process.version, "v24.21.0", "Use the pinned Node toolchain; compare measurements within the same recorded runtime.");
assert.equal(policy.kind, "mcdev-production-acceptance-policy");
const warmup = policy.performanceTargets.warmupIterations;
const iterations = policy.performanceTargets.measuredIterations;
assert(Number.isInteger(warmup) && warmup >= 5 && warmup <= 100);
assert(Number.isInteger(iterations) && iterations >= 30 && iterations <= 1000);

const fixturePath = "fixtures/assets/aurora-longsword-v2.item-asset.json";
const fixtureText = await readFile(join(root, fixturePath), "utf8");
const project = projectFromAsset(JSON.parse(fixtureText), randomUUID());
const session = new EditorSession(project);
const cubeId = cubes(project)[0]?.id;
assert(cubeId, "The control project must contain geometry.");
const samples = { mutation: [], export: [] };
const failures = [];
const digest = (value) => createHash("sha256").update(value).digest("hex");
let referenceBundle, firstExportMs;

for (let index = 0; index < warmup + iterations; index++) {
  for (const operation of ["mutation", "export"]) {
    const state = session.state();
    const mutation = {
      projectId: state.project.projectId,
      expectedRevision: state.revision,
      key: randomUUID(),
      commands: [{ type: "transform", cubeIds: [cubeId], translation: [index % 2 ? -0.01 : 0.01, 0, 0], scale: [1, 1, 1] }],
    };
    let result, failure;
    const started = performance.now();
    try {
      result = operation === "mutation"
        ? session.apply(mutation, "human")
        : compileItemAssetPayload(JSON.stringify(assetRequest(project)));
    } catch (error) {
      failure = { iteration: index, warmup: index < warmup, operation, error: String(error).slice(0, 512) };
    }
    const elapsedMs = performance.now() - started;
    if (operation === "export" && firstExportMs === undefined) firstExportMs = elapsedMs;
    if (index >= warmup) samples[operation].push({ iteration: index - warmup, elapsedMs, failed: !!failure });
    if (failure) failures.push(failure);
    if (result && operation === "export") {
      assert.equal(result.kind, "minecraft-item-asset-bundle");
      assert.equal(result.reviewRequired, true);
      for (const file of result.files) {
        assert.equal(digest(file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content), file.sha256);
      }
      const signature = JSON.stringify(result.files.map(({ path, sha256 }) => ({ path, sha256 })));
      referenceBundle ??= signature;
      assert.equal(signature, referenceBundle, "Repeated exports must contain the same bytes.");
    }
  }
}

function summary(values, targetP95Ms) {
  const sorted = values.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
  const percentile = (quantile) => sorted[Math.ceil(sorted.length * quantile) - 1];
  const p95Ms = percentile(policy.performanceTargets.quantile);
  return {
    count: values.length,
    p50Ms: percentile(0.5),
    p95Ms,
    maxMs: sorted.at(-1),
    failedSamples: values.filter(({ failed }) => failed).length,
    targetP95Ms,
    targetMet: values.length === iterations && values.every(({ failed }) => !failed) && p95Ms <= targetP95Ms,
  };
}
const measurement = {
  mutation: summary(samples.mutation, policy.performanceTargets.editorCoreMutationP95Ms),
  export: summary(samples.export, policy.performanceTargets.editorCoreExportP95Ms),
};
const corePassed = failures.length === 0 && measurement.mutation.targetMet && measurement.export.targetMet;
const output = join(root, "output/production-baseline", randomUUID().slice(0, 8));
await mkdir(output, { recursive: true });
const sourceInputs = await Promise.all([
  "scripts/measure-editor-baseline.mjs",
  "packages/editor-core/index.ts",
  "packages/editor-core/texture.ts",
  "packages/application/item-assets.ts",
  "packages/assets-core/minecraft-item.ts",
  "packages/assets-core/painted-item.ts",
].map(async (path) => ({ path, sha256: digest(await readFile(join(root, path))) })));
const report = {
  schemaVersion: 1,
  kind: "mcdev-editor-baseline",
  roadmapPoint: 10,
  status: corePassed ? "PARTIAL" : "FAILED",
  measuredAt: new Date().toISOString(),
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
  workspaceWasDirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true }).trim().length > 0,
  sourceInputs,
  scope: "Editor core on one fixture; excludes desktop/agent latency, artwork scoring and Minecraft runtime.",
  environment: { node: process.version, platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0]?.model, memoryGiB: totalmem() / 2 ** 30, gpu: "not-used-by-this-core-measurement" },
  policySha256: digest(policyText),
  fixture: { path: fixturePath, sha256: digest(fixtureText), cubes: cubes(project).length, texture: project.model.texture },
  warmupIterations: warmup,
  measuredIterations: iterations,
  measurement,
  firstTechnicalExportMs: firstExportMs,
  repeatedExportFileHashes: referenceBundle ? JSON.parse(referenceBundle) : null,
  samples,
  failures,
  notMeasured: { firstUserAcceptedExport: null, agentSessionSuccessRate: null, manualRepairCount: null, humanArtRatings: null, desktopResponsiveness: null, maximumSizeInput: null },
  completeRoadmapPoint: false,
};
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, output, measurement, completeRoadmapPoint: false }, null, 2));
if (!corePassed) process.exitCode = 1;
