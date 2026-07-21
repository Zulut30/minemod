# Phase 0: исключения оркестратора для frozen patches

## Статус

Принято 2026-07-21 только для двух frozen patches, перечисленных ниже, на базовом `HEAD` `b7567ea7dd4145e9117b1af70abe9e0f40f601d5`.

## Контекст

Phase 0 был разделён между изолированными worktrees и проверяется строгим профилем Codex Dev Team. Формальный patch scorer предназначен для небольших инкрементальных изменений и снижает оценку за размер diff, lockfiles и пути, отсутствовавшие в первоначальном статическом ownership claim. Для bootstrap-фазы эти сигналы требуют ручного решения, но не являются сами по себе дефектами реализации.

Это решение разрешает `force` только на этапе integration dry-run для точных артефактов ниже. Оно не разрешает игнорировать semantic review, конфликт, неуспешный тест, расхождение frozen patch с worktree, изменение SHA-256 или ошибку hosted CI.

## Разрешённые артефакты

### Control plane

- agent: `phase0-specs-control-plane`;
- frozen patch SHA-256: `c90420a81ec7ab379ad2ab2e353f9983a9112663fb9655d6717047cc9c7ef4f1`;
- размер: `509687` байт, `23` файла, `14640` вставок и `0` удалений;
- formal score: `0.26` при требуемых `0.85`;
- score artifact SHA-256: `0c8aaaf4828a15f025dd3e50e126db5e92501b65bc203f4c11bb21566e0dd958`;
- scorer failures: `min_patch_score` и `ownership_match`;
- единственный путь вне первоначального claim: `tsconfig.json`.

Размер diff существенно формируют обязательные воспроизводимые артефакты: dependency inventory (`234032` байта, SHA-256 `7f56908e0eade8ec2fd75944d77cf11a784f6231d9f52f07e475c959e5c7988d`) и `pnpm-lock.yaml` (`49719` байт, SHA-256 `ac83863800b68e7bdee1527ed89c01fe4266ca673a4ed55841e1bcb8a6131ced`). Корневой `tsconfig.json` (`452` байта, SHA-256 `0dca329e5ac270d7d881d9de750be1e67aebc603c47df1010ac2f03cb6fd397e`) необходим для единой TypeScript-конфигурации workspace и разрешён уточнённым claim.

Первоначальное формальное review обнаружило semantic blocker в обходе inherited enumerable keys. До принятия этого исключения blocker исправлен fail-closed проверкой до накопления и сортировки ключей. Отдельные subprocess-регрессии с `250000` свойств на `Object.prototype` и `Array.prototype` подтверждают один детерминированный `NON_JSON_VALUE`, отсутствие вызова getter и semantic handlers и ограниченное время/память.

Последующее contract review дополнительно отклонило hardcoded loader по умолчанию, generic `resources[]` вместо канонических разделов и неполный ArtSpec. Текущий exact patch делает базовую validation loader-neutral, оставляет NeoForge tuple только именованным trusted profile, вводит typed `items`/`blocks`/`entities`/`recipes`/`summoning`/`screens`, typed assets/integrations/GameTests и полный bounded ArtSpec с target matrix, class-specific contexts, visual constraints, provenance и budgets. Публичный wire contract использует числовой `schemaVersion: 0`; будущий production IR v1 явно отделён в roadmap. Все известные массивы имеют ранние caps, а одновременные максимальные ModSpec/ArtSpec укладываются в глобальные structural limits. Exact Node 24 frozen install, audit-high, lint, typecheck, все четыре test suite и build прошли; независимое contract review дало `CONTROL CONTRACT: APPROVE`.

### NeoForge baseline

- agent: `phase0-neoforge-baseline`;
- frozen patch SHA-256: `7425431fd01f7cbd4f824a1a514155cfafd4605beb74040f8497c0a99828f24e`;
- размер: `1052174` байта, `27` файлов, `19999` вставок и `0` удалений;
- formal score: `0.30` при требуемых `0.85`;
- score artifact SHA-256: `d1590f5bb94d67212ea88c8a1bd0205750bee8c91cfa44581ab4fadc0b1f2955`;
- scorer failures: `min_patch_score` и `ownership_match`;
- пути вне первоначального claim: `scripts/provenance/build-neoforge-inventory.py`, `scripts/provenance/inventory-runtime.init.gradle`, `scripts/provenance/neoforge-license-pom-evidence.txt`.

