# Самостоятельный сеанс установленного Claude Code

Пункт 032 закрыт в описанном техническом объёме. Установленный Claude Code 2.1.289 создал held-item из пустой сцены через тот же публичный MCP контракт Studio 0.10.1, что Codex в пункте 031. Это повторение ограниченного технического брифа 031 с атласом 256×256 и одним дизайном; полный benchmark 005 с тремя вариантами и игровыми contexts не заявляется. Художественного human approval нет.

## Сеанс и полномочия

Вход — существующая пользовательская авторизация `claude.ai`. Model/effort script не переопределяет. Новый скрытый экземпляр Studio имеет собственные `user-data` и projectId. Оператор только открывает empty project и прикрепляет brief; geometry/paint операций от оператора нет.

Клиент запускается с `--tools ""`, `--strict-mcp-config`, десятью точными именами MCP в `--allowedTools`, `dontAsk` и `--permission-prompts none`. Встроенные shell/file/web/subagent tools отсутствуют. `--disable-slash-commands` выключает skills; hooks отключены session settings, включённые user plugins выключаются для этого процесса. User config не переписывается. Runtime `system/init` проверяет фактические tools и единственный connected Studio server перед продолжением; неизвестный tool прекращает тестовый CLI.

Bearer token передаётся через environment substitution в HTTP header `${MINEMOD_STUDIO_032_TOKEN}`. Он не попадает в prompt или saved config. Auth status используется с whitelist полей для preflight; личные account metadata в evidence не сохраняются.

## Большой ответ экспорта

В первом фактическом сеансе native CLI ограничил ответ `studio_asset_export`: полный текст сохранён его собственным transport в `tool-results`. Модель увидела уведомление о размере и не читала файл через запрещённые tools. Поэтому original operator report сохранил `FAIL` с `exports: 0`: его первый collector не понимал этот формат доставки. Это не подменяется записью успешного первого harness.

Независимый оператор сохранил **тот же** native tool result, без второго экспорта или изменений сцены. Связь проверяется через tool_use_id, actual session UUID, cwd и ровно `projects/<encoded-own-cwd>/<session>/tool-results/mcp-studio_verification_032-studio_asset_export-<timestamp>.txt`. Reader отказывает чужому каталогу/session, symlink, превышению 2 MiB, неподходящему имени и несоответствию projectId/revision. Штатный bundle verifier проверяет содержимое и hashes перед сохранением.

Исправленный повторяемый collector читает только такой результат своего export tool. Agent File/Read не добавляется. Проверки reader включают реальный 143244-byte native ответ, отказ чужому каталогу/session/project/revision и unsafe tool ID. Операторская функция не является MCP endpoint или generic file reader.

## Проверенный результат

Сеанс `independent-claude-032-6ca08968`: 40 MCP calls, восемь successful apply, revision 1 → 9, empty scene → 20 кубов и шесть цветов. Получены 11 реальных PNG. Последняя revision имеет front/back/perspective; последний combined review с 32/64 px относится к revision 8, до небольшого смещения кромки на 0.25. Проверка всех восьми видов финальной revision этим сеансом не заявляется.

Все successful mutations воспроизведены из того же empty project/brief с совпадающим final project. Точный source в bundle совпал с `assetRequest(finalProject)`; проверены четыре files и manifest. Original CLI dump, его FAIL report, exact native bytes и независимый PASS сохранены отдельно. Ошибки `EMPTY_PAINT`/`NO_CHANGE` и последующие исправления присутствуют в trace.

Native client reported model `claude-opus-5-5`; это измерение данного сеанса, не обещание model availability или рекомендация модели. Модель честно указала плоскую заливку граней, отсутствие pixel surface detail и непроверенные display transforms. Эти замечания не заменяют human scorecard.

## Повторение

Профиль проверен на установленном клиенте указанной версии; model turns не входят в offline CI и используют квоту установленного клиента. Из корня checkout после packaging Studio:

```powershell
$env:PATH = (Join-Path (Get-Location) 'output/tools/node-v24.11.0-win-x64') + [IO.Path]::PathSeparator + $env:PATH
$env:MINEMOD_CLAUDE_EXE = (Get-Command claude.exe -ErrorAction Stop).Source
corepack pnpm --filter @mcdev/model-editor verify:claude-session
```

Script сверяет exact installed CLI 2.1.289; другую версию сначала проверяют отдельно. Watchdog ограничивает только собственный CLI 12 минутами/500 events и закрывает собственное hidden приложение.

Источники: [официальный CLI reference](https://code.claude.com/docs/en/cli-reference), [MCP configuration](https://code.claude.com/docs/en/mcp), [отключение hooks на один запуск](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks). Docs/Context7 сверены с actual installed help и actual `system/init`; новых dependencies нет.

## Повтор исправленного collector

Новый фактический сеанс `independent-claude-032-e587d05a` завершился original harness **PASS**, exit 0, без timeout или запрещённых tools. На том же техническом брифе: 27 MCP calls, семь successful apply, revision 1 → 8, empty scene → 16 кубов и шесть цветов. Сохранены шесть PNG: combined review на revisions 5/7/8 и front/back/perspective финальной revision 8.

Collector сразу сохранил исходный 128715-byte native export. Независимый replay воспроизвёл все семь agent applies до exact final project. Bundle source совпал с `assetRequest(finalProject)`; проверены files, manifest, actual PNG bytes/SHA и native response SHA. Это отдельный новый PASS; FAIL первого harness сохранён.

Actual final images показывают ступенчатый прямоугольный клинок, ромб у основания головы и три полосы обмотки. Плоская кожаная заливка и слабый контраст тёмных деталей остаются; технический PASS не подтверждает улучшение художественного качества. [Точные session/source/package hashes и границы проверки](evidence/independent-claude-032.json). Hosted verification operator source `2fe607e` прошёл: control-plane, полный hidden packaged Windows и production Fabric 1.20.1 build/GameTests/server/client.

Hosted Windows job [`111725840391`](https://github.com/Zulut30/minemod/actions/runs/37298652447/job/111725840391) сохранил packaged report и PNG по exact source. Offline suite не запускает модель и честно отмечает installed clients `not-run`; самостоятельные сеансы и независимый replay проверены отдельно. Общий workflow failed на legacy Fabric 26.2 checksum gate.
