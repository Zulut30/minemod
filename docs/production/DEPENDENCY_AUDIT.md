# Начальный аудит зависимостей

Roadmap 088 открыт. `corepack pnpm audit --json` по текущему lock сообщил 32 advisory findings: 12 high, 19 moderate, 1 low; critical отсутствуют. Это результат audit для dev/runtime graph, а не доказательство возможности эксплуатации приложения. [Evidence](evidence/dependency-audit-088.json) содержит lock/audit hashes, диапазоны и первичные ссылки.

Подтверждён путь `fast-uri 3.1.3 → ajv 8.20.0 → MCP SDK 1.29.0` в зависимостях Studio и stdio MCP. Две первичные карточки проверены: [fast-uri host confusion](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), [brace-expansion memory exhaustion](https://github.com/advisories/GHSA-mh99-v99m-4gvg). Остальные требуют отдельного source/exposure review. Версия из первой карточки может не закрывать последующие advisories; выбирать обновление следует по полному набору и точным metadata.

Следующая работа: разделить bundled runtime и build-only exposure, проверить исправленные версии/источники/лицензии, обновить lock минимальным согласованным diff, затем повторить lint, suites, package/MCP E2E и audit. Dependency update не выполнен. Gradle/runtime license classification и cache/derivation attestation остаются отдельными обязательными gates. Production acceptance по supply chain не выдана.

## Исправление npm graph в Studio 0.5.2

Снимок выше сохранён как исходное evidence. Обновлены `fast-uri` до 3.1.8, `hono` до 4.13.7, `ip-address` до 10.7.1, `brace-expansion` до 5.0.12, `@hono/node-server` до 1.19.15 и `qs` до 6.16.0. Последний требует `side-channel` 1.1.1; это единственное дополнительное изменение package graph. [Metadata/tarball/license review](../provenance/npm-security-update-20261004.json) фиксирует официальные registry/GitHub источники, SHA-512 integrity, SHA-256 archive/license и declared MIT/BSD-3-Clause. Archive contents не исполнялись.

Новая frozen install, `typecheck:all`, lint, пять portable suites, HTTP MCP, clean Windows package и скрытый packaged E2E прошли. Audit нового lock: 0 findings во всех severity categories. [Evidence](evidence/npm-security-update-088.json) связывает новый source/lock, logs, report и `app.asar`. Это не доказательство отсутствия любых уязвимостей, binary CVEs или дефектов самого приложения. Java/Fabric tuple и immutable runtime trees не изменены; pipeline всё ещё требует cache attestation, Gradle/license review и hosted проверки нового dependency graph. Пункт 088 не закрыт.
