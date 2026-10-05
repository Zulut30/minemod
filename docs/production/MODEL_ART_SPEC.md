# ArtSpec для классов моделей

Пункт 041: требования к будущей модели выражены публичным ArtSpec v1 и проверяются до генерации. Версия v0, её schema ID и прежние правила остаются доступны без автоматической миграции. Пункт пока не закрыт: окончательная запись evidence будет сделана после проверки точного source revision в CI.

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
