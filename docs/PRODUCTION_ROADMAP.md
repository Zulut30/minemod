# Production Roadmap

## Статус документа

Этот документ описывает путь от завершённого MVP к поддерживаемому GA-продукту Minecraft AI Mod Studio.

> **Актуализация от 21 июля 2026:** основной MVP и первый GA candidate теперь планируются для Fabric 26.2 согласно [ADR-0003](decisions/0003-fabric-first-mvp.md) и [Fabric-first MVP plan](FABRIC_FIRST_MVP_PLAN.md). Упоминания NeoForge как первичного target ниже являются историческим baseline и будут применяться к сохранённому второму backend, пока соответствующая секция не мигрирована отдельным evidence-backed решением.

Он дополняет:

- [Research и план MVP](RESEARCH_AND_MVP_PLAN.md);
- [Текущий Fabric-first MVP plan](FABRIC_FIRST_MVP_PLAN.md);
- [ADR-0001: лицензия продукта и generated output](decisions/0001-product-and-output-licensing.md);
- [Art Quality Rubric v0](quality/art-quality-rubric-v0.md);
- [Third-party licensing boundary](../THIRD_PARTY_NOTICES.md).

Roadmap не является status page. Наличие возможности, этапа или checklist в этом документе не означает, что они уже реализованы или проверены. Gate считается пройденным только при наличии неизменяемого evidence, привязанного к точному commit, compatibility pack, toolchain, target matrix и artifact hashes.

## 1. Цель первого production-релиза

Первый GA-релиз должен предоставлять local-first CLI и MCP server, которые для явно поддерживаемого набора ModSpec primitives:

1. создают проверяемый план;
2. изменяют только подтверждённый workspace;
3. генерируют читаемый Fabric-проект;
4. создают или подключают технически проверенные ассеты;
5. выполняют build, GameTest, client и dedicated-server checks;
6. формируют воспроизводимый release bundle;
7. не публикуют результат без отдельного явного подтверждения человека.

Первый GA не обязан одновременно обеспечивать parity для Fabric, NeoForge, Forge и Paper. Базовый GA target — production compatibility pack Fabric 26.2 либо его явно утверждённый successor, если к моменту release старый target больше нельзя безопасно поддерживать.

NeoForge, Forge, multi-loader export и Paper получают отдельные maturity gates. Они не должны задерживать Fabric GA или создавать ложное обещание feature parity.

### Не входит в обещание первого GA

- генерация произвольного мода вне поддерживаемых primitives;
- автоматическая миграция любого существующего проекта;
- автоматическая публикация без подтверждения;
- runtime-зависимость от hosted service;
- произвольное выполнение shell, Python, JavaScript или Blender-кода;
- полная совместимость со всеми shader, optimization и content-модами;
- одновременная поддержка всех актуальных и исторических Minecraft-версий;
- 24/7 support, пока для него не создана и не проверена отдельная on-call ротация.

## 2. Evidence и управление статусами

Для каждого release candidate должен существовать индекс evidence вида:

```text
evidence/releases/<release-id>/index.json
```

Индекс должен содержать либо сам evidence, либо content-addressed ссылки на неизменяемое хранилище:

- source commit и dirty-worktree status;
- product, schema и compatibility-pack versions;
- pack, lockfile и builder image hashes;
- target OS/JDK/Node/Minecraft/loader matrix;
- unit, integration, GameTest, client и server reports;
- reproducibility report двух независимых clean builds;
- SBOM и dependency/license inventory;
- source и build provenance;
- asset candidate, scorecard и human approval hashes;
- security findings и принятые исключения;
- SLO report;
- artifact hashes;
- release, security, QA и art approvals.

Допустимые состояния gate:

```text
NOT_STARTED → IN_PROGRESS → EVIDENCE_READY → APPROVED
                                      ├────→ NEEDS_REPAIR
                                      └────→ REJECTED
APPROVED → SUPERSEDED
```

Любое изменение связанного commit, lockfile, target matrix, runtime artifact, asset, scorecard или approval переводит прежний gate в `SUPERSEDED`.

Исключение должно иметь owner, rationale, риск, ограниченный scope и срок истечения. Для path escape, потери пользовательских данных, утечки секретов, публикации без подтверждения, неизвестной лицензии и unresolved critical/high security finding исключения запрещены.

## 3. MVP, Production Candidate и GA — разные ворота

