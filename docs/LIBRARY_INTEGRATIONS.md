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
- [Fabric ServerPlayConnectionEvents](https://maven.fabricmc.net/docs/fabric-api-0.92.11+1.20.1/net/fabricmc/fabric/api/networking/v1/ServerPlayConnectionEvents.html)

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
  },
  "integrations": {
    "jei": "off",
    "jade": "off",
    "yacl": {
      "categories": [
        {
          "id": "gameplay",
          "name": "Gameplay",
          "description": "Gameplay tuning.",
          "options": [
            {
              "id": "enable_special_attacks",
              "name": "Special attacks",
              "type": "boolean",
              "default": true,
              "restartRequired": false
            },
            {
              "id": "spawn_limit",
              "name": "Spawn limit",
              "type": "integer",
              "default": 8,
              "minimum": 1,
              "maximum": 32,
              "step": 1,
              "restartRequired": true
            },
            {
              "id": "welcome_message",
              "name": "Welcome message",
              "type": "string",
              "default": "Stay alert",
              "maxLength": 64,
              "binding": "player_join_message",
              "restartRequired": true
            }
          ]
        }
      ]
    }
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

Generated screen всегда содержит рабочую настройку `showGeneratedContentInCreativeTabs`, а `integrations.yacl.categories` добавляет собственные категории и boolean/integer/string options. Integer options получают bounded slider, string options ограничиваются `maxLength`, а `restartRequired` подключает стандартное предупреждение YACL о перезапуске. Все значения сохраняются в `config/<mod-id>.json5`.

Идентификаторы категорий и options проверяются на уникальность, числовые значения ограничены диапазоном Java `int`, defaults обязаны попадать в объявленные границы, а размер всей схемы ограничен. Пользовательская `integrations.yacl` требует одновременно required YACL и optional Mod Menu: без них компилятор останавливается с диагностикой вместо создания недоступного UI.

### Server-authoritative gameplay binding

String option может объявить `"binding": "player_join_message"`. Тогда compiler создаёт server-safe `GeneratedConfiguredBehavior`, регистрирует `ServerPlayConnectionEvents.JOIN` и отправляет игроку значение через `Component.literal`. Пустая строка отключает сообщение; строка не интерпретируется как команда или translation format.

Binding разрешён только один раз и требует `restartRequired: true`. На dedicated server используется его собственный `config/<mod-id>.json5`; изменение локального файла через Mod Menu у подключённого игрока не меняет конфигурацию удалённого сервера.

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

- дополнительные gameplay bindings, server-to-client sync и operator permissions;
- GeckoLib для runtime-моделей и анимаций;
- Cardinal Components API для persistent/synced state;
- Trinkets для дополнительных equipment slots;
- EMI/REI для recipe displays;
- Jade для information HUD;
- Architectury API и Balm как отдельные, взаимоисключающие multi-loader стратегии.

Наличие библиотеки в roadmap не означает поддержку. Она считается поддержанной только после exact version lock, license/provenance review, compiler fixture и реальной strict Gradle/client/server проверки.
