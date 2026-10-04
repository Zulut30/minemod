# Полнота истории редактора

Roadmap 028. Проверка относится к существующим supported-командам EditorProject v2 в Studio 0.7.0. Она не добавляет новые геометрические профили, скрытие/rename частей или persistent undo между запусками.

Сценарий использует реальный painted project с двумя сохранёнными вариантами. Семнадцать последовательных операций включают lock/unlock, brief, создание snapshot, transform, paint, fill, отражение UV с рисунком, duplicate, rotate, add, создание/закрепление/удаление части, restore/delete variant и следующую геометрическую правку. Палитра и rows меняются вместе с UV; данные части и variants входят в document snapshot.

После каждой операции фиксируются весь проект и exact hashes четырёх файлов bundle: Minecraft JSON, PNG, bbmodel, source. Сценарий выполняет 17 undo и 17 redo. Каждое промежуточное состояние обязано совпадать с соответствующим ранее зафиксированным документом и экспортом. Дополнительные assertions подтверждают, что операции действительно меняли геометрию, PNG, UV, parts и variants. Новая правка после undo закрывает redo branch; попытка вернуть устаревшую ветку не меняет проект/revision/history.

В hidden packaged E2E ручные правки проходят реальную trusted IPC boundary. Undo/redo выполняются через кнопки UI, а exports — через настоящий HTTP MCP. Перед последовательностью и после полной отмены renderer делает `front` capture с одинаковой камерой. Требуется совпадение PNG SHA-256, а не только размер файла или корректный JSON.

[Evidence 028](evidence/undo-redo-028.json) содержит source, package, reports и image hashes. Эти проверки подтверждают полноту истории для указанной последовательности и supported domains; они не доказывают художественную приёмку или Minecraft rendering. Группы здесь — существующие semantic parts; richer grouping относится к отдельным задачам.

Сохраняются прежние ограничения: 50 history entries, 100 replay keys; agent не отменяет human history. Файл проекта сохраняет variants и документ, но не undo stack. Переоткрытие документа начинает новую session history. Нагрузка на limit/длительные сеансы относится к пунктам 79/89.
