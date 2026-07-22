# Fabric-first MVP plan

## Статус и назначение

Дата первоначального решения: 21 июля 2026 года. Production baseline уточнён 22 июля 2026 года в [ADR-0004](decisions/0004-fabric-1.20.1-production-baseline.md).

Этот документ является текущим исполнимым планом первого MVP. Он меняет приоритет платформы из исходного [research-плана](RESEARCH_AND_MVP_PLAN.md): основной target теперь Fabric, а уже реализованный NeoForge backend сохраняется как второй адаптер и regression fixture.

План отвечает на четыре практических вопроса:

1. что уже готово и может быть переиспользовано;
2. что именно пользователь получит в первом MVP;
3. в каком порядке это строить, чтобы рано проверить самые рискованные части;
4. какими проверками доказывается качество кода, моделей, текстур и release bundle.

Наличие задачи в этом документе не означает, что она реализована. Статус подтверждается только кодом, тестами и evidence, привязанными к точному commit.

## 1. Результат MVP

Пользователь описывает мод обычным языком. Инструмент:

1. формирует проверяемые `ProductBrief`, `ModSpec` и `ArtSpec`;
2. показывает план и запрашивает подтверждение изменений;
3. генерирует читаемый нативный Fabric-проект без незавершённых заглушек;
4. создаёт необходимые item/block textures, icons, cuboid-модели, rig и анимации;
5. генерирует gameplay, data generation, UI, локализации и optional-интеграции;
6. собирает проект, запускает unit, GameTest, client и dedicated-server checks;
7. делает turntable и игровые screenshots, валидирует ассеты и выполняет ограниченный repair loop;
8. формирует JAR, sources, editable assets, документацию, отчёты, hashes и provenance;
9. останавливается перед публикацией и требует отдельного подтверждения человека.

Основной reference mod — Fabric-версия **Tidecaller**: медно-коралловый краб-компаньон, предметы и блок алтаря, ритуал призыва, экран настройки, optional EMI/Jade, локализации `en_us`/`ru_ru`, уникальные модель, текстуры и анимации.

## 2. Граница первого MVP

### Входит

- Minecraft 1.20.1, Fabric Loader и Java 17 как один exact compatibility pack;
- local-first CLI и MCP server;
- items, blocks, recipes, tags, loot, entities и attributes;
- owned companion с сохранением состояния и базовым AI;
- декларативный ритуал/призывание;
- безопасное client/server networking и native screen/menu;
- Fabric data generation;
- cuboid entity models и animation presets с version-tested runtime export для 1.20.1;
- AI-generated concepts, item icons и pixel textures;
- editable `.bbmodel`, runtime model/animation JSON и PNG;
- optional EMI recipe display и Jade tooltip integration;
- unit tests, Fabric GameTests, client GameTests и dedicated-server smoke;
- воспроизводимый release bundle с provenance и human asset approval.

### Не входит

- полная генерация произвольного Java-кода по промпту;
- parity со всеми возможностями NeoForge/Forge/Paper;
- произвольные Mixins, raw OpenGL, shell, Blender Python или Blockbench JavaScript;
- generic AI mesh как production-путь;
- сложная физика кораблей, worldgen измерений или масштабные tech trees;
- гарантированная совместимость со всеми сторонними модами;
- автоматическая публикация на Modrinth/CurseForge;
- обучение собственной image/3D модели в рамках MVP.

Generic image-to-3D остаётся experimental provider. Надёжный production-путь MVP: concept image → процедурная cuboid geometry → детерминированный UV → pixel texture → rig/animation presets → техническая и визуальная проверка.

## 3. Зафиксированный Fabric baseline

Первый compatibility pack создаётся для следующей матрицы. Каждая версия фиксируется exact value, checksum и provenance; moving aliases и `*-SNAPSHOT` запрещены в production pack.

