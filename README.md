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
- [ArtSpec v1 для пяти классов моделей](docs/production/MODEL_ART_SPEC.md): части, пропорции, материалы и бюджеты до генерации через CLI/MCP;
- [Художественный reference benchmark](docs/production/ART_REFERENCE_BENCHMARK.md): десять оригинальных учебных контрастов, нейтральные виды и native 32/64 PNG; человеческая и игровая приёмка остаются отдельными;
- [Нативные силуэты Studio 0.19](docs/production/NATIVE_SILHOUETTE_REVIEW.md): отдельный рендер 32/64, физический display 1:1 с DPI и локальная запись наблюдения человека; этап 043 открыт до проверки узнаваемости;
- [Сохранение цветов при перекраске Studio 0.20](docs/production/LOCAL_RECOLOR.md): выбранный цвет руны, кристалла или блика сохраняется в локальном тонировании и через ограниченную MCP-команду;
- [Безопасная перепаковка UV Studio 0.21](docs/production/SAFE_UV_REPACK.md): рисунок, отражения, защищённые поверхности и undo сохраняются; полный локальный и hosted Windows набор из 22 сценариев прошёл;
- [Масштаб пикселей Studio 0.22](docs/production/TEXEL_DENSITY_INSPECTION.md): read-only диагностика по граням в UV-панели и MCP, учёт inflate, целых UV и размеров атласа; создание согласованной текстуры и визуальная приёмка ещё открыты;
- [Материалы арт-проверки Studio 0.23](docs/production/ART_REVIEW_PREVIEW.md): экспорт и восемь ракурсов одной версии, реальные ArtSpec bindings и сохраняемая история черновика; художественная/игровая приёмка и release permission ещё открыты;
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

- Node.js `24.21.0`;
- pnpm `11.8.0` через Corepack;
- Git и Python 3 для проверок checkout и игровых bootstrap inputs;
- Eclipse Temurin `17.0.19+10` для Fabric 1.20.1 builds на Linux x64.

```bash
node scripts/verify-clean-checkout.mjs
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck:all
corepack pnpm lint
corepack pnpm build
```

Проверка checkout предназначена для свежего clone до `install`: старые `output/`, dependencies и build-каталоги вызывают отказ. Она не удаляет их из рабочей копии. [Чистый старт, команды сборки и границы воспроизводимости](docs/production/CLEAN_CHECKOUT.md).

`corepack pnpm test` выполняет полный suite на Linux x64 и явно отказывает на другой ОС: он проверяет реальные POSIX file modes и Linux-only build runner. Для Windows используйте `corepack pnpm test:portable`; packaged Studio проверяется отдельным Windows E2E. Успешный portable suite не подтверждает build/GameTests/dedicated server. [Матрица проверок ОС](docs/production/OS_VERIFICATION.md).

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
Для воспроизведения примера на Node.js 24.21.0:

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

Переносимая версия 0.22.0: точный путь к `MineMod Studio.exe` находится в `output/model-editor/latest-build.json`; каждая сборка создаётся отдельно в `releases/`. Тёмная тема и единый обзор четырёх ракурсов, силуэта и 32/64 px доступны для ручной и агентной работы. Оба размера отдельно рендерятся в квадрате, показываются 1:1 с учётом DPI и сохраняют кадрирование при изменении размера панели. [Переработка оружия](docs/MODEL_EDITOR_WEAPON_REDESIGN.md), [тема и визуальная работа ИИ](docs/MODEL_EDITOR_DARK_AND_REVIEW.md), [варианты](docs/MODEL_EDITOR_VARIANTS.md), [покраска и UV](docs/MODEL_EDITOR_TEXTURES.md), [подключение агента](docs/MODEL_EDITOR_MCP.md). Самостоятельное создание технического предмета установленными [Codex CLI](docs/production/INDEPENDENT_CODEX_SESSION.md) и [Claude Code](docs/production/INDEPENDENT_CLAUDE_SESSION.md) подтверждено на Studio 0.10.1 отдельно от offline CI. Автоматического image-to-3D нет; художественная приёмка этих моделей и проверка экспортируемых ресурсов в Minecraft остаются открытыми.

