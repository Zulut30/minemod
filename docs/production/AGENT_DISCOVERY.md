# Studio 0.10.0: обнаружение операций и восстановление после отказа

Дата: 4 октября 2026 года. Пункт 033. Десять существующих инструментов сохраняют имена; новые исполняемые инструменты и зависимости не добавлены. Редактор и exporter по-прежнему поддерживают held-item. Это технический контракт MCP, а не доказательство самостоятельного художественного сеанса Codex/Claude Code или работы нового ассета в Minecraft.

## Что читает агент

После initialize сервер указывает на `tools/list` и два фиксированных JSON-ресурса, доступных через `resources/list` / `resources/read`:

| URI | Содержание |
|---|---|
| `studio://contracts/v1` | Реальные input schemas десяти инструментов, их schema IDs, SHA-256 каталога, агентные и ручные команды, лимиты, profile, виды, причины отказа и recovery |
| `studio://scene/v1` | Текущие projectId/revision, modelId, cube/bone/part/variant IDs, закрепления, размер атласа и ручное выделение |

Схемы contract resource и `tools/list` выводятся из одних Zod-объектов. Тесты сравнивают их целиком, включая required, дополнительные поля и закрытые enums. Digest считается от `JSON.stringify(tools)` в опубликованном порядке. `studio/schemaId` в tool metadata указывает на запись ресурса. JSON Schema описывает поля; дополнительные проверки ссылок, bounds с inflate, UV, закреплений, истории и CAS продолжает выполнять core. Schema digest не является подписью, provenance ассета или художественным approval.

Оба ресурса читаются через общую очередь редактора и имеют тот же локальный bearer token, origin/host policy, request/response limits и rate limit. Фиксированные URI не открывают произвольные файлы. Ресурс сцены — снимок, а не резервирование revision: перед правкой нужно перечитать сцену. Labels и brief являются пользовательскими данными.

Без поддержки MCP resources клиент может получить schemas через `tools/list`, IDs, limits и ссылки через `studio_project_inspect`, а выделение — через `studio_selection_get`.

## Разрешённые правки

В опубликованной mutation schema доступны `transform`, `recolor`, `pivot`, `snap`, `rotate`, `add`, `delete`, `duplicate`, `paint`, `fill`, `uv`, `undo`, `redo`. Они используют существующие атомарные команды core. Undo/redo выполняются отдельно; агентная история не может менять ручные действия или закреплённые детали.

`brief`, `checkpoint`, `restoreVariant`, `deleteVariant` и `lock` исключены из агентной schema. Они остаются ручными операциями редактора. Попытка вызвать их через MCP сохраняет существующие отказы `HUMAN_ONLY` / `LOCKED`, сцену не меняет.

Profile честно указывает Minecraft 1.20.1 / Fabric / Java 17, held-item, raw geometry bounds −16…32, pivot −128…128, одну ось вращения с углами 0/±22.5/±45 и шаги сетки 0.125/0.25/0.5/1. Block/entity export и JAR integration перечислены как неподдерживаемые операции текущего редактора. Screenshot или корректная схема не подтверждают художественное качество.

## Отказы и исправление

Ошибки инструмента содержат `isError=true`, совместимый JSON text и одинаковый `structuredContent.error`: `code`, `message`, `recovery`. Recovery содержит конкретное действие, `automaticRetry=false` и ссылки на оба ресурса. Основные причины публикуются в contract resource; неизвестный внутренний код получает общий совет перечитать сцену и контракт.

- Неизвестное имя: `UNKNOWN_TOOL` со списком десяти допустимых инструментов.
- Неверные поля: `INVALID_ARGUMENTS`, schemaId и до восьми путей/кодов Zod issues. Возвращаемые пути ограничены 128 символами, а исходные значения и произвольный script/prompt не отражаются в сообщении.
- Устаревшая revision: `REVISION_CONFLICT`; inspect, пересчёт правки и новый preview/key. Автоматический повтор старого apply запрещён.
- Неверный ID, закрепление, общие UV или переполненный атлас: исправление конкретной причины, без молчаливой подмены цели или обхода защиты.

Authentication, media type, oversized HTTP body, origin и rate-limit отказы сохраняют HTTP statuses 401/415/413/403/429. Повреждённый JSON возвращает 400. Это transport failures; envelope выше относится к корректным `tools/call` JSON-RPC requests.

Предварительная проверка входа выполняется после HTTP guards и до SDK, чтобы SDK Zod diagnostics не отражали пользовательские значения. Допустимые вызовы продолжают проходить обычный SDK dispatch/validation и атомарный editor core. Ресурсы не добавляют agent file writes, shell или eval.

## Проверка

[Evidence пункта 033](evidence/agent-discovery-033.json) содержит точные source/package/report hashes. Unit suite использует настоящий Streamable HTTP и SDK clients, проверяет десять схем, динамические IDs при смене проекта, bounded errors, 16 отклонённых запросов, отсутствие payload echo, а затем исправленный preview/apply после CAS conflict. Mock capture в этом suite не заявляется рендером.

Packaged Windows suite запускает собственное скрытое приложение с отдельными user-data: читает оба ресурса, сверяет schemas, отклоняет выдуманный инструмент и неправильный pivot, создаёт реальную ручную правку между preview/apply, получает полезный conflict и выполняет новый preview/apply. Затем получает настоящий PNG 1024×768. Окна остаются невидимыми; нормальное пользовательское приложение не запускается и не закрывается.

Самостоятельные model turns установленными Codex и Claude Code проверяются отдельно в пунктах 031/032. Корректное обнаружение интерфейса снижает необходимость угадывать команды, но не гарантирует отсутствие ошибок у любой модели.

После hosted CI текущий Codex root agent отдельно прочитал живые resources, фактическую сцену и настоящий front PNG. По опубликованной schema он выбрал transform пяти кубов гарды: ширина −15% с сохранением центра. Preview сохранил весь state; apply изменил только эти кубы, не затронув atlas или остальные части. Агент просмотрел front/rear-perspective PNG, затем выполнил разрешённый undo. Полный проект и front PNG восстановились точно. Все 14 protocol calls, schemas и screenshots связаны hashes в evidence; токен в trace отсутствует. Это проход агента текущего чата через публичный MCP, а не самостоятельный сеанс установленного Codex CLI или Claude Code. Художественное одобрение не присвоено.

Полный Windows packaged suite и Linux suite прошли hosted CI для source `57dd6dd`; clean build, два инфраструктурных GameTests и dedicated-server smoke для Fabric 1.20.1 также прошли. Локальный повтор full suite не оставил итогового report, его process/exec handle при повторной проверке отсутствовали; причина не установлена. Local focused discovery PASS и hosted full PASS обозначены отдельно. Общий workflow остаётся failed из-за прежнего regression checksum Fabric 26.2.

Источники: [официальная спецификация tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources), [SDK 1.29.0](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.29.0). API сверены через Context7 и фактически установленный SDK/Zod; новых dependencies нет.
