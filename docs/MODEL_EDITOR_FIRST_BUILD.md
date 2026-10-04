# MineMod Studio: первый рабочий этап

Обновлено 4 октября 2026 года. Локальный прототип Windows x64, версия 0.5.1. Реализованы desktop, MCP общей сцены, [пиксельная мастерская](MODEL_EDITOR_TEXTURES.md), [варианты/сравнение](MODEL_EDITOR_VARIANTS.md), [тёмная тема и обзор для ИИ](MODEL_EDITOR_DARK_AND_REVIEW.md), [квадратные маленькие превью и новый пример оружия](MODEL_EDITOR_WEAPON_REDESIGN.md). Предыдущие проверки: [редактирование 0.3.2](MODEL_EDITOR_EDITING.md) и [полировка 0.3.1](MODEL_EDITOR_POLISH.md). Полный [план мастерской](MODEL_EDITOR_MVP_PLAN.md), художественная beta и игровой MVP не завершены.

## Запуск

Путь готовой переносимой сборки указан в `output/model-editor/latest-build.json`; каталог имеет вид `output/model-editor/releases/0.5.1/<build-id>/MineMod Studio-win32-x64/`. Запустить `MineMod Studio.exe`; установленный Node, pnpm и dev server не требуются. Рядом с EXE должны оставаться DLL, `resources` и другие файлы этой папки. Перед запуском закройте обычное окно старой версии. Установщик и автоматическое обновление пока не созданы.

Из исходников, в корне репозитория, с Node 24.11.0 и pnpm 11.8.0:

```powershell
corepack pnpm install
corepack pnpm --filter @mcdev/model-editor build
corepack pnpm --filter @mcdev/model-editor start
```

Для новой переносимой сборки:

```powershell
corepack pnpm --filter @mcdev/model-editor package
```

Команда `package` сначала выполняет чистый `build`. Скрипт очищает только собственный staging и создаёт новый каталог сборки, сохраняя предыдущие версии и работающие приложения. Путь записывается в `latest-build.json`.

## Что реализовано

- Задание для агента и до четырёх независимых снимков внутри проекта. Сравнение рабочей модели с сохранённой использует одинаковые камеры, масштаб и свет; доступны силуэт и миниатюры 64 px. Возврат/удаление отменяются через историю. Агент может прочитать/снять вариант, но не подменить его. [Подробности 0.4](MODEL_EDITOR_VARIANTS.md).

- Реальный Three.js/WebGL renderer: исходный меч, пиксельная текстура, orbit/zoom/pan, четыре ракурса, сетка и каркас. Повторное нажатие кнопки ракурса вписывает текущую геометрию в окно.
- Дерево частей и отдельных кубов. Выделение в 3D и в дереве, скрытие части, закрепление от агентных правок.
- Числовое изменение положения и размеров выделения; native item вращения одной оси на 0/±22.5/±45°.
- Адресная перекраска выбранных UV: сохраняются рисунок, прозрачность и градации яркости. Это изменение существующей покраски, а не универсальная имитация материала.
- Кисть, ластик, пипетка и связная заливка в увеличенном атласе. Покраска ограничена частью/гранью, draft отображается в 3D, штрих фиксируется одним действием. Числовой перенос/масштаб UV сохраняет рисунок, проверяет пересечения и показывает плотность пикселей. Те же команды доступны агенту.
- Новый пустой проект, добавление, удаление и дублирование куба. Новые грани получают свободные UV; копия переносит соответствующие пиксели.
- Один сервис документа в Electron utility process. Ручные операции используют закрытые команды с project ID, ожидаемой ревизией, идемпотентным ключом и атомарным применением batch.
- Undo/redo текущей сессии, Ctrl+Z / Ctrl+Shift+Z, Ctrl+S и «Сохранить как…» / Ctrl+Shift+S. Сохранение ожидает завершения ввода в числовом поле и прекращается при отказе его команды. Undo обратно к сохранённому содержимому снимает признак изменений. История ограничена 50 действиями; после перезапуска история не восстанавливается.
- Собственный `*.mmeditor.json` хранит геометрию, части, закрепления, палитру и строки пикселей вместе. Запись временного файла, fsync, сохранение предыдущего валидного файла в `.bak` и rename защищают от частичной записи. Recovery хранится в пользовательском data folder приложения.
- Новый экспорт Minecraft JSON, PNG, `.bbmodel` и исходного проекта в отдельный bundle с hashes. Существующий exporter повторно используется без изменения trusted packs.

