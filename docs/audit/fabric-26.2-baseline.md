# Аудит baseline Fabric 26.2

Дата среза: 21 июля 2026 года. Статус: **candidate-local-verified**.

Этот audit закрывает F0.1 из [Fabric-first MVP plan](../FABRIC_FIRST_MVP_PLAN.md): exact compatibility pack, минимальный split-source fixture, строгая dependency verification, clean build и локальные server/client smoke. Он не закрывает F0.2, GameTests, hosted CI или production release gate.

## Зафиксированный стек

| Компонент | Версия |
|---|---:|
| Minecraft | 26.2 |
| Fabric Loader | 0.19.3 |
| Fabric API | 0.155.2+26.2 |
| Fabric Loom | 1.17.16 |
| Gradle | 9.5.1 |
| Java | Eclipse Temurin 25.0.3+9-LTS |

Baseline следует официальной рекомендации Fabric использовать Loom 1.17, Gradle 9.5.1 и Loader 0.19.3 для Minecraft 26.2. Moving `1.17-SNAPSHOT` из example template заменён exact stable `1.17.16` из официального Fabric Maven.

## Supply-chain границы

- архив Temurin проверен SHA-256 `69264a7a211bf5029830d07bc3370f879769d62ebc5b5488e90c9343a2da0e1f`;
- Gradle distribution проверен SHA-256 `bafc141b619ad6350fd975fc903156dd5c151998cc8b058e8c1044ab5f7b031f`;
- committed wrapper JAR имеет SHA-256 `497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7`;
- POSIX и Windows wrappers проверяют wrapper JAR до запуска Java;
- `distributionSha256Sum` проверяет Gradle distribution;
- Gradle toolchain auto-detect и auto-download отключены, разрешён только `MCDEV_JAVA25_HOME`;
- verification metadata содержит 174 компонента, 393 artifact records и 393 SHA-256;
- wildcard trusted artifacts, SHA-1 и MD5 отсутствуют;
- runtime pack проверяется manifest file hashes, exact tree entry count и tree SHA-256 `a734a1c56878bb62f08928e008d2e3a59fa7ecdfa6afe125526a3e53a2a48c52`;
- tamper-test доказывает отказ при изменении Fabric `gradle.properties`.

Полная классификация лицензий всех transitive компонентов ещё не завершена, поэтому pack остаётся candidate, а release redistribution блокируется. Прямые зависимости и точные upstream commits зафиксированы в [Fabric dependency provenance](../provenance/fabric-26.2-dependencies.json).

## Fixture и результаты

`fixtures/fabric-26.2-empty` использует официальный unobfuscated Loom plugin `net.fabricmc.fabric-loom`, `splitEnvironmentSourceSets()`, отдельные main/client entrypoints и не содержит Mixins или raw OpenGL.

| Gate | Результат |
|---|---|
| wrapper JAR tamper-test | PASS; выполнение блокируется до Java |
| `--dependency-verification strict --warning-mode all clean build` | PASS; без deprecation warnings проекта |
| source JAR и remapped JAR | PASS |
| JAR entrypoints и expanded `fabric.mod.json` | PASS |
| dedicated server | PASS; Loader/API/fixture загружены, `Done (1.210s)` на отдельном local port |
| headless client под Xvfb | PASS; main/client entrypoints и texture atlases загружены |
| process teardown | PASS после bounded TERM/kill timeout; процессов fixture не осталось |
| Fabric server/client GameTests | PENDING F0.2 |
| GitHub-hosted CI | PENDING F0.2 |

Первый server probe на стандартном порту намеренно не принят как evidence: порт 25565 был занят внешним сервером, Minecraft завершился runtime crash, а Gradle task вернул status 0. Повторный gate использовал отдельный порт, проверял readiness/fatal log patterns и только после этого был принят. Это доказывает, что будущий smoke harness не может доверять одному exit code Loom task.

## Остаточные риски и следующий gate

- локальные smoke commands пока не оформлены как hardened CI scripts с nonce-bound process lifecycle;
- GameTest и client GameTest отсутствуют;
- hosted Ubuntu и Windows evidence отсутствует;
- transitive license inventory не завершён;
- версии не могут получить `production` status только на основании этого audit.

Следующая задача — F0.2: server/client GameTests, hardened repeatable smoke scripts, immutable reports/screenshots и GitHub-hosted matrix.

## Официальные источники

- Fabric 26.2: <https://fabricmc.net/2026/06/15/262.html>
- Fabric example mod 26.2: <https://github.com/FabricMC/fabric-example-mod/tree/26.2>
- Fabric Loom Maven: <https://maven.fabricmc.net/net/fabricmc/fabric-loom/>
- Fabric automated testing: <https://docs.fabricmc.net/develop/automatic-testing>
- Gradle dependency verification: <https://docs.gradle.org/9.5.1/userguide/dependency_verification.html>
