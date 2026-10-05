import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validModFixture } from "../../fixtures/specs/validation.ts";
import { VALIDATION_PROFILE_IDS, createArtPlan } from "@mcdev/validation";
import { isOperationEvidence } from "@mcdev/contracts";
import { FabricBuildOperationError } from "@mcdev/application";
import { runCli } from "./index.ts";

const output: string[] = [];
assert.equal(await runCli(["help"], (text) => output.push(text)), 0);
assert.match(output.join(""), /spec validate/u);
assert.match(output.join(""), /loader-neutral/u);
output.length = 0;
assert.equal(
  await runCli(["spec", "validate", JSON.stringify(validModFixture)], (text) => output.push(text)),
  0,
);
assert.match(output.join(""), /"valid": true/u);
const fabricFixture = {
  ...validModFixture,
  target: { minecraft: "26.2", loader: "fabric", java: 25 },
};
output.length = 0;
assert.equal(
  await runCli(["spec", "validate", JSON.stringify(fabricFixture)], (text) => output.push(text)),
  0,
  "default CLI validation must remain loader-neutral",
);
output.length = 0;
assert.equal(
  await runCli(
    ["spec", "validate", "--profile", VALIDATION_PROFILE_IDS[0], JSON.stringify(fabricFixture)],
    (text) => output.push(text),
  ),
  1,
  "the named compatibility profile must be opt-in and fail closed",
);
assert.match(output.join(""), /INCOMPATIBLE_TARGET/u);
assert.equal(
  await runCli(["spec", "validate", "--profile", "unknown", JSON.stringify(validModFixture)], () => undefined, () => undefined),
  2,
);
assert.equal(await runCli(["publish"], () => undefined, () => undefined), 2);
assert.equal(await runCli(["--self-test"], () => undefined, () => undefined), 2);

for (const name of ["polar-cleaver", "polar-armor", "copper-masonry", "tide-altar", "tidecaller-crab", "leaf-sword"]) {
  const payload = readFileSync(new URL(`../../fixtures/art/${name}.artspec-v1.json`, import.meta.url), "utf8");
  output.length = 0;
  assert.equal(await runCli(["art", "plan", payload], text => output.push(text)), 0);
  assert.deepEqual(JSON.parse(output.join("")), createArtPlan(payload));
}
output.length = 0;
assert.equal(await runCli(["art", "plan", "{}"], text => output.push(text)), 1);
assert.equal((JSON.parse(output.join("")) as { plan?: unknown }).plan, undefined);
assert.equal(await runCli(["art", "plan", "--file", "/arbitrary/path"], () => undefined, () => undefined), 2);
const leafPayload = readFileSync(new URL("../../fixtures/art/leaf-sword.artspec-v1.json", import.meta.url), "utf8");
const artChild = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url)), "art", "plan", leafPayload], { encoding: "utf8", timeout: 10_000 });
assert.equal(artChild.status, 0, artChild.stderr);
assert.deepEqual(JSON.parse(artChild.stdout), createArtPlan(leafPayload), "CLI process uses the same validated data-only plan.");

