# Generated Java: читаемые emitters и обязательная проверка исходников

Дата: 5 октября 2026 года. Пункт 018 выполнен в указанном ниже техническом scope. Compiler `@mcdev/compiler-fabric@0.1.1-phase.2`. Основной target остаётся Fabric 1.20.1 / Java 17.

Методы `Tier` и `ArmorMaterial` теперь имеют отдельные annotations, сигнатуры, тела и разделение пустыми строками. Расчёт durability/defense, float32 values, repair ingredients и registrations сохраняется. Compiler identity изменена, поэтому node input/cache keys не смешиваются с предыдущим emitter. ModSpec и trusted pack tuple/revision не менялись.

Пустой `GeneratedClient.onInitializeClient()` и его `client` entrypoint больше не генерируются. У current basic-content profile нет работы для этого callback. Common initialization по-прежнему регистрирует содержимое; YACL/Mod Menu UI загружается собственным `modmenu` entrypoint из client source set. Перед удалением scaffold hook compiler проверяет точное ожидаемое имя из проверенного template. Неизвестный client hook приводит к отказу, вместо молчаливого удаления нового поведения. Pack/templates и fixtures не изменяются: compiler обрабатывает проверенный template в своих generated outputs.

## Проверка исходников

`GeneratedConfig.normalize()` создаётся и вызывается только при наличии integer/string options, которые действительно требуют проверки диапазона или длины. Default и boolean-only конфигурации не содержат пустую нормализацию. Лишний явный public constructor убран: для public top-level класса Java 17 предоставляет public constructor без аргументов автоматически. Сохраняются JSON5 handler, поля и их начальные значения, настоящие ограничения и YACL controls. Это проверяется отдельно для default, boolean-only и mixed конфигурации; источник правила — [JLS 17, default constructor](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.8.9).

Перед созданием BuildPlan все generated `.java` проходят `assertGeneratedJavaQuality`:

- Исходники должны использовать LF.
- Незавершённые комментарии и литералы отклоняются.
- Комментарии с TODO/FIXME/STUB/PLACEHOLDER отклоняются.
- Исполняемая конструкция `throw new UnsupportedOperationException` отклоняется как типичная заготовка.
- Ссылки на Forge/NeoForge в Fabric-исходниках отклоняются.
- Ссылки на Minecraft client types в `src/main/java` отклоняются; `src/client/java` допускает настоящие client imports.

Проверка сначала переводит Java Unicode escapes по правилам Java 17, затем отличает code/comments от string/char/text-block literals. Поэтому Unicode-запись TODO-комментария или client type не обходит проверку, а пользовательский текст `/* TODO */` внутри annotation string сохраняется. Metadata descriptions не считаются Java comments. Empty public constructor и anonymous subclass для protected vanilla constructor допустимы: они сами по себе не являются незавершёнными методами.

Это ограниченная проверка принадлежащих compiler исходников, а не Java parser, formatter стороннего кода, security sandbox или доказательство отсутствия любого смыслового дефекта. Public ModSpec не принимает Java source. Javac, generated clean build, runtime tests и review остаются обязательными. Проверка не присваивает artistic approval и не отменяет предупреждение `PLACEHOLDER_ASSETS_USED`: текущие basic item/block textures ещё требуют отдельной реализации пункта 064.

## Review evidence

Generated equipment/config build-test при заданном оператором `MCDEV_FABRIC_TEST_REPORT_DIR` сохраняет `.java` и `fabric.mod.json` под `generated-source/`, а также `source-review-manifest.json` с planId, pack ref, путями, размерами и SHA-256. Это именно outputs компилятора, которые затем собираются в workspace; build и server logs сохраняются отдельно. Trusted pack и пользовательские файлы не подменяются. CI уже публикует этот report directory.

Unit suite содержит 15 допустимых и 22 запрещённых случай, включая comments, strings, escaped quotes, text blocks, Unicode eligibility, common/client separation и foreign loader references. Compiler suite дополнительно проверяет отсутствие пустого client hook, native metadata и сохранение пользовательского annotation text. Полный backend suite требует Linux. Локальный Windows вызов не прошёл pack integrity check: `templates/gradlew` имеет правильные 9671 bytes и SHA-256, но filesystem mode 0666 вместо требуемого executable 0755. Проверку не ослабляли; этот вызов не считается PASS.

[Evidence пункта 018](evidence/generated-java-018.json) подтверждает exact source `da6c6f6` в [hosted run 37290676327](https://github.com/Zulut30/minemod/actions/runs/37290676327). Full Linux compiler, strict generated build, два infrastructure GameTests, fixture/generated dedicated server, client smoke и packaged Windows Studio прошли. Пять generated Java и metadata просмотрены текущим агентом; размеры и SHA-256 всех шести файлов совпали с manifest, все Java повторно прошли source quality gate. Mixed config сохраняет реальные ограничения; единственный изменённый source относительно phase.1 — `GeneratedConfig`. Это implementation self-review, human code acceptance не записана. Полная generated gameplay и художественная приёмка являются отдельными gates. Общий workflow failed из-за существующего Fabric 26.2 derived-JAR checksum mismatch; проверки и pack не ослаблялись.

Источники: [Java 17 lexical structure](https://docs.oracle.com/javase/specs/jls/se17/html/jls-3.html), [Fabric project structure](https://docs.fabricmc.net/develop/getting-started/project-structure), [Loom source-set separation](https://docs.fabricmc.net/develop/loom). Разделение main/client сверено через Context7. API имена относятся к pinned 1.20.1 official mappings, а не переносятся из примеров новых версий Minecraft.
