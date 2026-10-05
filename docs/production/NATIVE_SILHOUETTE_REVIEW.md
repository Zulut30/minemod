# Studio 0.19: нативные силуэты 32/64 px

Техническая часть этапа 043 реализована; полный acceptance остаётся открытым до наблюдения человека. Выбор направления A «Лист» не заменяет узнавание типа и отличительной формы на маленьком силуэте. Объём, текстура и работа authored asset в Minecraft не приняты.

## Рендер и показ

В «Обзоре» каждый размер получает собственный квадратный WebGLRenderTarget и ортографическую проекцию. PNG 32×32 не получается уменьшением PNG 64×64. Общие bounds и направление камеры сохраняют одинаковое относительное кадрирование; квадратный рендер не зависит от пропорций панели. Targets без multisampling, nearest texture sampling и sRGB используют закреплённый Three.js 0.186.1. После readback восстанавливаются render target, viewport, scissor и scissor test; временный target освобождается.

Фронтальные маски меняют RGB на чёрный и сохраняют alpha нативного PNG без resize. Светлая подложка делает маски видимыми в тёмной теме. Нижний ряд содержит два силуэта спереди и два цветных вида в три четверти. Каждое изображение показывается в физических пикселях 1:1: CSS-размер делится на devicePixelRatio. Изменение DPI/масштаба страницы отслеживается через resolution media query. Размеры исходного PNG не меняются.

API сверены через Context7 и официальные [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [WebGLRenderTarget](https://threejs.org/docs/pages/WebGLRenderTarget.html); связь CSS и физических пикселей и мониторинг масштаба — по [devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio). Новые dependency не добавлены; lockfile прежний. Callback 64 px для сравнения вариантов сохранён, публичные MCP инструменты и limits не расширены.

Это проверка рисунка маленького растра в редакторе. Игровой inventory transform, GUI scale, освещение и in-hand вид требуют отдельного запуска Minecraft. Высота модели в PNG и количество непрозрачных пикселей не являются художественным score.

## Наблюдение человека

Скрипт `review-blockout-drafts.mjs` снимает настоящий `studio_model_review`, восемь обязательных видов и силуэт при общем framing вариантов. Из того же review окна сохраняются source PNG 32/64 и чёрные perspective masks; source .mmeditor.json остаётся неизменённым. Каждый capture имеет SHA-256; отчёт включает SHA-256 app.asar, версии Studio и проектов.

```powershell
node --experimental-strip-types apps/model-editor/scripts/review-blockout-drafts.mjs output/model-editor/leaf-volume-20261005-v3c
```

Нужны локальные authored проекты, authoring-report и их concept sidecars; это developer workflow для собственных файлов, не новый сетевой import/eval endpoint. Результат находится в отдельной папке `reviews-<id>`: `comparison.html` показывает полные виды; `recognition.html` показывает только чёрные силуэты под кодами S1/S2. На странице нет названий моделей или цвета. Знакомство с заданием отмечается явно: пользователь уже видел направление A, поэтому его ответ нельзя описывать как unprimed pilot.

Человек описывает тип предмета и заметную отличительную форму, включая размер, где она теряется. Ответы можно сохранить в локальный JSON, привязанный к hashes кандидатов, PNG, отчёта и пакета. Пустые ответы не сохраняются. Загрузка наблюдения не выполняется автоматически, artistic approval не назначается. Сеть для страницы запрещена CSP.

## Проверки

Packaged desktop regression проверяет отдельные source размеры 32/64, чёрные непрозрачные маски с прозрачным фоном, непустой и необрезанный растр, display 1:1 с DPI, изменение масштаба собственного скрытого окна и независимость framing от aspect ratio. На контрольной геометрии native 32 должен отличаться от nearest уменьшения 64 по RGBA pixels. Последний тест обнаруживает возвращение старого downsample пути, а не измеряет качество модели.

Read-only MCP regression сохраняет revision, проект и ручную камеру; возвращаемый PNG 1024×768 содержит всю геометрию с полями в четырёх панелях. Сравнение вариантов продолжает получать прежний 64 px callback. Проверки проходят в собственных скрытых Electron окнах; ComputerUse и пользовательский desktop не используются.

Составной MCP PNG нормализуется до 1024×768 и на HiDPI может менять размер встроенных миниатюр. Для оценки native pixels используются отдельно сохранённые drawing-buffer PNG в recognition.html, а не вырезки из обзорного снимка.

Локально прошли lint, обе проверки TypeScript, portable suite, package и все 21 packaged desktop subreports на Studio 0.19.0. Новый ASAR имеет SHA-256 `32d78fa6863c4181d25299361e8713aacbbc25df51693053af8d0b83cbc2176a`. Контрольный native 32 отличается от nearest уменьшения 64 на 55 RGBA pixels; display сохраняет 32/64 физических пикселя при DPR 1.4 и 1.75 и после resize/undo.

«Лист» переснят в `leaf-volume-20261005-v3c/reviews-c167c4d7`: 32 PNG, неизменённые source hashes, совпадающие фактические review cameras и union framing. Страница recognition проверена в 1400/390 px и DPR 1/1.75; отдельные фронтальные/perspective masks чёрные, непустые, не обрезаны и сохраняют source alpha. Download probe был scripted и не является человеческим ответом. [Локальный evidence](evidence/native-silhouette-043.json) сохраняет hashes и отдельные статусы.

Hosted [run 37368539822](https://github.com/Zulut30/minemod/actions/runs/37368539822) проверил Studio 0.19 по source `8a49732`: Windows clean checkout и все 21 packaged subreports PASS. Native display также проверен при DPR 1 и 0.8. Девять source inputs совпадают с исходным внедрением `0a1f739`; независимое byte comparison ASAR не выполнялось, архив пакета в CI evidence не загружался.

Attempt 1 завершился failure: control-plane, Fabric 1.20.1 и NeoForge отменены до первого шага; причина не установлена. Legacy Fabric 26.2 сохранил checksum failure, expected `23248c15…`, actual `d46235d8…`; gate не менялся. Attempt 2 запущен для отсутствующих проверок. Пока его terminal evidence нет, hosted matrix остаётся PARTIAL. До человеческого ответа этап 043 не отмечается выполненным, даже при техническом PASS.
