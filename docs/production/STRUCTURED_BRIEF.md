# Структурированный бриф в Studio

Пункт 034, в работе. Studio 0.11.0 добавляет редактируемые поля назначения, стиля, силуэта, материалов и палитры. Target фиксирован: held-item для Fabric 1.20.1. Замки частей показываются рядом с заданием. Поля можно сохранить в пустой сцене до создания геометрии.

## Путь пользователя

Во вкладке «Варианты» откройте «Задание для агента» → «По полям». Заполните описания и цвета `#RRGGBB`; проверьте закреплённые детали и сохраните задание. Затем агент читает его через `studio_project_inspect`. Свободный текст остаётся отдельным режимом.

Это форма контролируемого составления брифа человеком. Автоматическая NLP extraction, concept provider, новый model class или ArtSpec approval этим изменением не реализованы. Поля помогают явно задать форму и материалы; рост художественной оценки не измерен.

Ввод остаётся draft до сохранения задания. Он не меняет модель или покраску. Если агент изменил сцену во время ввода, исходная revision не может быть перезаписана: draft сохраняется, пользователь сверяет текущие детали и явно обновляет привязку. При смене projectId форма сбрасывает draft.

## Контракт и сохранение

`DesignBriefSchema` версии 1 имеет закрытый target, обязательные bounded descriptions, 1–24 уникальных цвета и bounded unique part IDs. Команда `designBrief` проходит серверный `MutationSchema`, существующие byte limits и CAS. Сохранение разрешено только actor `human`; MCP agent input не публикует эту команду и отдельно отклоняет обход через старый формат mutation.

`preserve` — снимок закреплённых IDs при сохранении брифа. Core отказывает отсутствующей или незакреплённой детали. Текущие `parts[].locked` остаются источником полномочий: последующее ручное снятие замка или восстановление варианта не должно интерпретироваться как разрешение агента самому менять защиту. Текст брифа не заменяет lock enforcement.

Typed record сериализуется в существующее текстовое `design.brief`, до 1200 символов вместе с полями. `ProjectSchema` остаётся v2: прежние файлы и свободные задания не мигрируют и не переписываются при чтении. Старый reader v2 сохраняет такое содержимое как string; новый reader дополнительно распознаёт известный brief record. Неизвестный/невалидный record остаётся обычным текстом, без исполнения или автоматического исправления. Сериализация нормализует цвета и пробелы в описаниях только при явном сохранении.

Public inspect содержит исходное сохранённое задание и `design.structuredBrief` либо `null`. Этот metadata object не добавляется в persisted project. Бриф не связывается автоматически с ArtSpec, candidate digest, JAR или human artistic approval.

## Проверки

Core suite проверяет 13 malformed payloads, unknown version/target/keys, duplicate colors/IDs, общий length limit, human-only permissions, CAS и реальные protected references. Проверены неизменность геометрии/пикселей, точный v2 persistence roundtrip, undo/redo и сохранение 24-color брифа в пустой сцене.

Focused hidden packaged E2E проверил GUI-поля, неправильную палитру, actual MCP reading и отказ agent replacement. Реальная MCP geometry mutation во время ввода не была потеряна; stale human brief отказал, текст остался, explicit refresh позволил сохранить его с актуальной сценой. Проверены exact saved file, перезапуск, сброс формы при новом projectId и сохранение брифа до появления первого куба.

Первый operator check завершил GUI cases, но cleanup завис на confirmation dialog из-за ошибочного test-close flag. Report сохранён; остановлен только идентифицированный собственный процесс. После исправления повтор закончился естественно с exit 0, скрытый экземпляр закрыт. Это ошибка тестового harness, не заявляемый production PASS первого cleanup.

Local lint/typecheck/portable suites, discovery, HTTP MCP и clean package прошли. Полный hosted Windows и production-target по новому source ещё ожидаются; пункт пока открыт. [Точные hashes и evidence](evidence/structured-brief-034.json).

Проверены [React controlled textarea](https://react.dev/reference/react-dom/components/textarea) и [reset state по key](https://react.dev/learn/preserving-and-resetting-state) через официальные docs/Context7. Dependencies не добавлены, trusted packs и fixtures не изменены.
