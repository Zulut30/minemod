## Проблема и результат

<!-- Конкретный trigger и поведение до/после. Один согласованный предмет изменения. -->

## Проверка

<!-- Source/pack/input revision, окружение, команды, результаты и ссылки на evidence. Разделить portable, packaged, Minecraft и human review; unverified указать явно. -->

## Контракты и зависимости

<!-- Указать изменения ModSpec/ArtSpec/project schema, миграцию/явный отказ и сохранность исходника. Для pack — новая revision и migration report. Для dependency — exact version/source/license/hashes; либо явно "без изменений". -->

## Ограничения

<!-- Остаточные blockers, неподдерживаемые действия, новые риски и rollback. -->

- [ ] Diff ограничен задачей; generated code исправлен через emitter, а не вручную в output.
- [ ] Strict contracts, server-side limits, ownership и client/server separation сохранены.
- [ ] Применимые lint/typecheck/suites прошли; проверки, которые не выполнены, перечислены.
- [ ] Game output имеет применимые clean build/GameTests/dedicated-server доказательства.
- [ ] Asset/export изменения сопровождаются captures; состояние human/game review указано отдельно.
- [ ] Dependency, pack и schema изменения имеют review и применимый migration report.

<!-- Политика: CONTRIBUTING.md. Неприменимые пункты пояснить, не отмечать как выполненную проверку. -->
