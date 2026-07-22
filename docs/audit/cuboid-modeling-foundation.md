# Cuboid modeling foundation audit

Дата проверки: 22 июля 2026 года.

## Проверенная граница

Этот срез добавляет loader-neutral основу моделирования, но не объявляет production asset pipeline или F2.2 завершёнными.

- `packages/assets-contracts` принимает только закрытый `CuboidModelSpec` версии 0 для `entity` и `held-item`.
- Контракт ограничивает число костей и кубоидов, координаты, размеры, UV atlas, уникальность IDs и ацикличность иерархии.
- `packages/assets-core` создаёт byte-deterministic editable Blockbench project с `meta.format_version` 5.0, отдельными `elements`, `groups` и вложенным `outliner`.
- `ArticulatedModelPlan` позволяет задавать pivot кости и origin куба локально относительно parent; materializer вычисляет world transforms независимо от порядка bones и автоматически упаковывает box UV с заданным padding без overlap.
- `CuboidTexturePlan` назначает каждому кубоиду bounded material и один из четырёх pixel patterns: `solid`, `panel`, `riveted` или `striped`.
- Texture renderer создаёт детерминированный RGBA PNG atlas, требует назначения для каждого кубоида и встраивает PNG в `.bbmodel` как internal data URL без абсолютного пути.
- `PixelIconPlan` отдельно описывает bounded инвентарную иконку 16×16 или 32×32 из палитры, линий и прямоугольников; compiler создаёт PNG и стандартную item-model ссылку `minecraft:item/handheld`.
- `CuboidAnimationPlan` описывает bounded position/rotation tracks с проверкой clip length, возрастающего времени keyframes, уникальности bone channels и ограничений координат/углов.
- UUID выводятся из model resource ID и element ID; timestamps и абсолютные пути в результат не добавляются.
- Метрики считаются до передачи артефакта дальше: bones, cubes и двенадцать треугольников на каждый cuboid.

Структура `.bbmodel` сверялась с текущей документацией формата и официальным serializer Blockbench:

- https://www.blockbench.net/wiki/docs/bbmodel/
- https://github.com/JannisX11/blockbench/blob/master/js/io/formats/bbmodel.js

Blockbench не является runtime dependency и не вендорится в проект.

## Golden fixtures

| Fixture | Тип | Bones | Cuboids | Triangles | SHA-256 экспортированного `.bbmodel` |
|---|---:|---:|---:|---:|---|
| `copper-guardian.model.json` | entity | 8 | 18 | 216 | `32760315de9f2a21aee4bb417267ae17b069954ced4f88d6f06f63a51d4fe3ab` |
| `clockwork-halberd.model.json` | held-item | 3 | 8 | 96 | `9231495fe8bb57b3272d2679258b68f6779d7949d9623e3915eab822f64274fd` |

Articulated materialization evidence:

| Fixture | Bones | Cuboids | UV rectangles | Used atlas | UV utilization | `.bbmodel` SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| `articulated-biped.plan.json` | 13 | 12 | 12 | 63×61 of 64×64 | 65.48% | `46e99621e21a28833419096e359edf7819dd5fe1fce23af0db52fe6f68a6f498` |
| `merchant-galleon.plan.json` | 30 | 72 | 72 | 255×255 of 256×256 | 77.82% | `e0e1bda3ba1058cc8f3c7f284228f3dd25a9c0bacb780ec0a5cc0f9ebb523b63` |

Fixture задаёт только local `pivotOffset`/`originOffset`: absolute pivot, cube origin и UV отсутствуют во входе. Pairwise test проверяет отсутствие пересечения всех UV rectangles; reversed bone order даёт те же world pivots. Атлас 16×16 для того же плана fail closed с указанием первого не помещающегося куба.

`Merchant Galleon` используется как stress-test не-гуманоидного объекта: ступенчатый корпус, палуба, нос, корма, руль, бушприт, каюта, пушечные порты, три мачты, реи, паруса, флаги и такелаж собраны в одну редактируемую иерархию. Первоначальный shelf packer не мог разместить UV даже при достаточной суммарной площади. Детерминированный MaxRects-подобный packer размещает все 72 прямоугольника с padding 1; pairwise test подтверждает отсутствие пересечений.

Textured export evidence:

| Fixture | PNG colors | Opaque pixels | PNG SHA-256 | Textured `.bbmodel` SHA-256 |
|---|---:|---:|---|---|
| Copper Guardian | 16 | 5,628 | `f102ca35b799828cc4b0a0300efd8e3308e9f1361afc58ea6876c6335908d828` | `94de00239c5c77512a4ddae2455332473a5a3a67d3526c8d511d1e26c530c5a2` |
| Clockwork Halberd | 15 | 1,640 | `4dd514804d2ccccd01691c3700c1abbf8d04b8902e50f01f08e2b589d1801b84` | `2432bc448de494d262b627040f78ad194093f4323b71b602ae7274ca383183fb` |

Showcase weapon evidence:

| Fixture | Bones | Cuboids | PNG colors | PNG SHA-256 | Textured `.bbmodel` SHA-256 |
|---|---:|---:|---:|---|---|
| Blue Steel Greatsword | 5 | 17 | 16 | `0e918e938f3dbe25f47eaf053ac17c0904e90d7299a204f540204eca39b0ef9a` | `bf5bd530bfb2578b4cfb12c2401e05ae0f607cbb2f7ca52e606ded264ebe44e3` |
| Death Scythe | 4 | 19 | 16 | `3ad8236db226dcbba485a7f9e60337bce71e4fc9b8428722017d1f297010f2d3` | `ceb7ae11453aa4ce663d25ae154c4d34536a0eb13a289473de2d2a5332738444` |