Размер diff в основном создают проверяемый dependency inventory (`659512` байт), Gradle verification metadata (`95309` байт) и неизменённый Gradle wrapper JAR (`45633` байта). Три отмеченных provenance-файла нужны для воспроизводимого построения inventory и доказательств лицензий; они разрешены уточнённым claim. Независимое semantic review baseline дало `APPROVE` без code/doc blocker.

Предыдущий SHA-256 NeoForge patch был заменён после формального review. Новый артефакт исправляет все содержательные findings: runtime provenance исполняется self-contained режимом `--emit-runtime-components` с exact JDK и fixture-local caches, NeoForge/ModDevGradle license evidence использует immutable SHA-проверенные источники, test-only process-group helpers удалены из production guard library, а runtime diagnostics fail closed валидирует всё дерево `logs/`.

Финальное deadline-hardening запускает общий GNU `timeout` до любого preflight и связывает child с точными duration, direct parent PID/starttime, inode executable и полным bounded NUL-разделённым argv. `BASHPID` сохраняется до command substitution, исключая clock-tick flake. Preflight и diagnostics используют единственный capped NUL-safe `find` stream; второго newline-based обхода нет. Полный producer+validator pipeline выполняется private worker под единым hard process-group deadline, поэтому зависнуть вне 30-секундного traversal cap не могут ни `find`, ни per-entry `stat`; статусы found/producer/validator остаются различимы. Реальный wrong-duration supervisor отклоняется, TERM-ignoring producer и validator уничтожаются без активного потомка, а newline filename покрыт regression. Exact ShellCheck/bash/diff-check, двенадцать суммарных последовательных full guard прогонов, реальные dedicated-server/headless-client smoke и strict byte-identical provenance reproduction прошли. Targeted rereview ранее найденного complete-scan blocker дало `COMPLETE SCAN: APPROVE`; full-index patch побайтно равен worktree diff и чисто применяется к базовому `HEAD`.

## Условия применения

Integration dry-run разрешён только если одновременно выполнены все условия:

1. frozen patch каждого агента побайтно равен актуальному full-index diff его worktree;
2. SHA-256 и размер совпадают с этим решением;
3. оба patches чисто применяются к текущему `HEAD`;
4. свежее read-only semantic review exact patches не содержит незакрытого code, documentation или security blocker; общий formal verdict `REQUEST_CHANGES` допустим перед dry-run только если все его оставшиеся требования буквально являются ещё не выполненными downstream gates из пунктов 5 и 7;
5. совместный integration dry-run проходит полный Node 24, Java 21/25, provenance, GameTest, server/client smoke и repository diff-check набор;
6. применение к основной checkout выполняется только из успешно проверенного dry-run artifact, без ручного изменения его содержимого, чтобы создать точный commit для hosted CI; до пункта 7 Phase 0 не объявляется завершённой;
7. после push обязательный hosted Phase 0 CI проходит на точном commit SHA.

Порядок пунктов 4–7 устраняет циклическую зависимость: combined dry-run нельзя требовать как уже завершённую предпосылку запуска самого dry-run, а hosted workflow нельзя проверить на точном commit до применения и push проверенного artifact. Это исключение относится только к порядку исполнения gates. Любой иной `REQUEST_CHANGES`, падение dry-run или hosted CI немедленно блокирует продолжение и требует исправления, нового freeze/score/review и новой exact-hash привязки.

Изменение любого frozen patch аннулирует это решение для изменённого артефакта и требует нового score, semantic review, точной привязки SHA-256 и отдельного решения. Native Windows/macOS coverage и зафиксированные same-UID local attacker residual risks этим исключением не закрываются.

## Решение

Root orchestrator принимает перечисленные scorer exceptions как ограниченные false-positive/scale signals bootstrap-фазы и разрешает forced dry-run только при выполнении условий выше. Минимальный score и ownership check не подменяются задним числом и остаются честно зафиксированными как непройденные; semantic, verification и hosted-CI gates остаются обязательными.
