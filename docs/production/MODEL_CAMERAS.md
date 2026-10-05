# Предсказуемый обзор модели

Roadmap 023. Studio 0.9.0 поддерживает восемь ортографических ракурсов и прежнее имя `side`: `front`, `back`, `left`, `right`, `top`, `bottom`, `perspective`, `rear-perspective`. Два «3D» вида используют orthographic three-quarter projection; это не перспективная камера с изменяющимся от расстояния масштабом. `side` и `right` совпадают. В формате проекта ничего не меняется.

## Ручной путь и агент

В «Модель» доступны прежние четыре кнопки и меню «Ещё ракурсы»: слева, справа, сверху, снизу и 3D сзади. ЛКМ вращает камеру, колесо изменяет zoom, ПКМ переносит target. Кнопка с глазом «Показать всю модель» заново вычисляет кадр для текущего ракурса. Изменение геометрии сохраняет ручной orbit; смена ракурса/проекта, resize и явный fit задают новый кадр. В texture-focus кадр ограничен выбранными кубами, как в предыдущей версии.

`studio_view_capture` принимает все девять имён через опубликованную enum schema. Он снимает весь snapshot своей revision в отдельном скрытом окне; ручная камера, выделение, скрытие частей и документ не меняются. Тест теперь наблюдает реальные camera position/target/quaternion/zoom при drag/pan, а не только preset metadata до вращения. Render jobs по-прежнему ограничены очередью, bytes и deadline.

Для сравнения сохранённого варианта и текущей модели используйте один view: `variantId` для исходника, `compareToVariantId` для рабочей модели. Общая рамка строится из обоих snapshots, поэтому разница размеров видна, а zoom не подгоняется независимо под каждый вариант. Порядок snapshots не влияет на общую рамку.

`studio_model_review` и обзорная доска остаются быстрым обзором четырёх привычных видов с native 32/64 px. Они не объявляются полной восьмисторонней художественной матрицей. Для проверки обратной стороны, толщины и креплений снимайте дополнительные виды через capture либо выбирайте их вручную. Art review и игровой вид остаются отдельными gates.

## Кадрирование

Рамка включает восемь углов каждого cuboid с `inflate`, поворотом и его собственным pivot. Центр берётся из world-space AABB; bounding sphere имеет диаметр диагонали этого AABB. Один диаметр и запас 12% задают единый zoom для всех views при одинаковом размере canvas. Это учитывает изменённый pivot повёрнутого куба, который прежний fit по origin/size мог обрезать.

Позиция камеры и near/far зависят от размера рамки. Значения ниже прежнего минимального zoom 4 разрешены, поэтому большой допустимый pivot не блокирует fit маленького viewport. Для top/bottom используются независимые up vectors; OrbitControls пересоздаётся при смене view, поскольку pinned Three.js сохраняет up в конструкторе. Capture job ID остаётся зависимостью кадрирования после исправления roadmap 024.

Square thumbnails используют тот же расчёт при 64×64. Native 32 px получается nearest downscale без подмены отдельным marketing render. Изменение камеры намеренно меняет PNG предыдущих версий; сравнение art candidates должно учитывать renderer version. Рамка является защитой от clipping, а не оценкой художественного качества.

## Проверки

После исходного evidence 023 обнаружена отдельная гонка layout при загрузке миниатюр четырёхстороннего обзора: поздний hidden screenshot уже корректен, а первый MCP PNG может обрезать предмет. Studio 0.14.1 резервирует место до загрузки изображений. [Отрицательный witness 0.14.0, исправленный PNG и hosted статус](CAPTURE_LAYOUT_FIX.md) сохраняются отдельно; прежний camera projection proof не считается проверкой этой гонки.

- Pure camera suite проецирует **31 968 углов** через настоящий pinned Three.js: девять preset names, четыре aspect ratios, полный предмет/часть/крайние pivot и inflate/общую рамку. Проверяются NDC bounds, near/far, одинаковый zoom, up vectors, alias и отсутствие mutation snapshots.
- Hidden packaged E2E выполняет реальный orbit и pan через CDP собственного окна, затем снимает все ракурсы через публичный HTTP MCP. Проверяются textured pixels, идентичность alias PNG, сохранность фактической ручной камеры и документа, fit, top/bottom и компактный toolbar.
- Три пары сравнения source/working используют одинаковую фактическую camera matrix, показывая разные PNG после правки геометрии. Их hashes входят в [evidence](evidence/cameras-023.json).
- Полный packaged suite дополнительно проверяет review thumbnails, варианты, геометрию, историю и recovery. Fabric 1.20.1 build/GameTests/server подтверждаются отдельным CI; эти ракурсы не считаются игровыми captures.

Официальные [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html) и [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) сверены 4 октября 2026 года; Context7 `/mrdoob/three.js` использован для projection update и target controls. Реальное поведение constructor/up дополнительно сверено с installed `three@0.186.1`. Dependencies не менялись.
