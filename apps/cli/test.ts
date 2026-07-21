import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validModFixture } from "../../fixtures/specs/validation.ts";
import { VALIDATION_PROFILE_IDS } from "@mcdev/validation";
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
