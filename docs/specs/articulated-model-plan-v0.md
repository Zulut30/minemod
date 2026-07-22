# Spec: Articulated model plan v0

## Objective

Добавить loader-neutral вход высокого уровня для создания сочленённых cuboid-моделей. Автор задаёт локальные offsets костей и кубов относительно родителя; инструмент рассчитывает абсолютные pivots/origins и детерминированно размещает box UV без перекрытий. Результат — существующий строгий `CuboidModelSpec`, поэтому Blockbench export, текстурирование и анимации продолжают использовать проверенный pipeline.

Первый срез не генерирует анатомию из текста и не заменяет низкоуровневый контракт. Archetype-presets (`biped`, `quadruped`, weapon rigs) строятся поверх этого плана последующими срезами.

## Tech stack and structure

- TypeScript и Zod без новых dependencies.
- Контракт и JSON Schema: `packages/assets-contracts/index.ts`.
- Materializer и UV packer: `packages/assets-core/articulated-model.ts`.
- Unit/golden tests: существующие `test.ts` обоих packages.
- Demonstration fixture: `fixtures/assets/articulated-biped.plan.json`.

## Commands

```text
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm --filter @mcdev/assets-contracts test
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm --filter @mcdev/assets-core test
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm lint
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm typecheck
```

## Contract

`ArticulatedModelPlan` содержит identity/texture поля модели, `uvPadding` и bounded bones. У каждой кости есть локальный `pivotOffset`, rotation и bounded cubes. Куб задаёт `originOffset` относительно world pivot своей кости, size/rotation/inflate/mirror, но не задаёт абсолютный pivot или UV.

Порядок bones не определяет результат: parent может находиться до или после child. Иерархия должна быть ацикличной, IDs — уникальными.

## Materialization rules

1. World pivot root bone равен его `pivotOffset`.
2. World pivot child bone равен world pivot parent плюс child `pivotOffset`.
3. Cube origin равен world pivot bone плюс `originOffset`; cube pivot равен world pivot bone.
4. Box UV rectangle имеет ширину `2 × (size.x + size.z)` и высоту `size.y + size.z`.
5. UV rectangles упаковываются shelf first-fit decreasing по height, width и cube ID. Между rectangles применяется `uvPadding`.
6. Если atlas не вмещает все rectangles, materialization завершается actionable error вместо overlap.
7. Полученный объект повторно проверяется `CuboidModelSpecSchema`.

## Code style

```ts
const generated = materializeArticulatedModel(plan);
const editable = compileBlockbenchModel(generated.model);
```

Публичный результат immutable; алгоритм не использует timestamps, random или filesystem paths.

## Testing strategy

- positive fixture проверяет local-to-world transforms, hierarchy и generated model metrics;
- repeat materialization проверяет byte-stable object/hash downstream;
- rectangle-pair test доказывает отсутствие UV overlap;
- negative fixtures проверяют duplicate IDs, missing/cyclic parents и atlas overflow;
- полный workspace regression обязателен перед завершением среза.

## Boundaries

- Always: strict bounded validation, deterministic output, final `CuboidModelSpec` validation.
- Ask first: новый runtime codec, dependency или изменение Fabric target.
- Never: executable fields, raw scripts, absolute paths, silent UV overlap или изменение user-owned files.

## Success criteria

- Валидный articulated plan превращается в компилируемый `.bbmodel` без ручных absolute pivots и UV.
- Все generated UV rectangles находятся внутри atlas и не пересекаются.
- Bone order не влияет на рассчитанные transforms.
- Повторный запуск даёт идентичный результат.
- Invalid hierarchy и недостаточный atlas fail closed с понятной ошибкой.
