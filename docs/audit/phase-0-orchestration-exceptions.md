# Phase 0: исключения оркестратора для frozen patches

## Статус

Принято 2026-07-21 только для двух frozen patches, перечисленных ниже.

## Контекст

Phase 0 был разделён между изолированными worktrees и проверяется строгим профилем Codex Dev Team. Формальный patch scorer предназначен для небольших инкрементальных изменений и снижает оценку за размер diff, lockfiles и пути, отсутствовавшие в первоначальном статическом ownership claim. Для bootstrap-фазы эти сигналы требуют ручного решения, но не являются сами по себе дефектами реализации.

Это решение разрешает `force` только на этапе integration dry-run для точных артефактов ниже. Оно не разрешает игнорировать semantic review, конфликт, неуспешный тест, расхождение frozen patch с worktree, изменение SHA-256 или ошибку hosted CI.

## Разрешённые артефакты

### Control plane

- agent: `phase0-specs-control-plane`;
- frozen patch SHA-256: `6b4031be4e8bbe41d8ae10c17c1da5a5a6b5dc71f1c467e40c6e1010ef459343`;
- размер: `458234` байта, `23` файла;
- formal score: `0.26` при требуемых `0.85`;
- score artifact SHA-256: `bc1edf968623ab643e775fe69c51809ea048b3f31b2d9350f01b4fe756a06b0c`;
- scorer failures: `min_patch_score` и `ownership_match`;
- единственный путь вне первоначального claim: `tsconfig.json`.

Размер diff существенно формируют обязательные воспроизводимые артефакты: dependency inventory (`234032` байта, SHA-256 `7f56908e0eade8ec2fd75944d77cf11a784f6231d9f52f07e475c959e5c7988d`) и `pnpm-lock.yaml` (`49719` байт, SHA-256 `ac83863800b68e7bdee1527ed89c01fe4266ca673a4ed55841e1bcb8a6131ced`). Корневой `tsconfig.json` (`452` байта, SHA-256 `0dca329e5ac270d7d881d9de750be1e67aebc603c47df1010ac2f03cb6fd397e`) необходим для единой TypeScript-конфигурации workspace и разрешён уточнённым claim.

Первоначальное формальное review обнаружило semantic blocker в обходе inherited enumerable keys. До принятия этого исключения blocker исправлен fail-closed проверкой до накопления и сортировки ключей. Отдельные subprocess-регрессии с `250000` свойств на `Object.prototype` и `Array.prototype` подтверждают один детерминированный `NON_JSON_VALUE`, отсутствие вызова getter и semantic handlers и ограниченное время/память. Независимое повторное review исправления дало `APPROVE`.

### NeoForge baseline

- agent: `phase0-neoforge-baseline`;
- frozen patch SHA-256: `6bc161dd887f7ea5efb093563b48c1e92428ff637066d0b15871194ad14544ca`;
- размер: `1032230` байт, `27` файлов;
- formal score: `0.30` при требуемых `0.85`;
- score artifact SHA-256: `cf1531b3f47edf10e12baecac1888275d0c12daf48651a302635c9690a6f5e0f`;
- scorer failures: `min_patch_score` и `ownership_match`;
- пути вне первоначального claim: `scripts/provenance/build-neoforge-inventory.py`, `scripts/provenance/inventory-runtime.init.gradle`, `scripts/provenance/neoforge-license-pom-evidence.txt`.

Размер diff в основном создают проверяемый dependency inventory (`677108` байт), Gradle verification metadata (`95309` байт) и неизменённый Gradle wrapper JAR (`45633` байта). Три отмеченных provenance-файла нужны для воспроизводимого построения inventory и доказательств лицензий; они разрешены уточнённым claim. Независимое semantic review frozen patch дало `APPROVE` без code/doc blocker.

## Условия применения

Integration dry-run разрешён только если одновременно выполнены все условия:

1. frozen patch каждого агента побайтно равен актуальному full-index diff его worktree;
2. SHA-256 и размер совпадают с этим решением;
3. оба patches чисто применяются к текущему `HEAD`;
4. свежее формальное review после исправления control-plane blocker возвращает `APPROVE` для обоих patches;
5. совместный integration dry-run проходит полный Node 24, Java 21/25, provenance, GameTest, server/client smoke и repository diff-check набор;
6. применение к основной checkout выполняется из успешно проверенного dry-run artifact, без ручного изменения его содержимого;
7. после push обязательный hosted Phase 0 CI проходит на точном commit SHA.

Изменение любого frozen patch аннулирует это решение для изменённого артефакта и требует нового score, semantic review, точной привязки SHA-256 и отдельного решения. Native Windows/macOS coverage и зафиксированные same-UID local attacker residual risks этим исключением не закрываются.

## Решение

Root orchestrator принимает перечисленные scorer exceptions как ограниченные false-positive/scale signals bootstrap-фазы и разрешает forced dry-run только при выполнении условий выше. Минимальный score и ownership check не подменяются задним числом и остаются честно зафиксированными как непройденные; semantic, verification и hosted-CI gates остаются обязательными.