Inventory icon evidence:

| Fixture | Размер | Непрозрачные пиксели | PNG colors | PNG SHA-256 | Item model SHA-256 |
|---|---:|---:|---:|---|---|
| Death Scythe | 32×32 | 223 | 6 | `149d8fbd69b0421e239f5b44be805ec79bd5af082905367c6e15e7f7863adbd9` | `2f93ae9cacc20023500dfc4f4997e067416b5f6733f7de184a1f220ed64bed45` |

Entity showcase evidence:

| Fixture | Bones | Cuboids | Triangles | PNG colors | PNG SHA-256 | Textured `.bbmodel` SHA-256 |
|---|---:|---:|---:|---:|---|---|
| Fungal Infected v2 | 27 | 60 | 720 | ≥20 | `9968f8e7a4c56d121650a22e98b131964365b29c640f4cca895eab0c092b3863` | `ec80872b28c1276b61593273c5510689e0259a491c36b57295540ccb6aa32cf6` |

Large object showcase evidence:

| Fixture | Bones | Cuboids | Triangles | PNG colors | Opaque pixels | PNG SHA-256 | Textured `.bbmodel` SHA-256 |
|---|---:|---:|---:|---:|---:|---|---|
| Merchant Galleon | 30 | 72 | 864 | 42 | 50,998 | `d159697b6102aa62d2ccbde351895a814a790f5d299ce3b1222369578f3bcf3b` | `e0e1bda3ba1058cc8f3c7f284228f3dd25a9c0bacb780ec0a5cc0f9ebb523b63` |

Animation evidence:

| Fixture | Clips | Tracks | Keyframes | Animated `.bbmodel` SHA-256 |
|---|---:|---:|---:|---|
| Fungal Infected v2 | 4 | 34 | 170 | `6fabbb24e8d020fc36e51b0f040f09a5d215bf108cb40e6b5ae91697e2d069d0` |

Клипы: циклические `idle` (2.0 s) и `walk` (1.0 s), однократные `climb_block` (1.0 s) и `attack` (0.8 s). `idle` использует отдельные pelvis/chest/neck и вторичное движение шляпок, щупалец и споровых наростов. Loop tracks обязаны покрывать полную длину и завершаться исходным значением; non-hold root position также обязан вернуться в начало, поэтому физическое перемещение остаётся ответственностью Minecraft entity. Для вращений и позиций используются стабильные bone UUID; keyframe UUID детерминированы из model/clip/bone/channel/index.

Оба textured `.bbmodel` были загружены 22 июля 2026 года через `Open Model` в официальном Blockbench Web. Редактор распознал embedded texture 128×128, все 17/19 элементов и bone outliner; в консоли было 0 ошибок. Превью получены встроенной командой Blockbench `Screenshot Model`, а не отдельным image generator.

`Fungal Infected v2` загружен в официальный Blockbench Web: редактор распознал embedded texture 128×128, 60/60 элементов и иерархию из 27 bones; в консоли было 0 ошибок. Иерархия включает pelvis/chest/neck, отдельные forearm/hand, shin/foot, грибные шляпки, щупальца и споровые наросты.

Анимированный `Fungal Infected v2` повторно загружен в Blockbench Web. Вкладка Animate распознала четыре именованных клипа, включая новый двухсекундный `idle`; root timeline содержит все пять ожидаемых position keyframes, `idle` проигран, в консоли было 0 ошибок.

`Merchant Galleon` загружен в официальный Blockbench Web: редактор распознал embedded texture 256×256, все 72/72 элемента и иерархию из 30 bones; в консоли было 0 ошибок. Визуально проверены полный силуэт, три мачты, отдельные ярусы парусов, флаги, бушприт и цветовые слои корпуса.

Fixtures созданы как оригинальные технические примеры по общим визуальным признакам пользовательских референсов. Пиксели, текстуры и геометрия исходных изображений не копировались.

## Выполненные проверки

На pinned Node.js 24.11.0 и pnpm 11.8.0:

```text
corepack pnpm --filter @mcdev/assets-contracts test
corepack pnpm --filter @mcdev/assets-core test
corepack pnpm typecheck
```

Покрыты valid entity/item/icon/animation/articulated fixtures, local-to-world transforms, bone-order independence, deterministic UV packing, pairwise UV non-overlap, atlas overflow, deterministic repeat export, golden hashes, counts, bounds, articulated-bone presence, Blockbench metadata, UUID shape, PNG signature, color/opacity metrics, embedded data URL, item model JSON, animation metrics, loop continuity, root-position restoration, missing animation bones, mismatched model IDs, duplicate tracks, unordered/out-of-range keyframes, missing/unknown texture assignments, unknown executable-looking fields, invalid resource locations, duplicate IDs, missing/cyclic parents, zero-size cuboids и UV overflow.

## Не доказано этим срезом

- автоматическое построение модели из текста или concept image;
- генерация AI/concept-aware текстуры; текущий atlas строится только из заданных palette/material/pattern;
- GeckoLib или другой runtime export для Fabric 1.20.1;
- переключение клипов из AI/навигации сущности и синхронизация root motion с Minecraft collision/navigation;
- автоматическое GUI-тестирование каждого golden file в Blockbench;
- загрузка/рендер модели в Minecraft client;
- визуальное соответствие пользовательскому референсу.

Следующий asset slice должен строить semantic anatomy из ограниченных primitives и генерировать детерминированный UV/PNG atlas. Выбор runtime animation library выполняется только после отдельной проверки exact версии с Fabric 1.20.1.
