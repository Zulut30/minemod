# Предварительная ведомость художественного ревью

Пункт 049 остаётся открыт. Реализованы bounded контракты candidate/scorecard, расчёт предложенных оценок, сравнение переданных файлов с manifest, проверка реального ArtSpec и сохраняемая история черновиков. Studio 0.23 подключает подготовку материалов к вкладке «Обзор». Trusted human decision и разрешение package/publish ещё не реализованы.

`packages/assets-contracts/art-review.ts` фиксирует все 19 критериев rubric 0.1.0: T1–T5, V1–V5, G1–G5, P1–P4. Таблицы весов и порогов неизменяемы. Strict records отвергают неизвестные поля, включая `actor`, `approval` и `approved`. Каждая ведомость содержит ровно одну запись каждого критерия. Оценка 0–4 требует rationale и evidence-ссылок; отсутствие оценки записывается явно как `not-rated`.

## Расчёт и идентичность

`previewArtScorecard(candidatePayload, scorecardPayload)` сравнивает SHA-256 точных UTF-8 bytes candidate с ведомостью, а также ArtSpec/rubric hashes между документами. Форматирование candidate тоже меняет идентичность; канонизация или незаметная миграция не выполняется. Scorecard получает собственный SHA-256. Manifest исключает себя, scorecard и approval из списка файлов, сохраняя направленную цепочку hashes.

Категории считаются по существующей rubric, округляются до 0,1, затем суммируются. Например, все ratings=3 дают 22,5 / 22,5 / 18,8 / 11,3 и total 75,1. Total 93 при technical 23 также не проходит: высокая общая сумма не компенсирует минимум категории. Это числа из тестовых предложений, не оценка «Листа» человеком.

`not-applicable-requested` сохраняет rationale и evidence, но **не исключает вес** из знаменателя: без подтверждённой применимости такое предложение даёт нулевой вклад и diagnostic `ART_NA_REVIEW_REQUIRED`. Это консервативная нижняя оценка для неполной ведомости. Нормализация по подтверждённым человеческим N/A пока не реализована; её нельзя подменять повышением остальных баллов.

Preview различает `DRAFT` и `NEEDS_REPAIR` по `reviewRequested`, отсутствующим оценкам/ссылкам/ролям, предложенным blockers и category/total thresholds. Поле `decisionScope` явно обозначает предварительный неперсистентный статус. Даже предложение 100/100 остаётся `DRAFT`, содержит `ART_REVIEW_REQUIRED` / `ART_HUMAN_APPROVAL_MISSING` и всегда имеет `releaseEligible: false`. Формальные `APPROVED`, `REJECTED`, `SUPERSEDED` и запрет возврата `reviewRequested` пока не реализованы этим API.

## Проверка bytes и границ

`verifyArtCandidateContents(candidatePayload, contents)` проверяет точный набор logical paths, размер и SHA-256 каждого переданного `Uint8Array`; повторения, подмена и отсутствующие файлы отклоняются. Paths не читаются с диска и не исполняются. Функция подтверждает только целостность переданных bytes, сохраняя `artisticApproval: NOT_PERFORMED`.

Один JSON document ограничен 65536 UTF-8 bytes, 4096 nodes, depth 12 и 64 элементами контейнера. Manifest содержит до 64 файлов, каждый до 8 MiB, суммарно до 32 MiB; target matrix — до четырёх записей. Paths допускают только относительные `source/`, `runtime/`, `qa/`, без traversal, Windows reserved names, ADS и циклических review files. JSON Schemas описывают transport shape; refinements и общий бюджет дополнительно проверяет код, их нельзя считать автоматически представленными в JSON Schema.

Core preview проверяет declared hashes/roles. Application `inspectArtReviewInputs` дополнительно проверяет реальные ArtSpec/rubric bytes, source descriptors и семантическую валидность ArtSpec существующим validator. Asset ID, класс и полная ordered target matrix должны совпадать, включая runtime и renderer. Проверка rubric bytes не удостоверяет её автора; числовая policy остаётся compiled table 0.1.0. Соответствие фактической модели бюджетам и контекстам задания этим API не измеряется.

Полный codec/budget/rights validator, trusted approval validation, подтверждённые N/A, formal review transitions и интеграция release gate остаются необходимыми следующими частями 049. Core preview и application history не добавлены в MCP и не расширяют права агента.

## Подготовка в Studio 0.23

Вкладка «Обзор» содержит свёрнутую панель «Материалы арт-проверки». Пользователь выбирает ArtSpec JSON через локальный диалог. Сначала проверяется экспорт native Fabric 1.20.1 item, затем private Electron renderer создаёт восемь PNG 1024×768: front/back/left/right/top/bottom/perspective/rear-perspective. Подготовка сохраняет текущую сцену в private recovery без изменения геометрии, рисунка, исходного файла или revision; защищённая recovery сохраняет существующий запрет перезаписи.