| Область | MVP completion | Production Candidate | GA |
|---|---|---|---|
| Основная ценность | Один полный prompt-to-bundle vertical slice | Повторяемая работа с внешними beta-пользователями | Поддерживаемый стабильный продукт |
| Target | Один Fabric production pack | Тот же pack или утверждённый successor | Явно опубликованная support matrix |
| Reference projects | Tidecaller, basic-content, animated-airship | Не менее 50 завершённых проектов от 15 пользователей | Не менее 100 завершённых supported проектов от 25 пользователей |
| Dogfood | Минимум 5 завершённых проектов | 30-дневная private-beta выборка | 30-дневная rolling SLO выборка и две успешные RC |
| Надёжность | Все обязательные gates зелёные для fixtures | Recovery, migration, failure injection и soak tests | GA SLO, error-budget policy и rollback rehearsal |
| Безопасность | Threat model и основные fail-closed boundaries | Fuzzing, dependency policy, security review | Нет unresolved critical/high; incident response проверен |
| Supply chain | Locks, checksums, provenance и release inventory | Подписанные packs/artifacts, SBOM, независимая rebuild | Верифицируемые attestations и key-rotation rehearsal |
| UX | Основной сценарий выполним | Diagnostics, resume, doctor и migration tested | Документация, accessibility и support-ready UX |
| Ассеты | Human approval для точных hashes | Повторяемый review workflow | Art SLO и reviewer capacity подтверждены |
| Support | Dogfood feedback | Private-beta triage | Опубликованные severity/SLA/EOL policies |
| Publishing | Только `publish_prepare` | Dry-run и sandbox/test project | Upload только при отдельном approval точного digest |
| Evidence | MVP bundle и Phase 0–6 reports | Immutable beta dossier | Подписанный GA go/no-go dossier |

Успешный Gradle build не закрывает ни один из трёх уровней самостоятельно.

## 4. Фазы после MVP

Сроки отсчитываются только после human approval полного MVP exit gate.

### P0. MVP exit audit и contract freeze — недели 0–2

**Entry:**

- сформирован MVP candidate;
- выполнены заявленные Phase 0–6;
- доступны Tidecaller, basic-content и animated-airship artifacts;
- проведён dogfood минимум по пяти проектам.

**Работы:**

- независимо проверить каждый пункт MVP Definition of Done;
- связать reports и artifacts единым evidence index;
- зафиксировать поддерживаемые ModSpec/ArtSpec/MCP contracts;
- классифицировать все открытые defects и exceptions;
- выбрать точный GA target pack;
- определить минимальную OS/hardware matrix;
- зафиксировать generated/user-owned file boundaries;
- принять support, compatibility и deprecation policies.

**Exit:**

- каждый MVP gate имеет evidence или остаётся открытым;
- нет неизвестных release blockers;
- все исключения имеют owner и expiry;
- опубликован точный beta support scope;
- MVP release authority подписал immutable evidence index.

### P1. Reliability и recovery foundation — недели 2–8

**Работы:**

- transactional apply и recoverable workspace journal;
- backups перед migration и destructive generated-cache operations;
- crash/restart/resume для каждого BuildPlan node;
- idempotent retries;
- bounded worker lifecycle без оставшихся процессов;
- failure injection для disk-full, process kill, timeout, corrupt cache и unavailable provider;
- schema и compatibility-pack migrations;
- performance benchmark harness;
- structured diagnostics и redacted support bundle;
- SLI collection без обязательной remote telemetry;
- nightly canonical compatibility matrix.

**Exit:**

- 14 последовательных дней canonical matrix без path escape, потери данных или residual processes;
- workflow success не ниже 99% на canonical fixtures;
- reproducibility — 100% для locked reference builds;
- retry-induced flake rate не выше 1%;
- все failure scenarios завершаются восстановлением либо безопасным fail-closed state;
- performance budgets зафиксированы на именованном reference hardware;
- release и rollback runbooks проверены.

### P2. Extended dogfood и private beta — недели 6–14

**Entry:**

- P1 reliability gate утверждён;
- support intake и privacy disclosure готовы;
- beta artifacts отделены от stable channel.

**Когорты:**

- опытные Fabric-разработчики;
- начинающие разработчики;
- technical artists;
- пользователи Codex;
- пользователи Claude Code;
- maintainers существующих generated проектов.

**Обязательные сценарии:**

- companion/entity;
- machine block;
- ritual/custom recipe;
- animated prop;
- native UI;
- optional EMI/Jade;
- изменение ранее generated проекта;
- failed build и resume;
- schema/pack migration;
- работа без официального image provider.

**Exit:**

