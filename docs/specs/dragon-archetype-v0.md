# Spec: Dragon archetype v0

## Назначение

Первый параметрический archetype для сложных существ проверяет, что asset pipeline способен создавать крупную модель без ручного дублирования всей геометрии. `createDragonArchetype` строит loader-neutral `ArticulatedModelPlan`, а существующие materializer, UV packer и Blockbench compiler остаются единственным путём экспорта.

## Реализовано

- 44 семантически названные кости и 88 cuboid-деталей;
- отдельные pivots для четырёх сегментов шеи, челюсти, шести сегментов крыла с каждой стороны, четырёх лап, рогов и семи сегментов хвоста;
- детерминированное зеркалирование левой анатомии в правую с отражением pivot, rotations, cube origins и UV mirror flag;
- 256×256 atlas с padding без UV overlap;
- органические texture patterns `scales`, `mottled` и `gradient` для кожи, брюха, перепонок, рогов и шипов;
- structural preflight: минимальные budgets, hierarchy depth, scale bands, обязательные animation bones, bilateral symmetry и bounds;
- byte-stable golden hashes для `.bbmodel` и embedded PNG.

## Границы

Structural preflight ловит сломанную анатомическую иерархию и грубую асимметрию, но не утверждает художественное качество. Release candidate по-прежнему требует neutral turntable, проверки силуэта на игровой дистанции, анимационных клипов, Fabric 1.20.1 runtime export и human approval по `Art Quality Rubric v0`.

Архетип не содержит mesh-деформации: это Minecraft-совместимый cuboid rig. Перепонки крыла собраны из тонких секций; будущий runtime adapter обязан подтвердить их render/culling policy на целевой версии.

## Проверка

```text
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm --filter @mcdev/assets-contracts test
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm --filter @mcdev/assets-core test
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm typecheck
PATH=/home/debian/.cache/mcdev/toolchains/node-v24.11.0/bin:$PATH corepack pnpm lint
```
