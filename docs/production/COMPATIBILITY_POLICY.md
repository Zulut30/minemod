# Развитие compatibility packs

Roadmap: пункт 008. Основной target неизменен: [ADR-0004](../decisions/0004-fabric-1.20.1-production-baseline.md), Fabric 1.20.1 / Java 17.

## Идентичность и допустимые изменения

Pack идентифицируется selector, pack ID, revision и SHA-256 дерева. Verified snapshot связывает manifest, содержимое и declared file modes. Built-in registry допускает только известные immutable tuples. Политика продолжает `packages/compatibility-packs/src/builtin-registry.ts` и `snapshot.ts`; она не заменяет code-level integrity checks.

Новая версия Minecraft, Loader/API, Loom, Gradle, JDK, template или export/runtime dependency требует отдельной revision с новыми lock/provenance/evidence. Уже reviewed tree не переписывается ради достижения PASS. На Windows ошибка POSIX/integrity не исправляется выключением защиты Linux runner или фиктивным runtime PASS.

Авторские geometry/PNG/animations подключаются как reviewed asset bundles через версионированный ModSpec-контракт. Добавление ассета не является поводом менять trusted pack. Разрешённые версии сторонних библиотек проходят закрытый catalog и отдельную лицензионную проверку.

## Процедура новой revision

- Указать причину, старый selector/revision/tree digest и proposed новый tuple. Обновление в рамках 1.20.1 не меняет production target на другую Minecraft-версию.
- Разрешить exact версии из официальных metadata, зафиксировать archive/component hashes, sources и licenses. Moving aliases/SNAPSHOT не допускаются.
- Подготовить новые templates/manifest/locks без изменения предыдущего reviewed tree. Совместимость schema и source sets проверяется явно.
- Выполнить clean build, dependency verification, server/client tests, dedicated server и optional absent/present matrix на новом tuple.
- Проверить migration старого ModSpec/assets и пять применимых dogfood-проектов; unsupported migrations получают точную диагностику.
- Сохранить migration report и reviewer decision, зарегистрировать revision только после review. Experimental статус не повышается по одному локальному smoke.
- Для существующего проекта использовать его зафиксированную revision либо явно согласованную миграцию; кеш и art approval не переносятся по имени pack.

Изменение самого production target требует отдельного ADR/прямого решения пользователя. Existing Fabric 26.2 и NeoForge остаются regression-backends без обещания parity.

## Обязательный migration report

Report содержит reason, before/after exact tuple и tree digests, schema changes, влияние на generated Java/resource formats, source/runtime hashes, список несовместимостей, license review, build/runtime/CI evidence и rollback procedure. Для art profile записываются необходимость нового ArtSpec/candidate и аннулированные approvals. В отчёте отличают успешно перенесённое, требующее repair и неподдерживаемое.

## Приёмка пункта 008

Политика согласована с ADR, immutable registry и snapshot verifier. Старый `docs/PRODUCTION_ROADMAP.md` получил актуальный banner/GA target вместо ошибочного 26.2 baseline. В этом пункте ни один файл trusted pack не изменён; migration report обязателен при реальном обновлении.