Studio 0.11.0 добавляет [редактируемый структурированный бриф](docs/production/STRUCTURED_BRIEF.md) до появления первого куба. Studio 0.12.0 добавляет [имена и плоские группы частей](docs/production/PARTS_EDITING.md), multiselect и ручную защиту деталей. Studio 0.12.1 исправляет [клавиатурный фокус и ARIA status/error](docs/production/ACCESSIBILITY.md); локально проверен фактический масштаб 175%, расширение матрицы продолжается. Полный [ручной путь из пустого проекта до экспорта](docs/production/MANUAL_WORKFLOW.md) проверяется через GUI; developer helpers запускают отдельные скрытые экземпляры приложения.

## Структура репозитория

Studio 0.14.0 добавляет [адресное исправление модели](docs/production/TARGETED_REPAIR.md): пользователь выбирает части, область/грань и лимит до трёх итераций, а сервис ограничивает каждую правку агента. Geometry сохраняет ручную покраску, texture/UV защищают соседние поверхности; preview и replay не расходуют бюджет. Локальный packaged путь проверен отдельно от hosted и художественной приёмки; статус доказательств указан в документе.

Studio 0.14.1 исправляет обрезание модели в первом PNG обзора после загрузки миниатюр: для них заранее выделено место, поэтому 3D-панели сохраняют размер. Регрессионная проверка требует свободные поля вокруг всей модели именно в возвращённом MCP-снимке; [воспроизведение на 0.14.0 и границы проверки](docs/production/CAPTURE_LAYOUT_FIX.md).

Studio 0.15.0 добавляет [концепты и разрешённые references рядом с брифом](docs/production/CONCEPT_WORKFLOW.md): исходный PNG сохраняется по hash, переносится с папкой `.assets`, доступен агенту как 2D направление. EditorProject v1/v2 мигрирует в v3 с сохранением точной исходной копии; художественная и игровая приёмка остаются отдельными.

Patch Studio 0.5.2 обновляет проверенные npm-зависимости: audit нового lock показывает 0 advisories, clean package и скрытый E2E прошли. [Изменения и границы security evidence](docs/production/DEPENDENCY_AUDIT.md). Пакет создаётся в отдельном каталоге, рабочее приложение пользователя не заменяется автоматически.

Studio 0.6.0 добавляет [asset bundle v1](docs/production/ASSET_BUNDLE_V1.md): экспортируемый предмет связан с исходником, bbmodel, runtime files, target, namespaces и точными hashes. MCP получает v1 по `format: "bundle-v1"`; CLI поддерживает `asset bundle` и `asset verify`. Legacy export сохранён. Манифест всегда требует отдельного review; JAR-интеграция и художественная/игровая приёмка этим изменением не подтверждаются.

Studio 0.7.0 вводит [проверяемую миграцию EditorProject v1 → v2](docs/production/PROJECT_MIGRATIONS.md). IDs, рисунок и варианты сохраняются; перед заменой v1 остаётся отдельная точная original copy. Неизвестная версия primary/backup блокирует перезапись. Файлы v2 следует редактировать в Studio 0.7.0 с новым reader; старые binaries не обновляются автоматически.

Studio 0.8.0 добавляет [привязку к сетке и числовой центр вращения](docs/production/GEOMETRY_EDITING.md) для held-item. Те же ограниченные команды `snap`/`pivot` доступны агенту через preview/apply; работают locks, CAS и undo/redo. Export сохраняет исходные UV/PNG и native item rotation. Новый пакет создаётся отдельно; игровые модели по-прежнему требуют review и проверки в Minecraft.

Studio 0.9.0 добавляет [восемь ракурсов и проверяемое кадрирование](docs/production/MODEL_CAMERAS.md): fit учитывает pivot, поворот и inflate; source/working сравниваются в одном масштабе. Снимки через MCP сохраняют фактическую ручную камеру. Быстрый `studio_model_review` остаётся обзором четырёх видов; дополнительные стороны доступны через `studio_view_capture` и меню редактора.

Studio 0.10.0 публикует [актуальные schemas, IDs и причины отказа](docs/production/AGENT_DISCOVERY.md) через MCP resources. Десять инструментов сохранены; ручные команды исключены из агентной schema. Ошибки содержат bounded recovery без отражения исходного payload. Сеансы самостоятельной генерации установленными Codex/Claude Code и художественная приёмка остаются отдельными проверками.

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

- [Правила изменений и review](CONTRIBUTING.md)
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
