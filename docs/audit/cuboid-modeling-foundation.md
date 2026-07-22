# Cuboid modeling foundation audit

Дата проверки: 22 июля 2026 года.

## Проверенная граница

Этот срез добавляет loader-neutral основу моделирования, но не объявляет production asset pipeline или F2.2 завершёнными.

- `packages/assets-contracts` принимает только закрытый `CuboidModelSpec` версии 0 для `entity` и `held-item`.
- Контракт ограничивает число костей и кубоидов, координаты, размеры, UV atlas, уникальность IDs и ацикличность иерархии.
- `packages/assets-core` создаёт byte-deterministic editable Blockbench project с `meta.format_version` 5.0, отдельными `elements`, `groups` и вложенным `outliner`.
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

Fixtures созданы как оригинальные технические примеры по общим визуальным признакам пользовательских референсов. Пиксели, текстуры и геометрия исходных изображений не копировались.

## Выполненные проверки

На pinned Node.js 24.11.0 и pnpm 11.8.0:

```text
corepack pnpm --filter @mcdev/assets-contracts test
corepack pnpm --filter @mcdev/assets-core test
corepack pnpm typecheck
```

Покрыты valid entity/item fixtures, deterministic repeat export, golden hashes, counts, bounds, Blockbench metadata, UUID shape, unknown executable-looking fields, invalid resource locations, duplicate IDs, missing/cyclic parents, zero-size cuboids и UV overflow.

## Не доказано этим срезом

- автоматическое построение модели из текста или concept image;
- генерация или упаковка PNG texture atlas;
- keyframe animations;
- GeckoLib или другой runtime export для Fabric 1.20.1;
- открытие golden files в GUI Blockbench;
- загрузка/рендер модели в Minecraft client;
- визуальное соответствие пользовательскому референсу.

Следующий asset slice должен строить semantic anatomy из ограниченных primitives и генерировать детерминированный UV/PNG atlas. Выбор runtime animation library выполняется только после отдельной проверки exact версии с Fabric 1.20.1.
