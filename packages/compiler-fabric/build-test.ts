import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fabricBasicContentFixture } from "../../fixtures/specs/fabric-basic-content.ts";
import { compileFabricPhase1 } from "./index.ts";
import { createArtifactIndex } from "../artifacts/index.ts";
import { fabricBuildEvidence } from "../application/evidence.ts";

const javaHome = process.env.MCDEV_FABRIC_TEST_JAVA_HOME;
const gradleHome = process.env.MCDEV_FABRIC_TEST_GRADLE_HOME;
if (javaHome === undefined || gradleHome === undefined) {
  throw new Error("MCDEV_FABRIC_TEST_JAVA_HOME and MCDEV_FABRIC_TEST_GRADLE_HOME are required.");
}

const workspace = await mkdtemp(join(tmpdir(), "mcdev-fabric-basic-content-"));
const reportDirectory = process.env.MCDEV_FABRIC_TEST_REPORT_DIR;
async function retainLog(name: string, stdout: string, stderr: string): Promise<void> {
  if (reportDirectory !== undefined) {
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(join(reportDirectory, name), `${stdout}\n${stderr}`);
  }
}
try {
  const fixture = fabricBasicContentFixture();
  fixture.dependencies.required = ["yet_another_config_lib_v3"];
  fixture.dependencies.optional = ["modmenu"];
  fixture.integrations.yacl = {
    categories: [{
      id: "gameplay",
      name: "Gameplay",
      options: [
        {
          id: "enable_special_attacks",
          name: "Special attacks",
          type: "boolean",
          default: true,
          restartRequired: false,
        },
        {
          id: "spawn_limit",
          name: "Spawn limit",
          type: "integer",
          default: 8,
          minimum: 1,
          maximum: 32,
          step: 1,
          restartRequired: true,
        },
        {
          id: "welcome_message",
          name: "Welcome message",
          type: "string",
          default: "Stay alert",
          maxLength: 64,
          binding: "player_join_message",
          restartRequired: true,
        },
      ],
    }],
  };
  fixture.gameplay.materials = [{
    id: "infectedfrontier:blue_steel",
    repairIngredient: "infectedfrontier:blue_ingot",
    durability: 1_024,
    miningSpeed: 9,
    attackDamageBonus: 4,
    miningLevel: 3,
    enchantmentValue: 18,
    armor: {
      durabilityMultiplier: 32,
      defense: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
      toughness: 2,
      knockbackResistance: 0.1,
    },
    palette: {
      base: "#477aa5",
      shadow: "#1b3347",
      highlight: "#bad9ef",
      accent: "#d4a72c",
      handle: "#60401f",
    },
  }];
  fixture.gameplay.items.push(
    {
      id: "infectedfrontier:blue_steel_sword",
      references: [],
      maxStackSize: 1,
      kind: "sword",
      material: "infectedfrontier:blue_steel",
      attackDamage: 4,
      attackSpeed: -2.4,
    },
    {
      id: "infectedfrontier:blue_steel_pickaxe",
      references: [],
      maxStackSize: 1,
      kind: "pickaxe",
      material: "infectedfrontier:blue_steel",
      attackDamage: 1,
      attackSpeed: -2.8,
    },
    {
      id: "infectedfrontier:blue_steel_axe",
      references: [],
      maxStackSize: 1,
      kind: "axe",
      material: "infectedfrontier:blue_steel",
      attackDamage: 6,
      attackSpeed: -3,
    },
    {
      id: "infectedfrontier:blue_steel_shovel",
      references: [],
      maxStackSize: 1,
      kind: "shovel",
      material: "infectedfrontier:blue_steel",
      attackDamage: 2,
      attackSpeed: -3,
    },
    {
      id: "infectedfrontier:blue_steel_hoe",
      references: [],
      maxStackSize: 1,
      kind: "hoe",
      material: "infectedfrontier:blue_steel",
      attackDamage: 0,
      attackSpeed: 0,
    },
    {
      id: "infectedfrontier:blue_steel_chestplate",
      references: [],
      maxStackSize: 1,
      kind: "armor",
      material: "infectedfrontier:blue_steel",
      armorSlot: "chestplate",
    },
  );
  fixture.gameplay.recipes.push({
    id: "infectedfrontier:blue_steel_sword",
    references: [],
    type: "shaped",
    ingredients: [],
    pattern: ["X", "X", "S"],
    key: [
      { symbol: "X", item: "infectedfrontier:blue_ingot" },
      { symbol: "S", item: "minecraft:stick" },
    ],
    result: "infectedfrontier:blue_steel_sword",
    resultCount: 1,
  });
  const payload = JSON.stringify(fixture);
  const compiled = await compileFabricPhase1(payload);
  if (reportDirectory !== undefined) {
    const reviewFiles = compiled.outputs.filter(({ file }) =>
      file.path.endsWith(".java") || file.path === "src/main/resources/fabric.mod.json");
    for (const { file } of reviewFiles) {
      const destination = join(reportDirectory, "generated-source", file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes);
    }
    await writeFile(join(reportDirectory, "source-review-manifest.json"), JSON.stringify({
      schemaVersion: 1, purpose: "generated-source-review", planId: compiled.plan.planId,
      pack: compiled.plan.pack,
      files: reviewFiles.map(({ file }) => ({ path: file.path, bytes: file.bytes.byteLength, sha256: file.sha256 })),
      note: "Generated Java and metadata only; build/runtime logs are separate. No artistic acceptance.",
    }, null, 2) + "\n");
  }
  for (const { file } of compiled.outputs) {
    const destination = join(workspace, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes, { mode: file.mode });
    await chmod(destination, file.mode);
  }

  // Только операторский CI bootstrap. Public build runner остаётся strict/offline.
  if (process.env.MCDEV_FABRIC_TEST_BOOTSTRAP === "1") {
    const bootstrap = spawnSync(
      join(workspace, "gradlew"),
      ["--no-daemon", "--dependency-verification", "strict", "build"],
      {
        cwd: workspace,
        encoding: "utf8",
        env: {
          ...process.env,
          JAVA_HOME: javaHome,
          MCDEV_JAVA17_HOME: javaHome,
          GRADLE_USER_HOME: gradleHome,
        },
        maxBuffer: 8 * 1024 * 1024,
        timeout: 10 * 60 * 1_000,
      },
    );
    await retainLog("bootstrap.log", bootstrap.stdout ?? "", bootstrap.stderr ?? "");
    assert.equal(bootstrap.error, undefined, bootstrap.stderr);
    assert.equal(bootstrap.signal, null, bootstrap.stderr);
    assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);
  }

  const build = spawnSync(
    join(workspace, "gradlew"),
    ["--offline", "--no-daemon", "--dependency-verification", "strict", "clean", "build"],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        JAVA_HOME: javaHome,
        MCDEV_JAVA17_HOME: javaHome,
        GRADLE_USER_HOME: gradleHome,
      },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10 * 60 * 1_000,
    },
  );
  await retainLog("clean-build.log", build.stdout ?? "", build.stderr ?? "");
  assert.equal(build.error, undefined, build.stderr);
  assert.equal(build.signal, null, build.stderr);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const artifacts = await readdir(join(workspace, "build", "libs"));
  const artifact = artifacts.find((name) => name === "infectedfrontier-0.1.0.jar");
  assert.ok(artifact !== undefined);
  if (reportDirectory !== undefined) {
    const jarBytes = await readFile(join(workspace, "build", "libs", artifact));
    const artifactPath = `build/libs/${artifact}`;
    const index = createArtifactIndex({ planId: compiled.plan.planId, pack: compiled.plan.pack,
      sources: [...compiled.outputs.map(({ artifactKind, file }) => ({ path: file.path, mode: file.mode, bytes: file.bytes,
        kind: artifactKind, provenance: file.origin === "pack" ? "pack" as const : "generator" as const })),
      { path: artifactPath, mode: 420, bytes: jarBytes, kind: "build-output", provenance: "build" }] });
    const evidence = fabricBuildEvidence(payload, index);
    assert.equal(evidence.game.status, "not-run");
    assert.equal(evidence.artistic.status, "requires-human-review");
    await mkdir(join(reportDirectory, "build", "libs"), { recursive: true });
    await writeFile(join(reportDirectory, artifactPath), jarBytes);
    await writeFile(join(reportDirectory, "operation-evidence.v1.json"), JSON.stringify(evidence, null, 2) + "\n");
  }
  const jarList = spawnSync(join(javaHome, "bin", "jar"), ["tf", join(workspace, "build", "libs", artifact)], {
    cwd: workspace,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(jarList.status, 0, jarList.stderr);
  assert.match(jarList.stdout, /dev\/mcdev\/generated\/m_infectedfrontier\/GeneratedConfig\.class/u);
  assert.match(
    jarList.stdout,
    /dev\/mcdev\/generated\/m_infectedfrontier\/GeneratedConfiguredBehavior\.class/u,
  );
  assert.match(
    jarList.stdout,
    /dev\/mcdev\/generated\/m_infectedfrontier\/client\/GeneratedModMenuIntegration\.class/u,
  );
  assert.match(
    jarList.stdout,
    /data\/infectedfrontier\/recipes\/blue_steel_sword\.json/u,
  );
  assert.match(jarList.stdout, /assets\/infectedfrontier\/models\/item\/blue_steel_sword\.json/u);
  assert.match(jarList.stdout, /assets\/infectedfrontier\/textures\/item\/blue_steel_sword\.png/u);
  assert.match(jarList.stdout, /assets\/infectedfrontier\/textures\/item\/blue_steel_pickaxe\.png/u);
  assert.match(jarList.stdout, /assets\/infectedfrontier\/textures\/item\/blue_steel_chestplate\.png/u);
  assert.match(jarList.stdout, /assets\/infectedfrontier\/textures\/models\/armor\/blue_steel_layer_1\.png/u);
  assert.match(jarList.stdout, /assets\/infectedfrontier\/textures\/models\/armor\/blue_steel_layer_2\.png/u);
  assert.match(jarList.stdout, /data\/minecraft\/tags\/items\/swords\.json/u);
  assert.match(jarList.stdout, /data\/minecraft\/tags\/items\/trimmable_armor\.json/u);

  const runDirectory = join(workspace, "run");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, "eula.txt"), "eula=true\n");
  await writeFile(
    join(runDirectory, "server.properties"),
    "online-mode=false\nserver-port=0\nlevel-name=mcdev-recipe-smoke\n",
  );
  const server = spawnSync(
    join(workspace, "gradlew"),
    ["--offline", "--no-daemon", "--dependency-verification", "strict", "runServer"],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        JAVA_HOME: javaHome,
        MCDEV_JAVA17_HOME: javaHome,
        GRADLE_USER_HOME: gradleHome,
      },
      input: "stop\n",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 3 * 60 * 1_000,
    },
  );
  const serverOutput = `${server.stdout}\n${server.stderr}`;
  await retainLog("dedicated-server.log", server.stdout ?? "", server.stderr ?? "");
  assert.equal(server.error, undefined, serverOutput);
  assert.equal(server.signal, null, serverOutput);
  assert.equal(server.status, 0, serverOutput);
  assert.match(serverOutput, /Done \([\d.]+s\)!/u);
  assert.doesNotMatch(
    serverOutput,
    /Parsing error loading recipe|Couldn't parse data file|Unknown item/u,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
