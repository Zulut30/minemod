# Художественный reference benchmark v1

Пункт 042 закрыт как reference collection. [Exact-source evidence](evidence/art-reference-benchmark-042.json) относится к source `5dc73bf`. В [фиксированном каталоге](../../fixtures/art/benchmark-scenes.v1.json) десять оригинальных учебных сцен: по паре для weapon, armor, building-block, decorative-prop и creature. Они показывают конкретные полезные черты и намеренные ошибки. Это reference collection, а не результаты выполнения пяти control briefs генератором; повышение качества генерации этим набором ещё не измерено.

Палитры и brief IDs совпадают с неизменёнными [control briefs v1](CONTROL_BRIEFS.md). Брифы, ArtSpec, ресурсные budgets и требуемые игровые contexts не переписываются. Сцена хранит смысловые части, простой cuboid reference, рисунок, наблюдение по конкретному виду и вопрос для проверки. Класс/representation, исходное происхождение, отсутствие approval, коллекции, текст и координаты проходят strict bounded parser (262144 UTF-8 bytes). Это внутренние данные developer renderer; нового сетевого импорта или MCP eval нет.

| Пара | Полезная черта | Намеренная ошибка | Что проверять |
|---|---|---|---|
| polar-cleaver | Голова, хват и socket имеют разные роли | Гарда доминирует, хват короткий, рисунок шумит | Тип и отличительная масса без текстуры; крепление и баланс |
| polar-armor | Светлые края, область лица и один знак на груди | Шум распределён по всем частям и лицу | Иерархия комплекта и зона лица на манекене |
| copper-masonry | Крупный камень, редкие крепления, отдельные верх/низ | Рамка тайла, шум и одинаковые грани | Читаемость стены 3×3, назначение граней и повторение |
| tide-altar | Основание поддерживает открытую чашу, кораллы стоят сзади | Тяжёлый декор закрывает чашу, основание мало | Рабочая область, распределение масс и завершённый тыл |
| tidecaller-crab | Широкий панцирь, короткие опоры, разные клешни | Опоры не доходят вниз, клешни оторваны, массы похожи | Узнаваемость и места соединений до анимации |

Наблюдения относятся к видимым чертам, а не к универсальному художественному PASS. У брони и блока в паре одинаковая геометрия; у алтаря одинаковое число частей. Mesh complexity не входит в score: numeric artistic score вообще не вычисляется. Контрасты оружия, алтаря и краба меняют несколько черт одновременно и не дают отдельной причинной оценки каждого параметра.

## Представления и границы

`reference-cuboids` — отдельный учебный формат. Он не расширяет CuboidModelSpec/held-item exporter до block renderer. Строительный блок показывается как полный объём 16³, с шестью оригинальными 16×16 face textures и кладкой 3×3; Minecraft blockstate, collision, drop и atlas integration здесь отсутствуют.

Броня использует два оригинальных 64×32 слоя и fixed head/body/arm/leg UV учебного манекена. Верхняя часть ног использует layer 2, нижняя — layer 1; область лица изображена цветом манекена. Это иллюстрация wearable layout и рисунка. Четыре inventory icons, реальный игрок, walk poses, glint и игровое UV acceptance этим renderer не подтверждены. Слои не выдаются за held-item экспорт.

Краб имеет semantic part names и статическую позу. Bone hierarchy, animation runtime, walk cycle и server event binding не реализуются этим reference. Алтарь не получает block runtime/state/collision. Ни один reference не добавляется в trusted pack или JAR.

Увеличенный рисунок на небольших cuboids является учебным; uniform texel density не подтверждена. Этот набор не заменяет этапы 043–056, formal art review и игровую интеграцию. Требуемые control contexts и gaps сохраняются в manifest каждого примера.

## Воспроизводимый просмотр

Из корня checkout с закреплёнными Node 24.21.0/pnpm 11.8.0:

```powershell
corepack pnpm --filter @mcdev/model-editor test:art-benchmark
corepack pnpm --filter @mcdev/model-editor preview:art-benchmark
```

Скрипт разработчика создаёт `output/model-editor/art-benchmark-042/index.html`, исходный JSON, неизменённые control briefs, license, manifest и 238 PNG. Все восемь видов имеют textured и neutral capture 256×256. Front/perspective silhouette и perspective texture отрисовываются непосредственно в 32/64 drawing buffer. HTML сохраняет нативные размеры маленьких PNG; текстуры слоёв/граней можно отдельно увеличить ×3 с nearest display.

