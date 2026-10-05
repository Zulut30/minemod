# Диагностика операции и границы приёмки

Roadmap 020 закрыт в указанном scope. Studio 0.13.0 добавляет bounded `mcdev.operation-evidence/v1` рядом с результатом операции. [Evidence](evidence/operation-evidence-020.json) сохраняет локальные проверки и source-linked hosted proof исходной реализации и дополнительной правки контекста отказа.

Отчёт связывает SHA-256 точного UTF-8 входа и его bytes, content revision или editor projectId/revision, команду, resolved pack при сборке, безопасную ошибку и отсортированные path/bytes/SHA-256 ресурсов. Build revision — настоящий planId из verified artifact index. Export revision — текущий editor snapshot; экспорт формата Fabric не означает разрешение trusted pack, поэтому pack равен null. Для ошибки до разрешения pack его значение также null.

После успешной compile ошибка workspace, runner или artifact index сохраняет уже известные planId и pack. Application оборачивает отказ в `FabricBuildOperationError`, сохраняет domain code и исходное исключение во внутреннем `cause`; публичный отчёт не копирует его stack, message или приватные пути. Failed report имеет пустой artifacts. Контекст ошибки переиспользуется только для входа с совпадающими SHA-256/bytes; ошибка другого request не получает чужой plan. Неверный закрытый request shape по-прежнему отклоняется до compile.

| Проверка | Значение этого producer | Что подтверждено |
|---|---|---|
| `technical` | pass/fail с конкретным scope и bounded error | Export/integrity либо clean build и индекс артефактов; число кубов не является quality score |
| `artistic` | requires-human-review | Художественная приёмка человеком ещё не получена |
| `game` | not-run | Эта операция не провела игровую приёмку; separate GameTests/server/client reports имеют собственный scope |

Producer не принимает пользовательские PASS/approval, shell или arguments. Validator проверяет JSON shape и пределы, а не удостоверяет автора отчёта. Для доверия к technical PASS нужны source revision и actual runtime/CI evidence. Human approval остаётся отдельной границей пункта 049 и [ролей review](REVIEW_ROLES.md).

## Реализованные пути

- `mcdev asset report <inline-item-json>` выполняет versioned exporter и возвращает `{ok, bundle, evidence}` либо `{ok:false, error, evidence}` с exit 1. Старые `asset item/bundle/verify` сохраняют прежний raw bundle output.
- `mcdev fabric build ...` и `mcdev_fabric_build` возвращают evidence вместе с successful artifact index. Ошибка CLI теперь bounded JSON в stderr с code/evidence; error stack и workspace/Java/cache paths туда не переносятся.
- `mcdev_asset_compile_item` добавляет evidence рядом с существующими полями legacy result; failure сохраняет `isError` и bounded code.
- `studio_asset_validate` и `studio_asset_export` возвращают evidence с exact editor reference. Исходный `bundle` не расширяется: V1 manifest, SHA и четыре file contents сохраняют прежний контракт.
- Ручной GUI export атомарно сохраняет `operation-evidence.v1.json` в новой export directory рядом с `asset-bundle.v1.json`. Report индексирует четыре manifest resources; container JSON и `source.mmeditor.json` остаются отдельными файлами.
- Production build-test collector готовит этот же report из actual strict/offline Gradle build, resolved plan/pack, generated inputs и прочитанных JAR bytes. Он сохраняет JAR для независимой проверки SHA; hosted выполнение этой новой ветки требуется отдельно.

Authorization/transport/schema failures до выполнения операции не становятся successful evidence. CAS, readonly tools, response limits, trusted packs и политика human review сохраняются.

## Границы и проверка

Report ограничен 2 MiB и 2048 descriptors, каждый file не более 16 MiB, общий бюджет 128 MiB. Payload digest вычисляется до 8 MiB; для большего отклонённого input bytes записываются, digest равен null. Raw input content в evidence отсутствует. Пути portable relative, без traversal, повторов и case collisions; revisions — safe integers, SHA-256 — exact lowercase hex.

Локально прошли exact input/artifact checks, byte-identical bundle comparison, corrupted-bundle отказ, UTF-8 bytes, 18 malformed report shapes, error privacy и metadata getter guard. HTTP MCP и CLI проверяют emitted reports. Hidden packaged GUI сохранил report, совпавший с реальной revision и manifest files, затем восстановил исходный authored document после restart. Synthetic build-index test не объявляется native Gradle proof.

[Run 37324709900](https://github.com/Zulut30/minemod/actions/runs/37324709900) для source `31abd4ae6ee4ee0081b4ce729c0f0acdf0aa8b09` подтвердил full Linux suite, 16 Windows packaged subreports и native Fabric 1.20.1 strict/offline generated build. Независимо сверены байты сохранённого JAR, шесть retained generated sources, report/manifest plan и pack; report содержит 46 descriptors. Два GameTests и client/server smoke относятся к production fixture, а не к авторским моделям. Whole run failed из-за legacy Fabric 26.2 checksum; expected/actual сохранены без изменения trusted baseline.

Уточнение failure context проверено локально через asset suite, настоящую сериализацию CLI/MCP, lint и typecheck. [Run 37326698895](https://github.com/Zulut30/minemod/actions/runs/37326698895) для source `ca6cc68752c1782a2d9d912ba3248a45da4e12b5` подтвердил actual application compile/workspace/runner/index failure cases на Linux, full Windows matrix и native JAR/report. Ошибка до compile имеет input revision/null pack; после compile — настоящий plan/pack. Failed report не содержит successful artifacts. Переподключение отчёта по одному размеру oversized input запрещено: без вычисленного SHA-256 known plan не переиспользуется. Whole run сохраняет failure legacy 26.2; authored game и artistic approval остаются отдельными задачами.
