# ArtSpec для классов моделей

Пункт 041 закрыт: требования к будущей модели выражены публичным ArtSpec v1 и проверяются до генерации. Версия v0, её schema ID и прежние правила остаются доступны без автоматической миграции. [Exact-source evidence](evidence/model-art-spec-041.json) относится к source `63c4646`; художественная и игровая приёмка authored моделей этим пунктом не выполнялась.

ArtSpec v1 добавляет обязательный `modelIntent` и `textureLayout`. Контракт содержит стиль, палитру, материал каждой смысловой части, дерево креплений, роль и важность части, габариты в model units (16 units/block), интервалы отношений размеров, крупные детали, читаемость в 32/64 px, причины отклонения, бюджеты и обязательные capture contexts. Это требования конкретного задания; интервалы не являются универсальной формулой художественного качества.

| Класс | Части и формат | Обязательные виды |
|---|---|---|
| weapon | Хват и клинок/голова; одно дерево; cuboid-model/native-held-item | Восемь нейтральных видов, 32/64 silhouette, UV, inventory, hand, ground, day/night |
| armor | Четыре слота; wearable-set/native-wearable-layers; два 64×32 слоя | Четыре иконки, перед/зад/бока игрока, ходьба, UV, glint, day/night |
| building-block | Поверхность полного 16×16×16 блока; native-block-model | Шесть граней, стена 3×3, placed, near/mid, day/night |
| decorative-prop | Основание и рабочий объём; одно дерево; native-block-model | Восемь видов, UV, четыре ориентации, состояния, placed, 32/64 silhouette, day/night |
| creature | Основной объём, semantic parts; одно дерево; animated-companion | Восемь видов, rig, key poses, idle/gameplay, timing, near/mid, 32/64 silhouette, day/night |

`runtimeRequirement` и `targetMatrix.renderer` описывают требуемую возможность. Они не подтверждают наличие exporter или игровую совместимость. Native armor layers не заменяются экспортом held-item; объёмные дополнения этим контрактом не разрешены. Для краба версия animation runtime не подтверждена; historical GeckoLib 5 не переносится на Fabric 1.20.1.

Публичная validation проверяет strict schema, пределы коллекций, уникальные ID, существование частей и материалов, циклы и разорванные крепления, диапазоны и повторные отношения, согласованность класса/runtime/asset class, texture layout, обязательные contexts, target/runtime agreement и budgets. Цвета material recipes и hue bands должны входить в палитру. `minimumValueStep` означает разницу HSV V в процентах между shadow/base/highlight каждого recipe. Это проверка заявленных цветов, а не измерение изображения. Structural limits и ограничение inline JSON 262144 байта сохраняются.

JSON Schema фиксирует форму и пределы полей; ссылки, циклы и cross-field условия проходят Zod/server-side validation. Проверены [официальная документация Zod](https://zod.dev/api) и [экспорт JSON Schema](https://zod.dev/json-schema), а также Context7. Dependency остаётся закреплённой 4.4.2; фактический parser и CLI/MCP проверяются на этой версии.

## Публичные операции

`mcdev spec validate <inline-json>` принимает ModSpec v0/v1 и ArtSpec v0/v1. `mcdev art plan <inline-artspec-v1-json>` и MCP `mcdev_art_plan({payload})` возвращают один `mcdev.art-plan/v1`: SHA-256 payload, проверенные parts/style/budgets/contexts и отдельные статусы generation/runtime/artistic/game/integration. CLI/MCP не читают произвольные файлы, не записывают assets и не вызывают build runner. MCP принимает только bounded payload; shell/script/eval аргументы отклоняются. Прежние validation/asset/build tools остаются доступны. Десять tools MCP самого Studio этим пунктом не расширяются.

Art plan отклоняет v0 явно; ошибка не возвращает частичный plan. Успех отмечает specification=validated, generation/game/integration=not-run, runtimeCapability=not-verified, artistic=requires-human-review. Контракт не выдаёт художественный PASS и не проверяет фактические bounds, cubes, rig, seams, UV, анимацию, состояние или collision модели.

## Воспроизводимые задания

В `fixtures/art/` находятся пять оригинальных заданий из неизменённых control briefs: polar-cleaver, polar-armor, copper-masonry, tide-altar, tidecaller-crab. Они сохраняют палитры и верхние budgets; native armor использует 64×32 вместо максимального atlas allowance 128. `assets` пуст: артефакты ещё не созданы.

Шестой fixture, leaf-sword, фиксирует выбранное направление A — симметричный меч «Лист». Это отдельное задание, а не переименование benchmark-топора. Объём v3c и будущая текстура не приняты; палитра fixture является предложением задания, а не human approval. Интеграция authored assets в trusted pack/JAR не выполняется.

`node --experimental-strip-types scripts/preview-art-plans.mjs` записывает offline dark style sheets, шесть plan JSON и три JSON Schema в `output/model-editor/art-plans-041/`. Это локальный скрипт разработчика; HTML экранирует текст, не загружает сеть и показывает те же validated data, что CLI/MCP. Это просмотр задания, не рендер модели.

Фактическая оценка силуэта, пропорций, объёма и formal human review относится к 042–050. Binding задания к exported bundle и игровой интеграции требует отдельной проверки.

## Подтверждённая проверка

Шесть fixtures проходят публичный validator и art plan; пять классов представлены, 32 ошибочных случая отклоняются без частичного plan. Максимальные intent collections сохраняют прежние structural limits; part material reference поддерживает полный 193-character ResourceLocation. Проверены actual CLI process, linked SDK и реальный stdio MCP. Lint, root/Studio typecheck, portable tests и desktop build прошли локально. Старые ArtSpec v0 и ModSpec v0/v1 JSON Schema сравнены с предыдущим Git source: объекты и hashes совпадают.

Offline style sheets проверены headless на 1440×1000 и 390×844: шесть карточек, ссылки, размеры native armor, статус направления Leaf, отсутствие horizontal overflow/page errors/network requests. Root-agent посмотрел полученный screenshot. Main/worker/preload Studio 0.18.0 после пересборки имеют прежние SHA-256; новый class exporter или UI generator не заявляется.

Hosted [run 37358494032](https://github.com/Zulut30/minemod/actions/runs/37358494032) завершился по точному source `63c4646`: Linux full tests/build, Windows 21 packaged subreports, Fabric 1.20.1, NeoForge и client smoke прошли. Clean-checkout reports Windows/Linux/production имеют одинаковые source/tree. Production подтверждает strict clean online/offline build, два обязательных infrastructure GameTests online/offline, dedicated/client readiness с полностью остановленными nonce, generated fixture build/server; hashes шести generated source files и JAR проверены по выгруженным bytes. Это не игровая проверка authored Leaf или других ArtSpec fixtures.

Whole workflow завершился failure только на сохранённом legacy Fabric 26.2 checksum gate: ожидается `23248c15f8413aa0d06ac59e676913dd6a1dc0c5fffaa09365afd6c98d59fcd3`, фактически `cf1ce23326b526d47a191726bcd54d11e72b8e71eea56255d0848c9947710b06`. Причина не установлена; checksum policy не менялась. Закрытие 041 касается pre-generation contract, а не production release всего проекта.

Ограничение native coordinate span 48 units в задании соответствует границам −16…32 [зафиксированного Java model format Blockbench 5.0.0](https://github.com/JannisX11/blockbench/blob/v5.0.0/js/io/formats/java_block.js). Фактические координаты и rotations проверяются отдельным exporter.
