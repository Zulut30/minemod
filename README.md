# MINECRAFT-MODS-SKILL

Agent-native инструмент для создания production-ready Minecraft-модов: от продуктового промпта до исходного кода, моделей, текстур, анимаций, тестов и готового JAR.

## Статус

Проект развивается по [Fabric-first MVP-плану](docs/FABRIC_FIRST_MVP_PLAN.md). Уже реализованы строгие contracts, trusted Fabric 26.2/NeoForge 26.1.2 packs, собираемый Fabric fixture, детерминированный codegen core, transactional workspace, artifact/logging слой, NeoForge compiler и fixed build runner. Fabric compiler, сквозная CLI/MCP orchestration и production AI asset pipeline ещё предстоит реализовать.

Этот README не объявляет отдельную фазу завершённой: актуальный статус определяется кодом, тестами и связанными audit/evidence, а не самим roadmap.

## Планируемый первый MVP

- локальные CLI и MCP-сервер для Codex, Claude Code и других MCP-клиентов;
- строгие ModSpec и ArtSpec;
- основной production compatibility pack для Fabric 26.2 и Java 25;
- генерация items, blocks, entities, AI, summoning recipes и native UI;
- AI-generated concepts, модели, текстуры и анимации с editable `.bbmodel` и GeckoLib 5 export;
- optional-интеграции EMI и Jade;
- unit tests, GameTests, client/dedicated-server smoke tests;
- воспроизводимый release bundle.

NeoForge 26.1.2 сохраняется как проверенный второй backend и regression target; Fabric не строится заменой imports в NeoForge-коде.

## Документация

- [Research и план MVP](docs/RESEARCH_AND_MVP_PLAN.md)
- [Текущий Fabric-first MVP plan](docs/FABRIC_FIRST_MVP_PLAN.md)
- [Production roadmap после MVP](docs/PRODUCTION_ROADMAP.md)
- [ADR-0001: лицензия продукта и generated output](docs/decisions/0001-product-and-output-licensing.md)
- [ADR-0003: Fabric как основной target MVP](docs/decisions/0003-fabric-first-mvp.md)
- [Art Quality Rubric v0](docs/quality/art-quality-rubric-v0.md)
- [Third-party licensing boundary](THIRD_PARTY_NOTICES.md)

## Этапы реализации

Текущий Fabric milestone:

1. ~~зафиксировать exact Fabric 26.2 compatibility pack~~ — выполнено локально;
2. ~~собрать пустой native Fabric fixture~~ — выполнено локально;
3. запустить GameTest, client и dedicated-server smoke в hosted CI;
4. добавить Fabric compiler для items/blocks;
5. закрыть первый prompt-to-JAR с настоящими AI-generated textures.

Зависимости, критерии приёмки и exit gates описаны в [Fabric-first плане](docs/FABRIC_FIRST_MVP_PLAN.md). Наличие пункта в roadmap само по себе не означает, что соответствующая возможность уже реализована или проверена.

## Лицензия

Оригинальные implementation, документация и схемы репозитория распространяются по [Apache License 2.0](LICENSE), если явно не указано иное. Generated output не передаётся проекту автоматически, но остаётся ограничен правами на inputs, provider/model terms, сторонние компоненты и правила Minecraft. Точные границы и оговорки зафиксированы в [ADR-0001](docs/decisions/0001-product-and-output-licensing.md).
