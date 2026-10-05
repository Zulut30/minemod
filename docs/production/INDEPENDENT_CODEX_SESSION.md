# Самостоятельный сеанс установленного Codex CLI

Пункт 031. Проверяется создание одного held-item из пустой сцены через публичные инструменты Studio. Это технический сеанс; художественная приёмка, три варианта контрольного брифа 005 и работа в Minecraft проверяются отдельно. Установленный клиент успешно создал и экспортировал модель. Hosted full Windows suite по точному source также прошёл; пункт 031 закрыт в этом техническом объёме.

## Проверяемое окружение

Оператор запускает установленный `codex-cli 0.160.0` с существующей авторизацией пользователя. Настройки модели и reasoning наследуются из config; script не выбирает другую модель и не копирует credentials. Проверка расходует обычную квоту этого клиента и не входит в автоматический offline CI.

Studio запускается отдельным скрытым экземпляром с новым `user-data`. Оператор заменяет встроенный пример пустым проектом и добавляет текст задания; кубов и texture edits от оператора нет. Диалог о несохранённом примере подавляется только в этом тестовом экземпляре. Обычное приложение пользователя не используется.

CLI получает `read-only` sandbox. Shell, unified exec, web search, приложения, plugins, hooks и multi-agent выключены. Каждый ранее настроенный MCP server отключается аргументом только для данного процесса: пустая таблица `mcp_servers={}` не очищает merged config. Перед model turn проверяется единственный включённый сервер `studio_verification_031`.

У сервера явно перечислены десять существующих инструментов. Для `studio_changes_apply` и `studio_history_undo` задано per-tool `approval_mode="approve"`: это уже разрешённые пользователем правки только тестовой сцены через bounded Studio API. Остальные инструменты используют `auto`. Режим `auto` сам по себе не разрешает mutating call при policy `never`; существующий config пользователя не переписывается. Bearer token передаётся дочернему процессу через переменную окружения, не через prompt или saved config.

## Совместимость схемы

Реальный CLI 0.160.0 пропускал `studio_changes_preview` при draft-7 `items: [schema, ...]` для координатных tuple. Studio 0.10.1 публикует однородные tuple как один `items` schema и точные `minItems`/`maxItems`. Поля, wire payload, Zod runtime parser, диапазоны координат/цветов/UV и human-only запреты сохраняются. Server validation не заменяется проверкой клиента.

Metadata применяется к agent schema; SDK `tools/list` и `studio://contracts/v1` продолжают выдавать одинаковые schemas. Все пять tuple — translation, scale, paint point, fill seed, UV rect — проверяются HTTP regression suite по форме, длине и bounds. Неоднородный tuple требует отдельного решения; helper отказывается публиковать его через это преобразование.

## Повторение на Windows

Из корня checkout, с установленным npm Codex CLI указанной версии и настроенным входом:

```powershell
$env:PATH = (Join-Path (Get-Location) 'output/tools/node-v24.11.0-win-x64') + [IO.Path]::PathSeparator + $env:PATH
$codexLauncher = Get-Command codex.cmd -ErrorAction Stop
$env:MINEMOD_CODEX_ENTRY = Join-Path (Split-Path $codexLauncher.Source) 'node_modules/@openai/codex/bin/codex.js'
corepack pnpm --filter @mcdev/model-editor package
corepack pnpm --filter @mcdev/model-editor verify:codex-session
```

Для другой установки укажите фактический JS entrypoint в `MINEMOD_CODEX_ENTRY`. Script отказывает другой версии клиента до model turn; новый профиль сначала требует проверки. Пакет Studio готовится отдельно, `latest-build.json` относится к локальной packaging operation.

В `output/playwright/independent-codex-031-*` сохраняются исходный prompt/brief, пустой проект, invocation без token, JSONL events, реальные PNG, точный tool export, final scene и report. Геометрия создаётся клиентским агентом, JSONL сохраняет его аргументы preview/apply. Вместо base64 в retained trace пишется имя PNG; полученный моделью MCP image не меняется. Bundle проходит штатную integrity validation перед сохранением. Script возвращает FAIL, если модель пуста, нет image/export, CLI завершён по timeout, появился другой MCP/shell/file/web tool либо клиент пропустил инструмент из-за ошибки schema.

Операторский watchdog ограничивает сеанс 12 минутами и 500 events. Он завершает только свой дочерний CLI и собственную скрытую Studio. Это не общий cancel/resume механизм приложения.

Источники: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [MCP per-tool approval config](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/config/src/mcp_types.rs), [тип schema клиента](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/tools/src/json_schema/types.rs), [Zod JSON Schema metadata](https://zod.dev/json-schema#metadata). Проверены официальные docs, exact-version source и Context7; dependencies Studio не обновлялись.

## Полученный технический результат

Сеанс `independent-codex-031-9ab419a3`: 52 MCP calls, восемь успешных apply, revision 1 → 9, empty scene → 22 куба, шесть цветов. Получены 20 PNG, включая все восемь видов итоговой revision и review с силуэтом/32/64 px. Один `NO_CHANGE` для paint не изменил сцену; клиент перечитал её и пересчитал запрос.

Независимая проверка заново воспроизвела все agent mutations из пустой сцены с тем же brief: итоговый project совпал полностью. Exact exported source bundle совпадает с `assetRequest(finalProject)`; четыре files и manifest проверены штатным bundle verifier. Широкая кромка, обмотка и кристалл видны на actual PNG. Это наблюдение о форме, не художественная оценка. [Точные hashes и retained failed attempts](evidence/independent-codex-031.json).

## Hosted проверка приложения

Windows job [`111722133851`](https://github.com/Zulut30/minemod/actions/runs/37294506792/job/111722133851), attempt 2, прошёл portable suites, HTTP MCP, package и полный hidden packaged E2E по source `fa1d871`. Проверены actual packaged report, MCP PNG hashes и review pixels. Actual installed CLI-сеанс выполнен отдельно: offline CI честно оставляет installed clients `not-run`.

Первый Windows attempt отменён после зависания portable stage; причина не подтверждена, job logs возвращали HTTP 404. Этот attempt сохранён отдельно. Linux control-plane и production Fabric 1.20.1 build/GameTests/server/client прошли по тому же source. Общий workflow остаётся failed на legacy Fabric 26.2 checksum gate.