const itemAssetPayload = readFileSync(new URL("../../fixtures/assets/aurora-longsword.item-asset.json", import.meta.url), "utf8");
output.length = 0;
assert.equal(await runCli(["asset", "item", itemAssetPayload], (text) => output.push(text)), 0);
const itemAssetResult = JSON.parse(output.join("")) as { reviewRequired: boolean; files: unknown[] };
assert.equal(itemAssetResult.reviewRequired, true);
assert.equal(itemAssetResult.files.length, 3);
const paintedPayload = readFileSync(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8");
output.length = 0;
assert.equal(await runCli(["asset", "item", paintedPayload], (text) => output.push(text)), 0);
assert.equal((JSON.parse(output.join("")) as { elements: number }).elements, 52);
const itemErrors: string[] = [];
assert.equal(await runCli(["asset", "item", "{}"], () => undefined, (text) => itemErrors.push(text)), 1);
assert.match(itemErrors.join(""), /SPEC_UNSUPPORTED/u);
output.length = 0;
assert.equal(await runCli(["asset", "bundle", paintedPayload], (text) => output.push(text)), 0);
const versionedText = output.join(""), versioned = JSON.parse(versionedText) as { manifest: { reviewRequired: boolean }; files: unknown[] };
assert.equal(versioned.manifest.reviewRequired, true);
assert.equal(versioned.files.length, 4);
output.length = 0;
assert.equal(await runCli(["asset", "report", paintedPayload], text => output.push(text)), 0);
const reported = JSON.parse(output.join("")) as { ok: boolean; bundle: unknown; evidence: unknown };
assert(reported.ok);assert.deepEqual(reported.bundle, versioned);assert(isOperationEvidence(reported.evidence));
assert.equal(reported.evidence.game.status, "not-run");assert.equal(reported.evidence.artistic.status, "requires-human-review");
output.length = 0;
assert.equal(await runCli(["asset", "report", "{}"], text => output.push(text)), 1);
const failedReport = JSON.parse(output.join("")) as { ok: boolean; evidence: unknown };
assert.equal(failedReport.ok, false);assert(isOperationEvidence(failedReport.evidence));assert.equal(failedReport.evidence.technical.status, "fail");
output.length = 0;
assert.equal(await runCli(["asset", "verify", versionedText], (text) => output.push(text)), 0);
assert.deepEqual(JSON.parse(output.join("")), versioned);
for (const operation of ["bundle", "verify"]) {
  const errors: string[] = [];
  assert.equal(await runCli(["asset", operation, "{}"], () => undefined, (text) => errors.push(text)), 1);
  assert.match(errors.join(""), /SPEC_UNSUPPORTED/u);
}

{
  let receivedConfig: unknown;
  let receivedRequest: unknown;
  output.length = 0;
  const code = await runCli([
    "fabric",
    "build",
    "--workspace",
    "/approved/workspace",
    "--java17-home",
    "/fixed/jdk-17",
    "--artifact-cache",
    "/fixed/cache",
    JSON.stringify(validModFixture),
  ], (text) => output.push(text), () => undefined, {
    createFabricApplication: (config) => {
      receivedConfig = config;
      return {
        build: async (request) => {
          receivedRequest = request;
          return {
            planId: "1".repeat(64),
            workspaceStatus: "created",
            warnings: ["PLACEHOLDER_ASSETS_USED"],
            artifacts: {
              contract: "mcdev.artifact-index/v1",
              planId: "1".repeat(64),
              pack: {
                packId: "fabric-1.20.1-java-17",
                revision: 2,
                treeSha256: "2".repeat(64),
              },
              entries: [{ path: "build/libs/example.jar", mode: 420, size: 1, sha256: "3".repeat(64), kind: "build-output", provenance: "build" }],
            },
          };
        },
      };
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(receivedConfig, {
    java17Home: "/fixed/jdk-17",
    artifactCacheRoot: "/fixed/cache",
  });
  assert.deepEqual(receivedRequest, {
    workspaceRoot: "/approved/workspace",
    payload: JSON.stringify(validModFixture),
  });
  assert.match(output.join(""), /"workspaceStatus": "created"/u);
  assert.match(output.join(""), /PLACEHOLDER_ASSETS_USED/u);
}

for (const resolved of [false, true]) {
  const errors: string[] = [];
  const original = Object.assign(new Error("must not leak /workspace"), { code: "BUILD_FAILED" });
  const plan = { planId: "1".repeat(64), pack: { packId: "fabric-1.20.1-java-17", revision: 2, treeSha256: "2".repeat(64) } };
  const code = await runCli([
    "fabric", "build", "--workspace", "/workspace", "--java17-home", "/jdk",
    "--artifact-cache", "/cache", "{}",
  ], () => undefined, (text) => errors.push(text), {
    createFabricApplication: () => ({
      build: async () => Promise.reject(resolved ? new FabricBuildOperationError("{}", original, plan) : original),
    }),
  });
  assert.equal(code, 1);
  const failure = JSON.parse(errors.join("")) as { code: string; evidence: unknown };
  assert.equal(failure.code, "BUILD_FAILED");assert(isOperationEvidence(failure.evidence));
  assert.equal(failure.evidence.technical.status, "fail");assert.equal(failure.evidence.artifacts.length, 0);
  assert.deepEqual(failure.evidence.pack, resolved ? plan.pack : null);
  assert.deepEqual(failure.evidence.revision, resolved ? { kind: "plan", planId: plan.planId } : { kind: "input", sha256: failure.evidence.input.sha256 });
  assert(!errors.join("").includes("/workspace"));
}

const entrypoint = fileURLToPath(new URL("./index.ts", import.meta.url));
const spawnCli = (args: readonly string[]) => spawnSync(
  process.execPath,
  ["--experimental-strip-types", entrypoint, ...args],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);

const selfTestOnly = spawnCli(["--self-test"]);
assert.equal(selfTestOnly.error, undefined);
assert.equal(selfTestOnly.status, 2, selfTestOnly.stderr);
assert.equal(selfTestOnly.stdout, "");
assert.equal(selfTestOnly.stderr, "Unsupported command. Run `mcdev help`.\n");

const mixedValidation = spawnCli(["spec", "validate", "--self-test"]);
assert.equal(mixedValidation.error, undefined);
assert.equal(mixedValidation.status, 1, mixedValidation.stderr);
assert.match(mixedValidation.stdout, /"code": "INVALID_JSON"/u);
assert.equal(mixedValidation.stderr, "");

for (const mixedArgs of [
  ["help", "--self-test"],
  ["unknown", "--self-test"],
  ["spec", "validate", JSON.stringify(validModFixture), "--self-test"],
] as const) {
  const rejected = spawnCli(mixedArgs);
  assert.equal(rejected.error, undefined);
  assert.equal(rejected.status, 2, rejected.stderr);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "Unsupported command. Run `mcdev help`.\n");
}
