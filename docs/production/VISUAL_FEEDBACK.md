# Визуальная обратная связь агента

Пункт 037 подтверждает технический цикл: PNG текущей revision → конкретное замечание агента → правка через preview/apply → новые PNG. Это не художественная приёмка модели и не доказательство роста оценки benchmark.

## Что получает агент

`studio_model_review(projectId, expectedRevision)` возвращает MCP image с четырьмя видами: front, side/right, back, perspective. В том же PNG находятся front silhouette и миниатюры перспективы 32/64 px. Metadata содержит projectId/revision, список видов и `requires-human-review` / `not-verified`. Модель получает изображение, а не только описание или число кубов.

Capture рендерит snapshot в отдельном скрытом окне. Он не меняет проект, выделение или ручную камеру. При несовпадении revision запрос отвергается. Miniature создаётся из квадратного offscreen 3D-рендера, 32 px уменьшается без сглаживания; silhouette использует alpha mask фронта. Проверки packaged desktop измеряют реальные pixels, размеры и общий camera target, а не только наличие DOM или поле metadata.

`studio_view_capture` дополняет обзор восемью индивидуальными видами и позволяет отдельно снять силуэт. Быстрый combined review остаётся четырёхсторонним. Он не заменяет обязательные остальные виды или игровой screenshot.

## Проверяемый рабочий цикл

1. Прочитать сцену, projectId/revision и защищённые части.
2. После blockout получить `studio_model_review` этой revision.
3. Описать видимый дефект, его место и ожидаемый эффект исправления. Например: «квадратный верх лезвия → повернуть blade_crown вокруг pivot → убрать прямоугольный силуэт».
4. Передать ограниченные команды в `studio_changes_preview`, затем применить конкретный proposal. Если человек успел изменить сцену, перечитать state и пересчитать правку после CAS rejection.
5. Получить PNG новой revision. После последней правки обновить review; снимок прежней revision не подтверждает финальную сцену.
6. Выполнить technical validation и export, сохранив статус художественной и игровой проверки открытым.

Нельзя использовать cube count, корректный JSON или технический PASS как оценку красоты. Сохранение всех ранее принятых ручных деталей и формальный лимит итераций являются отдельными gates 038/039/040. Watchdog независимого CLI harness ограничивает только его тестовый процесс.

## Фактическое доказательство

В установленном Codex CLI 0.160.0 агент получил review revision 3 (`item_16`). Следующее сообщение (`item_17`) указало прямоугольную лопасть, квадратные уступы кромки и гладкую рукоять. После него последовали preview/apply (`item_18`/`item_19`): реальные pivot/rotation/transform лезвия и новые детали. Review revision 4 (`item_20`) выполнен после apply. Replay подтверждает изменившуюся геометрию.

После front/back/perspective PNG revision 6 агент указал тёмную грань возле кромки и зубчатый блик кристалла (`item_35`). Texture plan изменился; review revision 7 (`item_39`) показывает результат. Финальная revision 9 имеет новый combined review (`item_49`) и все восемь индивидуальных видов. Exact final project воспроизводится только из MCP mutations; экспорт соответствует ему.

Проверены bytes/SHA-256 исходных PNG и порядок событий. Root-agent посмотрел оригинальные blockout/final изображения: наклонные сегменты и швы обмотки действительно видны. Мы проверяем сообщение агента и последующие изменения; внутренние причины его решения не измеряются. Human art approval и Minecraft acceptance не присвоены.

Исправленный Claude collector дополнительно сохранил combined reviews revisions 5/7/8 и final front/back/perspective revision 8. Его технический сеанс и native export подробно описаны отдельно: [Claude session](INDEPENDENT_CLAUDE_SESSION.md).

[Доказательство самостоятельного Codex](INDEPENDENT_CODEX_SESSION.md), [camera protocol](MODEL_CAMERAS.md), [точные данные пункта 037](evidence/visual-feedback-037.json).

## Packaged проверка

Hosted Windows job [`111722133851`](https://github.com/Zulut30/minemod/actions/runs/37294506792/job/111722133851), attempt 2, завершил полный packaged suite по source `fa1d871`. Review проверил native square 64 px, nearest 32 px, alpha silhouette, общий framing, read-only scene/manual camera и project conflict rejection. Это отдельное доказательство rendering/transport; actual installed-client image/critique/repair trace проверен выше. Общий workflow failed на сохранённой legacy Fabric 26.2 checksum проверке.
