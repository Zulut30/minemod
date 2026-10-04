# MineMod Studio 0.5.0: подключение к общей сцене

Дополнение Studio 0.8.0: [точные геометрические правки](production/GEOMETRY_EDITING.md) добавляют в schema `pivot` и `snap` без новых shell/eval возможностей. Документ ниже сохраняет исторический scope 0.5; текущий target редактора остаётся held-item, игровой импорт не добавлен.

Дополнение Studio 0.9.0: [camera protocol](production/MODEL_CAMERAS.md) расширяет `studio_view_capture.view` до front/back/left/right/top/bottom/perspective/rear-perspective и совместимого `side = right`. Все виды ортографические. Fit и comparison учитывают поворот/pivot/inflate, а screenshots не меняют реальный orbit/pan/zoom пользователя. `studio_model_review` продолжает давать четыре быстрых вида; остальные снимаются отдельно.

Обновлено 4 октября 2026 года. Windows x64. MCP adapter и [чтение/сравнение вариантов](MODEL_EDITOR_VARIANTS.md) реализованы; полный пользовательский сценарий с самостоятельной генерацией установленными Codex и Claude Code ещё не принят. Это не игровой release.

## Подключение

1. Откройте проект в Studio и закрепите части, которые агент должен сохранить.
2. Нажмите «Подключить AI» сверху, затем «Включить подключение» в открывшейся части правой панели. Появится локальный адрес.
3. Раскройте «Настройка подключения», выберите клиент и скопируйте команды в PowerShell. Клиент должен быть установлен; для последующей работы модели требуется его обычный вход в аккаунт.
4. Запустите клиент из того же PowerShell, чтобы ему была доступна переменная `MINEMOD_STUDIO_TOKEN`.
5. Поручите агенту прочитать сцену и выделение, проверить правку, применить предложение и сделать снимки с нескольких сторон.

Команды в панели используют реальный адрес и временный ключ. Добавление сервера меняет конфигурацию выбранного CLI только когда пользователь выполняет команду; Studio её сама не меняет. Ключ и порт действуют до выключения доступа или закрытия приложения. После перезапуска повторите настройку; постоянное подключение без повторного ввода ключа ещё не реализовано.

Без секретного значения пример выглядит так:

```powershell
$env:MINEMOD_STUDIO_TOKEN='<ключ из Studio>'
codex mcp add minemod-studio --url http://127.0.0.1:<порт>/mcp --bearer-token-env-var MINEMOD_STUDIO_TOKEN
codex
```

```powershell
$env:MINEMOD_STUDIO_TOKEN='<ключ из Studio>'
claude mcp add --transport http minemod-studio http://127.0.0.1:<порт>/mcp --header 'Authorization: Bearer ${MINEMOD_STUDIO_TOKEN}'
claude
```

Для Claude одинарные кавычки сохраняют ссылку `${MINEMOD_STUDIO_TOKEN}` в конфигурации: её раскрывает клиент при подключении. Встроенный чат Studio пока отсутствует. Текущий уже запущенный чат автоматически новое подключение не получает.

## Что агент умеет

| Инструмент | Поведение |
|---|---|
| `studio_variant_inspect` | Один неизменяемый снимок для сравнения, по ID и текущей ревизии; пиксели опциональны |
| `studio_project_inspect` | Геометрия, UV, семантические части, закрепления, палитра и версия. `includeTexture: true` добавляет строки пикселей; обычно они не нужны для изменения формы |
| `studio_selection_get` | Ручное выделение в текущем проекте |
| `studio_changes_preview` | Проверка атомарного пакета команд в изолированной копии с сохранением правил истории. Возвращает краткий diff и `proposalId`; сцену не меняет |
| `studio_changes_apply` | Применение сохранённого предложения к его исходным project ID и revision; повтор не применяет действие дважды |
| `studio_history_undo` | Отмена последней правки агента, с UUID key и проверкой версии; ручная правка защищена |
| `studio_view_capture` | Настоящий PNG 1024×768: perspective/front/side/back, точный project ID и revision |
| `studio_model_review` | Единый PNG с четырьмя ракурсами, силуэтом и 32/64 px для визуального исправления модели |
| `studio_asset_validate` | Технический экспортный preflight. Художественный и игровой статус остаются неподтверждёнными |
| `studio_asset_export` | Minecraft JSON, PNG и `.bbmodel` в ограниченном bundle-ответе; без записи на диск или JAR-интеграции |

Закрытые команды: transform, recolor, rotate, add, duplicate, delete, undo/redo. Агент не может снять закрепление. Сохранение, создание и открытие проекта остаются в GUI: инструмента удалённой замены текущего документа в этой версии нет.

В версии 0.4 задание и краткий список вариантов приходят в `studio_project_inspect`. `studio_view_capture` дополнительно принимает `variantId`, `compareToVariantId` и `silhouette`; парные снимки используют одинаковое общее кадрирование. Управление заданием/вариантами — human-only команды, отказ агента `HUMAN_ONLY`. Рекомендованный цикл: прочитать задание и исходник → адресная правка → четыре ракурса → исправление конкретного дефекта. [Пример и ограничения](MODEL_EDITOR_VARIANTS.md).

Пример поручения:

> Прочитай сцену и текущее выделение. Сделай гарду немного шире и перекрась в холодное серебро, сохрани пиксельный рисунок. Не меняй закреплённые части. Сначала проверь команды через preview, затем примени предложение и получи perspective/front/side/back. Оцени силуэт и читаемость деталей, перечисли недостатки; работа в Minecraft пока не проверена.

`preview` пока возвращает технический diff, а не отдельный рендер будущего варианта. Снимки показывают уже применённую сцену; нежелательное действие можно отменить. Все части отображаются на снимке, даже если пользователь скрыл их в своём редакторе. Ручная камера, выделение и видимость от снимков не меняются.

