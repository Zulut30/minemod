# Art Quality Rubric v0

## Назначение и статус

Версия rubric: `0.1.0`. Дата: 2026-07-21.

Этот документ задаёт воспроизводимый release gate для визуальных ассетов MINECRAFT-MODS-SKILL. Он переводит требования из [research-плана](../RESEARCH_AND_MVP_PLAN.md#8-модели-текстуры-и-анимации-почему-это-отдельный-продукт) в проверяемые evidence, blockers, score и human decision.

**Важно:** на Phase 0 автоматические asset validators, screenshot diff, perceptual similarity search и команды `mcdev_asset_*` ещё не реализованы. Идентификаторы и структуры ниже являются контрактом будущей реализации и одновременно форматом ручного review. До появления валидаторов нельзя описывать их результаты как автоматически проверенные.

Rubric отвечает на вопрос «можно ли включить конкретную версию ассета в release candidate». Он не доказывает юридическую чистоту, уникальность, авторство или отсутствие любых дефектов.

## 1. Область действия

Оценяется неизменяемый candidate: набор editable source, runtime outputs и evidence, связанный SHA-256 hashes. Один approval нельзя переносить на другие hashes.

Поддерживаемые классы:

| `assetClass` | Editable source | Runtime outputs | Обязательный контекст проверки |
|---|---|---|---|
| `item-icon` | layered source и/или PNG | texture PNG, item model JSON | inventory, hand/ground при наличии этих представлений, enchanted glint если применим |
| `cuboid-model` | `.bbmodel` и texture source | native block/item model JSON, blockstate при необходимости, PNG | inventory и placed/in-world views |
| `animated-model` | `.bbmodel`, texture source | GeckoLib geo/animation JSON, PNG и renderer bindings | neutral turntable, idle и все gameplay-significant clips in game |
| `structure` | blueprint/palette source | NBT/schematic или другой явно выбранный codec, palette manifest | near/mid/far views, interior при наличии, placement fixture |
| `decorative-mesh` | `.blend`/`.bbmodel` | только явно разрешённый reviewed loader format, textures/LOD | turntable и in-game renderer fixture; класс остаётся experimental для MVP |
| `ui-sprite` | layered/vector/raster source | PNG/nine-slice/font-independent layout data | GUI scale 2, 3 и 4; minimum и reference resolutions; `en_us` и `ru_ru` где есть текст |

Concept sheets и generic AI meshes являются входным evidence/blockout, а не release-ready runtime assets. Compound asset получает отдельный candidate на каждый независимо изменяемый runtime asset; общий approval возможен только как manifest, перечисляющий hashes всех дочерних candidates.

## 2. Предусловия review

До оценки должны быть зафиксированы:

- `assetId`, `assetClass`, назначение и gameplay contexts;
- target Minecraft/loader/runtime/renderer versions;
- ArtSpec version и SHA-256, включая palette, resolution, texel density, lighting, silhouette и performance budgets;
- candidate manifest с ArtSpec SHA-256 и SHA-256 всех editable/runtime files, `qa/technical.json`, `qa/provenance.json` и обязательных captures из `qa/previews/` и `qa/in-game/`;
- список применимых критериев из этой rubric.

Нет ArtSpec или target matrix — blocker `ART_SPEC_MISSING`; reviewer не должен подставлять молчаливые вкусовые предпочтения вместо отсутствующего контракта.

## 3. Evidence bundle

Рекомендуемая целевая структура (формат ещё не генерируется инструментом):

```text
<assetId>/
  source/                 editable source and permitted references
  runtime/                exact files proposed for release
  qa/candidate.json       identity, versions and SHA-256 manifest for source/runtime/pre-review evidence
  qa/technical.json       checks, commands/tools and measured budgets
  qa/provenance.json      origin, providers, references and licenses
  qa/scorecard.json       applicability, ratings, scores and diagnostics
  qa/approval.json        human decision bound to candidate manifest and scorecard hashes
  qa/previews/            lossless review captures
  qa/in-game/             lossless captures plus environment metadata
```

Evidence связывается без циклических hashes в строгом порядке:

1. Сначала фиксируются editable/runtime files, `qa/technical.json`, `qa/provenance.json` и обязательные captures. Эти записи не ссылаются на ещё не созданные scorecard или approval.
2. `qa/candidate.json` фиксирует ArtSpec hash и hashes всех файлов из пункта 1; собственный hash и более поздние `qa/scorecard.json`/`qa/approval.json` в него не входят.
3. `qa/scorecard.json` фиксирует SHA-256 неизменяемого `qa/candidate.json`, ratings, evidence references и решение до human approval; scorecard не содержит собственного hash.
4. `qa/approval.json` фиксирует SHA-256 `qa/candidate.json` и `qa/scorecard.json`, а также human decision. Сам approval не входит в утверждаемую им цепочку.

Замена любого связанного source/runtime/evidence файла меняет candidate manifest; замена scorecard меняет его hash. В обоих случаях существующий approval больше не применим.

Минимальный bundle содержит:

1. Editable source и все runtime outputs, либо явное объяснение допустимого отсутствия editable source.
2. SHA-256 каждого editable/runtime/evidence файла и ArtSpec в candidate manifest; SHA-256 самого candidate manifest в scorecard и approval; SHA-256 scorecard в approval.
3. Technical report: parser/export results, resource-reference resolution, geometry/UV/texture/rig/animation stats и сравнение каждого budget с ArtSpec.
4. Neutral preview: прозрачный/нейтральный фон без фильтров, не скрывающий silhouette и seams. Для 3D — front/back/left/right/top/bottom и две three-quarter views.
5. In-game captures из точной target matrix с Minecraft/loader/mod/renderer versions, resolution, GUI scale, graphics settings, lighting/context и camera distance.
6. Provenance: author mode (`manual`, `ai`, `mixed`), tool/provider/model/version, prompt и negative prompt без секретов, seed если существует, timestamps, references, licenses/terms snapshot URLs, editable/runtime hashes и repair history.
7. Scorecard, привязанный к candidate manifest hash, с evidence-ссылкой и кратким rationale для каждого rating и каждого `N/A`.
8. Human approval record, привязанный к rubric version, ArtSpec hash, candidate manifest hash и scorecard hash.

Скриншоты должны быть lossless PNG без beauty-filter, generative fill или постобработки, кроме зафиксированного crop. Дополнительные marketing renders допустимы, но не заменяют neutral и in-game evidence.

## 4. Hard blockers

Любой hard blocker запрещает `APPROVED` независимо от суммы баллов. Пока formal review ещё не запрошен (`reviewRequested: false`), незавершённый candidate остаётся `DRAFT`, даже если предварительная проверка уже показывает отсутствующий evidence. После запроса review (`reviewRequested: true`) исправимый blocker или threshold failure однозначно переводит candidate в `NEEDS_REPAIR`; после изменения связанного файла создаётся новый candidate и проводится review заново. `REJECTED` устанавливается только явным terminal decision уполномоченного человека, когда candidate прекращают исправлять или применимые права/ограничения принципиально не позволяют release; validator не устанавливает `REJECTED` автоматически.

| Diagnostic ID | Условие блокировки |
|---|---|
| `ART_EVIDENCE_MISSING` | Отсутствует обязательный файл, capture, environment metadata, hash или rationale. |
| `ART_SPEC_MISSING` | Нет применимого ArtSpec, target matrix или budget для класса. |
| `ART_HASH_MISMATCH` | Файл не совпадает с hash в candidate/approval или approval относится к другой версии. |
| `ART_FORMAT_INVALID` | Runtime codec не парсится целевым loader/runtime либо содержит NaN/invalid values. |
| `ART_RESOURCE_REFERENCE_INVALID` | Model, texture, animation, bone, material, namespace или runtime binding ссылается на отсутствующий/неверный ресурс. |
| `ART_BUDGET_EXCEEDED` | Cube/bone/triangle/keyframe/texture-memory/atlas budget превышен без заранее принятого исключения в ArtSpec. |
| `ART_GEOMETRY_INVALID` | Есть zero-size faces, запрещённые transforms/pivots, invalid normals/non-manifold geometry для применимого mesh codec или неприемлемый collision/hitbox. |
| `ART_UV_INVALID` | UV выходит за разрешённую область, нарушает declared overlap/padding/texel-density policy либо создаёт подтверждённый bleed/seam defect. |
| `ART_TEXTURE_INVALID` | Texture не декодируется, имеет неверные dimensions/alpha mode/palette policy, отсутствует или нарушает class profile ArtSpec. |
| `ART_RIG_ANIMATION_INVALID` | Не существует bone reference, loop/duration/root-motion policy нарушена, animation содержит invalid transforms или gameplay-significant event не совпадает с server event. |
| `ART_RUNTIME_SMOKE_FAILED` | Candidate не загружается либо вызывает error/crash в обязательном client/in-game fixture. |
| `ART_MISSING_TEXTURE_VISIBLE` | В обязательном capture виден missing-texture/material fallback или незапланированная invisible geometry. |
| `ART_PROVENANCE_INCOMPLETE` | Нельзя установить происхождение source/output, provider/model/version, references или repair history. |
| `ART_LICENSE_UNRESOLVED` | License/provider terms/redistribution status обязательного компонента неизвестны, несовместимы или не подтверждены evidence. |
| `ART_REFERENCE_RIGHTS_UNRESOLVED` | Внешний reference не имеет зафиксированного источника и основания использования; прямое копирование Minecraft/чужого mod asset не разрешено. |
| `ART_SECRET_EXPOSED` | Prompt, metadata, screenshot или source содержит credential/token/private secret. |

Validator может добавлять более узкие identifiers, но не должен заменять hard error общим `ART_VALIDATION_FAILED`, если причина известна.

### 4.1. Pending human approval

`ART_HUMAN_APPROVAL_MISSING` является fail-closed release-gate diagnostic, но не дефектом candidate и не основанием автоматически ставить `NEEDS_REPAIR` или `REJECTED`. Если hard blockers и threshold failures отсутствуют, candidate без human decision остаётся `DRAFT` с `ART_REVIEW_REQUIRED` и `ART_HUMAN_APPROVAL_MISSING`; package/release для него запрещён. После действительного approval для точных candidate manifest и scorecard hashes оба diagnostics снимаются.

## 5. Система баллов

Каждый применимый критерий получает rating `0..4`:

| Rating | Якорь оценки |
|---:|---|
| 0 | Evidence отсутствует или результат сломан; обычно одновременно hard blocker. |
| 1 | Крупные заметные дефекты; необходима существенная переделка. |
| 2 | Функционально, но дефекты регулярно заметны в обязательном контексте. |
| 3 | Release-quality: цель выполнена, остаются только небольшие локальные замечания. |
| 4 | Убедительно во всех обязательных контекстах, без замечаний; evidence показывает запас по budget/robustness. |

`N/A` разрешён только если таблица класса/ArtSpec делает критерий неприменимым. Reviewer обязан записать reason; generating agent не может самостоятельно убрать неудобный критерий.

Для категории:

```text
categoryScore = categoryMax × Σ(rating × weight) / (4 × Σ(applicable weight))
```

Сначала считается каждая категория, затем округляется до 0,1. Total — сумма четырёх category scores.

### 5.1. Technical correctness — 30

| ID | Вес | Что оценивается | Evidence |
|---|---:|---|---|
| `T1_FORMAT_REFERENCES` | 7 | Декодирование/export, namespaced paths, все runtime references и loader bindings | parser/export log и reference graph |
| `T2_GEOMETRY_UV_TEXTURE` | 7 | Geometry, pivots/transforms, UV bounds/padding/texel density, texture dimensions/alpha/palette | measured stats, UV sheet, close captures |
| `T3_RIG_ANIMATION` | 5 | Semantic bones, valid clips/loops, sparse stable keyframes, root-motion/event policy | rig/clip report и playback captures; `N/A` для неанимированных классов |
| `T4_PERFORMANCE_BUDGET` | 6 | Cubes/bones/triangles/keyframes/texture memory/LOD против ArtSpec | actual/limit table, target hardware/renderer context |
| `T5_SOURCE_RUNTIME_PARITY` | 5 | Editable source сохранён; export воспроизводим; runtime соответствует утверждённому source | source/output hashes и повторный export diff |

Minimum: **27,0 / 30**.

### 5.2. Visual quality — 30

| ID | Вес | Что оценивается | Evidence |
|---|---:|---|---|
| `V1_SILHOUETTE_READABILITY` | 8 | Силуэт и gameplay role читаются при 32/64 px preview и типичной игровой дистанции | downscaled silhouette и in-game distance captures |
| `V2_STYLE_PALETTE_MATERIAL` | 7 | Соответствие style family, palette/value hierarchy, lighting direction и material recipes ArtSpec | palette report и comparison sheet |
| `V3_SURFACE_COHERENCE` | 6 | Нет заметных seams/bleed/noisy detail; стороны, highlights, AO и texel density согласованы | neutral turntable и close views |
| `V4_MOTION_STATE_POLISH` | 5 | Poses, loops, transitions и visual states ясны, не дрожат и не скользят чрезмерно | clip captures; `N/A` при отсутствии motion/variants |
| `V5_SET_CONSISTENCY` | 4 | Asset не выглядит случайно чужим относительно утверждённой project library и запрещённых клише | side-by-side с approved reference set |

Minimum: **24,0 / 30**.

### 5.3. In-game fitness — 25

| ID | Вес | Что оценивается | Evidence |
|---|---:|---|---|
| `G1_RENDER_CONTEXTS` | 7 | Корректная загрузка и rendering во всех обязательных contexts, без missing/invisible fallback | client log и class-specific capture matrix |
| `G2_LIGHTING_DISTANCE` | 6 | Читаемость при daylight/night/interior и near/mid/far там, где применимо | одинаковые camera presets и unfiltered PNG |
| `G3_GUI_INVENTORY` | 5 | Inventory/icon/UI читаются на обязательных GUI scales/resolutions, glint не разрушает силуэт, текст не обрезан | inventory/UI matrix; `N/A` только для classes без GUI context |
| `G4_GAMEPLAY_TIMING` | 4 | Attack/summon/interaction visual event синхронизирован с подтверждённым gameplay/server event | timestamped capture/test evidence; `N/A` без event-driven visual state |
| `G5_TARGET_MATRIX_STABILITY` | 3 | Результат стабилен на заявленной renderer/graphics/localization matrix и не зависит от debug-only state | environment manifest и повторные captures |

Minimum: **21,0 / 25**.

### 5.4. Provenance and reviewability — 15

| ID | Вес | Что оценивается | Evidence |
|---|---:|---|---|
| `P1_IDENTITY_REPRODUCIBILITY` | 5 | Полные hashes, timestamps, tool versions и воспроизводимая связь source → runtime | candidate manifest и repeat-export record |
| `P2_GENERATION_HISTORY` | 4 | Author mode, provider/model/version, prompt/negative prompt/seed и repair history достаточно подробны для аудита | provenance record без секретов |
| `P3_RIGHTS_EVIDENCE` | 4 | Для references, providers, fonts и components есть source/license/terms evidence и redistribution decision | versioned URLs/snapshots и reviewer note |
| `P4_REVIEW_TRACE` | 2 | Diagnostics, score rationale, decisions и superseded approvals прослеживаются | scorecard и approval history |

Minimum: **13,0 / 15**.

## 6. Решение release gate

Candidate получает `APPROVED` только одновременно при выполнении всех условий:

- hard blockers отсутствуют;
- total score **не ниже 85,0 / 100**;
- выполнены minimum каждой категории;
- все обязательные captures и target contexts представлены;
- уполномоченный human approver подписал точные hashes.

Высокий total не компенсирует провал категории. Состояние вычисляется в следующем приоритетном порядке:

1. `SUPERSEDED` — ранее утверждённый candidate изменился или сработал re-review trigger.
2. `REJECTED` — уполномоченный человек принял явное terminal decision прекратить candidate; validator не выбирает этот статус автоматически.
3. `DRAFT` — `reviewRequested: false`, поэтому evidence ещё может собираться; предварительные diagnostics блокируют release, но не переводят draft в другое состояние.
4. `NEEDS_REPAIR` — `reviewRequested: true` и существует хотя бы один исправимый hard blocker или threshold failure.
5. `DRAFT` — review пройден без blocker/threshold failure, но human approval для точных candidate manifest и scorecard hashes ещё не получен.
6. `APPROVED` — review пройден, и действительный human approval разрешает candidate только для указанной target matrix.

`reviewRequested` фиксируется в scorecard и после первого formal review не возвращается в `false` для того же candidate hash. Таким образом, неполный pre-review draft и уже проверенный candidate, требующий ремонта, не могут одновременно соответствовать двум состояниям.

Exception к budget допускается только до review: оно записывается в versioned ArtSpec с причиной, новым пределом, owner и target impact. Reviewer не может задним числом игнорировать превышение.

## 7. Минимальная capture matrix по классу

| Класс | Neutral evidence | In-game evidence |
|---|---|---|
| `item-icon` | native size, 2×/4× nearest-neighbor, alpha checkerboard | inventory normal/selected, hand/ground если применимо, enchanted glint если разрешён |
| `cuboid-model` | 8-view turntable, UV sheet, close seam views | inventory и placed views; daylight/night/interior; near/mid distance |
| `animated-model` | 8-view turntable; key poses каждого clip | idle и каждый gameplay-significant clip; near/mid distance; daylight/night/interior; timing evidence |
| `structure` | orthographic elevations, palette/material sheet | placed fixture; exterior near/mid/far; interior и night при наличии |
| `decorative-mesh` | 8-view turntable, wireframe/LOD/UV evidence | target renderer fixture; near/mid/far; worst-case lighting; LOD transitions |
| `ui-sprite` | source atlas/nine-slice bounds | GUI scale 2/3/4; minimum/reference resolutions; `en_us`/`ru_ru`; hover/disabled/error states где применимо |

Если ArtSpec требует дополнительные contexts, они обязательны. Если класс не имеет указанного context, scorecard должен содержать утверждённый `N/A` rationale.

## 8. Human approval

Approver — названный человек со release authority, назначенный product owner. AI-модель, critique agent или validator не может быть approver. В маленькой команде human author может выполнить review, но должен явно записать self-review; независимый art/QA review рекомендуется, а для commercial release со спорными правами требуется отдельная профильная проверка.

Approval record содержит:

- approver name/stable identity и роль;
- UTC timestamp;
- rubric version и ArtSpec SHA-256;
- candidate manifest SHA-256 и scorecard SHA-256;
- hashes всех runtime outputs через связанный candidate manifest;
- category scores, total и список diagnostics, точно совпадающие со связанным scorecard, а также final status;
- краткое rationale и известные ограничения target matrix.

Approval становится `SUPERSEDED`, и нужен полный или целевой re-review, если произошло хотя бы одно:

- изменился editable/runtime file hash, export setting или resource binding;
- изменились ArtSpec, rubric, texture resolution, palette, geometry, UV, rig, animation или performance budget;
- изменилась target Minecraft/loader/renderer version либо обязательная compatibility matrix;
- изменились provider/model/version, license/terms, reference или redistribution decision;
- изменился hash любого связанного technical/provenance/capture evidence либо candidate manifest/scorecard;
- screenshot diff или ручная проверка обнаружили визуальное изменение вне заранее утверждённого tolerance;
- GameTest/client smoke/regression report выявил связанный дефект;
- выяснилась новая информация о provenance, правах, товарном знаке или наличии секрета.

Byte-identical regeneration с теми же environment/tool hashes не требует новой художественной оценки, но повторная verification hashes обязательна.

## 9. Machine-readable diagnostic contract

Целевой diagnostic record:

```json
{
  "schemaVersion": 0,
  "rubricVersion": "0.1.0",
  "assetId": "example:asset",
  "candidateManifestSha256": "<64 lowercase hex>",
  "reviewRequested": false,
  "diagnostics": [
    {
      "id": "ART_UV_INVALID",
      "severity": "error",
      "artifact": "runtime/example.png",
      "evidence": "qa/technical.json#/uv/checks/3",
      "message": "Human-readable, actionable explanation",
      "expected": "Declared ArtSpec constraint",
      "actual": "Measured value"
    }
  ],
  "scores": {
    "technical": 0.0,
    "visual": 0.0,
    "inGame": 0.0,
    "provenance": 0.0,
    "total": 0.0
  },
  "decision": "DRAFT"
}
```

Требования к diagnostics:

- `id` — стабильный identifier из этой rubric или документированное более узкое расширение;
- `severity` — `error`, `warning` или `info`; все hard blockers имеют `error`;
- `artifact` и `evidence` указывают точное место, а не только asset целиком;
- `message` объясняет исправление человеку; решения нельзя принимать парсингом свободного текста;
- machine output не устанавливает `APPROVED` или `REJECTED`: final human decision хранится отдельно.

Дополнительные gate/threshold diagnostics:

- `ART_SCORE_TOTAL_BELOW_THRESHOLD`;
- `ART_SCORE_TECHNICAL_BELOW_THRESHOLD`;
- `ART_SCORE_VISUAL_BELOW_THRESHOLD`;
- `ART_SCORE_INGAME_BELOW_THRESHOLD`;
- `ART_SCORE_PROVENANCE_BELOW_THRESHOLD`;
- `ART_REVIEW_REQUIRED`;
- `ART_HUMAN_APPROVAL_MISSING`;
- `ART_APPROVAL_SUPERSEDED`.

## 10. Definition of done для автоматизации rubric

Rubric можно считать реализованной в продукте только когда:

- JSON Schemas для candidate, technical, provenance, scorecard и approval records versioned и имеют negative tests;
- validators действительно измеряют заявленные технические constraints и публикуют diagnostics выше;
- fixture captures воспроизводятся на pinned target matrix;
- score calculator проверен golden tests, включая `N/A` normalization и rounding;
- approval невозможно применить к несовпадающему candidate manifest или scorecard hash;
- release command fail-closed при blocker, недостаточном score или отсутствующем human approval.

До выполнения этих пунктов release review по v0 является ручным и должен так называться в отчёте.
