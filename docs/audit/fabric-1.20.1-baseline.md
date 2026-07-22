# Аудит baseline Fabric 1.20.1

Дата среза: 22 июля 2026 года. Статус: **candidate-local-runtime-verified**.

Этот audit фиксирует начало production baseline из [ADR-0004](../decisions/0004-fabric-1.20.1-production-baseline.md): exact compatibility pack, минимальный split-source fixture, strict dependency verification и локальные client/dedicated-server smoke. F0 ещё не закрыт полностью: GameTests, hosted CI evidence и полный transitive license review остаются обязательными.

## Зафиксированный стек

| Компонент | Версия |
|---|---:|
| Minecraft | 1.20.1 |
| Fabric Loader | 0.19.3 |
| Fabric API | 0.92.11+1.20.1 |
| Fabric Loom | 1.6.12 |
| Gradle | 8.7 |
| Java | Eclipse Temurin 17.0.19+10 |
| Mappings | official Mojang mappings |

Актуальный официальный Fabric example mod для ветки 1.20.1 использует более новый Loom 1.17, который при локальной проверке не загрузился на Java 17. Он не подходит для выбранной границы Java 17. Локально проверенная exact пара Loom 1.6.12 + Gradle 8.7 сохраняет Java 17 и успешно собирает target 1.20.1. Это осознанный compatibility choice, а не moving dependency.

## Supply-chain границы

- архив Temurin проверен SHA-256 `d8afc263758141a66e0e3aafc321e783f7016696f4eaea067d340a269037d331`;
- Gradle distribution проверен SHA-256 `544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d`;
- committed wrapper JAR проверен SHA-256 `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8` до запуска Java;
- Gradle toolchain auto-detect и auto-download отключены, разрешён только `MCDEV_JAVA17_HOME`;
- strict verification metadata содержит 263 компонента, 555 artifact records и 555 SHA-256, без SHA-1/MD5;
- runtime pack проверяется manifest file hashes, exact tree entry count и tree SHA-256 `312f9a8d39a5fc50e4889ea42f14ef61fc0d91793319866e4d3e3e36b97f1deb`;
- selector registry принимает только exact tuple Minecraft 1.20.1/Fabric/Java 17.

Полная классификация лицензий transitive компонентов ещё не завершена. Pack остаётся candidate, а release redistribution блокируется. Прямые зависимости и upstream sources записаны в [Fabric 1.20.1 dependency provenance](../provenance/fabric-1.20.1-dependencies.json).

## Fixture и результаты

`fixtures/fabric-1.20.1-empty` использует official Mojang mappings, `splitEnvironmentSourceSets()`, отдельные main/client entrypoints и не содержит Mixins или raw OpenGL.

| Gate | Результат |
|---|---|
| wrapper JAR checksum enforcement | PASS локально |
| `--dependency-verification strict --warning-mode all clean build` | PASS на exact Temurin 17.0.19+10 |
| source JAR и remapped JAR | PASS |
| dedicated server smoke | PASS; nonce-bound readiness опубликован после `SERVER_STARTED`, затем сервер штатно остановлен |
| headless client smoke под Xvfb | PASS; main/client entrypoints загружены, title screen стабилен 20 ticks, nonce-bound readiness опубликован |
| smoke guard negative tests | PASS; неизвестный target и некорректные readiness markers отклоняются |
| GameTests | PENDING для 1.20.1 |
| GitHub-hosted CI | PENDING для 1.20.1 |

## Остаточные риски и следующий gate

- server/client GameTests и screenshots пока существуют только для другого Fabric baseline и должны быть реализованы нативно для 1.20.1;
- hosted Linux/Windows evidence отсутствует;
- transitive license inventory не завершён;
- Fabric compiler ещё не выбирает и не потребляет этот pack;
- runtime animation dependency для entities ещё не выбрана и не должна считаться GeckoLib 5 по умолчанию.

Следующий gate — F0.2 для exact baseline 1.20.1: GameTests, screenshots и hosted build/client/server jobs. После него начинается Fabric-native compiler для items/blocks.

## Официальные источники

- Fabric example mod, branch 1.20.1: <https://github.com/FabricMC/fabric-example-mod/tree/1.20.1>
- Fabric Meta: <https://meta.fabricmc.net/>
- Fabric Maven: <https://maven.fabricmc.net/>
- Fabric developer documentation: <https://docs.fabricmc.net/develop/>
- Gradle 8.7 dependency verification: <https://docs.gradle.org/8.7/userguide/dependency_verification.html>
