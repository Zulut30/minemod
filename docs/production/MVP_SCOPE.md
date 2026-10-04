# Границы MVP и отказ от неподдержанного ввода

Roadmap: пункт 007. Scope следует [Fabric-плану](../FABRIC_FIRST_MVP_PLAN.md), [ADR-0004](../decisions/0004-fabric-1.20.1-production-baseline.md) и [release contract](RELEASE_CONTRACT.md).

В первый production входят version-tested ModSpec primitives, editable cuboid assets, pixel textures, Studio/CLI/MCP, companion/ritual/native UI и проверенный Fabric 1.20.1 bundle. Статус каждой возможности хранится в [аудите](CAPABILITY_AUDIT.md); включение в scope не означает сегодняшнюю реализацию.

## Что явно исключено

| Запрос | Граница | Какой результат допустим |
|---|---|---|
| Передать произвольный Java, shell, Gradle task или environment через ModSpec/MCP | Strict schemas, immutable catalogs, closed BuildPlan/runner | Schema/capability diagnostic; текст не становится executable input |
| Выполнить Blender Python/Blockbench JavaScript/eval | Нет generic executor в публичных tools | Неизвестный tool/command отклоняется; нет файлового или execution side effect |
| Экспортировать generic mesh/OBJ как production-модель | Только declared target profiles | Explicit unsupported/format diagnostic; нельзя заменить mesh случайными кубами и назвать задачу выполненной |
| Генерировать физику кораблей, большие worldgen-системы или marketplace | Не входит в первый MVP | Точная unsupported primitive/capability, без молчаливого пропуска |
| Получить parity всех loaders/версий | Отдельные compatibility packs и maturity gates | Неверный selector отклоняется; основной target не меняется автоматически |
| Обойти Windows/POSIX guard ради сборки | Linux x64 runner и trusted pack integrity | Отдельно показать unsupported environment/integrity failure; не выдавать skipped build за PASS |
| Выдать concept за готовую 3D-модель | Concept и editable/runtime artifact различаются | Candidate/evidence gap, не artistic approval |
| Отправить placeholder в production | Art/release gates | Требуется repair настоящих ресурсов; warning не становится доказательством готовности |

## Реализованные границы, проверенные сейчас

Editor `MutationSchema` отклоняет неизвестный command как `INVALID_COMMAND`; `validateProject` ограничивает профиль и размеры. Revision/locks/preview isolation не обходятся через raw payload. HTTP suite проверяет эти границы реальными клиентами.

Fabric `validateSupportedSpec` возвращает `SPEC_UNSUPPORTED` с конкретным path для unsupported entities/screens/libraries/recipes и других primitives. Strict wire validation отделена от компиляции. Minecraft item exporter отклоняет неверный modelType, unsupported transforms и geometry bounds. Build runner проверяет фиксированные policies и trusted snapshot; generic task/string execution не добавляется.

На Linux hosted `control-plane` для source `0b04d68` прошли все workspace unit suites, включая compiler-fabric, validation, runner, application и desktop tests. На Windows свежие portable и HTTP MCP suites прошли отдельно. Общий workflow тогда завершился failure из-за других jobs: это не общий hosted release PASS. Подробности: [scope-007.json](evidence/scope-007.json).

Полный художественный evaluator и production-bundle placeholder gate ещё требуют реализации в пунктах 49/64. Их будущие правила не выдаются здесь за существующую автоматизацию.

## Приёмка пункта 007

Границы MVP названы явно. Публичные schemas/tools/emitters соответствуют закрытой модели и дают diagnostics на неподдержанный ввод; negative branches проверены в применимых текущих suites. Запланированные entities/blocks не исключены из цели ради обхода недостающего кода. Production и платформенные gaps остаются отдельными пунктами roadmap.
