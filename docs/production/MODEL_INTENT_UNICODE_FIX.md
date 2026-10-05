# Корректировка Unicode-контракта ModelIntent v1

Source `4091a5d` проверен локально и в hosted baseline: Linux full suite, Windows 21 packaged subreports и Fabric 1.20.1 PASS. Дополнение к 041, без нового художественного или игрового acceptance. [Evidence source, clean checkouts и CI](evidence/model-intent-unicode-fix.json) сохранён отдельно от исторического 041.

Прежний regex исключал surrogate code units с флагом `u`. JavaScript при этом читал корректную supplementary pair как один code point, поэтому label с emoji проходил и `ModelIntentSchema`, и публичный `art plan`. Это расходилось с заявленной BMP policy и с согласованностью length в Zod/JSON Schema.

RegExp semantics сверены с [ECMAScript specification](https://tc39.es/ecma262/multipage/text-processing.html), `.regex()`/JSON Schema — через Context7 и официальные [Zod API](https://zod.dev/api) и [JSON Schema export](https://zod.dev/json-schema). Используется закреплённый Zod 4.4.2: отдельный runtime probe подтверждает UTF-16 length (`max(1)` отклоняет emoji). Текущая документация/Context7 может описывать более новую реализацию длины; dependency не обновляется, фактическое поведение проверяется на pinned version.

Исправление задаёт явные BMP scalar ranges: U+0000–U+D7FF и U+E000–U+FFFF. Символы вне BMP и одиночные high/low surrogates отклоняются; русский текст и прежние пределы сохраняются. Никакой trim/transform или автоматической миграции не добавлено. Изменение касается text fields ModelIntent v1; legacy ArtSpec v0 и ModSpec v0/v1 схемы остаются побайтно прежними.

Проверены все роли текста intent, максимальная кириллическая label 80 chars и pattern в emitted JSON Schema. Public validator/art plan проверяют три ошибочных Unicode-последовательности и не возвращают частичного plan; actual CLI process завершается с кодом 1. Validation suite теперь содержит 35 negative cases вместо 32. Portable CLI/MCP/assets/editor regression и desktop build также прошли локально; main/worker/preload SHA-256 не изменились.

Legacy JSON Schema SHA-256 (JSON.stringify без pretty-print):

- ArtSpec v0: `3f1b3d26efc8432a8e60aa14711dc4f523db007a04df589cccf1cdba535e21a9`.
- ModSpec v0: `05b7bace7ed9d039f797999f6c0af939117ed9f5f5e466462ecd28db6110134e`.
- ModSpec v1: `59d44708800dca4132444d7c1c8c6cc63019c5454ed802235303d4a321dd1d94`.

Исторический evidence 041 относится к source `63c4646` и его прежним тестам. Исправление не переписывает тот снимок и требует своего exact-source CI. Benchmark 042 на source `5dc73bf` проверяется отдельно; его reference parser уже использует явные BMP ranges.

CI run `37364290675`, attempt 1 завершился failure: legacy Fabric 26.2 checksum не совпал, а auxiliary NeoForge client-smoke отменён до первого шага. Ожидаемый SHA-256 `23248c15f8413aa0d06ac59e676913dd6a1dc0c5fffaa09365afd6c98d59fcd3`, фактический `4708c213640f30b39490ed7ed9ff922a7ab950217d419d5d585ec292982cc02d`; причина не установлена, checksum gate не изменён. Отменённый client job перезапущен отдельно; до terminal результата успех не заявляется.

Baseline Fabric 1.20.1 в этом же source прошёл strict online/offline clean build, два infrastructure GameTests, dedicated-server и headless-client readiness с полностью остановленными nonce processes. Побайтно проверены шесть generated source files и JAR по manifest. Это технический fixture, без authored «Листа»/reference assets и без их художественной приёмки. UI 0.19 и новые native previews относятся к 043 и проверяются на своём source.