- не менее 50 завершённых supported проектов от 15 пользователей;
- каждая обязательная scenario family представлена минимум пятью проектами;
- beta workflow completion не ниже 90%;
- не менее 80% проектов не требуют ручного изменения generated infrastructure;
- crash-free tool sessions не ниже 99,5%;
- 100% declared optional integrations проходят absent/present matrix;
- 100% release candidates имеют provenance и dependency inventory;
- нет открытых Sev0, critical или high security defects;
- известные P1 defects имеют workaround, owner и срок;
- private-beta retrospective утверждён человеком.

### P3. Production hardening и public beta — недели 12–22

**Работы:**

- branch protection, signed tags и release approvals;
- подписанные compatibility packs и revoke mechanism;
- CycloneDX 1.6 SBOM для control plane и generated release;
- source/build provenance attestations;
- два независимых clean builds;
- external security assessment;
- 30-дневный SLO dashboard;
- rollback, key-rotation и compromised-pack drills;
- public documentation, tutorials и migration guides;
- accessibility и localization matrix;
- support rotation rehearsal;
- installer/update/uninstall safety tests;
- public beta только для явно перечисленной matrix.

**Exit:**

- не менее 100 completed supported projects от 25 пользователей;
- все GA SLO выполняются 30 последовательных дней;
- выпущены две byte-verified RC без Sev0/Sev1 regression;
- external security findings закрыты или формально отклонены с документированной причиной; critical/high не допускаются;
- rollback выполняется по runbook и не повреждает user workspace;
- signing-key rotation проверен;
- support команда выполняет response targets в rehearsal;
- privacy, trademark, EULA и redistribution review завершены;
- Release Council выпускает GA go/no-go dossier.

### P4. GA — ориентир недели 20–26, только по evidence

GA не происходит автоматически по календарю.

**GA gate:**

- все P0–P3 gates утверждены;
- GA support matrix опубликована;
- последние 30 дней находятся внутри error budget;
- stable artifacts воспроизводимы и подписаны;
- SBOM, provenance, license inventory и checksums полны;
- нет unresolved Sev0/Sev1 или critical/high security findings;
- documentation, migration, troubleshooting и known issues актуальны;
- on-call и release owners назначены;
- rollback и compromised-pack procedures проверены;
- human product, release, security, QA и art approvals относятся к точным hashes.

После GA действует 14-дневный heightened-monitoring период. Feature releases в этот период разрешаются только для критических исправлений.

### P5. NeoForge production adapter — параллельно после P1

NeoForge остаётся отдельным backend и не должен догонять Fabric через замену imports.

**Entry:**

- ModSpec и codegen-core contracts стабильны;
- loader-specific API не протекает в canonical IR;
- Fabric reliability не ухудшается из-за expansion work.

**Последовательность maturity:**

1. `EXPERIMENTAL`: basic scaffold, build и data generation.
2. `CANDIDATE`: entity, summoning, UI, networking, assets и optional integrations.
3. `PRODUCTION`: полный pack gate и beta evidence.

**Production exit:**

- basic, entity, recipe/UI, JEI/Jade, dedicated-server и asset fixtures проходят;
- platform-native networking и lifecycle проходят security review;
- client rendering не использует запрещённые raw API;
- clean build и runtime matrix проходят на заявленных OS;
- не менее 30 NeoForge beta projects завершены;
- 30 дней pack-specific SLO;
- feature/capability matrix явно фиксирует различия с Fabric;
- migration между pack revisions проверена.

### P6. Forge adapter — после стабильного NeoForge candidate

Forge получает отдельные templates, lifecycle, metadata, fixtures и owners.

Production gate повторяет P5, но не принимает NeoForge/Fabric evidence вместо Forge-native verification.

### P7. Multi-loader export

Multi-loader export разрешён только когда минимум два adapter packs:

- имеют статус `PRODUCTION`;
- прошли минимум два независимых release cycle;
- имеют согласованную capability matrix;
- не требуют ослабления platform-native gates.

Общий source set содержит только действительно общие gameplay contracts. Loader entrypoints, networking, metadata, run tasks, data generation и compatibility tests остаются platform-specific.

### P8. Дополнительные capability packs

Порядок после core stability:

1. REI и расширенные EMI/Jade capabilities;
2. machines/energy/fluids;
3. worldgen/structures;
4. Accessories/cosmetics;
5. Create integration;
6. Valkyrien/Eureka;
7. Paper/Folia как отдельная product line.

Каждый pack получает собственные IR fragments, security model, fixtures, performance budgets и support status. Наличие core GA не присваивает новому pack production status.

