import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fabricBasicContentFixture } from "../../fixtures/specs/fabric-basic-content.ts";
import { compileFabricPhase1 } from "./index.ts";

const javaHome = process.env.MCDEV_FABRIC_TEST_JAVA_HOME;
const gradleHome = process.env.MCDEV_FABRIC_TEST_GRADLE_HOME;
if (javaHome === undefined || gradleHome === undefined) {
  throw new Error("MCDEV_FABRIC_TEST_JAVA_HOME and MCDEV_FABRIC_TEST_GRADLE_HOME are required.");
}

const workspace = await mkdtemp(join(tmpdir(), "mcdev-fabric-basic-content-"));
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
  const compiled = await compileFabricPhase1(JSON.stringify(fixture));
  for (const { file } of compiled.outputs) {
    const destination = join(workspace, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes, { mode: file.mode });
    await chmod(destination, file.mode);
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
  assert.equal(build.error, undefined, build.stderr);
  assert.equal(build.signal, null, build.stderr);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const artifacts = await readdir(join(workspace, "build", "libs"));
  const artifact = artifacts.find((name) => name === "infectedfrontier-0.1.0.jar");
  assert.ok(artifact !== undefined);
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