При ошибке команды предыдущая модель сохраняется. Неверное числовое значение возвращается к текущему значению документа. Если покраска делит UV с другой частью, перекраска отклоняется. Если свободного места либо цветов не хватает, возвращается диагностика: автоматическое разделение/перепаковка ещё не реализовано.

В повторных локальных проверках обнаружен `EPERM` Windows при финальном rename папки экспорта. Для rename проекта и export bundle добавлено до семи попыток только при EPERM/EACCES/EBUSY, с суммарным ожиданием до 1.575 s; другие ошибки возвращаются сразу. Failure-injection тест проверяет сохранность завершённого файла при временной блокировке и отказ без повторов при некорректной цели. Причина внешней блокировки не установлена; защита Defender не изменялась.

Кубоидный документ ограничен 256 кубами; первоначальный importer оставляет fixture в существующих bones с лимитом 64 куба на bone. Добавление выбирает bone с местом и возвращает ошибку при их заполнении, а не создаёт новую bone автоматически. Целевая геометрия остаётся в диапазоне −16…32; палитра — до 32 цветов, атлас — до 256×256.

## Границы первой сборки

MCP endpoint общей сцены реализован и включается пользователем в панели редактора. Правки агента проходят preview/revision/lock проверки, попадают в общую историю и сразу отображаются в GUI. Настоящие снимки получают через отдельный скрытый рендер; детали подключения и границы клиентских проверок — в [MCP-документе](MODEL_EDITOR_MCP.md). Существующий `apps/mcp-server` работает отдельно и не управляет этой сценой.

Drag-развёртка, автоматическая перепаковка UV, импорт произвольного `.bbmodel`, authored display transforms, броня и анимации остаются следующими этапами. Варианты-снимки реализованы; несколько одновременно редактируемых документов пока отсутствуют. Открываются собственные проекты; встроенный меч загружается отдельной кнопкой.

Экспорт использует текущие display defaults существующего exporter. Имя и item ID нового проекта пока фиксированы; их редактирование и display inspector добавляются перед полноценной export beta. Реальный пользовательский shader preview не объявляется Minecraft-рендером.

Ресурсы не встроены в ModSpec/JAR. Работа в игре, GameTests и dedicated-server gates этим desktop этапом **не подтверждены**. Runtime runner требует Linux x64, а текущая проверка выполнена на Windows.

## Проверки

```powershell
corepack pnpm lint
corepack pnpm typecheck:all
corepack pnpm --filter @mcdev/editor-core test
corepack pnpm --filter @mcdev/model-editor test
corepack pnpm --filter @mcdev/model-editor exec node scripts/test-desktop.mjs --packaged
```

`typecheck:all` проверяет и существующий Node workspace, и отдельные renderer `.tsx` / host entrypoints. Старый `typecheck` сохраняет исходный контракт и сам по себе не покрывает desktop.

Desktop tests используют Playwright Electron API. Окно создано с `show: false`, проверяется `isVisible() === false`; файловые диалоги заменены внутри тестового процесса. Снимки берутся через `webContents.capturePage(..., { stayHidden: true })`, без захвата рабочего стола, Computer Use, системной мыши и клавиатуры. Тестовые данные изолированы в отдельной папке под `output/playwright/`.

Команда `test` выполняет HTTP MCP tests на всех ОС, затем desktop build перед E2E на Windows. На других ОС desktop E2E помечается явным SKIP, чтобы существующий Ubuntu CI не пытался открыть Electron без display server; это не PASS desktop проверки. `test:desktop` запускает E2E напрямую для уже собранного приложения. В Phase 0 добавлена отдельная `studio-windows` job на `windows-2022`, которая упаковывает и проверяет EXE; её команды прошли локально, запуск на GitHub пока не подтверждён.

