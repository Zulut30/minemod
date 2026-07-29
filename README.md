# MineMod

[![Minecraft](https://img.shields.io/badge/Minecraft-26.1.2-62B47A?logo=minecraft)](https://www.minecraft.net/)
[![NeoForge](https://img.shields.io/badge/Loader-NeoForge-d7742f)](https://neoforged.net/)
[![Java](https://img.shields.io/badge/Java-25-E76F00?logo=openjdk)](https://adoptium.net/)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-Phase%200-orange)](docs/RESEARCH_AND_MVP_PLAN.md)

**Agent-native конструктор Minecraft-модов.** Первый production target — NeoForge 26.1.2 на Java 25. MineMod принимает строгий `ModSpec`, строит закрытый `BuildPlan`, генерирует читаемый Java-код и ресурсы, создаёт новый workspace и запускает фиксированную build policy через CLI или MCP.

> Проект находится в Phase 0 и ещё не является production-ready. Проверен узкий NeoForge-путь для базовых items/blocks; генерация полноценных сущностей, UI, анимаций, JEI/Jade adapters и release packaging остаётся незавершённой.

## Текущий NeoForge-срез

- строгая локальная проверка bounded `ModSpec` без исполнения кода из промпта;
- exact baseline NeoForge `26.1.2.80`, Minecraft `26.1.2`, Java `25.0.3+9` и ModDevGradle `2.0.141`;
- детерминированная генерация NeoForge workspace, базовых items/blocks и ресурсов;
- транзакционное create-only применение плана без молчаливой перезаписи файлов;
- фиксированный Linux x64 Gradle runner с checksum-проверками и Java 21/25 toolchains;
- индекс generated и build-артефактов;
- отдельные `neoforge build` adapters для CLI и подтверждаемого MCP tool;
- инфраструктурный GameTest, dedicated-server и headless-client smoke baseline.

JEI и Jade остаются optional dependencies и пока не включены в обязательный generated runtime.

## Экспериментальный Fabric compatibility pack

- генерация Fabric 1.20.1 проекта с разделёнными main/client source sets;
- items, blocks, creative entries, loot, blockstates и модели;
- типизированные материалы, мечи, кирки, топоры, лопаты, мотыги и четыре слота брони;
- детерминированные pixel-art иконки экипировки и два 64×32 wearable-слоя брони;
- shaped 1×1–3×3, shapeless и smelting recipes, включая item/tag ингредиенты и количество результата;
- закрытая Gradle policy с Temurin 17, checksum-проверками и фиксированными tasks;
- получение готового remapped JAR и индекса артефактов;
- cuboid-модели, pixel texture atlases, rig и editable Blockbench 5 `.bbmodel`;
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
- Eclipse Temurin `25.0.3+9`;
- Eclipse Temurin `21.0.11+10` как auxiliary toolchain ModDevGradle;
- Linux x64 для фиксированного build runner Phase 0.

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
  --profile neoforge-26.1.2-java-25 \
  '<modspec-json>'
```

Сборка одобренного ModSpec:

```bash
pnpm --filter @mcdev/cli start -- \
  neoforge build \
  --workspace /absolute/path/to/existing-empty-directory \
  --java21-home /absolute/path/to/temurin-21.0.11+10 \
  --java25-home /absolute/path/to/temurin-25.0.3+9 \
  --artifact-cache /absolute/path/to/mcdev-cache \
  '<modspec-json>'
```

MCP-сервер публикует:

- `mcdev_spec_validate` — безопасная локальная проверка;
- `mcdev_neoforge_build` — подтверждаемая сборка NeoForge 26.1.2 с literal-полем `approved: true`;
- `mcdev_fabric_build` — сборка только с literal-полем `approved: true`.

```bash
pnpm --filter @mcdev/mcp-server start
```

## Структура репозитория

```text
apps/
  cli/                 CLI adapter
  mcp-server/          MCP stdio server
packages/
  application/         общий build workflow
  compiler-neoforge/   NeoForge 26.1.2 backend
  compiler-fabric/     Fabric 1.20.1 backend
  library-catalog/     доверенные сторонние библиотеки
  assets-core/         модели, текстуры, rig и quality checks
  build-runner/        закрытая Gradle execution policy
  compatibility-packs/ проверка exact runtime packs
  modspec/             схемы ModSpec и ArtSpec
packs/
  neoforge-26.1.2/     первый production-target compatibility pack
  fabric-*/             отдельные compatibility packs
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

1. Расширить NeoForge compiler типизированными рецептами и GameTests generated content.
2. Добавить NeoForge entities/UI только через bounded ModSpec contracts.
3. Ввести технический и визуальный quality gate для моделей и текстур.
4. Добавить GeckoLib, JEI и Jade через проверенный каталог, сохраняя JEI/Jade optional.
5. Реализовать отдельную `package`-операцию без автоматического `publish`.
6. Завершить plan/review/apply workflow с progress и cancel/resume.

Актуальные критерии и границы находятся в [Research and MVP plan](docs/RESEARCH_AND_MVP_PLAN.md), а долгосрочное направление — в [Production roadmap](docs/PRODUCTION_ROADMAP.md).

## Документация

- [Research и MVP plan](docs/RESEARCH_AND_MVP_PLAN.md)
- [Исторический Fabric-first plan](docs/FABRIC_FIRST_MVP_PLAN.md)
- [Library integrations](docs/LIBRARY_INTEGRATIONS.md)
- [Архитектурные решения](docs/decisions/)
- [Аудиты baseline и modeling foundation](docs/audit/)
- [Art Quality Rubric](docs/quality/art-quality-rubric-v0.md)
- [Third-party licensing boundary](THIRD_PARTY_NOTICES.md)

## Лицензия

Оригинальный код, документация и схемы распространяются по [Apache License 2.0](LICENSE). Generated output остаётся ограничен правами на входные материалы, лицензиями сторонних библиотек, условиями AI providers и правилами Minecraft. Полная граница описана в [ADR-0001](docs/decisions/0001-product-and-output-licensing.md).
