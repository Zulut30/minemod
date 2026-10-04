# Версионированный asset bundle

Roadmap 061. Контракт v1 связывает исходник, editable source и runtime files для Fabric 1.20.1 / Java 17. Реализован held-item exporter; схемы block, armor и animated-entity проверяют структуру манифеста и ссылки. Наличие этих классов в контракте не подтверждает block editor, wearable rendering или установленный animation renderer.

## Артефакт и идентичность

`asset-bundle.v1.json` содержит `schemaVersion: 1`, `kind: mcdev-asset-bundle`, `manifest`, `manifestSha256` и inline `files`. Манифест содержит target, namespaces, список assets, ModSpec references и file descriptors (`path`, role, encoding, decoded bytes, SHA-256).

`manifestSha256` вычисляется по `canonicalJsonFileBytes(manifest)`: рекурсивно сортированные ключи, compact JSON, UTF-8, завершающий LF. File SHA-256 считается по точным decoded bytes; JSON и bbmodel не нормализуются. Исходный item payload сохраняется без изменения пробелов и перевода строк. Хеши подтверждают целостность; они не удостоверяют автора и не дают human approval.

`modSpecSha256` и `artSpecSha256` могут быть `null`. Нынешний exporter не принимает ModSpec/ArtSpec и оставляет оба поля `null`; список references обозначает предполагаемую связь с `items`, а не проверку существования записи в конкретной spec. Будущий importer должен сверить spec, target, нативные ссылки и approved digest (пункт 62).

В каждом bundle `reviewRequired` строго равен `true`. Поля `humanApproved`, команды, неизвестные keys и будущие schema versions отвергаются. Отдельное решение человека привязывается к exact manifest digest; сам bundle не является источником полномочий approver.

## Классы и пути

| Класс | ModSpec collection | Runtime resources | Текущая реализация |
|---|---|---|---|
| held-item | items | `models/item/*.json`, `textures/*.png` | Реальный exporter Minecraft JSON/PNG/bbmodel и исходника |
| block | blocks | `models/block/*.json`, `blockstates/*.json`, inventory `models/item/*.json`, PNG | Manifest contract; редактор/игровая интеграция ещё не реализованы |
| armor | items | Два различных PNG layer paths | Manifest contract; wearable-проверка отдельно |
| animated-entity | entities | `geo/*.json`, `animations/*.json`, PNG, exact renderer id/version | Manifest contract; renderer не выбирается и не устанавливается |

Файлы находятся в `source/<namespace>/`, `editable/<namespace>/` и `assets/<namespace>/`. Контракт проверяет roles, encoding, расширения, namespace, наличие каждого resource, уникальность paths/references и отсутствие несвязанных файлов. Traversal, абсолютные пути, backslash, ADS, пустые сегменты, Windows reserved names и сегменты с конечной точкой запрещены. Несколько assets могут использовать общий файл; он остаётся одним descriptor.

Limits: 16 assets, 64 files, 2 MiB на decoded file, 4 MiB decoded total, 8 MiB входного JSON. Для inline предмета сохраняется более строгий 256 KiB limit. PNG-validator проверяет CRC, последовательность IHDR/IDAT/IEND, RGBA8, размеры 1..256, точную длину scanlines, допустимые filter bytes и ограниченный inflate без trailing compressed bytes. Ancillary chunks/interlace/другие color formats не входят в текущий профиль exporter.

## Доступные операции

- Studio export атомарно создаёт новую папку с четырьмя файлами bundle и `asset-bundle.v1.json`; также сохраняет прежний `bundle.json` и полный `source.mmeditor.json` с editor metadata. Исходник в manifest — item asset request; editor history/design не являются runtime resources.
- MCP `studio_asset_export` поддерживает `format: bundle-v1`. Формат по умолчанию `legacy` сохраняет прежний ответ из трёх файлов. Нужны projectId/expectedRevision; операция read-only, bounded response 2 MiB, filesystem/JAR/approval она не меняет.
- CLI `mcdev asset bundle <inline-item-json>` выпускает v1; `mcdev asset verify <inline-bundle-v1-json>` проверяет JSON и возвращает тот же bundle. Legacy `asset item` сохранён. У shell есть собственные ограничения длины аргумента.
- Application `compileItemAssetBundleV1`, `verifyAssetBundleV1`, `verifyAssetBundlePayloadV1` возвращают deep-frozen значения. Внешний JSON следует передавать через payload API с byte limit.

`AssetBundleManifestV1JsonSchema` описывает форму данных. JSON Schema не выражает все наши cross-file/namespace/hash проверки: обязательно применять Zod contract и application verifier. Verifier подтверждает JSON object root, PNG profile и целостность; он не обещает семантическую проверку произвольного Minecraft model/Blockbench/entity JSON. Source recompilation и согласование native references относятся к importer.

## Проверки и границы

[Evidence 061](evidence/asset-bundle-061.json) фиксирует source и результаты. Contract suites проверяют четыре класса, missing files, role/type mismatch, namespaces, duplicates, budgets и запрещённые пути. Application suites проверяют детерминизм, точные source/runtime bytes, PNG corruption/inflate limits и несовпадающие hashes. CLI, реальный HTTP MCP и скрытый packaged Studio E2E проверяют текущий held-item путь; E2E сверяет каждый file descriptor с экспортированным файлом на диске.

Новые внешние зависимости не добавлены. Использованы существующие Apache-2.0 workspace packages assets-contracts и codegen-core; lock изменён только на эти workspace links. Экспорт не добавляет assets в JAR и не меняет trusted packs. Художественная приёмка и Minecraft runtime нового bundle остаются открытыми.

Документация, сверенная при реализации: [Zod refinements](https://zod.dev/api?id=refinements), [Zod JSON Schema](https://zod.dev/json-schema), [Node 24.11 zlib options](https://github.com/nodejs/node/blob/v24.11.0/doc/api/zlib.md#class-options), Context7 `/colinhacks/zod`.
