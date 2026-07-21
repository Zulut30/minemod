# Third-party licensing boundary

Проверено 2026-07-21. Это bootstrap-запись Phase 0, а не исчерпывающий shipping manifest и не юридическая гарантия. Для каждого release bundle источником истины должен стать сгенерированный inventory фактически включённых artifacts с version, source URL, hash, license text и redistribution status.

## Известные toolchain boundaries

| Компонент | Роль и способ использования | Проверенный upstream record | Практическое требование |
|---|---|---|---|
| Gradle Build Tool 9.2.1 | Внешний build tool; Wrapper может включать upstream scripts/JAR и скачивать distribution | [versioned LICENSE](https://github.com/gradle/gradle/blob/v9.2.1/LICENSE), [raw text](https://raw.githubusercontent.com/gradle/gradle/v9.2.1/LICENSE), SHA-256 raw-файла `cf234c4188d773406f640bf89be680d9288f40ff96901c70d643fcea96ad46df`; [официальная license page](https://docs.gradle.org/current/userguide/licenses.html) | Код Gradle Build Tool обозначен Apache-2.0, но versioned LICENSE также содержит условия bundled third-party components. При распространении Gradle/Wrapper нужно сохранять применимые тексты и notices, а не сводить всё к одной строке `Apache-2.0`. |
| Node.js 24.11.0 | Внешний runtime для CLI/MCP; не является кодом проекта | [versioned LICENSE](https://github.com/nodejs/node/blob/v24.11.0/LICENSE), [raw text](https://raw.githubusercontent.com/nodejs/node/v24.11.0/LICENSE), SHA-256 raw-файла `537308465103a306d0e3eecf42632b4ff1b48aaaec044e9fc10a78c81fd00b34` | Основной grant Node.js — MIT, но upstream LICENSE включает отдельные условия externally maintained libraries. Если Node binary когда-либо войдёт в distribution, нужно приложить полный соответствующий upstream license set. |
| Minecraft: Java Edition | Внешняя игра/target runtime; не включается в release bundle | [EULA](https://www.minecraft.net/en-us/eula), [Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines) | Не распространять game software, Modded Version или чужие game assets; не создавать впечатление официального/одобренного продукта; перед публикацией повторно проверить актуальные правила. |

Apache-2.0 корневого репозитория не меняет лицензии этих компонентов. Аналогично, использование dependency во время build не означает, что его можно встраивать или распространять без выполнения upstream conditions.

## Требование к будущему release inventory

До package/release для каждого фактически включённого runtime artifact должны быть известны как минимум:

- точные name, version, package coordinates и role;
- официальный source URL и cryptographic hash;
- license identifier и полный license/notice evidence;
- bundled, linked, downloaded-at-build или external-only status;
- разрешённый redistribution status и зафиксированный reviewer;
- связь с файлами внутри release bundle.

Неизвестная лицензия, отсутствующее evidence или неразрешённый redistribution status являются release blockers. Этот файл следует обновлять только из проверенных upstream records; маркетинговое описание лицензии не заменяет versioned license text.
