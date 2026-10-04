# Явная миграция Fabric pack revision 3 → 4

Дата: 4 октября 2026. Статус: metadata/source review выполнен; clean build, GameTests и runtime revision 4 пока pending. Release status остаётся `candidate`, transitive license review не закрыт.

## Причина и evidence

Fresh hosted run [37214772795](https://github.com/Zulut30/minemod/actions/runs/37214772795) остановил strict verification на 51 опубликованном Maven JAR. Старый local cache содержал hashes других ZIP-контейнеров. Игровой PASS этой сборке не присваивается.

[Проверка всех nested modules](../provenance/fabric-1.20.1-container-review-r4.json) сначала подтвердила exact hash aggregate Fabric API JAR из revision 3. Для 53 nested modules сравнивались **все** распакованные entries с официальными Maven JAR: class/resource bytes, paths, число entries; duplicate names и oversized ZIP отвергаются. У 50 отличаются только контейнерные bytes. В report записаны оба SHA-256 и digest таблицы contents.

GameTest API не входит в nested aggregate. Его опубликованный JAR проверен по официальному Maven SHA-256; reviewed source JAR имеет прежний checksum. `fabric.mod.json` подтверждает exact ID/version, Apache-2.0; class versions совместимы с Java 17. Равенство прежнего и нового **binary** container этого модуля не установлено и явно обозначено `unverified`. Это отдельная замена accepted checksum, требующая runtime проверки, а не утверждение о совпадении binary content.

## До и после

| Поле | Revision 3 | Revision 4 |
|---|---|---|
| Directory | `packs/fabric-1.20.1/runtime` | `packs/fabric-1.20.1/runtime-r4` |
| Manifest revision | 3 | 4 |
| Tree SHA-256 | `e1a4c9b16670980edfd162301f56e042ff03fcaaad4deaebb288a1828f0bca37` | `5665fbc60365bf22639292c0b5e8ee46c7853c52e20e744be88a2c3fbaaf2282` |
| Exact tuple | Minecraft 1.20.1 / Loader 0.19.3 / API 0.92.11+1.20.1 / Loom 1.6.12 / Gradle 8.7 / Temurin 17.0.19+10 | Совпадает побайтно в `versions.lock.json` |
| Runtime metadata artifacts | 654 | 654 |
| Exact SHA-256 entries | 654 | 705 |
| Downloaded-artifact wildcard exceptions | 0 | 0 |
| Generated sources/resources templates | Исходные templates | Совпадают побайтно |

Revision 3 сохранена целиком и проверяется отдельным snapshot regression test с прежним digest и реальными Linux modes. Новая registry registration имеет revision 4 и другой tree digest. Код не изменяет существующие generated outputs, JAR или approval records.

## Миграция и rollback

Новая генерация выбирает revision 4 явно через обновлённую fixed registry. Старый BuildPlan с ref revision 3 **не** становится plan revision 4: exact ref validation отклоняет его. Для нового build нужно повторно валидировать исходный ModSpec, создать новый plan/workspace и пройти strict build. Старые источники, export, JAR, evidence и их hashes сохраняются. Art approval нельзя переносить по имени.

Rollback требует checkout предыдущей версии compiler/runner и её собственных locked inputs/cache; archived revision 3 остаётся доступной для проверки snapshot. Offline historical PASS не означает, что clean Maven bootstrap старой revision исправлен.

Generator `scripts/provenance/create-fabric-revision4.py` не перезаписывает уже существующую revision и не меняет исходный runtime directory. Digest рассчитан по declared POSIX modes; это **определение** pack. Hosted Linux verifier должен отдельно проверить фактические bytes/modes. Public MCP не получает shell или средство изменения trusted metadata.
