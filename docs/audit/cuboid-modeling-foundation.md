# Cuboid modeling foundation audit

Дата проверки: 22 июля 2026 года.

## Проверенная граница

Этот срез добавляет loader-neutral основу моделирования, но не объявляет production asset pipeline или F2.2 завершёнными.

- `packages/assets-contracts` принимает только закрытый `CuboidModelSpec` версии 0 для `entity` и `held-item`.
- Контракт ограничивает число костей и кубоидов, координаты, размеры, UV atlas, уникальность IDs и ацикличность иерархии.
- `packages/assets-core` создаёт byte-deterministic editable Blockbench project с `meta.format_version` 5.0, отдельными `elements`, `groups` и вложенным `outliner`.
- `CuboidTexturePlan` назначает каждому кубоиду bounded material и один из четырёх pixel patterns: `solid`, `panel`, `riveted` или `striped`.
- Texture renderer создаёт детерминированный RGBA PNG atlas, требует назначения для каждого кубоида и встраивает PNG в `.bbmodel` как internal data URL без абсолютного пути.
- UUID выводятся из model resource ID и element ID; timestamps и абсолютные пути в результат не добавляются.
- Метрики считаются до передачи артефакта дальше: bones, cubes и двенадцать треугольников на каждый cuboid.

Структура `.bbmodel` сверялась с текущей документацией формата и официальным serializer Blockbench:

- https://www.blockbench.net/wiki/docs/bbmodel/
- https://github.com/JannisX11/blockbench/blob/master/js/formats/bbmodel.js

Blockbench не является runtime dependency и не вендорится в проект.

## Golden fixtures

| Fixture | Тип | Bones | Cuboids | Triangles | SHA-256 экспортированного `.bbmodel` |
|---|---:|---:|---:|---:|---|
| `copper-guardian.model.json` | entity | 8 | 18 | 216 | `32760315de9f2a21aee4bb417267ae17b069954ced4f88d6f06f63a51d4fe3ab` |
| `clockwork-halberd.model.json` | held-item | 3 | 8 | 96 | `9231495fe8bb57b3272d2679258b68f6779d7949d9623e3915eab822f64274fd` |

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

Оба textured `.bbmodel` были загружены 22 июля 2026 года через `Open Model` в официальном Blockbench Web. Редактор распознал embedded texture 128×128, все 17/19 элементов и bone outliner; в консоли было 0 ошибок. Превью получены встроенной командой Blockbench `Screenshot Model`, а не отдельным image generator.

Fixtures созданы как оригинальные технические примеры по общим визуальным признакам пользовательских референсов. Пиксели, текстуры и геометрия исходных изображений не копировались.

## Выполненные проверки

На pinned Node.js 24.11.0 и pnpm 11.8.0:

```text
corepack pnpm --filter @mcdev/assets-contracts test
corepack pnpm --filter @mcdev/assets-core test
corepack pnpm typecheck
```

Покрыты valid entity/item fixtures, deterministic repeat export, golden hashes, counts, bounds, Blockbench metadata, UUID shape, PNG signature, color/opacity metrics, embedded data URL, missing/unknown texture assignments, model ID mismatch, unknown executable-looking fields, invalid resource locations, duplicate IDs, missing/cyclic parents, zero-size cuboids и UV overflow.

## Не доказано этим срезом

- автоматическое построение модели из текста или concept image;
- генерация AI/concept-aware текстуры; текущий atlas строится только из заданных palette/material/pattern;
- keyframe animations;
- GeckoLib или другой runtime export для Fabric 1.20.1;
- открытие golden files в GUI Blockbench;
- загрузка/рендер модели в Minecraft client;
- визуальное соответствие пользовательскому референсу.

Следующий asset slice должен строить semantic anatomy из ограниченных primitives и генерировать детерминированный UV/PNG atlas. Выбор runtime animation library выполняется только после отдельной проверки exact версии с Fabric 1.20.1.