## 5. Compatibility-pack lifecycle

```text
EXPERIMENTAL → CANDIDATE → PRODUCTION → DEPRECATED → EOL
                         └────────────→ REVOKED
```

| Статус | Обещание |
|---|---|
| `EXPERIMENTAL` | Без SLA; нельзя выбирать по умолчанию |
| `CANDIDATE` | Beta testing; возможны controlled breaking changes |
| `PRODUCTION` | Полная fixture matrix, поддержка и migrations |
| `DEPRECATED` | Только fixes; минимум 90 дней уведомления до EOL |
| `EOL` | Нет обычных fixes; migration path остаётся в документации |
| `REVOKED` | Использование блокируется из-за подтверждённого security/supply-chain риска |

Каждый pack содержит exact versions, hashes, capabilities, migrations, known issues и support dates. Инструмент не имеет права молча менять Minecraft, loader, Java или pack revision.

## 6. Reliability, SLI и SLO

### 6.1. Hard invariants

Эти показатели не имеют error budget:

- 0 записей вне подтверждённого workspace и artifact cache;
- 0 непреднамеренных удалений user-owned файлов;
- 0 публикаций без approval точного artifact digest и destination;
- 0 секретов в logs, reports, telemetry или release bundle;
- 0 unresolved critical/high security findings в stable release;
- 100% dedicated-server purity для поддерживаемых releases;
- 100% absent/present tests для declared optional dependencies;
- 100% locked reference builds воспроизводимы;
- 100% shipping artifacts имеют hashes, SBOM и provenance;
- 100% visual release assets имеют действительный human approval.

Нарушение hard invariant немедленно останавливает stable releases.

### 6.2. Основные SLO

| SLI | Private beta | GA |
|---|---:|---:|
| Supported prompt-to-verified-bundle completion | ≥90% | ≥95% |
| Core build success на valid locked projects | ≥95% | ≥98% |
| Crash-free CLI/MCP sessions | ≥99,5% | ≥99,9% |
| Successful resume после recoverable failure | ≥99% | ≥99,9% |
| Canonical matrix pass | ≥99% | ≥99,5% |
| Диагностика без ручного поиска source cause | ≥85% | ≥95% |
| Art approval не более чем за два repair loops | ≥80% | ≥85% |
| Generated-infrastructure manual-edit-free projects | ≥80% | ≥90% |
| Provenance completeness | 100% | 100% |

Denominator включает только valid ModSpec, поддерживаемый pack и заявленную hardware/OS matrix. User cancellation измеряется отдельно. Если официальный provider входит в заявленный workflow, его outage учитывается в end-to-end SLI; внутренний core SLI публикуется отдельно, чтобы нельзя было скрыть provider failures.

### 6.3. Latency и resource budgets

Начальные budgets, подлежащие калибровке в P1:

- raw MCP request: не более 2 MiB плюс отдельные bounds на depth, keys и string sizes;
- spec validation: p95 не более 2 секунд и 512 MiB RSS;
- plan generation: p95 не более 5 секунд без LLM/provider wait;
- transactional apply: p95 не более 30 секунд без Gradle/assets;
- warm basic fixture build: p95 не более 8 минут;
- cold basic fixture build: p95 не более 20 минут;
- client или server smoke: не более 15 минут на run;
- после run/timeout: 0 nonce-owned child processes;
- 100-companion benchmark: средняя дополнительная server tick cost не более 5 ms, p99 не более 10 ms относительно baseline;
- asset limits задаются ArtSpec и не могут обходиться общей «красивой» оценкой.

Каждый benchmark указывает CPU, memory, disk, GPU, OS, JDK, cache state и network conditions.

### 6.4. Error-budget policy

SLO считается на rolling 30-day window.

- расход 50% месячного budget за первую неделю — остановка новых risky features;
- расход 75% — только reliability, security и support fixes;
- расход 100% — release freeze до root-cause review и восстановления SLO;
- hard invariant breach — немедленный freeze независимо от процента.

Для local-first core uptime hosted service не используется как подмена workflow reliability. Если позже появится hosted pack registry, его отдельный SLO — не ниже 99,9% monthly availability, при этом подписанный cached pack должен позволять безопасную offline-работу минимум семь дней.

## 7. Security program

### 7.1. Обязательные boundaries

