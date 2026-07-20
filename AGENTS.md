# Инструкции для AI-агентов

## Язык

Отвечайте и комментируйте на русском языке.

## Текущая стадия

Проект находится в Phase 0. Не описывайте запланированные возможности как уже реализованные.

## Источник истины

Перед архитектурными или scope-решениями прочитайте:

- README.md;
- docs/RESEARCH_AND_MVP_PLAN.md.

## Базовые решения MVP

- первый production target: NeoForge 26.1.2;
- Java 25;
- Fabric, Forge и Paper реализуются отдельными compatibility packs;
- единый контракт между платформами — ModSpec, а не общий Java-код любой ценой;
- модели и текстуры проходят технический и визуальный quality gate;
- JEI и Jade остаются optional dependencies;
- package и publish являются разными операциями.

## Правила работы

- Всегда сверяйте актуальную официальную документацию и используйте Context7.
- Делайте минимальные диффы и не проводите несогласованный рефакторинг.
- Не добавляйте dependency без проверки версии, лицензии и источника.
- Не копируйте код или assets из reference-модов без совместимой лицензии.
- Не давайте агенту generic shell или arbitrary Blender/Blockbench eval через MCP.
- Все generated network payloads должны иметь limits и server-side validation.
- После появления кода проверяйте clean build, GameTests и dedicated-server запуск.
