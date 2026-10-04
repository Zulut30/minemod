# Три уровня выпуска и условия приёмки

Roadmap: пункт 003. Это спецификация gates, а не реализованный автоматический release evaluator. Опирается на [контракт](RELEASE_CONTRACT.md), [сценарии](USER_SCENARIOS.md), [art rubric](../quality/art-quality-rubric-v0.md) и [Fabric Definition of Done](../FABRIC_FIRST_MVP_PLAN.md#7-definition-of-done).

## R1: локальная beta редактора

**Обещание:** пользователь самостоятельно создаёт и редактирует поддерживаемый held-item в Windows Studio, подключает любой из двух проверенных клиентов, сохраняет проект и получает технически корректный отдельный экспорт.

**Обязательные доказательства:**

- Clean desktop build, проверка упакованного EXE и пройденные editor/MCP-сценарии на заявленной ОС.
- Autosave/recovery и undo/redo геометрии, UV и пикселей; manual/agent revision conflict не теряет данные.
- По одному настоящему Codex и Claude Code сеансу от пустого проекта до bundle без прямой подмены файлов.
- Несколько ракурсов, native 32/64 px, подтверждённое человеком направление дизайна на контрольном брифе.
- Export validation, совпадение editable/runtime files и hashes, документация подключения и восстановления.
- Проверка desktop/MCP permissions, bounded payloads и отсутствия секретов в проекте/экспорте.

**Не является обещанием:** готовый JAR с этой моделью, in-game fitness, wearable 3D-броня, декоративные блоки или complete generator. Принятие направления дизайна в R1 не устанавливает production-статус `APPROVED`: полная rubric требует игровые evidence и точные candidate/scorecard hashes.

**Блокирующие условия:** потеря пользовательских данных, некорректный экспорт, отсутствие реального сеанса одного из заявленных клиентов, обход permission boundary, неизвестные права на выпускаемые компоненты.

## R2: beta авторских ресурсов в Minecraft

**Обещание:** пользователь интегрирует авторское оружие и блок через reviewed asset bundle и получает рабочий Fabric 1.20.1 мод.

**Дополнительно к R1 обязательны:**

- Versioned ModSpec↔asset contract; проверены namespaces, hashes и ссылки. Нет trusted-pack mutation или подмены JAR.
- Authoring/export block target и текстуры всех граней; blockstates, placement, collision и drop соответствуют спецификации.
- У оружия проверены inventory, обе руки, first/third person и ground в применимых contexts.
- Clean build с exact Java 17/Fabric tuple, серверные поведенческие тесты, client harness и dedicated-server lifecycle.
- Нейтральные и игровые captures; полный technical/visual/in-game/provenance scorecard, отсутствие blockers и human approval точных hashes.
- Нет placeholder/missing texture в выпускаемом наборе. Отсутствие optional adapters не ломает загрузку.

**Не является обещанием:** выполненный Tidecaller, machine/menu, все entity animations или parity других loaders. Эти gaps остаются видимыми в документации и release metadata.

**Блокирующие условия:** mismatch approved hashes, отсутствие игровых evidence, fallback textures, ошибки server/client separation или невоспроизводимый build path.

## R3: production всего MineMod

**Обещание:** полный результат Fabric-first MVP и обе пользовательские истории воспроизводимы из clean inputs через CLI/MCP.

**Дополнительно к R2 обязательны:**

- Закрыта Definition of Done текущего Fabric-плана, включая Tidecaller: companion, gameplay, ritual, UI, локализации, models/textures/animations и поддержанные optional integrations.
- Пройдены все пять dogfood-проектов: basic content, Tidecaller, machine/menu, animated prop, configuration/UI utility. Generated source не исправляется вручную.
- Hosted CI подтверждает production-target 1.20.1/Java 17 и Windows desktop. Existing regression backends сохранены.
- Проверены failure injection, multiplayer authority, compatibility absent/present, аппаратные бюджеты и внешний пользовательский пилот.
- Дистрибутив, подпись, rollback/migrations и bundle verification работают на clean machine.
- JAR/sources/editable assets/docs/licenses/SBOM/provenance/evidence/hashes входят в release bundle. Никаких unresolved critical/high security, data-loss и license findings.
- Пункты 001–099 имеют применимые доказательства и commits; publication point 100 выполняется после приёмки exact digest.

**Блокирующие условия:** любой незакрытый обязательный gate; beta-доказательства не заменяют full-MVP-доказательства.

## Как фиксировать решение

Для выбранного уровня записываются source revision, pack revision, app version, artifact hashes, evidence index и результаты reviewers. Если source/runtime/evidence изменились, предыдущая приёмка не переносится автоматически. Успешный `publish_prepare` только готовит проверенный bundle; опубликованным релиз становится после отдельной операции с согласованным digest.

Документ пункта 003 принят как перечень требований: он различает три обещания и исключает подмену игрового качества desktop PASS. Реальные результаты R1/R2/R3 добавляются по мере реализации; ни один уровень сейчас не объявлен завершённым.
