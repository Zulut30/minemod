# ADR-0004: Fabric 1.20.1 как основной production baseline

## Статус

Принято. Уточняет baseline из ADR-0003.

## Дата

2026-07-22.

## Контекст

ADR-0003 выбрал Fabric главным loader первого MVP и первоначально зафиксировал Minecraft 26.2 с Java 25. Пользователь уточнил реальный продуктовый сценарий: инструмент должен создавать Fabric-моды именно для Minecraft 1.20.1. Поэтому продолжение разработки только вокруг 26.2 не дало бы целевой пользователю результат, даже если такой fixture технически новее.

Fabric 1.20.1 отличается не только версиями зависимостей. Для него нужен Java 17 toolchain, совместимый Loom/Gradle, отдельные mappings и version-native templates. Кодогенератор не должен получать поддержку 1.20.1 заменой imports или обратным портированием шаблонов 26.2.

## Решение

- Основной production target первого MVP — Fabric для Minecraft 1.20.1 и Java 17.
- Exact baseline: Minecraft 1.20.1, Fabric Loader 0.19.3, Fabric API 0.92.11+1.20.1, Fabric Loom 1.6.12, Gradle 8.7 и Eclipse Temurin 17.0.19+10.
- Новый trusted pack имеет отдельный versioned contract и selector `{ minecraft: "1.20.1", loader: "fabric", java: 17 }`.
- `fabric-26.2` сохраняется как экспериментальный regression/future-compatibility pack, но не определяет templates и Definition of Done первого MVP.
- `compiler-fabric` генерирует нативный для 1.20.1 код и физически разделяет common/client source sets.
- Версия GeckoLib и точный animation export profile для 1.20.1 выбираются отдельным исследованием и compatibility test. GeckoLib 5 из прежнего плана не переносится в новый baseline автоматически.
- NeoForge 26.1.2 остаётся вторым regression backend; его существующие проверки не удаляются.
- Hosted CI, GameTests и transitive license review остаются release gates. Локально прошедшие build/client/server smoke не дают pack статус `production` сами по себе.

## Последствия

- Ближайшая задача после trusted baseline — завершить F0 test harness для 1.20.1, затем реализовать первый basic-content vertical slice в `compiler-fabric`.
- Контракты v1/v2 и pack `fabric-26.2` не изменяются; поддержка Java 17 добавлена новой закрытой веткой контракта.
- Документы, называющие Fabric 26.2 основной целью, остаются историческими только там, где это явно обозначено. Текущий исполнимый план следует этому ADR.
- Любое изменение exact tuple создаёт новую revision pack и требует повторных build/runtime/supply-chain проверок.

## Рассмотренные альтернативы

### Оставить 26.2 основной целью и добавить 1.20.1 позднее

Отклонено: первый usable build не соответствовал бы заявленной пользователем версии Minecraft.

### Генерировать 26.2-код и автоматически backport-ить его

Отклонено: различия mappings, API, lifecycle и rendering делают такой output хрупким и ненативным.

### Удалить уже реализованные 26.2 и NeoForge packs

Отклонено: они дают полезную regression-проверку loader-neutral архитектуры и будущей миграции.
