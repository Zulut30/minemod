# Fabric pack revision 5: локальные Loom derivatives

Дата: 4 октября 2026. Candidate; hosted build/GameTests/client/server прошли, security acceptance остаётся открытой.

Revision 4 устранила missing checksums скачиваемых Maven containers, но fresh hosted [run 37215901547](https://github.com/Zulut30/minemod/actions/runs/37215901547) отказался принять `net.minecraft:minecraft-common-b7a764897f:1.20.1-loom.mappings.1_20_1.layered+hash.2198-v2`: exact ZIP SHA отличается от прежнего local-cache SHA. Это не опубликованный Minecraft artifact: [pinned Loom source](https://github.com/FabricMC/fabric-loom/blob/c4d36fac4ea7ccd1ef9526aa138139a154c8f581/src/main/java/net/fabricmc/loom/configuration/providers/minecraft/mapped/AbstractMappedMinecraftProvider.java) создаёт named JAR локально через TinyRemapper и сохраняет его в `LoomLocalMinecraft`. Побайтное равенство с прежним cache не подтверждено.

Новая revision сохраняет tuple, wrapper и Java/resource templates. Она добавляет четыре **exact** локальные exceptions: common/clientOnly для уже записанных profiles `3d2c7816d3` и `b7a764897f`; каждый имеет полный group, name, version и filename. Regex/wildcard для `net.minecraft` или скачиваемых Fabric artifacts не добавлен. Gradle остаётся в strict mode для внешних inputs. Эти exceptions снимают ZIP-checksum проверку только с четырёх локально производимых JAR; их нельзя описывать как проверку class bytes по старому checksum.

Raw client/server JAR и обе Mojang mapping tables получили fixed SHA-1/SHA-256/size/URL в [input evidence](../provenance/minecraft-1.20.1-input-hashes-r5.json) и новом version lock. Исходный version descriptor также проверен по Mojang SHA-1. CI независимо скачивает и проверяет эти четыре inputs без их публикации. Такая preflight проверка источника **не является** attestation произвольно подготовленного local cache: проверка cache/derivation provenance runner остаётся частью roadmap 083/088 до production. Candidate status не снимает этот gate.

| Поле | До | После |
|---|---|---|
| Revision / directory | 4 / `runtime-r4` | 5 / `runtime-r5` |
| Tree SHA-256 | `5665fbc60365bf22639292c0b5e8ee46c7853c52e20e744be88a2c3fbaaf2282` | `dae2523ebfccd6c9215438643b0586605de24e6db876862fc55ef4010e124099` |
| Tuple | 1.20.1 / Loader 0.19.3 / API 0.92.11+1.20.1 / Loom 1.6.12 / Gradle 8.7 / Temurin 17.0.19+10 | Без смены версий |
| External metadata artifacts / exact SHA entries | 654 / 705 | 654 / 705 |
| Exact additional local exceptions | 0 | 4 |
| Existing mapping/remapped-mod rules | 3 | 3 |

Revision 3 и 4 остаются неизменными; snapshot regression проверяет обе по прежним digests/modes. Новый plan имеет revision 5, поэтому прежние plans/cache approvals не превращаются в новые по имени. Миграция требует нового workspace/plan, повторного strict build и runtime evidence. Rollback — предыдущий compiler/runner checkout с его собственной revision и проверками. Immutable generator отвергает overwrite; public MCP не может расширять список trusted artifacts.

Hosted runtime proof: [source 26567c9 / job 111480850198](https://github.com/Zulut30/minemod/actions/runs/37217477326/job/111480850198), [evidence](evidence/fabric-production-013.json). Проверены strict online bootstrap/offline clean build, два инфраструктурных GameTest, client/server smoke, generated equipment/config build и server lifecycle. Это не проверка cache provenance, gameplay matrix или визуального качества. Candidate не переводится в production этим результатом.
