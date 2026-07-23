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
- shapeless и smelting recipes, локализация `en_us`;
- транзакционное создание нового workspace без молчаливой перезаписи файлов;
- закрытая Gradle policy с Temurin 17, checksum-проверками и фиксированными tasks;
- получение готового remapped JAR и индекса артефактов;
- одинаковый application service для CLI и подтверждаемого MCP tool;
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

1. Новые gameplay bindings, server-to-client sync и operator-only configuration flow.
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
- [Third-party licensing boundary](THIRD_PARTY_NOTICES.md)

## Лицензия

Оригинальный код, документация и схемы распространяются по [Apache License 2.0](LICENSE). Generated output остаётся ограничен правами на входные материалы, лицензиями сторонних библиотек, условиями AI providers и правилами Minecraft. Полная граница описана в [ADR-0001](docs/decisions/0001-product-and-output-licensing.md).
