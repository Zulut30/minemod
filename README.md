# MINECRAFT-MODS-SKILL

Agent-native инструмент для создания production-ready Minecraft-модов: от продуктового промпта до исходного кода, моделей, текстур, анимаций, тестов и готового JAR.

## Статус

Проект находится на стадии Discovery / Phase 0. Реализация ещё не начата; текущий репозиторий содержит проверенный research и план MVP.

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

## Ближайший этап

Phase 0:

1. утвердить ModSpec v0 и ArtSpec v0;
2. зафиксировать NeoForge 26.1.2 toolchain;
3. создать пустой собираемый fixture;
4. подготовить CLI/MCP monorepo;
5. запустить clean build, GameTest и dedicated-server smoke в CI.

## Лицензия

Лицензия проекта пока не выбрана. До её утверждения не копируйте implementation или assets из исследованных сторонних проектов.
