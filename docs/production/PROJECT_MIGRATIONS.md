# Миграции проекта Studio

Текущий формат Studio 0.15.0 — v3; [концепты и переход v1/v2 → v3](CONCEPT_WORKFLOW.md). Ниже сохранена историческая приёмка roadmap 027 для Studio 0.7.0, а не повторное доказательство новой версии.

Roadmap 027. Studio 0.7.0 читает согласованный EditorProject v1 и сохраняет EditorProject v2. Версии ModSpec, item asset request и bundle этим не меняются. Геометрия остаётся held-item; новый block target ещё не реализован.

## Переход v1 → v2

Миграция выполняется в памяти при чтении. Она изменяет только `schemaVersion` проекта и его variant snapshots с 1 на 2. Project/cube/bone/part/variant IDs, геометрия, рисунок, палитра, UV, display transforms, locks, brief и варианты сохраняются. v1 без `design` поддержан; отсутствующий design не заполняется фиктивными данными. v2 проходит текущую строгую схему; повторное чтение идемпотентно.

Реальный [v1 fixture](../../fixtures/editor-projects/v1-painted-variants.mmeditor.json) создан packaged Studio 0.6.0 в проверке сохранения двух вариантов. Он сохранён побайтно; [provenance](evidence/project-migration-fixture-027.json) связывает его с исходным E2E report. Это тест данных и migration protocol; художественное approval он не получает.

Reader проверяет UTF-8, размер до 1 MiB, строгую схему и semantic asset constraints. Неизвестная версия верхнего проекта или snapshot получает `UNSUPPORTED_PROJECT_VERSION`. Ни версия, ни IDs не угадываются; source не переписывается при чтении. Неизвестные поля и испорченные известные версии не «исправляются» удалением данных.

## Сохранение и оригинальная копия

Первое сохранение поверх v1:

1. Готовит актуальный v2 в собственном exclusive staging file и синхронизирует данные.
2. Проверяет primary и backup; неподдерживаемая версия любого из них останавливает save.
3. Сохраняет точные original bytes в `<path>.v1-<SHA256>.original.json`. Полная staging-копия публикуется через exclusive hard link; существующая копия проверяется и не заменяется. У original отдельный inode от primary/rotating backup.
4. Публикует `.bak` с исходными bytes через staging/rename, затем заменяет primary готовым v2.

Дальнейшие saves обновляют обычную `.bak`, но не удаляют и не изменяют migration original. CRLF, отступы и последний перевод строки в копии остаются исходными. Конфликт `MIGRATION_BACKUP_CONFLICT` оставляет существующие файлы на месте. Если сохранение прервётся после готовых copies, primary остаётся читаемым v1; повторный save использует ту же original copy.

Для публикации exact original нужен filesystem с hard links: проверен Windows NTFS; hosted Linux проверяется отдельно. Если filesystem/permissions не позволяют создать copy, исходный primary не заменяется. Можно сохранить текущий v2 в новый файл, оставив старый v1 нетронутым. Несколько независимых writers, физическое отключение питания и directory fsync остаются отдельными ограничениями; файл, изменённый внешним редактором, не защищается этим протоколом.

## Неизвестная версия в recovery

Future primary не считается обычным повреждением и не вызывает тихий fallback к старому backup. Приложение открывает исходный пример, показывает причину и блокирует autosave в защищённый recovery path. Future backup-only тоже блокирует запись; future backup при корректном current primary обнаруживается перед первой записью. Warning сохраняется после ручных правок; рабочую модель можно сохранить в новый файл.

Manual open отказывает, сохраняя активный проект/revision/selection. Save/Save As поверх future file тоже отказывают. MCP не получает новых файловых полномочий или возможности снимать защиту. Для продолжения с future source нужна версия Studio, которая поддерживает его формат; оригинал доступен на прежнем месте.

В UI отображается сообщение о миграции v1 при open/recovery. Файлы v2 требуют Studio 0.7.0 или новее с этим reader. Более старые binaries не обновлены этим изменением; не открывайте v2 в них для редактирования. Для возврата к прежнему Studio используйте точную `.original.json` копию v1. Новый пакет создаётся отдельно и автоматически не запускается в пользовательском user data.

## Доказательства

[Evidence 027](evidence/project-migrations-027.json) фиксирует exact source, package и reports. Unit/integration tests сравнивают весь реальный проект и snapshots до/после, original/backup bytes, повторное сохранение, конфликт копии, неправильные pixels/UTF-8 и future primary/backup/variant. Отдельный процесс принудительно завершается перед заменой v1; проверяются complete copies и успешный retry. Скрытый packaged E2E проходит ручной open/save, legacy recovery, visible warning и четыре варианта future-file защиты.

Протокол опирается на [Node 24 fs API](https://github.com/nodejs/node/blob/v24.11.0/doc/api/fs.md#fspromiseslinkexistingpath-newpath) и Context7 `/websites/nodejs_latest-v24_x_api`. Новые dependencies не добавлены.
