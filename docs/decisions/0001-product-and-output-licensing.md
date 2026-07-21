# ADR-0001: Лицензия продукта и политика generated output

## Статус

Принято.

## Дата

2026-07-21.

## Контекст

Phase 0 требует permissive-лицензию для самого продукта и явную границу между кодом репозитория, результатами генерации, сторонними компонентами и интеллектуальной собственностью Minecraft. Без этой границы корневая лицензия может ошибочно восприниматься как разрешение на чужие ассеты, provider output или файлы игры.

Этот ADR фиксирует инженерную политику проекта, а не юридическое заключение и не гарантию наличия прав в конкретной юрисдикции. Для коммерческого релиза с внешними ассетами или особыми provider terms всё ещё нужна профильная проверка.

## Решение

Оригинальные implementation, документация и схемы этого репозитория выпускаются под **Apache License 2.0**, если конкретный файл или каталог явно не помечен иначе. Полный неизменённый текст находится в корневом [`LICENSE`](../../LICENSE).

Корневой файл воспроизводит официальный текст Apache License 2.0:

- источник: <https://www.apache.org/licenses/LICENSE-2.0.txt>;
- размер: 11 358 байт;
- SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.

Apache Software Foundation рекомендует помещать копию текста в `LICENSE` верхнего уровня. Лицензия даёт permissive copyright grant и явный patent grant, но сохраняет условия перераспространения, notices, отказ от гарантий и не предоставляет права на товарные знаки.

### Что входит в Apache-2.0 scope

- оригинальный исходный код и build/configuration files проекта;
- оригинальные ModSpec/ArtSpec schemas и compatibility-pack metadata;
- оригинальная документация и тестовые fixtures проекта;
- принятые contributions, если автор явно не обозначил их как не являющиеся contribution и не действует отдельное соглашение;
- бинарные формы перечисленного выше при соблюдении условий Apache-2.0.

Файл с отдельным license header, vendored-каталог или запись в provenance manifest имеет приоритет для соответствующего материала. Наличие материала в репозитории само по себе не доказывает, что правообладатель может перелицензировать его под Apache-2.0.

### Что не становится Apache-2.0 автоматически

- dependency, runtime, build tool, plugin и vendored material третьих лиц;
- Minecraft software, code, textures, models, sounds, screenshots, names и trademarks;
- пользовательские prompts, references, вручную загруженные исходники и секреты;
- output внешнего AI/provider, model weights и datasets;
- generated mod, code или asset только потому, что инструмент создал его в пользовательском workspace.

### Политика generated output

Проект не требует передачи ему прав на generated output и не заявляет дополнительный copyright interest только из-за факта генерации. Output остаётся в пользовательском workspace и управляется пользователем в пределах реально существующих прав.

Это не обещание, что любой output свободен от ограничений. На него могут одновременно влиять:

- применимое право и права на входные prompts/references;
- terms и output policy выбранного provider/model;
- лицензии включённых templates, libraries, fonts, models и иных компонентов;
- Minecraft EULA и Usage Guidelines;
- права третьих лиц, включая copyright, trademarks, publicity/privacy rights.

Если generated output содержит существенные фрагменты Apache-licensed templates проекта, Apache-2.0 продолжает применяться к этим фрагментам. Generator должен сохранить требуемые notices и сформировать точный provenance/license manifest; он не должен маркировать весь bundle одной лицензией без анализа его состава.

Пользователь отвечает за наличие прав на inputs и за допустимость распространения результата. Инструмент должен показывать известные ограничения и блокировать release при неполной provenance, но такая проверка не заменяет юридическую оценку.

### Minecraft boundary

Инструмент создаёт оригинальные Mods и resource data, но не распространяет игру или Modded Version. Minecraft EULA разрешает разрабатывать оригинальные Mods и отделяет их от кода/контента Minecraft, при этом запрещает распространять Modded Versions. Usage Guidelines также требуют не создавать впечатление официального продукта, сохраняют права Mojang/Microsoft на name, brand и assets и могут изменяться.

Каждый публичный product page и release description должен содержать ясный non-affiliation disclaimer, соответствующий актуальным Usage Guidelines. Перед публикацией нужно повторно проверить актуальную EULA и Usage Guidelines, а не полагаться только на этот ADR.

## Рассмотренные альтернативы

### MIT

Короткая и permissive, но не содержит такого же явного patent grant. Отклонена в пользу Apache-2.0 для compiler/tooling проекта с contributions и schemas.

### MPL-2.0 или LGPL

Дают file/library-level copyleft. Это усложняет embedding и использование generated scaffolds, тогда как выбранная продуктовая модель требует permissive core. Отклонены для кода репозитория; отдельные dependencies могут оставаться под этими лицензиями.

### GPL, source-available или proprietary core

Не соответствуют принятому решению о permissive open-source core. GPL-инструменты при необходимости должны оставаться за отдельной process/repository boundary и проходить самостоятельную проверку.

### Автоматически лицензировать весь generated output под Apache-2.0

Отклонено: проект не может выдать права на пользовательские inputs, provider output, Minecraft assets или сторонние components, которыми не владеет.

## Последствия

- Корневой `LICENSE` обязателен в исходных и бинарных дистрибутивах проекта.
- [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) описывает bootstrap-boundary; release bundle должен получать versioned, исчерпывающий manifest из фактически включённых artifacts.
- `NOTICE` создаётся, когда у проекта появятся собственные или upstream attribution notices, требующие его распространения; пустой `NOTICE` не создаётся.
- Каждый dependency/provider/reference проверяется отдельно; название лицензии верхнего уровня не «очищает» transitive content.
- Release gate блокируется при неизвестной лицензии, отсутствии provenance или неразрешённых правах на reference.
- Решение пересматривается при смене business model, generator template policy, contribution model или состава распространяемых компонентов.

## Проверенные первичные источники

Проверено 2026-07-21:

- [Apache License 2.0 — официальный текст](https://www.apache.org/licenses/LICENSE-2.0.txt)
- [ASF: применение Apache License 2.0](https://www.apache.org/legal/apply-license)
- [Minecraft EULA](https://www.minecraft.net/en-us/eula)
- [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)
- [Gradle Build Tool 9.2.1 — versioned LICENSE](https://github.com/gradle/gradle/blob/v9.2.1/LICENSE)
- [Gradle: License Information](https://docs.gradle.org/current/userguide/licenses.html)
- [Node.js 24.11.0 — versioned LICENSE](https://github.com/nodejs/node/blob/v24.11.0/LICENSE)
