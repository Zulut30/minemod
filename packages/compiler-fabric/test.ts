import assert from "node:assert/strict";
import { containsForbiddenExecutionSurface, isBuildPlan } from "@mcdev/contracts";
import type { ModSpecV1 } from "@mcdev/modspec";
import { validFabricV1Fixture } from "../../fixtures/specs/validation.ts";
import {
  compileFabricPhase0,
  FabricCompilerError,
  type CompiledFabricProject,
} from "./index.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

function phase0Fixture(): ModSpecV1 {
  const spec = structuredClone(validFabricV1Fixture);
  spec.project.name = "Infected \"Frontier\"";
  spec.gameplay.entities = [];
  spec.gameplay.structures = [];
  spec.gameplay.screens = [];
  spec.assets.models = [];
  spec.assets.animations = [];
  spec.packaging.includeSources = false;
  return spec;
}

function textOutput(result: CompiledFabricProject, path: string): string {
  const output = result.outputs.find(({ file }) => file.path === path);
  assert.ok(output !== undefined, `missing generated output ${path}`);
  return decoder.decode(output.file.bytes);
}

async function expectCompilerError(
  payload: string,
  code: FabricCompilerError["code"],
  path?: string,
): Promise<FabricCompilerError> {
  try {
    await compileFabricPhase0(payload);
  } catch (error) {
    assert.ok(error instanceof FabricCompilerError);
    assert.equal(error.code, code);
    assert.equal(Object.isFrozen(error.errors), true);
    if (path !== undefined) {
      assert.ok(error.errors.some((entry) => entry.path === path), `missing compiler error path ${path}`);
    }
    return error;
  }
  assert.fail(`expected ${code}`);
}

const expectedPaths = [
  ".gitignore",
  "build.gradle",
  "gradle.properties",
  "gradle/verification-metadata.xml",
  "gradle/wrapper/gradle-wrapper.jar",
  "gradle/wrapper/gradle-wrapper.properties",
  "gradlew",
  "gradlew.bat",
  "settings.gradle",
  "src/client/java/dev/mcdev/generated/m_infectedfrontier/client/GeneratedClient.java",
  "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java",
  "src/main/resources/fabric.mod.json",
];

const fixture = phase0Fixture();
const compiled = await compileFabricPhase0(JSON.stringify(fixture));
assert.deepEqual(compiled.outputs.map(({ file }) => file.path), expectedPaths);
assert.equal(Object.isFrozen(compiled), true);
assert.equal(Object.isFrozen(compiled.outputs), true);
assert.equal(Object.isFrozen(compiled.plan), true);
assert.equal(isBuildPlan(compiled.plan), true);
assert.equal(containsForbiddenExecutionSurface(compiled.plan), false);
assert.equal(compiled.plan.pack.packId, "fabric-1.20.1-java-17");
assert.deepEqual(compiled.plan.nodes.map(({ nodeId }) => nodeId), [
  "apply-workspace",
  "generate-content",
  "generate-project",
  "gradle-clean-build",
  "index-artifacts",
]);
const buildNode = compiled.plan.nodes.find(({ kind }) => kind === "gradle-clean-build");
assert.ok(buildNode?.kind === "gradle-clean-build");
assert.equal(buildNode.policy, "fabric-1.20.1-phase0-v1");
assert.equal(compiled.plan.nodes.find(({ nodeId }) => nodeId === "generate-project")?.outputs.length, 10);
assert.equal(compiled.plan.nodes.find(({ nodeId }) => nodeId === "generate-content")?.outputs.length, 2);

const fabricMod = JSON.parse(textOutput(compiled, "src/main/resources/fabric.mod.json")) as {
  name: string;
  entrypoints: { main: string[]; client: string[] };
};
assert.equal(fabricMod.name, fixture.project.name);
assert.deepEqual(fabricMod.entrypoints, {
  main: ["dev.mcdev.generated.m_infectedfrontier.GeneratedMod"],
  client: ["dev.mcdev.generated.m_infectedfrontier.client.GeneratedClient"],
});
assert.equal(textOutput(compiled, "src/main/resources/fabric.mod.json").includes("@@MCDEV_"), false);
assert.match(
  textOutput(compiled, "src/main/java/dev/mcdev/generated/m_infectedfrontier/GeneratedMod.java"),
  /implements ModInitializer/u,
);
assert.match(
  textOutput(compiled, "src/client/java/dev/mcdev/generated/m_infectedfrontier/client/GeneratedClient.java"),
  /implements ClientModInitializer/u,
);

const reorderedRoot = {
  packaging: fixture.packaging,
  tests: fixture.tests,
  integrations: fixture.integrations,
  dependencies: fixture.dependencies,
  assets: fixture.assets,
  gameplay: fixture.gameplay,
  target: fixture.target,
  project: fixture.project,
  kind: fixture.kind,
  schemaVersion: fixture.schemaVersion,
};
assert.equal(
  (await compileFabricPhase0(JSON.stringify(reorderedRoot, null, 2))).plan.planId,
  compiled.plan.planId,
  "JSON whitespace and key order must not affect the Fabric plan",
);

await expectCompilerError(JSON.stringify(validFabricV1Fixture), "SPEC_UNSUPPORTED", "/gameplay/entities");
const hyphenated = phase0Fixture();
hyphenated.project.modId = "infected-frontier";
await expectCompilerError(JSON.stringify(hyphenated), "SPEC_UNSUPPORTED", "/project/modId");
const v0 = { ...fixture, schemaVersion: 0 };
await expectCompilerError(JSON.stringify(v0), "SPEC_INVALID", "/schemaVersion");
await expectCompilerError("{", "SPEC_INVALID");
