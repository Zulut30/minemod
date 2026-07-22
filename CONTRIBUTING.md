# Contributing to MineMod

Спасибо за интерес к проекту. MineMod строит воспроизводимый и безопасный pipeline генерации Minecraft-модов, поэтому изменения принимаются небольшими проверяемыми срезами.

## Локальная настройка

Требуются Node.js `24.11.0`, pnpm `11.8.0` и Java 17 для Fabric 1.20.1 fixtures.

```bash
corepack pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

## Правила изменений

- один логический change на commit;
- не добавляйте moving versions, snapshots или произвольные Maven repositories;
- не ослабляйте closed BuildPlan и runner policies ради удобства;
- loader-specific API остаётся внутри соответствующего compiler/adapter package;
- client-only imports не должны попадать в dedicated-server path;
- новая возможность получает unit test и реальный fixture или runtime evidence;
- generated code не должен содержать TODO, абсолютные пути, shell или незавершённые placeholders без явного warning.

## Добавление библиотеки

Новая библиотека требует:

1. официального источника документации и Maven coordinate;
2. exact версии для Minecraft 1.20.1;
3. лицензии и provenance;
4. bounded catalog entry с environment и допустимой relation;
5. checksum verification metadata;
6. compiler tests для Gradle и `fabric.mod.json`;
7. clean strict build и соответствующей client/server matrix.

См. [Library integrations](docs/LIBRARY_INTEGRATIONS.md).

## Pull request

В описании укажите:

- что изменилось и зачем;
- какие публичные contracts или generated outputs затронуты;
- команды проверки;
- runtime evidence;
- известные ограничения и безопасный rollback.