- canonical workspace containment;
- fail-closed symlink, junction и path traversal checks;
- no generic shell MCP tool;
- no arbitrary worker eval;
- command/task/domain allowlists;
- bounded input, output, memory, time и process counts;
- server-authoritative gameplay;
- typed networking intents и collection limits;
- secrets только в OS keychain или explicit environment;
- logs redaction и release secret scan;
- plan/apply/package/publish разделены;
- generated code считается недоверенным до прохождения gates.

### 7.2. Secure development lifecycle

Для каждого изменения:

- threat impact отмечен в PR;
- untrusted input покрыт negative/property tests;
- dependency и license diff проверены;
- security-sensitive код требует второго reviewer;
- public interfaces имеют backward-compatibility review;
- rollback path документирован;
- audit evidence сохраняется.

До public beta:

- continuous parser/path/network fuzzing;
- минимум 72 aggregate fuzz-hours без crash, hang или containment escape;
- external security assessment MCP, workspace, worker и publishing boundaries;
- incident-response tabletop;
- private security reporting channel;
- coordinated disclosure policy.

### 7.3. Severity и incident response

| Уровень | Пример | Acknowledgement | Mitigation target |
|---|---|---:|---:|
| Sev0 | RCE, secret leak, path escape, data loss, unauthorized publish, compromised stable pack | ≤4 часа | ≤24 часа |
| Sev1 | Stable workflow массово заблокирован, invalid artifact опубликован | ≤1 рабочий день | ≤3 рабочих дней |
| Sev2 | Существенная деградация с workaround | ≤2 рабочих дней | Patch ≤14 дней |
| Sev3 | Неблокирующий defect/docs | ≤5 рабочих дней | Планируется по приоритету |

Если команда не способна выполнять Sev0 rotation, продукт остаётся beta и не обещает GA support.

## 8. Supply chain и provenance

Stable release требует:

- protected release branch;
- минимум два human approvals;
- подписанный Git tag;
- pinned CI actions/plugins по immutable revision;
- exact npm/Gradle locks;
- Gradle dependency verification и repository allowlist;
- checksum verification до execution;
- CycloneDX 1.6 SBOM;
- полный runtime/license inventory;
- source commit, builder и environment identity;
- hashes всех artifacts;
- два независимых clean builds;
- artifact signature;
- подписанный compatibility pack;
- offline verification command;
- key-rotation и revocation runbook.

Provenance chain:

```text
source commit
  → dependency/pack locks
  → BuildPlan
  → builder/environment
  → generated source/assets
  → tests and captures
  → release manifest/SBOM
  → human approvals
  → signed artifact
```

Asset provenance дополнительно содержит provider/model/version, prompt без секретов, seed, references, licenses, editable/runtime hashes, repair history и human approval.

Любая неизвестная лицензия, непроверенный redistribution status или несовпадающий hash блокирует stable release.

## 9. Telemetry и privacy

Core остаётся local-first и работоспособным без telemetry.

### 9.1. Политика по умолчанию

- remote telemetry выключена;
- opt-in не отмечен заранее;
- consent отделён от EULA и provider consent;
- пользователь может посмотреть точный event schema;
- crash bundle отправляется только после redaction preview и подтверждения;
- отключение telemetry не ухудшает local functionality.

### 9.2. Запрещённые данные

Без отдельного feature-specific consent нельзя отправлять:

- prompts;
- source code;
- ModSpec/ArtSpec content;
- asset images/models;
- абсолютные пути и filenames;
- Minecraft username/UUID;
- IP;
- secrets и environment values;
- provider request/response;
- chat/agent transcript.

Допустимы coarse product/version/OS fields, duration buckets, stable diagnostic IDs, pack ID и success/failure category.

### 9.3. Retention

- raw opt-in events: максимум 30 дней;
- агрегаты без project/user identifiers: максимум 12 месяцев;
- случайный installation identifier ротируется;
- fingerprinting запрещён;
- доступны export и deletion;
- privacy-impact review обязателен до hosted accounts или team features.

Local audit log не является telemetry: он хранится в workspace, принадлежит пользователю и имеет documented retention/cleanup policy.

## 10. UX и developer experience

### 10.1. Основной путь

```text
mcdev doctor
  → project init/import
  → ProductBrief review
  → ModSpec/ArtSpec review
  → plan diff
  → apply
  → build/test progress
  → targeted repair
  → visual review
  → package
  → optional publish_prepare
```

### 10.2. Production UX gates

