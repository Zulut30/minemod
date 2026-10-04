# Правила изменений MineMod

Основной target — Fabric 1.20.1 / Java 17, desktop — проверяемый Windows x64 Studio. Перед архитектурным решением прочитать [README](../../README.md), [ADR-0004](../decisions/0004-fabric-1.20.1-production-baseline.md) и [Fabric-first plan](../FABRIC_FIRST_MVP_PLAN.md). Исторический research не заменяет текущий baseline.

## Размер и предмет изменения

Один diff исправляет определённую причину или добавляет согласованную capability. Описать trigger, поведение до/после и ограничения. Косметический рефакторинг соседнего модуля не смешивать с исправлением. Для generated output исправлять emitter/contract, затем повторять генерацию: ручная правка сгенерированного Java не является исправлением генератора.

Например, backup публиковался прямым `copyFile` и мог оказаться частичным при завершении процесса. [Исправление autosave](AUTOSAVE_RECOVERY.md) меняет только persistence и подтверждается остановкой собственного процесса внутри записи, recovery E2E и hashes распространяемого пакета. Оно не требует изменения Minecraft fixture или Java templates.

## Контракты и миграции

Изменение входной схемы описывает версию, default для старого входа либо явный отказ, лимиты, ссылочную целостность и unsupported capabilities. Добавить meaningful negative case для опасного входа; не ослаблять strict parser ради convenience. Старый проект до миграции должен остаться доступен для восстановления. ModSpec, ArtSpec и editor project имеют отдельные версии.

Trusted runtime trees после регистрации неизменны. Dependency/template update создаёт новую revision, before/after tuple и digests, migration report и rollback. [Compatibility policy](COMPATIBILITY_POLICY.md) распространяется и на verification metadata. Не лечить checksum error wildcard-доверием к внешним скачиваемым JAR.

## Зависимости и источники

Для новой или обновлённой зависимости проверить точную версию, официальный источник, лицензию, transitive состав и advisories. Зафиксировать lock, integrity/hashes и требуемые notices. В PR записать эти доказательства; отсутствие dependency change указать явно. Официальный API сверить с pinned target и Context7. Публичный код или asset без разрешающей лицензии не копировать.

MCP не получает generic shell, arbitrary eval, Java source, сторонние Gradle tasks или неограниченные network payloads. Runtime guards и server-side limits нельзя переносить только в UI. Путь, Origin/Host, IPC sender, revision/CAS и output ownership проверяются на соответствующей границе.

## Проверки и доказательства

Выбирать проверку по реальному риску. Повторяющий implementation unit test не заменяет negative input, transaction rollback, process-crash или настоящий runtime сценарий. Для безопасной правки текста дополнительные unit tests обычно не нужны. Для кода пройти lint/typecheck и затронутые suites; для generated game output — clean build, GameTests и dedicated server на поддержанном окружении. [Обязательный CI](MERGE_CHECKS.md) сохраняет отдельные Windows, production и regression checks.

В evidence записать точный source/input/pack hash, command/scenario, окружение и фактический статус. Mock, portable tests, packaged E2E и Minecraft проверяют разные области. Не выдавать пропуск проверки за PASS. Для authored модели выполнить export, lossless captures с нескольких сторон и [визуальный цикл](../AI_CODE_AND_3D_WORKFLOW.md), затем явную reviewed интеграцию и проверку в игре.

Technical PASS не является human art approval. Publication требует отдельного решения владельца по точному release digest. [Назначенные роли](REVIEW_ROLES.md) определяют, кто вправе принимать результат.

## Review

GitHub использует [PR template](../../.github/pull_request_template.md): reviewer видит проблему, ограниченный diff, contract/dependency changes и фактическое evidence. Отметки checklist — утверждения автора, не автоматическая художественная приёмка. Roadmap пункт закрывать только когда его критерий выполнен; отдельный `roadmap(NNN)` commit содержит результат и ссылку на проверку.
