# Предварительная ведомость художественного ревью

Пункт 049 остаётся открыт. Реализованы bounded контракты candidate/scorecard, расчёт предложенных оценок и сравнение переданных файлов с manifest. Это основа formal review, без trusted human decision, persistent истории или разрешения package/publish.

`packages/assets-contracts/art-review.ts` фиксирует все 19 критериев rubric 0.1.0: T1–T5, V1–V5, G1–G5, P1–P4. Таблицы весов и порогов неизменяемы. Strict records отвергают неизвестные поля, включая `actor`, `approval` и `approved`. Каждая ведомость содержит ровно одну запись каждого критерия. Оценка 0–4 требует rationale и evidence-ссылок; отсутствие оценки записывается явно как `not-rated`.

## Расчёт и идентичность

`previewArtScorecard(candidatePayload, scorecardPayload)` сравнивает SHA-256 точных UTF-8 bytes candidate с ведомостью, а также ArtSpec/rubric hashes между документами. Форматирование candidate тоже меняет идентичность; канонизация или незаметная миграция не выполняется. Scorecard получает собственный SHA-256. Manifest исключает себя, scorecard и approval из списка файлов, сохраняя направленную цепочку hashes.

Категории считаются по существующей rubric, округляются до 0,1, затем суммируются. Например, все ratings=3 дают 22,5 / 22,5 / 18,8 / 11,3 и total 75,1. Total 93 при technical 23 также не проходит: высокая общая сумма не компенсирует минимум категории. Это числа из тестовых предложений, не оценка «Листа» человеком.

`not-applicable-requested` сохраняет rationale и evidence, но **не исключает вес** из знаменателя: без подтверждённой применимости такое предложение даёт нулевой вклад и diagnostic `ART_NA_REVIEW_REQUIRED`. Это консервативная нижняя оценка для неполной ведомости. Нормализация по подтверждённым человеческим N/A пока не реализована; её нельзя подменять повышением остальных баллов.

Preview различает `DRAFT` и `NEEDS_REPAIR` по `reviewRequested`, отсутствующим оценкам/ссылкам/ролям, предложенным blockers и category/total thresholds. Поле `decisionScope` явно обозначает предварительный неперсистентный статус. Даже предложение 100/100 остаётся `DRAFT`, содержит `ART_REVIEW_REQUIRED` / `ART_HUMAN_APPROVAL_MISSING` и всегда имеет `releaseEligible: false`. Формальные `APPROVED`, `REJECTED`, `SUPERSEDED` и запрет возврата `reviewRequested` пока не реализованы этим API.

## Проверка bytes и границ

`verifyArtCandidateContents(candidatePayload, contents)` проверяет точный набор logical paths, размер и SHA-256 каждого переданного `Uint8Array`; повторения, подмена и отсутствующие файлы отклоняются. Paths не читаются с диска и не исполняются. Функция подтверждает только целостность переданных bytes, сохраняя `artisticApproval: NOT_PERFORMED`.

Один JSON document ограничен 65536 UTF-8 bytes, 4096 nodes, depth 12 и 64 элементами контейнера. Manifest содержит до 64 файлов, каждый до 8 MiB, суммарно до 32 MiB; target matrix — до четырёх записей. Paths допускают только относительные `source/`, `runtime/`, `qa/`, без traversal, Windows reserved names, ADS и циклических review files. JSON Schemas описывают transport shape; refinements и общий бюджет дополнительно проверяет код, их нельзя считать автоматически представленными в JSON Schema.

Ссылки на ArtSpec, rubric, technical/provenance и captures сейчас проверяются по declared hashes/roles, а не по смыслу evidence. Полный codec/budget/rights validator, проверка ArtSpec bytes и target-context matrix, trusted approval validation, подтверждённые N/A, persistent review transitions и интеграция release gate остаются необходимыми следующими частями 049. Этот API не добавлен в MCP и не расширяет права агента.

## Проверки

Contract tests проверяют strict fields, 19 уникальных criteria, числовые границы, безопасные пути, manifest roles и malformed records. Core tests проверяют weighted/rounded golden scores, провал категории при high total, неподтверждённый N/A, draft/repair, exact-byte drift, отсутствующие ссылки, подмену и повторные content files, JSON limits и отказ от forged approval. Portable package suite проверяет существующие exporters вместе с новым модулем. GameTests не являются художественной приёмкой ведомости.

Read-only проверка сохранённого «Листа» в `output/model-editor/art-review-049-leaf-b3e3a226/` связала 17 существующих файлов: неизменённый C, ArtSpec/rubric, четыре исторических export files, technical/density reports и восемь neutral PNG. Bytes каждого файла проверены до и после сценария. Все 19 критериев явно `not-rated`; нулевой вклад не является художественной оценкой модели. Отсутствуют provenance и in-game evidence: предварительный draft остаётся `DRAFT`, тестовое включение `reviewRequested` возвращает `NEEDS_REPAIR`. Реальный formal review не запускался, input и export files не менялись, approval не создан.

При разработке сверены [Zod strict schemas](https://zod.dev/api), JSON Schema limitations через Context7 и [Node SHA-256 API](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options). Проверки используют закреплённые Zod 4.4.2 / Node 24.21.0; новые зависимости не добавлены.
