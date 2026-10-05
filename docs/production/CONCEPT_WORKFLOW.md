# Концепт рядом с брифом

Roadmap 035, Studio 0.15.0 / EditorProject v3. Реализован импорт исходных PNG, описание источника и прав, просмотр в GUI и через MCP, сохранение и перенос вместе с проектом. Текущие результаты и точный source находятся в [evidence](evidence/concepts-035.json). Это работа с изображением-направлением; генерация 3D из изображения и художественная приёмка не присваиваются.

Вкладка «Варианты» содержит панель концептов рядом с брифом. Пользователь выбирает PNG через native file dialog, задаёт название, автора/инструмент, происхождение, право использования и желаемые особенности модели. Для чужого reference требуется источник. Эти сведения являются декларацией пользователя, а не автоматической проверкой лицензии. Source и note отображаются как текст, ссылки и внешние изображения автоматически не загружаются.

## Оригинал и перенос

В проекте сохраняется descriptor: UUID, SHA-256, размер, dimensions, provenance и `review: direction-only`. Байты PNG лежат отдельно, без перекодирования. Допускаются три изображения, каждое до 8 MiB, стороны до 4096 и площадь до 4 Mpx. Worker проверяет signature, CRC, базовое chunk ordering, color/depth profile, ограниченный IDAT pixel stream и filter bytes. Метаданные ограничены 1 MiB на compressed chunk и 4 MiB суммарно после распаковки. APNG и неизвестные critical chunks отклоняются. Это ограниченный preflight, не полный conformance checker всех PNG ancillary chunks; браузерный decoder также может отказать.

При сохранении `меч.mmeditor.json` рядом создаётся `меч.mmeditor.json.assets/concepts/<sha256>.png`. **Переносите JSON и его папку `.assets` вместе.** Новый профиль проверяет descriptors и восстанавливает исходные изображения из sidecar. Файл с неверным hash не подменяется. Отсутствующий sidecar не создаётся при чтении. Undo удаления возвращает descriptor; оригиналы сохраняются, автоматический garbage collection пока не реализован.

Автовосстановление с недоступным PNG сохраняет primary и backup, сообщает причину и останавливает запись recovery. Открытие повреждённого проекта сохраняет текущую рабочую сцену. Сохранить новую текущую работу в отдельный файл можно через «Сохранить как».

## Формат проекта v3

Добавление строгого `design.concepts` меняет EditorProject с v2 на v3. Форматы ModSpec и game asset bundle остаются прежними. v1/v2 читаются через явную миграцию в памяти: меняются только версии root и variant snapshots. Геометрия, IDs, UV, рисунок, brief, locks и варианты сохраняются; отсутствующие концепты не придумываются. При первой записи сохраняется точный исходник `.v1-<sha>.original.json` или `.v2-<sha>.original.json` отдельно от rotating backup. Старые редакторы не должны записывать v3. Историческая приёмка предыдущего перехода описана в [PROJECT_MIGRATIONS](PROJECT_MIGRATIONS.md).

## Доступ агента

`studio_project_inspect` и `studio://scene/v1` возвращают metadata концептов. Агент читает бриф, выбирает существующий concept ID и вызывает `studio_view_capture` с projectId, expectedRevision и conceptId. Получает ограниченный PNG 1024×768 с подписью «2D изображение-направление» и provenance. Вызов не меняет модель, ручную камеру или историю. conceptId нельзя сочетать с variantId, compareToVariantId или silhouette. Добавление/удаление концепта остаётся human-only; произвольные пути, shell/eval и сетевые источники не предоставляются агенту.

Перед каждым capture worker повторно проверяет исходный PNG. Renderer загружает его по закрытому адресу текущего задания, чтобы повторный снимок не опирался на cached image после повреждения файла. Ошибка decode возвращает controlled capture failure; исходник и сцену она не меняет. Capture сохраняет существующий лимит ответа 2 MiB: особо сложное изображение может не поместиться в ответ; оригинал всё равно остаётся сохранённым.

Экспортированный editor source содержит отдельную папку `.assets`. PNG концепта не попадает в Minecraft runtime files или `asset-bundle.v1.json`, не получает art approval и не интегрируется в JAR. Для готовой модели остаются multi-view review, технический gate, явная интеграция и проверка в игре.

## Проверки и границы

Core проверяет права агента, CAS, лимиты, duplicates, undo и сохранность игрового asset payload. Store tests проверяют точные байты, перенос, повреждение, compressed metadata, links и noncreating reads. HTTP MCP test проверяет discovery, read-only capture и отказы. Скрытый packaged сценарий проходит GUI import → original PNG → MCP rendered pixels → save/undo → export → fresh-profile transfer; отдельные случаи защищают recovery и рабочую сцену. Synthetic PNG в тестах служит проверкой передачи данных, художественным образцом он не является.

Актуальные API сверены через Context7 `/electron/electron`, `/websites/nodejs_latest-v24_x_api` и [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol), [webContents](https://www.electronjs.org/docs/latest/api/web-contents), [Node fs](https://nodejs.org/docs/latest-v24.x/api/fs.html), [PNG specification](https://www.w3.org/TR/png-3/). Dependencies и trusted compatibility packs не изменены. Проверка authored 3D в Minecraft и самостоятельные Codex/Claude сеансы этой версии требуют отдельного evidence.
