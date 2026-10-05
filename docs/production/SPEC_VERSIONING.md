# Версии спецификаций и отказ до генерации

Пункт 019. Реализованы строгие ModSpec v0/v1 и ArtSpec v0. Поддержка структуры документа и способность backend выпустить соответствующий мод проверяются раздельно.

| Контракт | Принимаемая версия | Текущий путь |
|---|---|---|
| ModSpec | numeric `0`, schema `modspec-v0.json` | Исторический loader-neutral контракт и NeoForge regression backend |
| ModSpec | numeric `1`, schema `modspec-v1.json` | Production target Fabric 1.20.1 / Java 17; bounded items/materials/basic blocks/recipes и allowlisted libraries |
| ArtSpec | numeric `0`, schema `artspec-v0.json` | Декларативный стиль, target matrix, contexts, provenance и asset budgets; принятие schema не подтверждает runtime exporter |
| EditorProject | numeric `2` | Отдельная миграция проекта v1 → v2; не миграция ModSpec или ArtSpec |
| Asset bundle | numeric `1` | Отдельный reviewed-export contract; ещё не разрешает интеграцию authored assets в JAR |

`SUPPORTED_SPEC_VERSIONS` выводится из literals фактических Zod schemas и заморожен вместе с массивами. Поэтому сообщение валидатора не содержит отдельно поддерживаемую вручную таблицу версий. Schema IDs и shapes v0/v1 не заменялись; новые внешние dependencies не добавлены.

## Порядок проверки

1. Проверить bounded JSON: payload, depth, nodes/keys, array sizes, отсутствие accessors/proxies/non-JSON values и reserved keys.
2. Выбрать `kind` и явно отказать неизвестной numeric версии с `SCHEMA_INVALID` на `/schemaVersion`, перечислив доступные версии. Будущий `gameplay` не интерпретируется как старый формат. String, null и пропущенная версия по-прежнему не проходят strict schema; coercion или downgrade отсутствуют.
3. Проверить exact named target profile, resource graph, schema, budgets и semantic constraints.
4. Fabric compiler проверяет поддержку valid primitive до emitters/BuildPlan: entities, structures, summoning, screens, authored assets, custom serializers и другие неподдержанные поля не пропускаются молча. Invalid документ возвращает `SPEC_INVALID`; valid schema с ещё не реализованной capability — `SPEC_UNSUPPORTED`.
5. Только затем принадлежащие compiler outputs проходят generated-source gate, strict build и runtime проверки. Общий validator не выдаёт художественную или игровую приёмку.

Public Fabric entrypoint отвергает invalid schema до загрузки compatibility pack. Compile stage для valid ModSpec проверяет trusted pack перед internal content preflight; это не разрешает unsupported primitive и не создаёт частичный результат. Windows pack integrity не обходится.

## Ссылки материалов ModSpec v1

Теперь общий validator до компиляции проверяет уникальность `/gameplay/materials/*/id`, существование материала у equipment item, наличие armor properties у материала брони и repair ingredient в item domain. Ремонт использует declared gameplay item либо `minecraft:*`; ID блока с отдельным item ID не считается item автоматически. Диагностика указывает конкретное поле: `DUPLICATE_RESOURCE_LOCATION`, `BROKEN_REFERENCE` или `SEMANTIC_INVALID`. Повторная проверка в compiler сохраняется как защитный уровень.

Эти изменения ужесточают semantic validation ранее ошибочных документов. Такие документы уже не могли успешно пройти Fabric content preflight. Корректные v0/v1 inputs не переписываются, IDs, defaults и resource domains сохраняются. Проверка разрешённого `minecraft:*` namespace не доказывает существование любого ID в vanilla registry: runtime/content tests остаются обязательными.

ArtSpec уже проверяет unique asset IDs/paths, target tuple/runtime agreement, palette cardinality, required contexts, provenance kinds и числовые budgets. `assets.artSpec` является safe declarative path; автоматическое чтение произвольного файла, cross-document binding и reviewed bundle integration не добавлены этим пунктом. Текущий Fabric backend отклоняет nonempty authored asset sections; их интеграция и проверяемая связь с ArtSpec относятся к 049/062. Аналогично `assetClass: decorative-mesh` в ArtSpec не включает generic mesh generator.

## Проверки и границы

Regression suite покрывает сохранение известных версий, 12 отказов future/negative/fractional версий, отказ future shape без старой семантики и сохранение structural limits перед version dispatch. Material cases проверяют declared/vanilla repair, duplicate/missing material, armor properties и item/block domain. Отдельный portable `@mcdev/compiler-fabric test:spec-preflight` подтверждает шесть отказов unknown versions/primitives до pack loading. Linux full compiler suite дополнительно требует явных `SPEC_UNSUPPORTED` для всех непустых неподдерживаемых секций контрольного valid fixture.

Hosted run `37293017239` по source `2f96752` завершил full Linux compiler, Windows Studio и production-target успешно. Проверены strict clean build, два fixture GameTests, dedicated server/headless client и generated equipment/config build/server. Все шесть generated source/metadata файлов проверены по bytes/SHA-256 и совпадают с приёмкой 018. Это не full gameplay coverage; общий workflow failed на сохранённой legacy Fabric 26.2 checksum проверке.

[Evidence пункта 019](evidence/spec-versioning-019.json) различает local проверки и hosted compiler/build/runtime. Formal art approval и production release этим документом не выдаются.

Источники: [Zod discriminated unions](https://zod.dev/api#discriminated-unions), [Zod JSON Schema](https://zod.dev/json-schema). APIs сверены с официальными docs, Context7 и установленным pinned Zod 4.4.2; переход на новую версию библиотеки не выполнялся.