Проверяются реальная загрузка текстуры, 3D selection, размер, некорректное значение, перекраска, undo/redo, сохранение с кириллицей/пробелами, новый проект, добавление, повторное открытие, hashes экспортированных файлов, закрытая IPC-поверхность и восстановление после перезапуска. Добавлены проверки кисти, заливки, прозрачности, UV-переноса и конфликта незавершённого штриха с MCP commit. Core tests отдельно проверяют stale revision, retry, rollback batch, pinned parts, UV isolation/copy, лимиты UTF-8, повреждённый файл и точные RGBA PNG.

Входной общий прогон перед полировкой 0.3.1: **13 пакетов PASS, 6 FAIL** в compatibility-packs/workspace/build-runner/compiler-fabric/compiler-neoforge/application integration. Подтверждены ограничения Windows: размер и SHA-256 trusted `gradlew` совпадают, но Windows возвращает mode 0666 вместо требуемого 0755; workspace требует POSIX ownership, runner — Linux x64. Проверки integrity не ослаблялись. Лог: `output/verification/studio-polish-baseline-tests.log`; весь workspace в 0.4 не прогонялся повторно.

В 0.4.0 прошли пять переносимых пакетов, lint/typecheck, HTTP MCP, чистая упаковка и packaged E2E, включая десять новых сценариев вариантов. Итоговый desktop отчёт: `output/playwright/studio-packaged-eb65476c/report.json`. Авторский проект содержит исходник, два кандидата и 16 сравнительных снимков. [Подробности проверки 0.4](MODEL_EDITOR_VARIANTS.md); предыдущие проверки [0.3.2](MODEL_EDITOR_EDITING.md) сохранены отдельно.

В 0.5 дополнительно проверяется единый обзор: четыре камеры, реальные 32/64 px и alpha-силуэт, компактное окно, контраст двух ролей и закрытый MCP tool. Текущие evidence и hashes — в `output/verification/STUDIO_BUILD.json`; [подробности 0.5](MODEL_EDITOR_DARK_AND_REVIEW.md). Сводка 0.4 сохранена как `STUDIO_BUILD-0.4.0.json`.

## Зависимости и архитектура

Версии, upstream repositories, licenses, tarball integrity и источники npm проверены до установки и сохранены в [provenance](provenance/model-editor-dependencies.json). Bundled runtime inventory и полные лицензии создаются в `dist/dependency-inventory.json` / `dist/licenses/`, входят в `app.asar`; Electron LICENSE и Chromium notices остаются рядом с EXE. В npm-архиве R3F отсутствует LICENSE, поэтому зафиксирован текст из соответствующего upstream tag и его SHA-256 проверяется при каждой сборке.

Используются Electron 44.5.1, React 19.3.0, R3F 9.8.1, Three.js 0.186.1, Zustand 5.0.15 и Vite 8.3.2. Для первоначальной упаковки используется напрямую официальный `@electron/packager` 20.3.0, лежащий в основе Forge: это уменьшает количество конфигурации до появления установщика. Vite и esbuild явно собирают renderer/main/preload/worker; TypeScript исходники не исполняются в packaged app.

Renderer изолирован: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; ограниченный preload, sender/frame validation, закрытые request shapes и размер запросов. Навигация и открытие произвольных новых окон запрещены; грузятся только локальные ресурсы контролируемого `studio://app/` protocol. Node export не попадает в браузерный bundle.

Официальные источники: [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts), [Playwright Electron](https://playwright.dev/docs/api/class-electron), [R3F](https://r3f.docs.pmnd.rs/getting-started/introduction), [packager](https://electron.github.io/packager/main/). Context7 использован для проверки Electron isolation/IPC границ.

Следующие этапы — художественная итерация, более удобные UV-инструменты и полная приёмка обоими агентами. До изменения Java/JAR-пайплайна отдельно выполняется этап M7 из плана.
