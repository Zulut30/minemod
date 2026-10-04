# MineMod

[![Minecraft](https://img.shields.io/badge/Minecraft-1.20.1-62B47A?logo=minecraft)](https://www.minecraft.net/)
[![Fabric](https://img.shields.io/badge/Loader-Fabric-dbbf8a)](https://fabricmc.net/)
[![Java](https://img.shields.io/badge/Java-17-E76F00?logo=openjdk)](https://adoptium.net/)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-experimental-orange)](docs/FABRIC_FIRST_MVP_PLAN.md)

**Agent-native конструктор модов для Fabric 1.20.1.** MineMod принимает строгий `ModSpec`, генерирует читаемый Java-код и ресурсы, создаёт новый Fabric workspace и собирает проверенный JAR через CLI или MCP.

> Проект находится в активной разработке. Базовый путь `ModSpec → Fabric project → JAR` работает, но свободный prompt-to-production-mod, полноценные игровые сущности и runtime-анимации ещё не завершены.

## Что уже работает

- строгая локальная проверка `ModSpec v1` без исполнения кода из промпта;
- генерация Fabric 1.20.1 проекта с разделёнными main/client source sets;
- items, blocks, creative entries, loot, blockstates и модели;
- типизированные материалы, мечи, кирки, топоры, лопаты, мотыги и четыре слота брони;
- детерминированные pixel-art иконки экипировки и два 64×32 wearable-слоя брони;
- shaped 1×1–3×3, shapeless и smelting recipes, включая ванильные ингредиенты и количество результата;
- транзакционное создание нового workspace без молчаливой перезаписи файлов;
- закрытая Gradle policy с Temurin 17, checksum-проверками и фиксированными tasks;
- получение готового remapped JAR и индекса артефактов;
- одинаковый application service для CLI и подтверждаемого MCP tool;
- cuboid-модели, pixel texture atlases, rig и editable Blockbench 5 `.bbmodel`;
- отдельный экспорт authored 3D-предмета в Minecraft JSON, PNG и `.bbmodel` с локальным интерактивным просмотром;
- параметрический архетип большого дракона и structural/texture preflight;
- доверенный каталог интеграций Fabric-библиотек.
- сохраняемая JSON5-конфигурация с generated boolean/integer/string controls, YACL-экран и кнопка Mod Menu.
- server-authoritative `player_join_message` binding через Fabric networking lifecycle event.

```text
approved ModSpec
      │
      ▼
validate ──→ resolve trusted libraries ──→ generate source/resources
                                                  │
                                                  ▼
artifact index ←── verified JAR ←── fixed Gradle runner ←── new workspace
```

## Интеграции Fabric 1.20.1

| Интеграция | Зафиксированная версия | Поведение |
|---|---:|---|
| Fabric Loader | `0.19.3` | обязательная платформа |
| Fabric API | `0.92.11+1.20.1` | обязательная базовая API |
| YACL | `3.5.0+1.20.1-fabric` | сохраняет JSON5 и создаёт типизированный экран настройки |
| Mod Menu | `7.2.2` | optional; открывает generated YACL screen из списка модов |

Версии, Maven repositories, licenses и допустимая обязательность берутся только из закрытого каталога. Произвольные coordinates и repositories из пользовательского запроса не принимаются. YACL 3.5.0 выбран после реальной проверки с текущим Loom 1.6.12; YACL 3.6.x требует обновления проверенного Loom baseline.

Подробности и пример ModSpec: [Library integrations](docs/LIBRARY_INTEGRATIONS.md).

## Пример shaped-рецепта

```json
{
  "id": "infectedfrontier:blue_steel_sword",
  "references": [],
  "type": "shaped",
  "ingredients": [],
  "pattern": ["X", "X", "S"],
  "key": [
    { "symbol": "X", "item": "infectedfrontier:blue_steel_ingot" },
    { "symbol": "S", "item": "minecraft:stick" }
  ],
  "result": "infectedfrontier:blue_steel_sword",
  "resultCount": 1
}
```

Компилятор проверяет прямоугольную форму, границы 1×1–3×3, уникальность символов, точное соответствие `pattern` и `key`, ссылки на generated items и диапазон результата 1–64.

## Пример материала и оружия

```json
{
  "materials": [{
    "id": "infectedfrontier:blue_steel",
    "repairIngredient": "infectedfrontier:blue_ingot",
    "durability": 1024,
    "miningSpeed": 9,
    "attackDamageBonus": 4,
    "miningLevel": 3,
    "enchantmentValue": 18,
    "armor": {
      "durabilityMultiplier": 32,
      "defense": { "helmet": 3, "chestplate": 8, "leggings": 6, "boots": 3 },
      "toughness": 2,
      "knockbackResistance": 0.1
    },
    "palette": {
      "base": "#477aa5",
      "shadow": "#1b3347",
      "highlight": "#bad9ef",
      "accent": "#d4a72c",
      "handle": "#60401f"
    },
    "visualProfile": {
      "silhouette": "ornate",
      "motif": "runed"
    }
  }],
  "items": [{
    "id": "infectedfrontier:blue_steel_sword",
    "references": [],
    "maxStackSize": 1,
    "kind": "sword",
    "material": "infectedfrontier:blue_steel",
    "attackDamage": 4,
    "attackSpeed": -2.4
  }]
}
```

Поддерживаются `sword`, `pickaxe`, `axe`, `shovel`, `hoe` и `armor` со слотами `helmet`, `chestplate`, `leggings`, `boots`. Генератор создаёт Java-классы предметов, разные 16×16 pixel-art силуэты, handheld-модели, creative-tab entries, vanilla item tags и два 64×32 wearable-атласа. Палитра optional: без неё цвета детерминированно выводятся из ID материала; явная палитра проверяется на уникальность и читаемый value contrast. Optional `visualProfile` независимо задаёт семейство формы (`balanced`, `heavy`, `ornate`) и мотив (`clean`, `riveted`, `runed`, `organic`). Старые спецификации получают `balanced/clean`.

В `fixtures/reference-studies` лежат version-pinned исследования открытых модов. Они хранят источники и лицензии, требуют минимум три независимых проекта для продвижения общих правил и всегда запрещают копировать чужую геометрию, текстуры или характерный дизайн.

## Быстрый старт для разработчика

Требуется:

- Node.js `24.11.0`;
- pnpm `11.8.0` через Corepack;
- Eclipse Temurin `17.0.19+10` для Fabric 1.20.1 builds.

```bash
corepack pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

Проверка спецификации:

```bash
pnpm --filter @mcdev/cli start -- \
  spec validate \
  --profile fabric-1.20.1-java-17 \
  '<modspec-json>'
```

Сборка одобренного ModSpec:

```bash
pnpm --filter @mcdev/cli start -- \
  fabric build \
  --workspace /absolute/path/to/existing-empty-directory \
  --java17-home /absolute/path/to/temurin-17.0.19+10 \
  --artifact-cache /absolute/path/to/mcdev-cache \
  '<modspec-json>'
```

MCP-сервер публикует:

- `mcdev_spec_validate` — безопасная локальная проверка;
- `mcdev_asset_compile_item` — ограниченный экспорт 3D-предмета для review, без записи файлов и запуска сборки;
- `mcdev_fabric_build` — сборка только с literal-полем `approved: true`.

Вторая версия оружия с пиксельной покраской и рабочий цикл улучшения кода/моделей: [AI code and 3D workflow](docs/AI_CODE_AND_3D_WORKFLOW.md).
Для воспроизведения примера на Node.js 24.11.0:

```bash
node scripts/preview-item.mjs
```

Откройте `output/item-preview-v2/preview.html` в браузере. Просмотр работает автономно, позволяет вращать модель, менять ракурс и включать каркас. Экспортируемые ресурсы ещё не подключены к `ModSpec → JAR`; загрузка предмета, положение в руке и игровой рендер требуют отдельной проверки. Результат `fabric build` теперь также возвращает предупреждения компилятора в поле `warnings`.

```bash
pnpm --filter @mcdev/mcp-server start
```

## Локальная мастерская моделей

Путь к production: [100 пунктов с критериями приёмки](docs/PRODUCTION_ROADMAP_100.md). План отдельно определяет готовность редактора, проверку авторских ресурсов в Minecraft и выпуск всего генератора.

Первый Windows-прототип MineMod Studio: 3D-сцена, выбор частей, изменение формы и цвета, undo/redo, собственный проект и отдельный экспорт. [Запуск, проверки и текущие ограничения](docs/MODEL_EDITOR_FIRST_BUILD.md), [план дальнейшей разработки](docs/MODEL_EDITOR_MVP_PLAN.md).

```powershell
corepack pnpm --filter @mcdev/model-editor build
corepack pnpm --filter @mcdev/model-editor start
```

Переносимая версия 0.5.1: точный путь к `MineMod Studio.exe` находится в `output/model-editor/latest-build.json`; каждая сборка создаётся отдельно в `releases/`. Тёмная тема и единый обзор четырёх ракурсов, силуэта и 32/64 px доступны для ручной и агентной работы. Маленькие превью отдельно рендерятся в квадрате и сохраняют масштаб при изменении размера панели. После отказа пользователя от «Полярного стража» созданы три самостоятельных редактируемых дизайна по новому оригинальному концепту; они ожидают художественной оценки. [Переработка оружия](docs/MODEL_EDITOR_WEAPON_REDESIGN.md), [тема и визуальная работа ИИ](docs/MODEL_EDITOR_DARK_AND_REVIEW.md), [варианты](docs/MODEL_EDITOR_VARIANTS.md), [покраска и UV](docs/MODEL_EDITOR_TEXTURES.md), [подключение агента](docs/MODEL_EDITOR_MCP.md). Автоматического image-to-3D в приложении нет; самостоятельная генерация установленными CLI и проверка ресурсов в Minecraft остаются отдельными этапами.

## Структура репозитория

```text
apps/
  cli/                 CLI adapter
  mcp-server/          MCP stdio server
  model-editor/        локальная Windows-мастерская моделей
packages/
  application/         общий build workflow
  compiler-fabric/     Fabric 1.20.1 backend
  library-catalog/     доверенные сторонние библиотеки
  assets-core/         модели, текстуры, rig и quality checks
  build-runner/        закрытая Gradle execution policy
  compatibility-packs/ проверка exact runtime packs
  modspec/             схемы ModSpec и ArtSpec
packs/
  fabric-1.20.1/       production-target compatibility pack
fixtures/              воспроизводимые тестовые проекты и ассеты
docs/                  ADR, планы, аудиты и quality rubric
```

## Архитектурные гарантии

- промпт не может передать Java source, shell command, Gradle task или environment;
- compatibility pack и library catalog версионированы и проверяются по SHA-256;
- generated workspace создаётся транзакционно и только в разрешённой пустой директории;
- client-only код физически отделён от server-safe кода;
- optional API не должны попадать в обязательный путь загрузки;
- одинаковый вход создаёт одинаковый план и детерминированное дерево generated files;
- публикация мода не выполняется автоматически и остаётся человеческим решением.

## Ближайшие этапы

1. Reference-driven мотивы, варианты силуэтов и human visual review для generated экипировки.
2. Каталог GeckoLib, Cardinal Components, Trinkets, EMI и Jade.
3. Fabric GameTests и отдельные hosted client/server gates.
4. AI texture provider без placeholder assets.
5. Gameplay entities, AI, структуры и проверенный runtime animation export.
6. Полный plan/review/apply workflow с progress и cancel/resume.

Актуальные критерии приёмки находятся в [Fabric-first MVP plan](docs/FABRIC_FIRST_MVP_PLAN.md), а долгосрочное направление — в [Production roadmap](docs/PRODUCTION_ROADMAP.md).

## Документация

- [Fabric-first MVP plan](docs/FABRIC_FIRST_MVP_PLAN.md)
- [Library integrations](docs/LIBRARY_INTEGRATIONS.md)
- [Research и исходный MVP plan](docs/RESEARCH_AND_MVP_PLAN.md)
- [Архитектурные решения](docs/decisions/)
- [Аудиты baseline и modeling foundation](docs/audit/)
- [Art Quality Rubric](docs/quality/art-quality-rubric-v0.md)
- [Рабочий цикл AI-кода и 3D-моделей](docs/AI_CODE_AND_3D_WORKFLOW.md)
- [Third-party licensing boundary](THIRD_PARTY_NOTICES.md)

## Лицензия

Оригинальный код, документация и схемы распространяются по [Apache License 2.0](LICENSE). Generated output остаётся ограничен правами на входные материалы, лицензиями сторонних библиотек, условиями AI providers и правилами Minecraft. Полная граница описана в [ADR-0001](docs/decisions/0001-product-and-output-licensing.md).