Snapshot содержит 17 файлов: editor source, ArtSpec, shipped rubric, четыре файла AssetBundle v1, export manifest, техническую ведомость и восемь снимков. Actual bytes всех файлов сравниваются с candidate manifest. Техническая ведомость фиксирует проверенный exporter/texture codec и лишь bounded PNG header check для captures; полное декодирование всех восьми PNG выполняет desktop-сценарий. Ведомость явно сохраняет `modelMeasurements: NOT_RUN`, `inGame: NOT_RUN`, `artisticApproval: NOT_PERFORMED`. Подготовитель принимает только один native item target Fabric 1.20.1 / Loader 0.19.3 / Java 17; unsupported и дополнительные targets отклоняются до captures. Даже принятый target не подтверждает работу в игре.

Все 19 criteria первоначально `not-rated`; интерфейс показывает число критериев без оценки, не художественный балл 0. Реальный ID берётся из экспортируемой модели. Несовпадающий ArtSpec ID отображается как замечание без переименования модели. «Запросить проверку» сохраняет локальный запрос; внешние сообщения не отправляются. Отсутствующие оценки, provenance и игровые evidence дают `NEEDS_REPAIR`, всегда `releaseEligible: false`.

Private IPC принимает только `get`, `prepare`, `request`. Для подготовки и запроса нужны project ID/revision, для запроса — текущий history head. Arbitrary paths, `approve`, `approval` и дополнительные поля запрещены; путь ArtSpec приходит только от main-process диалога. MCP inventory сохраняет 11 tools и не содержит review/approval capabilities.

## История черновиков

`ArtReviewDraftHistory` сохраняет immutable последовательные files с цепочкой SHA-256. Exclusive staging, sync и публикация hard link без перезаписи занятой позиции дают CAS: два writer с одним expected head не могут занять один следующий slot. Повреждённые записи, пропуски, неизвестные поля, symlinks, некорректные даты/UTF-8 и подмена candidate отклоняются; исходные данные сохраняются. После `reviewRequested: true` библиотека запрещает возврат в false для тех же candidate bytes. Изменившаяся сцена требует новый snapshot.

Лимиты: 64 candidates, 32 events на candidate, 1 MiB на event, 8 MiB history на candidate и 8 pending names. Studio использует одну private queue; библиотечный CAS проверен также между двумя instances. Root-wide quotas между независимыми concurrent writers не являются транзакционной гарантией этой библиотеки. История — обычные local files, не подпись человека и не защита от владельца файловой системы, способного заменить всю цепочку. `APPROVED`, `REJECTED`, `SUPERSEDED` и authority для release пока отсутствуют.

## Проверки

Contract tests проверяют strict fields, 19 уникальных criteria, числовые границы, безопасные пути, manifest roles и malformed records. Core tests проверяют weighted/rounded golden scores, провал категории при high total, неподтверждённый N/A, draft/repair, exact-byte drift, отсутствующие ссылки, подмену и повторные content files, JSON limits и отказ от forged approval. Portable package suite проверяет существующие exporters вместе с новым модулем. GameTests не являются художественной приёмкой ведомости.

Read-only проверка сохранённого «Листа» в `output/model-editor/art-review-049-leaf-b3e3a226/` связала 17 существующих файлов: неизменённый C, ArtSpec/rubric, четыре исторических export files, technical/density reports и восемь neutral PNG. Bytes каждого файла проверены до и после сценария. Все 19 критериев явно `not-rated`; нулевой вклад не является художественной оценкой модели. Отсутствуют provenance и in-game evidence: предварительный draft остаётся `DRAFT`, тестовое включение `reviewRequested` возвращает `NEEDS_REPAIR`. Реальный formal review не запускался, input и export files не менялись, approval не создан.

Application tests проверяют реальные ArtSpec/rubric bindings, strict semantic validation, actual exporter byte parity, требование восьми captures, restart, concurrent CAS, неизменяемость caller snapshot, сохранение corruption, request monotonicity и limits. Desktop-сценарий проверяет фактический packaged UI, 17 files, декодирование восьми PNG, сохранение сцены/ArtSpec, stale head, повреждённый capture, restart и отказ старого snapshot после изменения сцены. Художественная и игровая приёмка «Листа» этими проверками не производится.

При разработке сверены [Zod strict schemas](https://zod.dev/api), [Node filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html) через Context7 и [Electron IPC security](https://www.electronjs.org/docs/latest/tutorial/security). Проверки используют закреплённые Zod 4.4.2 / Node 24.21.0 / Electron 44.5.1. Добавлена только существующая внутренняя workspace dependency `@mcdev/validation` 0.0.0-phase.0 с Apache-2.0; новые внешние зависимости не добавлены.
