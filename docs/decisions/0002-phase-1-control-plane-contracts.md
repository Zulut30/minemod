# ADR-0002: Версионированные контракты control plane Phase 1

## Статус

Принято.

## Дата

2026-07-21.

## Контекст

Phase 0 заморозил ModSpec/ArtSpec v0 и публичный MCP tool `mcdev_spec_validate` с аргументами ровно `{kind, payload}`. Phase 1 добавляет выбор compatibility pack, BuildPlan, workspace transaction, artifact index и structured logs. Эти документы пересекают границы packages, CLI и MCP, поэтому не могут быть неявными TypeScript-объектами или разделять один общий `schemaVersion`.

Особенно опасны две подмены границ:

- использовать `packs/neoforge-26.1.2/pack.json` как runtime manifest: это audit descriptor с self-declared status и путями `../../`, а не self-contained data pack;
- позволить BuildPlan переносить `command`, `args`, `env`, `cwd`, module path, script или иной executable payload из недоверенного запроса в runner.

## Решение

Создаётся dependency-free нижний слой `@mcdev/contracts`. Каждый wire document имеет отдельный обязательный literal:

- `mcdev.compatibility-pack/v1`;
- `mcdev.build-plan/v1`;
- `mcdev.artifact-index/v1`;
- `mcdev.workspace-manifest/v1`;
- `mcdev.workspace-journal/v1`;
- `mcdev.log-event/v1`;
- `mcdev.error/v1`;
- отдельные request/result literals для plan/apply operations.

Версии не являются alias друг друга и не выводятся из ModSpec `schemaVersion`. Изменение формы любого документа требует нового literal и явной миграции.

### Compatibility pack boundary

Runtime manifest — data-only и self-contained. Он содержит target и отсортированный список файлов `{path, mode, size, sha256, role}`, но не содержит `trusted`, `status`, network URL или путь вне pack root. Trust, candidate/production status и ожидаемый tree digest принадлежат встроенному registry, который будет реализован отдельным коммитом. Выбор pack выполняется planner/application, но не общим ModSpec validator.

### Закрытый BuildPlan

Phase 1 допускает только пять node kinds:

- `generate-project`;
- `generate-content`;
- `apply-workspace` с policy `create-only-cas-wal-v1`;
- `gradle-clean-build` с policy `neoforge-phase1-v1`;
- `index-artifacts` с policy `sha256-v1`.

Каждый node содержит bounded typed inputs/outputs, content digests, зависимости, closed validator/provenance/log policies и `retryPolicy: never`. Контракт отклоняет unknown keys, duplicate/cyclic/missing dependencies, output collisions и любую executable surface. Runner в будущем сам отобразит фиксированную policy в известную команду с `shell:false`; caller не сможет передать task, flag или environment.

### Workspace boundary

Apply policy — create-only. Публичного `force`/overwrite нет. Workspace manifest фиксирует только canonical relative paths, modes, sizes и SHA-256; абсолютные пути не являются частью reproducible state. Journal — отдельный контракт со strictly bounded state и списком только тех файлов, которые принадлежат текущей транзакции.

### Operations и adapter compatibility

`plan-build` принимает bounded ModSpec payload и не принимает profile, pack ID/path или executable настройки. `apply-plan` принимает workspace root, исходный bounded payload и content-derived plan ID, чтобы application повторно построил план и fail closed при `PLAN_ID_MISMATCH`.

Этот ADR не регистрирует новые MCP tools. Существующий `mcdev_spec_validate {kind,payload}` и его raw-frame/security tests остаются без изменений. CLI и MCP будут тонкими adapters одного application service в завершающем Phase 1 коммите.

### Лимиты v1

- BuildPlan: до 128 nodes, 512 edges и 2 MiB canonical JSON;
- до 2 048 generated files;
- один generated file до 16 MiB, весь apply до 128 MiB;
- relative path до 240 UTF-8 bytes;
- inline spec до 256 KiB;
- log/journal record до 16 KiB.

Увеличение лимита считается изменением threat model и требует review; оно не выполняется автоматически по входным данным.

## Рассмотренные альтернативы

### Один общий `schemaVersion: 1`

Отклонено: версия ModSpec, pack, plan и workspace state меняется независимо. Общий номер создаёт ложную совместимость.

### Zod в каждом новом package

Отклонено для нижнего слоя: contracts остаётся dependency-free, а runtime guards используют малые exact-key predicates. Adapter-specific JSON Schema может строиться поверх этих контрактов позднее.

### Произвольные команды в DAG

Отклонено: такой план фактически стал бы generic shell MCP tool. Расширение выполняется добавлением нового закрытого node kind и runner policy после отдельного review.

### Runtime-загрузка audit descriptor

Отклонено: self-declared trust/status и `../../` paths нарушают границу pack root. Audit descriptor остаётся доказательством Phase 0, а runtime pack будет отдельным self-contained деревом.

## Последствия

- `@mcdev/contracts` не зависит от ModSpec, filesystem, process, network или MCP SDK.
- ModSpec/ArtSpec сохраняют числовой `schemaVersion: 0`; миграция IR не включена в Phase 1.
- Любой новый package обязан иметь собственный test script; frozen lockfile получает новый workspace importer даже без third-party dependencies.
- `docs/provenance/control-plane-inventory.json` остаётся явно историческим снимком пяти importers Phase 0. До закрытия Phase 1 должен быть создан новый current inventory либо Phase 0 snapshot должен получить immutable commit/lockfile scope в machine-checked metadata.
- Следующие implementation commits отдельно реализуют built-in pack registry, pure codegen, planner, transactional workspace, fixed build runner и adapters. Сам контракт не заявляет, что эти runtime gates уже выполнены.
