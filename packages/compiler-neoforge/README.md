# Phase-1 NeoForge compiler

`compileNeoForgePhase1(payload)` is the only application entrypoint. It validates one bounded inline ModSpec, selects and verifies the built-in `neoforge-26.1.2-java-25` compatibility pack, and returns immutable generated outputs plus a closed five-node `mcdev.build-plan/v1`. It does not access a workspace, launch Gradle, execute a command, or accept a caller-selected pack.

## Determinism contract

Objects use canonical JSON and ResourceLocations use ASCII ordering. The compiler hashes `domain + NUL + canonical-json(value)` with SHA-256 using these domains:

- `mcdev.compiler-neoforge.modspec/v1`
- `mcdev.compiler-neoforge.node-input/v1`
- `mcdev.compiler-neoforge.node-cache/v1`
- `mcdev.compiler-neoforge.plan/v1`

`planId` hashes the canonical plan body containing `contract`, `specDigest`, `pack`, `nodes`, and `warnings`; the `planId` field itself is excluded to avoid self-reference. Generated project files are tied to the reviewed pack tree digest, while generated content is tied to the normalized ModSpec digest and exact compiler version.

The original 16×16 checkerboard placeholder is a reviewed 97-byte PNG embedded as static base64. Its SHA-256 is `918a4d7a554bfec52db1649d1aa5d6db74d220d698c69d6724ce6bc12ecf6971`. A project with any item or block receives exactly one shared placeholder and `PLACEHOLDER_ASSETS_USED`.

## Version-specific evidence

The emitted API and resource shapes were checked against the pinned NeoForge `26.1.2.80` sources and Minecraft `26.1.2` vanilla client/data artifacts used by the reviewed compatibility baseline. The current official documentation supports the same patterns:

- [NeoForge registries and event-bus registration](https://docs.neoforged.net/docs/concepts/registries/)
- [NeoForge items and `DeferredRegister.Items`](https://docs.neoforged.net/docs/items/)
- [NeoForge blocks and `DeferredRegister.Blocks`](https://docs.neoforged.net/docs/blocks/)
- [Minecraft 26.1 client item definitions and baked models](https://docs.neoforged.net/docs/resources/client/models/items/)
- [Blockstates](https://docs.neoforged.net/docs/resources/client/models/blockstates/)
- [Loot tables](https://docs.neoforged.net/docs/resources/server/loottables/)

Minecraft 26.1 uses client item definitions under `assets/<namespace>/items`, baked models under `assets/<namespace>/models`, and the singular data path `data/<namespace>/loot_table`. Block hardness is rounded once to Java `float` and emitted as `Float.intBitsToFloat(0xXXXXXXXX)`, preserving deterministic IEEE-754 bits across Java source generation.
