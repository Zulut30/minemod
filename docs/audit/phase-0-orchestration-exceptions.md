# Phase 0: исключения оркестратора для frozen patches

## Статус

Принято 2026-07-21 только для двух frozen patches, перечисленных ниже. Родительский `HEAD` этого решения — `7f4254b0d74ccd815d5aa5f268e00d2588f8d0aa`; оба артефакта обязаны чисто применяться и к exact commit решения перед dry-run.

## Контекст

Phase 0 был разделён между изолированными worktrees и проверяется строгим профилем Codex Dev Team. Формальный patch scorer предназначен для небольших инкрементальных изменений и снижает оценку за размер diff, lockfiles и пути, отсутствовавшие в первоначальном статическом ownership claim. Для bootstrap-фазы эти сигналы требуют ручного решения, но не являются сами по себе дефектами реализации.

Это решение разрешает `force` только на этапе integration dry-run для точных артефактов ниже. Оно не разрешает игнорировать semantic review, конфликт, неуспешный тест, расхождение frozen patch с worktree, изменение SHA-256 или ошибку hosted CI.

## Разрешённые артефакты

### Control plane

- agent: `phase0-specs-control-plane`;
- frozen patch SHA-256: `84c5f6319e60f85a9a89b603e3790502d0213a02d11261b6e62c50e04d83c355`;
- размер: `514859` байт, `23` файла, `14743` вставки и `0` удалений;
- formal score: `0.26` при требуемых `0.85`;
- score artifact SHA-256: `8a0eb9c45191d3ae0728797bb99042c4e98daf5e5b68296c771227eeba25482a`;
- scorer failures: `min_patch_score` и `ownership_match`;
- единственный путь вне первоначального claim: `tsconfig.json`.

Размер diff существенно формируют обязательные воспроизводимые артефакты: dependency inventory (`234032` байта, SHA-256 `7f56908e0eade8ec2fd75944d77cf11a784f6231d9f52f07e475c959e5c7988d`) и `pnpm-lock.yaml` (`49719` байт, SHA-256 `ac83863800b68e7bdee1527ed89c01fe4266ca673a4ed55841e1bcb8a6131ced`). Корневой `tsconfig.json` (`452` байта, SHA-256 `0dca329e5ac270d7d881d9de750be1e67aebc603c47df1010ac2f03cb6fd397e`) необходим для единой TypeScript-конфигурации workspace и разрешён уточнённым claim.

Первоначальное формальное review обнаружило semantic blocker в обходе inherited enumerable keys. До принятия этого исключения blocker исправлен fail-closed проверкой до накопления и сортировки ключей. Отдельные subprocess-регрессии с `250000` свойств на `Object.prototype` и `Array.prototype` подтверждают один детерминированный `NON_JSON_VALUE`, отсутствие вызова getter и semantic handlers и ограниченное время/память.

Последующее contract review дополнительно отклонило hardcoded loader по умолчанию, generic `resources[]` вместо канонических разделов и неполный ArtSpec. Более позднее formal review нашло ещё два semantic blocker: глобальную дедупликацию ResourceLocation между независимыми registries/resource domains и отсутствие обязательного GeckoLib для анимаций в именованном NeoForge-профиле. Текущий exact patch закрывает оба finding: uniqueness действует внутри каждого фактического registry/resource domain, Block и BlockItem либо model/texture/animation могут законно разделять id, а профиль `neoforge-26.1.2-java-25` требует bare `geckolib` именно в `dependencies.required` при непустых `assets.animations`; loader-neutral validation этого требования не навязывает. Положительные cross-domain и отрицательные within-domain/profile regressions включены.

Следующее formal review обнаружило ещё одно расхождение с authoritative agent claim: MCP tool публиковал optional `profile`, хотя его public schema обязана оставаться ровно `kind`/`payload`. Текущий exact patch удаляет profile только с hostile MCP wire boundary. `tools/list` linked и raw regressions требуют ровно два свойства и `additionalProperties:false`; даже точное имя доверенного профиля возвращает SDK `isError:true` до handler invocation. Сам handler типизирован как двухаргументный и всегда вызывает loader-neutral `validate(payload, kind)`. Именованный профиль и GeckoLib-политика остаются в trusted programmatic API и CLI `--profile`. Focused независимое rereview итогового worktree дало `MCP CONTRACT: APPROVE`, включая сохранность `__proto__` surrogate и near-cap frame regressions.

Остальной contract сохраняется: базовая validation loader-neutral, NeoForge tuple существует только как именованный trusted profile, schema содержит typed `items`/`blocks`/`entities`/`recipes`/`summoning`/`screens`, typed assets/integrations/GameTests и полный bounded ArtSpec с target matrix, class-specific contexts, visual constraints, provenance и budgets. Публичный wire contract использует числовой `schemaVersion: 0`; будущий production IR v1 явно отделён в roadmap. Все известные массивы имеют ранние caps, а одновременные максимальные ModSpec/ArtSpec укладываются в глобальные structural limits. После последнего исправления exact Node 24.11.0 frozen install, audit-high, lint, typecheck, все четыре workspace test suite, build, adversarial key-bombs и diff-check прошли дважды — в agent worktree и независимо root-оркестратором; lockfile остался побайтно неизменным. Новый scorer честно сохраняет те же два bootstrap failure: `min_patch_score` и первоначальный ownership claim для необходимого root `tsconfig.json`.

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
4. свежее read-only semantic review exact patches не содержит незакрытого code, documentation или security blocker; общий formal verdict `REQUEST_CHANGES` допустим перед dry-run только если каждое оставшееся finding относится исключительно (a) к exact `min_patch_score`/`ownership_match` failures, явно и по SHA принятым этим решением, и/или (b) к ещё не выполненным downstream gates из пунктов 5 и 7; любое иное finding блокирует dry-run;
5. совместный integration dry-run проходит полный Node 24, Java 21/25, provenance, GameTest, server/client smoke и repository diff-check набор;
6. применение к основной checkout выполняется только из успешно проверенного dry-run artifact, без ручного изменения его содержимого, чтобы создать точный commit для hosted CI; до пункта 7 Phase 0 не объявляется завершённой;
7. после push обязательный hosted Phase 0 CI проходит на точном commit SHA.

Порядок пунктов 4–7 устраняет циклическую зависимость: combined dry-run нельзя требовать как уже завершённую предпосылку запуска самого dry-run, а hosted workflow нельзя проверить на точном commit до применения и push проверенного artifact. Разрешение formal `REQUEST_CHANGES` не объявляет scorer green и не маскирует его: оно ограничено только двумя уже перечисленными, неизменяемыми bootstrap findings и downstream-порядком. Любой иной `REQUEST_CHANGES`, падение dry-run или hosted CI немедленно блокирует продолжение и требует исправления, нового freeze/score/review и новой exact-hash привязки.

Изменение любого frozen patch аннулирует это решение для изменённого артефакта и требует нового score, semantic review, точной привязки SHA-256 и отдельного решения. Native Windows/macOS coverage и зафиксированные same-UID local attacker residual risks этим исключением не закрываются.

## Решение

Root orchestrator принимает перечисленные scorer exceptions как ограниченные false-positive/scale signals bootstrap-фазы и разрешает forced dry-run только при выполнении условий выше. Минимальный score и ownership check не подменяются задним числом и остаются честно зафиксированными как непройденные; semantic, verification и hosted-CI gates остаются обязательными.
