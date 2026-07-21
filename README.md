# MINECRAFT-MODS-SKILL

Agent-native инструмент для создания production-ready Minecraft-модов: от продуктового промпта до исходного кода, моделей, текстур, анимаций, тестов и готового JAR.

## Статус

Проект развивается по поэтапному MVP-плану. Этот README не объявляет отдельную фазу завершённой: актуальный статус определяется содержимым текущей ревизии и связанными audit/evidence, а не самим roadmap.

## Планируемый первый MVP

- локальные CLI и MCP-сервер для Codex, Claude Code и других MCP-клиентов;
- строгие ModSpec и ArtSpec;
- production compatibility pack для NeoForge 26.1.2 и Java 25;
- генерация items, blocks, entities, AI, summoning recipes и native UI;
- модели, текстуры и анимации через узкий Blockbench bridge и GeckoLib;
- optional-интеграции JEI и Jade;
- unit tests, GameTests, client/dedicated-server smoke tests;
- воспроизводимый release bundle.

## Документация

- [Research и план MVP](docs/RESEARCH_AND_MVP_PLAN.md)
- [Production roadmap после MVP](docs/PRODUCTION_ROADMAP.md)
- [ADR-0001: лицензия продукта и generated output](docs/decisions/0001-product-and-output-licensing.md)
- [Art Quality Rubric v0](docs/quality/art-quality-rubric-v0.md)
- [Third-party licensing boundary](THIRD_PARTY_NOTICES.md)

## Этапы реализации

Базовый scope Phase 0:

1. утвердить ModSpec v0 и ArtSpec v0;
2. зафиксировать NeoForge 26.1.2 toolchain;
3. создать пустой собираемый fixture;
4. подготовить CLI/MCP monorepo;
5. запустить clean build, GameTest и dedicated-server smoke в CI.

Дальнейшие этапы и их exit gates описаны в [research-плане](docs/RESEARCH_AND_MVP_PLAN.md). Наличие пункта в roadmap само по себе не означает, что соответствующая возможность уже реализована или проверена.

## Лицензия

Оригинальные implementation, документация и схемы репозитория распространяются по [Apache License 2.0](LICENSE), если явно не указано иное. Generated output не передаётся проекту автоматически, но остаётся ограничен правами на inputs, provider/model terms, сторонние компоненты и правила Minecraft. Точные границы и оговорки зафиксированы в [ADR-0001](docs/decisions/0001-product-and-output-licensing.md).