## Границы и устройство

В 0.5 добавлен `studio_model_review`: один обзор четырёх сторон, силуэт и 32/64 px вместе с заданием и критериями просмотра. Его можно вызывать до правок и после каждого прохода, затем исправлять конкретный недостаток. Поддерживает снимки вариантов и общее кадрирование, проверяет ревизию, ограничивает весь ответ 2 MiB. [Порядок работы и авторский пример](MODEL_EDITOR_DARK_AND_REVIEW.md).

Один authoritative `EditorSession` в utility process обслуживает GUI и все HTTP-клиенты. Одна очередь сериализует ручные операции, агентные транзакции, recovery и снимки. Agent commit отправляет состояние в GUI; в истории есть пометка «AI». Устаревшее предложение возвращает `REVISION_CONFLICT`, смена проекта — `PROJECT_CONFLICT`. Прочитайте сцену заново и создайте новое предложение.

Доступ по умолчанию выключен. HTTP слушает только `127.0.0.1`, проверяет точный Host, присутствующий Origin и Bearer-ключ; CORS не включён. Используется stateless Streamable HTTP: транспорт создаётся для одного запроса, документ и предложения общие. Старый stdio MCP-сервер проекта не меняется.

Лимиты: запрос 262144 байта UTF-8, до 32 команд, 256 кубов, атлас 256×256 и 32 цвета; 64 предложения по 5 минут; 8 активных HTTP-запросов, 16 соединений и 120 POST/min. JSON-ответ до 2 MiB, base64 PNG до 2 MiB; один render job, deadline 12 s, окно рендера закрывается при отказе после 10 s. Request/header/socket timeout: 15/10/20 s. История — 50 операций, replay cache — 100 ключей. Истёкший proposal требует повторного preview.

Агент не получает shell, eval, произвольные URLs, пути сохранения, Java/Blender-код или установку dependencies. Ключ хранится в памяти, не попадает в проект, экспорт или recovery. При выключении новые и ожидающие в очереди MCP-команды отклоняются; уже завершённые изменения остаются в истории.

Снимок создаётся отдельным скрытым sandboxed BrowserWindow на локальном renderer, с теми же Three.js геометрией и текстурами. Это рендер собственного приложения; OS desktop capture, Computer Use и управление мышью пользователя не используются.

SDK 1.29.0 имеет несовместимые объявления optional transport properties с TypeScript `exactOptionalPropertyTypes`. Локальные casts Transport и host-only `skipLibCheck` обходят ошибки declarations; проверки исходного кода, renderer, строгих схем и реального транспорта сохранены.

## Проверки

```powershell
corepack pnpm --filter @mcdev/model-editor test:mcp
corepack pnpm --filter @mcdev/model-editor test:desktop
corepack pnpm --filter @mcdev/model-editor exec node scripts/test-desktop.mjs --packaged
# Дополнительная проверка установленного Codex CLI и Claude Code без запуска модели:
corepack pnpm --filter @mcdev/model-editor test:desktop --check-installed-clients
```

MCP tests работают и без GUI: два настоящих HTTP SDK-клиента, неверный Bearer/Host/Origin, размер UTF-8, invalid JSON/batch, strict schema, изоляция preview, rollback, locks, человеческая история, replay и смена проекта. Unit-тест capture использует PNG fixture только для проверки протокола; настоящий рендер проверяется в desktop E2E.

Desktop E2E проверяет GUI-синхронизацию агентного commit, conflict с ручной правкой, shared selection, undo, закрепления, отключение HTTP, четыре настоящих PNG и сохранность ручной камеры/выделения. Тесты запускают окна с `show: false`, проверяют невидимость всех окон и сохраняют evidence под `output/playwright/`.

Отчёт `report.json` раздельно отражает SDK transport, установленный клиент и наличие model turns. Успешный CLI health check или вызов через локальный app-server не подтверждает, что модель самостоятельно выполнила художественное поручение. Полная приёмка M4 требует отдельных сценариев чтения/изменения/снимков обоими агентами; M5 — визуальной итерации на нескольких предметах.

Установленный Codex CLI 0.143.0 проверяется через его настоящий app-server: inventory из десяти инструментов, inspect, selection, preview, apply, capture, model review и undo; используется ephemeral protocol session, без model turn. Установленный Claude Code 2.1.226 проверяется регистрацией в изолированной конфигурации, раскрытием ключа из environment и реальным HTTP health check. Tool calls Claude и самостоятельные модельные итерации **не запускались**. Авторизация, глобальные конфигурации и чаты пользователя не изменяются. Итог текущей переносимой версии и точный report указаны в `output/verification/STUDIO_BUILD.json`. Результаты 0.4 сохранены в `STUDIO_BUILD-0.4.0.json`. Авторский пример текущего Codex описан в [отчёте 0.5](MODEL_EDITOR_DARK_AND_REVIEW.md).

[Покраска и UV](MODEL_EDITOR_TEXTURES.md) доступны через закрытые команды `paint`, `fill`, `uv`. HTTP tests проверяют preview/apply/undo этих команд, лимит 4096 точек, а desktop E2E — конфликт агента с незавершённой ручной кистью и настоящие снимки покрашенной модели. Сравнение вариантов реализовано в 0.4; import `.bbmodel` и удобное постоянное подключение остаются следующими этапами. Ресурсы не интегрированы в ModSpec/JAR; clean Fabric build, GameTests и dedicated server этой версии редактора не проверены.

## Источники

Сверены официальные [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [SDK 1.29.0](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.29.0), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Electron capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts). Context7 использован для SDK 1.29.0 schemas и stateless transport; реальный CLI protocol дополнительно получен через установленный `codex app-server generate-json-schema`.
