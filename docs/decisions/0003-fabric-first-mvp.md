# ADR-0003: Fabric как основной target первого MVP

## Статус

Принято.

## Дата

2026-07-21.

## Контекст

Первоначальный research-план выбрал NeoForge 26.1.2 первым production profile из-за состояния ecosystem на дату исследования. После этого проект реализовал и проверил loader-agnostic control-plane primitives, NeoForge compiler и fixed build runner. Пользователь уточнил продуктовый приоритет: первый полезный MVP должен быть ориентирован прежде всего на Fabric и создавать не только код, но и необходимые модели, текстуры и анимации.

Перенос уже сгенерированного NeoForge source заменой imports ненадёжен: loaders отличаются registration, lifecycle, networking, datagen, source-set и rendering patterns. При этом удаление рабочего NeoForge backend уничтожило бы полезное regression evidence и исказило бы loader-neutral архитектуру.

## Решение

- Основной MVP compatibility pack — Fabric для Minecraft 26.2 и Java 25.
- Точный baseline и этапы определяет [Fabric-first MVP plan](../FABRIC_FIRST_MVP_PLAN.md).
- Canonical `ModSpec`, `ArtSpec`, BuildPlan concepts, workspace, artifacts и logging остаются loader-neutral.
- Создаётся отдельный `compiler-fabric`; NeoForge compiler не используется как текстовый шаблон для подмены API.
- Существующий NeoForge 26.1.2 backend сохраняется, тестируется и считается вторым backend без обязательной feature parity в первом Fabric MVP.
- Build runner получает отдельную закрытую Fabric policy. Добавление Fabric не расширяет вход до произвольных Gradle tasks/args/env.
- Production asset path строится одновременно с первым Fabric vertical slice. AI provider создаёт candidates/concepts, а валидируемый Minecraft asset выпускают детерминированные geometry/UV/texture/GeckoLib stages.
- Fabric rendering не использует raw OpenGL. Mixins запрещены по умолчанию и требуют отдельной capability, allowlist и review.
- EMI и Jade являются optional Fabric integrations первого MVP; их отсутствие не должно ломать загрузку мода.

## Последствия

- Ближайшая implementation задача — trusted pack и fixture `fabric-26.2`.
- Старые документы, называющие NeoForge основным MVP/GA target, являются историческим контекстом в части выбора платформы.
- Новый loader требует versioned evolution закрытых contracts и policies, а не ослабления существующих validators.
- CI обязан сохранять NeoForge regression gates, одновременно добавляя Fabric client/server/GameTest matrix.
- Срок MVP определяется не только codegen: asset generation, visual QA, provenance и human approval входят в release gate.

## Рассмотренные альтернативы

### Удалить NeoForge и переименовать packages

Отклонено: теряются рабочий backend, доказательства и архитектурная проверка независимых adapters.

### Конвертировать NeoForge output заменой imports

Отклонено: создаёт хрупкий ненативный Fabric code и скрывает реальные различия lifecycle/API.

### Сначала закончить весь codegen, затем добавить ассеты

Отклонено: самый неопределённый пользовательский результат проверялся бы слишком поздно. Минимальный AI texture pipeline входит уже в первый vertical slice.

### Делать generic text-to-3D главным путём

Отклонено для MVP: результат плохо соответствует Minecraft cuboid/UV/rig ограничениям. Generic 3D допускается только как experimental blockout provider.