- `doctor` объясняет отсутствующий JDK, Node, GPU, pack или dependency;
- каждое mutating действие показывает workspace и expected diff;
- долгие operations имеют progress, cancellation и resume;
- diagnostics имеют stable code, cause, affected artifact и next action;
- raw stack trace доступен в verbose mode, но не заменяет user-facing error;
- повторный apply не переписывает user-owned файлы;
- modified generated file приводит к выбору: adopt override, discard regeneration или fork ownership;
- CLI работает без цвета и с machine-readable JSON mode;
- generated Screen/Menu поддерживает keyboard focus, narration и GUI scale matrix;
- `en_us` и `ru_ru` проходят layout tests;
- quickstart до первого basic JAR проверяется новым пользователем;
- migration всегда создаёт backup и preview.

Целевые time-to-value budgets:

- от clean install до basic fixture JAR: p50 ≤30 минут;
- от approved Tidecaller-class spec до tested JAR, без human/provider wait: p50 ≤90 минут;
- типичная recoverable ошибка объясняется без поиска по generated source минимум в 95% GA cases.

## 11. Release и publishing controls

### 11.1. Channels

```text
nightly → alpha → beta → rc → stable
```

- nightly: автоматический, не поддерживаемый;
- alpha: internal/dogfood;
- beta: external testing, breaking changes только с migration note;
- RC: exact stable candidate, feature freeze;
- stable: только после GA/release gate.

Product, compatibility pack и generated project versions независимы.

### 11.2. Cadence

- nightly — при изменениях;
- alpha — не чаще раза в неделю;
- beta — не чаще раза в две недели;
- stable — не чаще раза в месяц и только при наличии ценности;
- security hotfix — вне cadence.

Календарь не является причиной release.

### 11.3. Marketplace publishing

GA core может ограничиться `publish_prepare`. Upload adapter допускается отдельно и использует три шага:

1. подготовить metadata и exact artifact digest;
2. показать destination, game versions, loaders, dependencies, release notes и permissions;
3. получить отдельное human approval и выполнить upload.

После upload инструмент проверяет remote receipt и сохраняет project/version ID. Credentials имеют минимальный scope и никогда не входят в release bundle или report.

Нельзя переиспользовать approval после изменения хотя бы одного byte, destination или metadata field.

### 11.4. Rollback

- stable index хранит last-known-good release;
- pack может быть помечен `REVOKED`;
- cache предупреждает или блокирует revoked pack;
- downgrade/migration path документирован;
- marketplace yank/deprecate выполняется человеком;
- rollback rehearsal обязателен до GA и раз в квартал.

## 12. Support и lifecycle

### 12.1. Support surface

- публичная support matrix;
- known issues;
- troubleshooting decision tree;
- redacted diagnostic bundle generator;
- issue templates с environment manifest;
- security contact;
- migration и EOL guides;
- changelog с breaking changes;
- pack health/status page, если появится hosted registry.

### 12.2. Version policy

- текущий stable product minor поддерживается полностью;
- предыдущий minor получает critical/security fixes минимум 90 дней;
- production pack получает минимум 90 дней deprecation notice;
- revoked pack может быть отключён немедленно;
- новые Minecraft/loader versions не получают production label без полного pack gate.

### 12.3. Support KPIs

- не менее 90% Sev1 tickets получают воспроизводимый diagnostic bundle;
- не менее 80% beta и 90% GA support cases закрываются без ручного редактирования generated infrastructure;
- median first meaningful response: ≤1 рабочий день;
- repeat incident rate по одной root cause: <5% после declared fix.

## 13. Staffing и ownership

### Рекомендуемый состав к public beta

| Роль | Capacity | Ответственность |
|---|---:|---|
| Product/release owner | 1,0 FTE | Scope, GA decision, release authority |
| Core compiler/MCP engineers | 2,0 FTE | ModSpec, planner, CLI/MCP, workspace |
| Loader/gameplay engineers | 1,5–2,0 FTE | NeoForge, Fabric/Forge adapters, GameTests |
| Build/reliability/security engineer | 1,0 FTE | CI, supply chain, runners, incidents |
| QA automation engineer | 1,0 FTE | Matrix, failure injection, regression |
| Technical artist | 0,5 FTE | ArtSpec, capture review, asset rubric |
| Support/developer relations | 0,5 FTE | Beta cohort, docs, triage |
| Legal/privacy/security specialists | project-based | External review |

Минимум для GA:

- три инженера, способных участвовать в Sev0 rotation;
- минимум два maintainers для production pack;
- независимый QA approver;
- названный security owner;
- названный human art approver;
- отсутствие единственного человека, который может собрать, подписать или откатить release.

Если capacity ниже, срок увеличивается; release bar не понижается.

## 14. Capacity и финансовые budgets

