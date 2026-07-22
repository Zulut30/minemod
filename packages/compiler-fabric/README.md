# Fabric compiler

`@mcdev/compiler-fabric` compiles a validated `ModSpec v1` for the exact Minecraft 1.20.1, Fabric and Java 17 target. It accepts only the reviewed built-in `fabric-1.20.1-java-17` compatibility pack.

Phase 1 currently generates:

- reproducible Gradle/Fabric project metadata and split main/client entrypoints;
- item and block registration with bounded stack size and hardness;
- creative-tab entries;
- built-in shapeless crafting and smelting recipes;
- item models, block models, blockstates, self-drop loot tables and `en_us` localization;
- a closed deterministic BuildPlan using `fabric-1.20.1-phase1-v1`.

Until authored textures are connected, generated basic content uses a deterministic placeholder PNG and reports `PLACEHOLDER_ASSETS_USED`. Shaped/custom recipes cannot be represented safely by the current ModSpec recipe fields and fail closed with a precise `SPEC_UNSUPPORTED` diagnostic. Tags, entities, structures, screens, integrations and authored assets also fail closed; they are not silently omitted.

The ordinary unit suite runs with `pnpm --filter @mcdev/compiler-fabric test`. A real strict offline Gradle build can be run with:

```sh
MCDEV_FABRIC_TEST_JAVA_HOME=/path/to/temurin-17 \
MCDEV_FABRIC_TEST_GRADLE_HOME=/path/to/warmed-gradle-home \
pnpm --filter @mcdev/compiler-fabric test:build
```
