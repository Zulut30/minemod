# Fabric 1.20.1 library integrations

## Назначение

MineMod подключает сторонние библиотеки через закрытый versioned catalog. Пользовательский или AI-generated ModSpec выбирает только известный Fabric mod ID; Maven coordinate, repository, version, license и runtime relation определяет код проекта.

Это сохраняет воспроизводимость сборки и не позволяет промпту добавить произвольный repository или исполняемый Gradle fragment.

## Реализованный каталог

| Mod ID | Назначение | Версия | Relation | Environment | License |
|---|---|---:|---|---|---|
| `yet_another_config_lib_v3` | YACL configuration UI/API | `3.5.0+1.20.1-fabric` | required when selected | client and server | LGPL-3.0-or-later |
| `modmenu` | список модов и точка входа в настройки | `7.2.2` | optional | client | MIT |

Официальные источники:

- [YACL installation](https://docs.isxander.dev/yet-another-config-lib/installing-yacl)
- [YACL project](https://modrinth.com/mod/yacl)
- [Mod Menu developer API](https://modrinth.com/mod/modmenu#developers)
- [Fabric dependency metadata](https://docs.fabricmc.net/develop/loader/fabric-mod-json#dependency-resolution)

## Выбор библиотек в ModSpec

```json
{
  "dependencies": {
    "required": [
      "yet_another_config_lib_v3"
    ],
    "optional": [
      "modmenu"
    ]
  }
}
```

Компилятор детерминированно добавляет:

- разрешённые Maven repositories с `includeGroup` filters;
- exact `modImplementation` coordinates в `build.gradle`;
- YACL version constraint в `fabric.mod.json.depends`;
- Mod Menu в `fabric.mod.json.suggests`;
- `modmenu` entrypoint, если выбраны обе библиотеки;
- `GeneratedConfig` с JSON5 serializer и загрузкой при старте;
- `GeneratedModMenuIntegration` с настоящим YACL screen;
- checksum metadata для исходных и транзитивных артефактов.

Текущий generated screen содержит рабочую настройку `showGeneratedContentInCreativeTabs`. Она сохраняется в `config/<mod-id>.json5`, управляет добавлением generated items/blocks в стандартные creative tabs и требует перезапуска игры после изменения. Если выбран только YACL, файловая конфигурация генерируется без Mod Menu entrypoint. Если выбран только Mod Menu, компилятор не создаёт классы конфигурации, которые ссылались бы на отсутствующий YACL.

## Закрытые правила

- Mod Menu нельзя объявить обязательным через текущий catalog.
- YACL нельзя объявить optional, пока generated adapter не изолирован от его классов.
- неизвестный mod ID отклоняется до создания workspace.
- повтор одной библиотеки в required/optional отклоняется.
- зависимости сортируются перед генерацией, поэтому порядок во входном JSON не меняет план.
- locally remapped Loom JAR разрешён только для exact групп и имён каталога; скачанные исходные artifacts остаются под SHA-256.

## Проверенная совместимость

Текущий pack использует Fabric Loom `1.6.12`. YACL `3.6.1` и `3.6.6` для Minecraft 1.20.1 публиковались более новым Loom и не проходят этот baseline. Поэтому pack фиксирует YACL `3.5.0+1.20.1-fabric`, для которого реальная strict CLI-сборка завершается готовым remapped JAR.

Переход на YACL 3.6.x требует отдельного compatibility-pack revision с обновлённым Loom, dependency verification metadata и полной client/server regression matrix.

## Следующие интеграции

Планируемые capability-профили:

- расширяемая ModSpec-схема для boolean/integer/string options, ranges и categories;
- GeckoLib для runtime-моделей и анимаций;
- Cardinal Components API для persistent/synced state;
- Trinkets для дополнительных equipment slots;
- EMI/REI для recipe displays;
- Jade для information HUD;
- Architectury API и Balm как отдельные, взаимоисключающие multi-loader стратегии.

Наличие библиотеки в roadmap не означает поддержку. Она считается поддержанной только после exact version lock, license/provenance review, compiler fixture и реальной strict Gradle/client/server проверки.