Это planning envelopes, а не коммерческая смета. Их нужно подтвердить фактическими provider и infrastructure quotes в P1.

### Первые 90 дней после MVP

- core/compiler/DX: 6 person-months;
- loader/gameplay: 3–4,5 person-months;
- reliability/security/release: 3 person-months;
- QA: 3 person-months;
- technical art: 1,5 person-months;
- product/support: 1,5 person-months;
- внешний security и legal review — отдельно.

### Infrastructure envelope

| Статья | Private beta | Public beta / GA |
|---|---:|---:|
| CI/build runners | $2k–5k/месяц | $5k–12k/месяц |
| Artifact/log storage | $0,5k–2k/месяц | $1k–4k/месяц |
| Product-sponsored image/GPU workloads | $1k–5k/месяц | $3k–10k/месяц |
| Support/telemetry infrastructure | $0,5k–2k/месяц | $2k–5k/месяц |
| Reference hardware, one-time | $8k–20k | — |
| External security assessment, one-time | $20k–60k | — |
| Legal/privacy review, one-time | $5k–20k | — |

BYOK остаётся default для коммерческих image providers. Product-sponsored calls имеют per-project budget и fail-closed approval.

Cost controls:

- alert при 50%, 75% и 90% бюджета;
- при 90% приостанавливаются non-critical nightly/GPU jobs;
- hard cap нельзя превышать автоматически;
- security и stable release jobs используют отдельный reserved budget;
- ежемесячно измеряются cost per verified bundle, cache hit rate и wasted reruns.

## 15. KPI

### North star

Доля supported prompts, завершившихся human-approved release bundle без ручного изменения generated infrastructure.

| KPI | Private beta | GA |
|---|---:|---:|
| North-star completion | ≥80% | ≥90% |
| Supported workflow completion | ≥90% | ≥95% |
| Clean build success | ≥95% | ≥98% |
| Exact locked reproducibility | 100% | 100% |
| Dedicated-server purity | 100% | 100% |
| Optional integration matrix | 100% | 100% |
| Complete asset provenance | 100% | 100% |
| Art approval ≤2 repair loops | ≥80% | ≥85% |
| Self-service diagnostic resolution | ≥85% | ≥95% |
| Unauthorized publish/path escape/data loss | 0 | 0 |

Дополнительные продуктовые метрики:

- time from approved spec to tested JAR;
- mean repair loops;
- percentage targeted repairs против full regeneration;
- migration success;
- resume success;
- support cases per completed project;
- four-week retained creators;
- percentage abandoned at brief, spec, build, asset и package stages.

Release decision нельзя основывать только на opt-in telemetry. Controlled cohort reports и immutable test evidence обязательны.

## 16. Risk register

| Риск | Вероятность / влияние | Ранний сигнал | Mitigation | Owner / contingency |
|---|---|---|---|---|
| Loader/API drift | Высокая / Высокое | Fixture ломается после metadata refresh | Immutable packs, scheduled candidate update, no silent latest | Pack owner; freeze affected pack |
| Supply-chain compromise | Средняя / Критическое | Hash/repository/signature mismatch | Allowlist, locks, signatures, two-build verification | Security owner; revoke pack/release |
| Уязвимый generated network code | Средняя / Критическое | Fuzz/negative GameTest failure | Declarative intents, codecs, server validation | Gameplay owner; disable primitive |
| Path/symlink/process escape | Средняя / Критическое | Residual process или containment diagnostic | Canonicalization, nonce-owned cleanup, adversarial tests | Core owner; stable freeze |
| Flaky headful tests | Высокая / Среднее | Retry rate растёт | Fixed scenes, deterministic seeds, separate infra/product flakes | QA owner; quarantine only with expiry |
| Низкое art quality | Высокая / Высокое | Repair loops и rejection растут | ArtSpec, technical checks, targeted repair, human review | Art owner; manual asset path |
| Rights/license uncertainty | Средняя / Критическое | Missing provider/reference terms | Fail-closed provenance, legal review | Release owner; remove asset/dependency |
| Перезапись user code | Средняя / Высокое | Ownership conflicts | File manifest, adopt/fork/discard flow, backup | Core owner; restore and halt apply |
| Provider outage/lock-in | Средняя / Среднее | Completion depends on one provider | Manual import, BYOK adapters, provider-neutral contract | Product owner; switch provider |
| Telemetry/privacy leak | Низкая / Критическое | Unexpected fields in event/crash bundle | Default-off, schema allowlist, redaction preview | Privacy owner; disable ingestion/delete |
| Multi-loader scope explosion | Высокая / Высокое | Fabric SLO падает из-за adapter work | Independent teams/gates, no parity promise | Product owner; pause expansion |
| Support volume превышает capacity | Средняя / Высокое | SLA/error budget burn | Cohort limits, docs, diagnostics, hiring gate | Support owner; close beta intake |
| CI/GPU cost explosion | Средняя / Среднее | Cost per bundle растёт | CAS/cache, quotas, workload tiers | Infra owner; pause noncritical jobs |
| Signing key compromise | Низкая / Критическое | Unknown signature/use | Hardware-backed keys, rotation, revocation drill | Release owner; revoke and reissue |
| Minecraft/EULA/brand policy change | Низкая / Высокое | Updated terms affect distribution | Scheduled legal review, non-affiliation policy | Product/legal; suspend publishing |
| Roadmap воспринимается как evidence | Средняя / Высокое | README заявляет незакрытый feature | Evidence-linked status page, CI docs check | Release owner; correct claims before release |