| Компонент | MVP baseline | Источник решения |
|---|---:|---|
| Minecraft | 1.20.1 | пользовательская product target; проверяется exact Fabric fixture |
| Java toolchain | Eclipse Temurin 17.0.19+10 | Java 17 baseline Minecraft 1.20.1; exact archive и source зафиксированы в pack |
| Gradle | 8.7 | локально проверенная пара с Loom 1.6.12 и Java 17 |
| Fabric Loom | 1.6.12 | exact stable из [официального Fabric Maven](https://maven.fabricmc.net/net/fabricmc/fabric-loom/) |
| Fabric Loader | 0.19.3 | exact stable из [Fabric Meta](https://meta.fabricmc.net/) для 1.20.1 |
| Fabric API | 0.92.11+1.20.1 | exact release из [официального Fabric Maven](https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/) |
| Mappings | official Mojang mappings | Loom mapping layer без перераспространения mappings |
| GeckoLib/runtime animation | не выбран | отдельный compatibility test обязателен до F2.2 |

Перед присвоением pack статуса `production` versions повторно разрешаются из официальных metadata, фиксируются lock-файлами и проходят полную fixture matrix. Обновление любой версии создаёт новый pack, а не молча изменяет существующий.

Архитектурные ограничения Fabric 1.20.1:

- общие и client-only исходники физически разделены;
- dedicated server не загружает client types;
- rendering идёт через Minecraft/Fabric abstractions версии 1.20.1; raw OpenGL по-прежнему запрещён;
- Mixins по умолчанию запрещены и добавляются только как именованная capability с allowlist, review и тестом;
- регистрация и datagen используют актуальные типизированные IDs, а не устаревшие snippets;
- optional APIs изолированы так, чтобы мод запускался без EMI/Jade.

## 4. Что уже готово

Текущая ветка содержит существенную loader-agnostic основу:

| Компонент | Состояние | Использование в Fabric MVP |
|---|---|---|
| Строгие wire contracts и bounded BuildPlan | Реализовано и протестировано | Расширить новой версией/закрытыми Fabric policies |
| Trusted compatibility-pack registry | Реализовано для Fabric 1.20.1, Fabric 26.2 и NeoForge 26.1.2 | Добавлять новые revisions без изменения старых trees |
| Детерминированное codegen core | Реализовано | Переиспользовать без loader imports |
| Transactional create-only workspace apply | Реализовано | Переиспользовать без изменений semantics |
| Artifact index и structured logging | Реализовано | Переиспользовать для Fabric build/assets/reports |
| Fixed secure Gradle runner | Реализован для NeoForge | Выделить общую execution основу, добавить отдельную Fabric policy |
| NeoForge 26.1.2 compiler | Реализован и остаётся зелёным | Не конвертировать подменой imports; оставить отдельным backend |
| Application orchestration, CLI/MCP E2E | Не завершено | Закрыть в первом Fabric vertical slice |
| Fabric pack/compiler/fixtures | Exact 1.20.1 pack, clean build и client/server smoke реализованы локально; compiler отсутствует | Добавить 1.20.1 GameTests/hosted gates, затем Fabric compiler |
| Production AI asset pipeline | Не реализован | Проверить минимальный путь уже в первом vertical slice |

Следовательно, сейчас есть качественный control plane и рабочий NeoForge backend, но **инструмент ещё не генерирует Fabric-мод от промпта до JAR и не создаёт production-ассеты**.

## 5. Целевая архитектура

```text
prompt
  → ProductBrief review
  → loader-neutral ModSpec + ArtSpec
  → semantic validation
  → closed BuildPlan
      ├─ compiler-fabric ─→ native Java/resources/datagen/tests
      ├─ asset compiler ─→ concepts/bbmodel/geo/animations/PNG
      ├─ optional adapters ─→ EMI/Jade
      └─ fixed Fabric runner ─→ build/GameTest/client/server
  → technical + visual QA
  → artifact index + provenance
  → human approval
  → release bundle
```

Ключевые границы:

- `ModSpec` и `ArtSpec` не содержат Java source или исполняемых команд;
- loader backend реализует capability interface и генерирует нативный код;
- NeoForge и Fabric используют общий IR, но разные templates/generators/tests;
- image provider создаёт candidate/concept, а технически корректный Minecraft asset выпускает детерминированный asset compiler;
- runner принимает только известную policy, никогда не принимает command/args/env от промпта;
- generated и user-owned файлы различаются manifest’ом и никогда не перезаписываются молча;
- каждый выход имеет hash, входы, tool/model versions и связь с BuildPlan node.

Предлагаемые новые модули:

```text
packs/fabric-1.20.1/
packages/compiler-fabric/
packages/application/
apps/cli/
apps/mcp-server/
packages/assets-contracts/
packages/assets-core/
packages/assets-image-provider/
packages/assets-geckolib/
packages/visual-qa/
fixtures/fabric-1.20.1-empty/
```

## 6. Порядок реализации

Работа идёт вертикальными срезами. Каждый checkpoint должен оставлять запускаемый результат, а не только новые внутренние abstractions.

### F0. Fabric baseline и доверенная сборка — 1–2 недели

#### F0.1. Compatibility pack `fabric-1.20.1`

**Зависимости:** нет.

**Работа:** создать self-contained pack, exact version locks, checksums, capabilities, known issues, license/dependency inventory и минимальный проект по официальному example mod.

**Приёмка:**

- pack не содержит moving versions, внешних путей или исполняемых входов;
- clean build работает без глобального Gradle и системного Java;
- pack digest проверяется trusted registry;
- Minecraft client и dedicated server стартуют с пустым fixture;
- NeoForge pack и его tests остаются зелёными.

**Статус на 22 июля 2026:** exact pack, tamper-checked Gradle wrapper, strict dependency metadata, clean build и client/server smoke проходят локально. GameTests, hosted evidence и полный transitive license review ещё не закрыты.

**Проверка:** pack unit tests, checksum tamper tests, offline rebuild после прогрева cache, client/server smoke.

#### F0.2. Fabric test harness

**Зависимости:** F0.1.

**Статус на 22 июля 2026:** hardened server/client smoke для 1.20.1 реализованы и проходят локально. JUnit/GameTests, screenshots и отдельные hosted jobs для 1.20.1 ещё не реализованы. Проверки 26.2 не считаются evidence для 1.20.1.

**Работа:** настроить JUnit, server GameTests, client GameTests/screenshots, dedicated-server smoke и CI jobs. Для headless client использовать фиксированный Linux environment/Xvfb.

**Приёмка:** намеренно сломанные registration, client/server boundary и GameTest дают красный gate; reports и screenshots индексируются как artifacts.

**Checkpoint F0:** exact Fabric fixture воспроизводимо собирается и запускается на client и server.

### F1. Первый полный vertical slice — 2–3 недели

Цель этапа: запрос «добавь руду, блок и инструмент» превращается в Fabric JAR с уникальными AI-generated icons/textures.

#### F1.1. Fabric-native compiler для basic content

**Зависимости:** F0.

**Работа:** реализовать scaffold, metadata, source sets, items, blocks, creative entries, recipes, loot, tags, models, blockstates, localization и datagen.

**Приёмка:** generated source читаем, форматирован, не содержит TODO/placeholders, абсолютных путей или NeoForge imports; два одинаковых входа дают одинаковое дерево файлов.

**Проверка:** golden tests, semantic compile fixtures, datagen diff, path/size/property tests.

#### F1.2. Закрытая Fabric build policy

**Зависимости:** F0.1.

**Работа:** выделить безопасное общее ядро существующего runner и добавить отдельную Fabric policy с фиксированными tasks, JDK, cache и timeouts. Версионировать BuildPlan contract; не ослаблять старую NeoForge policy.

**Приёмка:** caller не может передать Gradle task, flag, environment, init script или plugin; timeout/kill очищает process tree; cache trust и artifact allowlist проверяются.

**Проверка:** adversarial runner tests и build пустого/basic fixture.

#### F1.3. Минимальный AI texture pipeline

**Зависимости:** F1.1.

**Работа:** ввести `ArtSpec`, provider interface и BYOK image provider для concept/icon candidates; детерминированно нормализовать palette, alpha, resolution и pixel grid; генерировать block/item textures и provenance.

**Приёмка:** fixture не использует placeholder или чужой asset; сохраняются prompt, seed/request ID, provider/model version, input/output hashes и license terms snapshot; provider secret не попадает в logs/artifacts.

**Проверка:** PNG/palette/alpha/silhouette validators, secret-redaction tests, cached replay без provider network.

#### F1.4. Application service, CLI и MCP

**Зависимости:** F1.1–F1.3 и готовые workspace/artifact/logging packages.

**Работа:** соединить validate → plan → review → apply → asset → build → index; реализовать одинаковые операции в CLI и MCP поверх одного service.

**Приёмка:** `plan` не меняет filesystem; `apply` принимает только подтверждённый content-derived plan ID; path escape/overwrite fail closed; события progress структурированы и одинаковы для CLI/MCP.

**Проверка:** raw MCP frames, CLI integration tests, cancel/resume boundary tests, create-only workspace tests.

#### F1.5. Basic-content E2E fixture

**Зависимости:** F1.1–F1.4.

**Приёмка:** один clean запрос создаёт новый workspace, AI textures, source, datagen, tests, working JAR и artifact index; client screenshot показывает контент, dedicated server загружает мод; повторный clean run имеет ожидаемые hashes.

**Checkpoint F1 — первый usable build:** prompt-to-Fabric-JAR доказан кодом, реальными ассетами, client и server evidence.

### F2. Анимированное существо и полноценные ассеты — 3–4 недели

#### F2.1. Entity gameplay compiler

**Зависимости:** F1.

**Работа:** entity type, attributes, spawn item, owner/tame state, persistence, follow/stay/wander goals, damage/death rules, particles/sounds и server-authoritative state.

**Приёмка:** сохранение переживает reload/chunk unload; owner permissions проверяются server-side; entity не требует client classes на dedicated server; AI укладывается в performance budget.

**Проверка:** unit tests, server GameTests, save/reload and permission fixtures, dedicated-server smoke.

#### F2.2. Cuboid model, rig и version-tested animation exporter

**Зависимости:** F2.1 и F1.3.

**Работа:** сначала выбрать совместимую с Fabric 1.20.1 exact версию runtime animation library; затем из semantic anatomy и concept views строить cuboid blockout, pivots, named bones, box UV, texture atlas, editable `.bbmodel`, version-native model/animation resources и presets `idle/walk/attack/sit`.

**Приёмка:** все references существуют; runtime paths соответствуют зафиксированной версии библиотеки; нет zero-size cubes, invalid UV, missing bones, NaN или превышения budgets; runtime и editable artifacts связаны hashes.

**Проверка:** schema/geometry/UV/animation validators, golden exports, generated-resource load test, animated client fixture.

#### F2.3. Visual QA и bounded repair

**Зависимости:** F2.2.

**Работа:** fixed-camera turntable, daylight/night/interior и inventory screenshots, silhouette/readability scoring, screenshot diff, visual critic и максимум три scoped repair attempts.

**Приёмка:** repair меняет только заявленные asset regions; regression после repair запускает технические validators заново; бесконечный цикл невозможен; точные approved hashes подписывает человек.

**Checkpoint F2:** по prompt создано уникальное анимированное существо с editable source, работающее в Fabric client/server.

### F3. Tidecaller gameplay, UI и integrations — 2–3 недели

#### F3.1. Декларативное призывание

**Зависимости:** F2.

**Работа:** altar block/entity при необходимости, ingredient pattern, cooldown, ownership, feedback effects и transactional consumption.

**Приёмка:** все условия проверяются server-side; invalid/duplicate packets не дублируют сущность или расход; interrupted ritual оставляет согласованное состояние.

**Проверка:** happy/invalid/permission/replay/concurrency GameTests.

#### F3.2. Native UI и networking intents

**Зависимости:** F2.1.

**Работа:** screen/menu для имени и режима companion; ModSpec описывает intent и limits, generator создаёт typed payloads и validation.

**Приёмка:** payload bounded; distance, ownership, state и rate limits проверяются server-side; malformed data fail closed; UI имеет translatable labels и keyboard path.

**Проверка:** packet fuzz/property tests, client GameTest, unauthorized-player fixture.

#### F3.3. Optional EMI и Jade adapters

**Зависимости:** F3.1–F3.2.

**Работа:** EMI показывает ritual/recipe, Jade показывает bounded companion/altar data; integrations находятся в изолированных entrypoints/source paths.

**Приёмка:** мод запускается без обеих интеграций, с каждой отдельно и с обеими; optional API не попадает в mandatory loading path; отображаемые данные локализованы.

**Проверка:** четыре client matrices и dedicated server без optional mods.

**Checkpoint F3:** Tidecaller функционально завершён и тестируется как настоящий Fabric-мод.

### F4. Production hardening ассетов и кода — 2–3 недели

#### F4.1. Полный asset contract и validators

**Зависимости:** F2.

**Работа:** versioned asset manifest, material/palette/texel-density profiles, cube/bone/keyframe/performance budgets, seam/bleed/UV checks, perceptual hashes и reference-license policy.

**Приёмка:** отсутствующий provenance, неизвестная лицензия, budget overflow или broken runtime reference блокируют release; external references отделены от generated output.

#### F4.2. Code quality gates

**Зависимости:** F1–F3.

**Работа:** formatter/lint/static analysis, forbidden imports, client/server architecture checks, generated-code complexity limits, dependency audit и mutation tests для критичных validators.

**Приёмка:** zero warnings policy; нет TODO/stub/dead generated code; public generated APIs документированы; критичные security/semantic branches доказаны negative tests.

#### F4.3. Failure recovery

**Зависимости:** F1.4 и F4.1.

**Работа:** idempotent node cache, provider retry policy, resume journal и failure injection для provider outage, corrupt response/cache, disk full, timeout и process kill.

**Приёмка:** сбой заканчивается восстановимым либо безопасным fail-closed состоянием; user-owned files и secrets не теряются и не публикуются.

**Checkpoint F4:** качество проверяется автоматически и подтверждается человеком, а не оценивается только фактом успешной компиляции.

### F5. Release bundle и dogfood — 2–3 недели

#### F5.1. Packaging и reproducibility

**Зависимости:** F4.

**Работа:** JAR, sources JAR, README, CHANGELOG, LICENSE, THIRD_PARTY_NOTICES, SBOM/dependency manifest, asset provenance, reports, screenshots и artifact hashes; только `publish_prepare`.

**Приёмка:** два независимых clean builds одного locked input дают заявленный reproducibility result; bundle проверяется отдельной verify command; publish требует нового подтверждения exact digest.

#### F5.2. Пять dogfood-проектов

**Зависимости:** F5.1.

Обязательная выборка:

1. basic items/blocks/tools;
2. Tidecaller companion + ritual + UI;
3. machine block с state/menu;
4. animated decorative prop;
5. configuration/UI-focused utility mod.

Каждый проект проходит clean generation, code review, asset review, client/server checks и release verification. Дефекты исправляются в compiler/pack/pipeline, а не вручную только в fixture.

#### F5.3. MVP exit audit

**Зависимости:** F5.2.

**Приёмка:** выполнена Definition of Done ниже; нет unresolved critical/high security, data-loss, license или release findings; exact evidence index утверждён ответственными за code, QA и art.

**Checkpoint F5:** Fabric-first MVP готов к ограниченному использованию; NeoForge остаётся regression backend без обещания feature parity.

## 7. Definition of Done

MVP считается завершённым только когда одновременно выполнено всё:

- CLI и MCP проводят один и тот же prompt-to-bundle workflow;
- Fabric 1.20.1 pack exact, hashed, documented и воспроизводим;
- пять dogfood-проектов генерируются из clean inputs без ручной правки generated source;
- Tidecaller имеет рабочие gameplay, UI, model, textures, animations и optional integrations;
- generated code читаем, отформатирован, без placeholders/TODO и проходит code review;
- unit, integration, datagen, server GameTest, client GameTest и dedicated-server suites зелёные;
- client-only classes не загружаются на server, raw OpenGL и неразрешённые Mixins отсутствуют;
- каждый runtime asset имеет editable source, technical validation, screenshots и provenance;
- ни один release asset не является placeholder и каждый точный hash имеет human approval;
- секреты не входят в plan, logs, cache, artifacts или bundle;
- workspace не выходит за подтверждённый root и не перезаписывает user-owned files;
- failure injection доказывает безопасный timeout/cancel/resume;
- optional EMI/Jade проверены в absent/present matrices;
- release bundle содержит JAR, sources, docs, licenses, dependency/SBOM inventory, reports и hashes;
- автоматической публикации нет; `publish_prepare` не использует release credentials;
- NeoForge compiler/runner regression suite остаётся зелёным.

## 8. Контроль качества кода

Для каждого implementation task обязательны:

1. маленький reviewable commit с одной причиной изменения;
2. tests в том же commit, включая хотя бы один отрицательный сценарий;
3. exact dependency versions и обновлённый provenance при добавлении зависимости;
4. отсутствие произвольного executable input на границах CLI/MCP/spec/plan;
5. structured diagnostic с безопасным сообщением для пользователя;
6. documentation/schema migration при изменении public contract;
7. локальные `lint`, `typecheck`, `test`, релевантный fixture build и CI;
8. устранение причины дефекта в generator/compiler, а не маскировка в output.

Большие LLM-generated Java blobs не являются архитектурой продукта. LLM выбирает поддерживаемые primitives и пишет bounded content; стабильная структура Java, registrations, networking, tests и resources генерируется типизированными emitters/templates.

## 9. Реалистичная оценка

Для одного разработчика full-time с агентной автоматизацией: ориентировочно **14–20 недель** до доказанного MVP. Для небольшой команды из двух backend/tooling инженеров и одного technical art/QA специалиста: примерно **9–13 недель**, если задачи после F1 выполняются параллельно.

Оценка меняется после checkpoint F1. Если prompt-to-Fabric-JAR с реальной AI-текстурой не проходит за первые 3–5 недель вместе с F0, scope сокращается до items/blocks и одного animated entity, но quality gates не ослабляются.

## 10. Ближайшая задача

Следующий implementation milestone — **F0.2: Fabric 1.20.1 test harness**. Trusted `fabric-1.20.1` pack, strict clean fixture build и hardened local client/dedicated-server evidence уже созданы. Теперь нужны server/client GameTests, screenshots и hosted CI для того же exact baseline; после этого начинается Fabric-native compiler для basic content.
