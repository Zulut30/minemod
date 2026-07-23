# Fabric compiler

`@mcdev/compiler-fabric` compiles a validated `ModSpec v1` for the exact Minecraft 1.20.1, Fabric and Java 17 target. It accepts only the reviewed built-in `fabric-1.20.1-java-17` compatibility pack.

Phase 1 currently generates:

- reproducible Gradle/Fabric project metadata and split main/client entrypoints;
- item and block registration with bounded stack size and hardness;
- creative-tab entries;
- built-in shaped 1×1–3×3, shapeless crafting and smelting recipes;
- item models, block models, blockstates, self-drop loot tables and `en_us` localization;
- trusted YACL JSON5 configuration with ModSpec-driven boolean, integer slider and string controls;
- an optional server-authoritative player join message bound to Fabric's play-connection event;
- a closed deterministic BuildPlan using `fabric-1.20.1-phase1-v1`.

Shaped recipes use a bounded `pattern`/`key` contract, support vanilla and declared generated ingredients, and emit deterministic Minecraft 1.20.1 `crafting_shaped` JSON. Custom serializers still fail closed with a precise `SPEC_UNSUPPORTED` diagnostic.

Until authored textures are connected, generated basic content uses a deterministic placeholder PNG and reports `PLACEHOLDER_ASSETS_USED`. Tags, entities, structures, gameplay screens, unsupported integrations and authored assets also fail closed; they are not silently omitted.

The ordinary unit suite runs with `pnpm --filter @mcdev/compiler-fabric test`. The opt-in integration test below performs a strict offline Gradle build, inspects the remapped JAR and starts then cleanly stops a Fabric 1.20.1 dedicated server to verify resource loading:

```sh
MCDEV_FABRIC_TEST_JAVA_HOME=/path/to/temurin-17 \
MCDEV_FABRIC_TEST_GRADLE_HOME=/path/to/warmed-gradle-home \
pnpm --filter @mcdev/compiler-fabric test:build
```