Risk register пересматривается ежемесячно и перед каждым RC.

## 17. Приоритеты 30/60/90 дней

Отсчёт начинается после принятого MVP evidence.

### Дни 0–30

- завершить независимый MVP exit audit;
- создать release evidence index;
- заморозить public contracts и GA scope;
- принять support/version/deprecation policies;
- внедрить transactional apply, recovery journal и backups;
- создать canonical performance/reference hardware profile;
- запустить nightly failure-injection matrix;
- реализовать `mcdev doctor`, resume и redacted diagnostics bundle;
- принять security threat model и disclosure process;
- определить telemetry schema, оставив remote telemetry выключенной;
- провести минимум 10 extended-dogfood проектов.

**Результат:** утверждённый P0 и readiness report для private beta.

### Дни 31–60

- открыть ограниченную private beta;
- завершить минимум 25 из требуемых 50 beta projects;
- устранить top reliability/UX failure modes;
- внедрить SBOM, signatures и provenance attestations;
- выполнить независимую clean rebuild;
- провести rollback и compromised-pack rehearsal;
- начать external security assessment;
- утвердить privacy/support documents;
- реализовать migration и generated-file ownership UX;
- подготовить NeoForge capability-gap RFC и следующий regression fixture без parity promises.

**Результат:** mid-beta report с KPI, cost baseline и обновлённым risk register.

### Дни 61–90

- завершить минимум 50 private-beta projects;
- накопить 30-дневный SLO report;
- закрыть critical/high findings;
- выпустить первый signed RC candidate;
- провести support и incident-response rehearsal;
- проверить OS/hardware matrix;
- завершить accessibility/localization pass;
- сформировать public-beta или GA gap dossier;
- принять решение `GO`, `EXTEND_BETA` или `NO_GO`.

**Результат:** evidence-backed решение. День 90 не является автоматической датой GA.

## 18. Решения с обязательным сроком

До P0 exit:

- точный GA Minecraft/Fabric pack;
- local-only minimum mode;
- supported OS/hardware matrix;
- artifact/cache location и retention;
- допустимость external GPL Blockbench bridge;
- generated/user-owned ownership contract.

До private beta:

- официальный список image providers;
- нужен ли hosted pack registry;
- telemetry operator и privacy jurisdiction;
- support hours и severity owners;
- beta cohort limits.

До public beta:

- stable publishing surfaces;
- signing/key custody;
- EOL duration;
- trademark/non-affiliation text;
- GA pricing или полностью open-source distribution model;
- external security/legal approvals.

Открытый вопрос не закрывается молчаливым default, если он меняет права, privacy, support obligation или release scope.

## 19. Definition of Done для каждого production increment

Каждая задача считается завершённой только если:

- выполнены её acceptance criteria;
- поведение проверено runtime-тестом, а не только compile/typecheck;
- negative/error paths покрыты;
- lint, format и regression tests проходят;
- public contracts и migration impact проверены;
- документация описывает текущее состояние;
- security и privacy implications рассмотрены;
- observability и diagnostics добавлены для критического пути;
- rollback/recovery существует;
- evidence привязано к exact revision;
- human reviewer утвердил изменение.

## 20. Финальный принцип

MVP доказывает, что вертикальный путь возможен. Production Candidate доказывает, что он повторяем для контролируемой группы. GA означает, что команда готова поддерживать обещание во времени.

Ни количество сгенерированного кода, ни один успешный demo, ни зелёный Gradle build не заменяют reliability, security, provenance, support и human release authority.
