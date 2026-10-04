# Начальный аудит зависимостей

Roadmap 088 открыт. `corepack pnpm audit --json` по текущему lock сообщил 32 advisory findings: 12 high, 19 moderate, 1 low; critical отсутствуют. Это результат audit для dev/runtime graph, а не доказательство возможности эксплуатации приложения. [Evidence](evidence/dependency-audit-088.json) содержит lock/audit hashes, диапазоны и первичные ссылки.

Подтверждён путь `fast-uri 3.1.3 → ajv 8.20.0 → MCP SDK 1.29.0` в зависимостях Studio и stdio MCP. Две первичные карточки проверены: [fast-uri host confusion](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), [brace-expansion memory exhaustion](https://github.com/advisories/GHSA-mh99-v99m-4gvg). Остальные требуют отдельного source/exposure review. Версия из первой карточки может не закрывать последующие advisories; выбирать обновление следует по полному набору и точным metadata.

Следующая работа: разделить bundled runtime и build-only exposure, проверить исправленные версии/источники/лицензии, обновить lock минимальным согласованным diff, затем повторить lint, suites, package/MCP E2E и audit. Dependency update не выполнен. Gradle/runtime license classification и cache/derivation attestation остаются отдельными обязательными gates. Production acceptance по supply chain не выдана.
