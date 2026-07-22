# MINECRAFT-MODS-SKILL

Agent-native инструмент для создания production-ready Minecraft-модов: от продуктового промпта до исходного кода, моделей, текстур, анимаций, тестов и готового JAR.

## Статус

Проект развивается по [Fabric-first MVP-плану](docs/FABRIC_FIRST_MVP_PLAN.md). Основная цель — создание Fabric-модов для Minecraft 1.20.1. Уже реализованы строгие contracts, trusted Fabric 1.20.1/Fabric 26.2/NeoForge 26.1.2 packs, локально проверенный build и client/server smoke для Fabric 1.20.1, детерминированный codegen core, transactional workspace, artifact/logging слой, NeoForge compiler и fixed build runner. Для моделирования уже есть bounded cuboid/material contracts, детерминированные pixel texture atlases и экспорт сложной геометрии, rig и embedded PNG в editable Blockbench 5 `.bbmodel`. Fabric compiler, сквозная CLI/MCP orchestration, concept/AI texture provider, анимации и version-tested runtime export ещё предстоят.

Этот README не объявляет отдельную фазу завершённой: актуальный статус определяется кодом, тестами и связанными audit/evidence, а не самим roadmap.

## Планируемый первый MVP

- локальные CLI и MCP-сервер для Codex, Claude Code и других MCP-клиентов;
- строгие ModSpec и ArtSpec;
- основной production compatibility pack для Fabric 1.20.1 и Java 17;
- генерация items, blocks, entities, AI, summoning recipes и native UI;
- AI-generated concepts, модели, текстуры и анимации с editable `.bbmodel` и проверенным для 1.20.1 runtime export;
- optional-интеграции EMI и Jade;
- unit tests, GameTests, client/dedicated-server smoke tests;
- воспроизводимый release bundle.

Fabric 26.2 и NeoForge 26.1.2 сохраняются как regression targets; Fabric 1.20.1 не строится backport-ом или заменой imports в коде других версий/loaders.

## Документация

- [Research и план MVP](docs/RESEARCH_AND_MVP_PLAN.md)
- [Текущий Fabric-first MVP plan](docs/FABRIC_FIRST_MVP_PLAN.md)
- [Production roadmap после MVP](docs/PRODUCTION_ROADMAP.md)
- [ADR-0001: лицензия продукта и generated output](docs/decisions/0001-product-and-output-licensing.md)
- [ADR-0003: Fabric как основной target MVP](docs/decisions/0003-fabric-first-mvp.md)
- [ADR-0004: Fabric 1.20.1 как production baseline](docs/decisions/0004-fabric-1.20.1-production-baseline.md)
- [Аудит локального Fabric 1.20.1 baseline](docs/audit/fabric-1.20.1-baseline.md)
- [Аудит основы cuboid-моделирования](docs/audit/cuboid-modeling-foundation.md)
- [Art Quality Rubric v0](docs/quality/art-quality-rubric-v0.md)
- [Third-party licensing boundary](THIRD_PARTY_NOTICES.md)

## Этапы реализации

Текущий Fabric milestone:

1. ~~зафиксировать exact Fabric 1.20.1 + Java 17 compatibility pack~~ — выполнено локально;
2. ~~собрать и запустить пустой native Fabric 1.20.1 fixture на client/server~~ — выполнено локально;
3. добавить GameTests и запустить build/client/server gates в hosted CI;
4. добавить Fabric compiler для items/blocks;
5. закрыть первый prompt-to-JAR с настоящими AI-generated textures.

Зависимости, критерии приёмки и exit gates описаны в [Fabric-first плане](docs/FABRIC_FIRST_MVP_PLAN.md). Наличие пункта в roadmap само по себе не означает, что соответствующая возможность уже реализована или проверена.

## Лицензия

Оригинальные implementation, документация и схемы репозитория распространяются по [Apache License 2.0](LICENSE), если явно не указано иное. Generated output не передаётся проекту автоматически, но остаётся ограничен правами на inputs, provider/model terms, сторонние компоненты и правила Minecraft. Точные границы и оговорки зафиксированы в [ADR-0001](docs/decisions/0001-product-and-output-licensing.md).
