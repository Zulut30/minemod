# CI для production target

Roadmap 012/013/016: реализация проверок не означает их успешное hosted выполнение. Завершённые run IDs и exact source hashes фиксируются отдельно после проверки artifacts.

Job `fabric-production` в `phase-0.yml` использует Ubuntu 24.04, Node 24.11.0 и Java 17.0.19+10 из archive, URL и SHA-256 которого берутся из reviewed lock. `setup-java` устанавливает проверенный локальный archive в режиме `jdkfile`; runtime identity сверяется после установки. Это не автоматическое обновление trusted pack.

Проверка входов сравнивает wrapper bytes с trusted runtime и checksums fixture dependencies с reviewed metadata. Empty fixture имеет 562 artifacts, compiler runtime — 654 из-за дополнительного библиотечного профиля. Все используемые fixture checksums должны принадлежать reviewed набору.

В чистом checkout первая фиксированная Gradle-команда загружает dependencies со strict verification. Следующий clean build использует `--offline`. Два server GameTests подтверждают correct target, доступность harness и сохранение directional state после ticks. Dedicated server/client smoke используют существующую изоляцию, readiness nonce, закрытие только собственных процессов и ограниченные console logs.

Отдельный `compiler-fabric test:build` генерирует equipment/config/recipe fixture, проверяет remapped JAR и запускает dedicated server. `MCDEV_FABRIC_TEST_BOOTSTRAP=1` разрешает только фиксированный strict bootstrap внутри операторского теста; public MCP/build runner не получает новой команды или сетевой capability. Logs сохраняются в `output/ci/fabric-production/generated`.

Artifacts включают tuple/hashes, Java runtime, XML обоих GameTests и ограниченные runtime logs. Пустой XML, failed/skipped cases или отсутствие обязательного теста являются ошибкой CI. Harness не доказывает приёмку generated рецептов, loot, multiplayer или художественного качества.

Windows job упаковывает Studio и запускает desktop MCP/editor E2E в скрытых изолированных окнах. Проверка captured PNG декодирует пиксели в центральной области контрольного fixture: измеряет площадь, высоту, ширину и разнообразие цвета. Пустой render отвергается отдельной negative-проверкой. Размер сжатого PNG не является критерием наличия геометрии. Snapshot сохраняется до assertion для диагностики CI.

Jobs запускаются на push/PR; обязательность для merge дополнительно требует repository ruleset/branch protection из roadmap 014. Наличие job не подменяет эту настройку.

Источники: [Loom run configuration](https://wiki.fabricmc.net/documentation:fabric_loom), [pinned Fabric GameTest API](https://github.com/FabricMC/fabric-api/tree/0.92.11%2B1.20.1/fabric-gametest-api-v1), [setup-java jdkfile](https://github.com/actions/setup-java/blob/v5.2.0/docs/advanced-usage.md#installing-java-from-local-file).