Каждая пара использует один union framing: более слабая форма тоже входит в bounds и не масштабируется отдельно. Общие параметры — orthographic camera, pixelRatio=1, antialias=false, nearest textures, sRGB, фиксированный свет. API сверены через Context7 и официальные [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [CanvasTexture](https://threejs.org/docs/pages/CanvasTexture.html) и [color management](https://threejs.org/manual/pages/color-management.html). Используются уже закреплённые Three.js 0.186.1, esbuild 0.28.2 и Playwright 1.63.0; dependency/lockfile не обновлялись.

Renderer работает в собственном headless browser. На Windows выбирается установленный Edge, на Linux нужен доступный Playwright Chromium. Desktop focus, мышь, пользовательский browser и ComputerUse не используются. Сеть для viewer запрещена CSP; developer run фиксирует неожиданные HTTP(S) requests и browser errors. Readback непустого silhouette и проверка raster boundaries подтверждают техническую целостность PNG; они не доказывают, что человек узнаёт предмет.

Если сохранён локальный witness `leaf-volume-20261005-v3c/reviews-b6f9b030`, приложение developer preview проверяет source/capture hashes и добавляет отдельный разбор «Листа»: два editable проекта и 20 настоящих Studio 0.18.0 PNG. На чистом checkout этот witness может отсутствовать; десять tracked reference-сцен воспроизводятся независимо. Пользователь выбрал направление A; объём v3c и текстура остаются без approval.

Уточнение после проверки 043: у старого Leaf witness восемь видов и отдельный full-size silhouette используют union framing; составной четырёхвидовой обзор использовал bounds каждого проекта отдельно. Поэтому общий масштаб всех 20 Leaf PNG не подтверждён. Новый [native review 0.19](NATIVE_SILHOUETTE_REVIEW.md) передаёт compareToVariantId и в обзор, записывает фактические камеры и проверяет их совпадение. Десять учебных reference пар 042 от этой ошибки не зависят.

## Использование агентом

Перед новым blockout прочитать ArtSpec и два примера нужного класса, открыть указанные PNG и сформулировать конкретную проверку. Затем снять виды собственного candidate при согласованном масштабе и проверить те же черты. Исправление должно называть часть, видимый дефект и ожидаемый эффект. Нельзя выводить rating/APPROVED из названия `trait`, fixture JSON, количества частей или успеха renderer.

`source.json` содержит наблюдения и вопросы; `manifest.json` — SHA-256 source/inputs/PNG, точные версии renderer/browser, framing и отдельные evidence states. Файлы доступны в workspace; публичные CLI/MCP tools и desktop Studio этим пунктом не расширяются. Автоматическое принятие модели, formal scorecard и сравнительный независимый агентный сеанс относятся к следующим этапам.

Оригинальные geometry/pixels созданы процедурно при помощи Codex специально для этого набора и распространяются под Apache-2.0. Чужие моды, assets и image provider не использованы. Точное имя model/seed не сохранено и обозначено `not-recorded`; сведения не восстанавливаются догадкой. Provenance declaration не является отдельным legal audit release.

Локальные schema/pixel checks, headless render и PNG hashes подтверждены на exact source. Проверены десять примеров, пять классов, 20 ошибочных payloads, исходные палитры, общий framing, native dimensions, непустые silhouettes, отсутствие clipping, 238 reference PNG и 20 настоящих Studio PNG с сохранёнными project/concept sidecars. Offline viewer проверен в 1400 и 390 px без overflow, browser errors и HTTP(S) requests. Это техническая целостность и иллюстрации приёмов, без human recognition score.

Hosted [run 37362390292](https://github.com/Zulut30/minemod/actions/runs/37362390292) завершён на source `5dc73bf`: full Linux suite, Windows packaged Studio 0.18.0 с 21 подотчётом, Fabric 1.20.1, NeoForge и client smoke PASS. Три clean checkouts имеют одинаковые source/tree; source hashes, шесть generated fixture source files и JAR сверены по bytes/SHA-256. Production target прошёл strict online/offline clean builds, два infrastructure GameTests и полностью остановленные dedicated/client nonce. Reference renderer выполнен локально; новые reference-сцены и «Лист» в JAR не интегрировались.

Whole workflow failed на legacy Fabric 26.2: ожидаемый checksum `23248c15f8413aa0d06ac59e676913dd6a1dc0c5fffaa09365afd6c98d59fcd3`, фактический `4954665c434812be6e2940e68b5a93deb469bded098b130e02af4a337cda8312`. Причина не установлена, защита сохранена. Формальная художественная, generator-comparison и игровая приёмка остаются отдельными gates. Следующая корректировка Unicode ModelIntent v1 имеет собственные source/tests/CI и не переписывает этот snapshot.
