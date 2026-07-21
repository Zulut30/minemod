# Аудит baseline NeoForge 26.1.2

Дата среза: 2026-07-21. Статус гейта: **Phase 0 hosted-verified**; manifest pack сохраняет статус `candidate-local-verified`.

Baseline прошёл NeoForge-гейты локально и в двух независимых GitHub-hosted runs на exact implementation commit. Это закрывает Phase 0 bootstrap gate, но не обозначает pack production-ready; точные failed/success runs, remediation patch и отдельное решение scorer exception зафиксированы в `phase-0-hosted-remediation.md`.

Строгий orchestration quality gate не пройден: формальный scorer зафиксировал точный результат `0.30` при требуемых `0.85`, поэтому `quality_gate_passed: false` и `needs_followup: true`. Он также отметил три пути `scripts/provenance/**` как выход за ownership, хотя актуальный уточнённый claim явно разрешает `scripts/provenance/**`; это формальное расхождение не переписывается как pass. Независимый semantic/adversarial review уже дал дословный вердикт `APPROVE, no remaining code/doc blocker`, но это не подменяет strict gate.

Root orchestrator выполнил условное exact-hash exception: исходные frozen patches прошли совместный dry-run, post-integration remediation получил новый freeze/score/verification/review, а hosted push и pull-request runs завершились успешно. Исходные формальные scores и новый `0.81/0.85` не переписываются как pass; разрешение ограничено exact SHA, указанными в `phase-0-hosted-remediation.md`.

## Зафиксированный стек

| Компонент | Версия | Основание |
| --- | --- | --- |
| Minecraft | 26.1.2 | production target Phase 0 |
| NeoForge | 26.1.2.80 | официальный MDK 26.1.2 |
| ModDevGradle | 2.0.141 | официальный MDK 26.1.2 |
| Gradle | 9.2.1 | wrapper официального MDK |
| Основная Java | Temurin 25.0.3+9 | Java 25 для NeoForge 26.1 |
| Вспомогательная Java | Temurin 21.0.11+10 | toolchain, запрашиваемый ModDevGradle для asset-задачи |

Выбран согласованный tuple из официального `MDK-26.1.2-ModDevGradle` (срез commit `a5d4d8ea744e09e16a1c4fb5f0cba5ba04d5f4b4`), а не механически последние патчи. NeoForge 26.1.2.83 и ModDevGradle 2.0.142 уже существуют, но их переход требует отдельного полного прогона.

Официальный `gradle-wrapper.jar` хранится в fixture. Скрипт `gradlew` до запуска проверяет его SHA-256 `423cb469ccc0ecc31f0e4e1c309976198ccb734cdcbb7029d4bda0f18f57e8d9`; Gradle distribution независимо защищён `distributionSha256Sum`. Активные Gradle user/project caches всегда размещены в `fixtures/basic-content/run/` локально и в CI, то есть `clean` их не удаляет. Smoke-скрипты и tracked runtime-inventory mode перезаписывают унаследованные `GRADLE_USER_HOME` и `GRADLE_PROJECT_CACHE_DIR` этими каноническими fixture-local путями; runtime mode дополнительно передаёт абсолютный `--project-cache-dir`, поэтому ни `~/.gradle`, ни project `.gradle` не являются неявным входом.

Официальные POSIX и Windows launchers Gradle 9.2.1 сохраняют стандартную обработку `JAVA_HOME`, `JAVA_OPTS` и `GRADLE_OPTS`; локально добавлена только fail-closed проверка wrapper JAR. POSIX-ветка предпочитает GNU `sha256sum` и использует стандартный macOS `shasum -a 256` как fallback; Windows-ветка использует `PowerShell Get-FileHash`. Отсутствие обоих POSIX hashers, JAR или совпадающего SHA завершает запуск до Java. Self-test исполняет fallback с настоящим `shasum` при недоступном `sha256sum` и доказывает, что несовпадающий digest не достигает Java. Linux gate фактически исполняет основную POSIX-ветку, а CI статически требует обе POSIX-ветви и checksum/errorlevel-ветви Windows launcher. Windows runtime-прогон ещё не заявлен.

В fixture отключены и автоматическое обнаружение, и автоматическая загрузка Java toolchains. CI сначала устанавливает точную Temurin `21.0.11+10`, сохраняет её канонический `realpath`, затем устанавливает `25.0.3+9` как финальную default Java и так же сохраняет канонический путь. Это обязательно на GitHub-hosted runner: `setup-java` экспортирует hosted-toolcache alias, тогда как Gradle и fail-closed provenance generator работают с каноническим `/usr/lib/jvm` target того же JDK. Gradle читает оба явных пути только из `PHASE0_JAVA21_HOME` и `PHASE0_JAVA25_HOME` через `org.gradle.java.installations.fromEnv`; изменение runner-wide auto-detection не может подменить JDK. Gate `javaToolchains` требует ровно эти две установки и состояния `Auto-detection: Disabled` / `Auto-download: Disabled`. Команда `python3 scripts/provenance/build-neoforge-inventory.py --emit-runtime-components` fail closed требует оба абсолютных канонических пути, сверяет фактические `java.runtime.version` и vendor с Temurin `21.0.11+10-LTS`/`25.0.3+9-LTS`, назначает Java 25 launcher и удаляет унаследованные `GRADLE_OPTS`, `JAVA_OPTS`, `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS` и `_JAVA_OPTIONS` перед Gradle.

Foojay resolver удалён: при `auto-download=false` и двух обязательных `fromEnv` toolchains он не участвовал ни в одном gate, но добавлял неиспользуемый provisioning plugin и supply-chain graph.

Linux x64 архив вспомогательной Temurin 21 имеет официальный SHA-256 `4b2220e232a97997b436ca6ab15cbf70171ecff52958a46159dfa5a8c44ca4de`; primary Temurin 25 — `69264a7a211bf5029830d07bc3370f879769d62ebc5b5488e90c9343a2da0e1f`. Источники, лицензия и sidecar URL продублированы в `versions.lock.json` и provenance manifest.

## Dependency verification

Metadata сформирован Gradle 9.2.1 с `--write-verification-metadata sha256`, затем просмотрен по координатам и структуре. Итог:

- 202 компонента, 383 выбранных plugin/Maven artifacts и metadata-файла, 383 SHA-256;
- каждый `artifact` имеет ровно один 64-символьный SHA-256;
- `verify-metadata=true`, signatures не подменяют checksum-проверку;
- нет `trusted-artifacts`, wildcard-исключений, SHA-1 или MD5;
- SHA-256 всех 383 выбранных файлов повторно вычислены из локального Gradle cache: 383 совпадения, 0 расхождений; все реальные конфигурации ниже разрешаются в strict-режиме;
- 49 добавленных записей закрывают девять cold-cache-only `.module` descriptors и 40 ранее не закреплённых license POMs; полный cold-only набор включает `groovy-bom-4.0.27.module`, семь версий `junit-bom-*.module`, `spring-framework-bom-5.3.39.module` и входящий в эти 40 POM `lwjgl-bom-3.4.1.pom`;
- две независимые проверки начинались с пустых канонических `run/gradle-home` и `run/project-cache`; обе выполнили точный CI prefix, strict logging preparation, clean build, license-POM resolution и byte-identical inventory regeneration.

Число 383 также записано в `packs/neoforge-26.1.2/versions.lock.json`. Исполняемый static gate вычисляет число `<artifact>` из verification metadata и требует равенства с lock, обоими счётчиками inventory, dependency manifest и единственной CI-константой `expected_artifact_count=383`. Поэтому расширение cold-cache graph больше не может оставить lock незаметно на старом значении.

CI дополнительно фиксирует ожидаемое число артефактов, чтобы изменение dependency graph требовало нового review metadata.

Полный component-level inventory сохранён в `docs/provenance/neoforge-26.1.2-inventory.json` (SHA-256 `91bac93a31124918a1fcc986633b7e757554a72c7f68f64dcda56756728b0445`). Он покрывает все 202 компонента и все 383 ссылки verification metadata, имеет `unresolved: []` и не классифицирует ни один компонент как vendored/redistributed. Для восьми компонентов `SPDX NONE` означает точный завершённый вывод «в потреблённых upstream metadata отсутствует license declaration», а не неизвестную лицензию и не разрешение на распространение; до отдельного подтверждения прав эти компоненты нельзя включать в репозиторий или распространять.

Reproducibility inputs больше не спрятаны в ignored `run/`: reviewed generator `scripts/provenance/build-neoforge-inventory.py` имеет SHA-256 `03044f14dfccd08d44bc8cabab187fbeb55d0afa8f3d18cfb59a92f2c203b453`, runtime resolver `scripts/provenance/inventory-runtime.init.gradle` — `2d567690d9ccc5df5b6e8bdb1b4cdc7ffd97e2fbf45795345112aed53acc994a`, а список 192 разрешённых license POMs `scripts/provenance/neoforge-license-pom-evidence.txt` — `72ac2908dfab6adfbef386d1c1d1c932fe068115d948844a3452fae292616d6d`. Inventory фиксирует все три пути/hash, generator command и self-contained runtime command в top-level inputs и во всех evidence records.

Generator больше не перебирает произвольные cached POMs. Каждый POM в reviewed-списке сначала разрешается отдельной Gradle-конфигурацией в задаче `resolveProvenanceLicensePomEvidence`, должен присутствовать в verification metadata, совпасть с её SHA-256 и иметь source URL, построенный из review-owned repository base и Maven coordinate path. Явные coordinate overrides покрывают Minecraft Libraries, Plugin Portal и NeoForged Mojang metadata; наблюдаемый cache URL, если он есть, обязан входить в этот allowlist, но отсутствие cache-history не меняет результат. После построения generator требует, чтобы все 192 и только эти POMs были фактически использованы direct/inherited/no-grant license resolution.

License evidence верхнеуровневого dependency manifest больше не ссылается на изменяемые ветви. NeoForge `26.1.2.80` использует точный официальный POM `neoforge-26.1.2.80.pom` с SHA-256 `b4c2a5b5a585f6217b0f1d75bdedfe2af9eebeedcd5e1613832d16fca4908b56`, уже обязательным в strict verification metadata. ModDevGradle использует официальный license-файл immutable commit `545875049fb624ce2af2c92263ce2907342b7a76` (peeled commit официального tag `2.0`); независимо скачанные bytes имеют SHA-256 `9b872a8a070b8ad329c4bd380fb1bf0000f564c75023ec8e1e6803f15364b9e9`. Mutable `26.1.x` и `main` не являются provenance evidence.

После разрешения strict dependencies fresh-checkout-style проверка выполняется из корня репозитория:

```bash
set -euo pipefail
repo=$(pwd -P)
fixture="$repo/fixtures/basic-content"
export PHASE0_JAVA21_HOME="$fixture/run/jdks/temurin-21.0.11+10"
export PHASE0_JAVA25_HOME="$fixture/run/jdks/temurin-25.0.3+9"
export JAVA_HOME="$PHASE0_JAVA25_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
export GRADLE_USER_HOME="$fixture/run/gradle-home"
export GRADLE_PROJECT_CACHE_DIR="$fixture/run/project-cache"
unset GRADLE_OPTS JAVA_OPTS JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS _JAVA_OPTIONS
candidate=$(mktemp)
trap 'rm -f -- "$candidate"' EXIT
(
  cd "$fixture"
  ./gradlew --project-cache-dir "$GRADLE_PROJECT_CACHE_DIR" \
    --dependency-verification strict resolveProvenanceLicensePomEvidence
)
python3 scripts/provenance/build-neoforge-inventory.py \
  --emit-runtime-components > "$fixture/run/inventory-runtime-components.txt"
python3 scripts/provenance/build-neoforge-inventory.py \
  --runtime-components "$fixture/run/inventory-runtime-components.txt" > "$candidate"
cmp -- docs/provenance/neoforge-26.1.2-inventory.json "$candidate"
```

Generator требует sorted/unique список ровно из 85 runtime-координат и sorted/unique список ровно из 192 license-POM координат, проверяет coordinate syntax, POM SHA/source/usage и отказывает при duplicate manual provenance coordinate. CI повторяет этот flow после clean build и требует byte-identical `cmp`; никакой run-only generator или warm cache history не считается provenance source.

## Fixture и фактические гейты

`fixtures/basic-content` — минимальный NeoForge-проект без стороннего implementation-кода и assets. Конструктор entrypoint устанавливает состояние и регистрирует GameTest-функцию `basiccontent:entrypoint_initialized`; тест проверяет именно состояние конструктора и пишет маркер `BASIC_CONTENT_ENTRYPOINT_GAMETEST_EXECUTED`.

Все команды запускались с `JAVA_HOME` основной Temurin 25.0.3+9, явными путями к Temurin 21/25, отключёнными auto-detect/auto-download и с `--dependency-verification strict`:

| Гейт | Локальный результат |
| --- | --- |
| `./gradlew --version` | PASS; launcher и daemon JVM 25.0.3 |
| `./gradlew ... -q javaToolchains` | PASS; обнаружены только Temurin 21.0.11+10 и 25.0.3+9, оба auto-флага отключены |
| `./gradlew ... help` | PASS |
| `./gradlew ... verifySmokeLoggingConfiguration` | PASS; client/server имеют ровно один Log4j2 config argument, generated configs byte-identical reviewed source |
| `./gradlew ... clean build` | PASS |
| tracked provenance regeneration + byte-identical `cmp` | PASS; 85 runtime coordinates, committed inventory regenerated exactly |
| `./gradlew ... runGameTestServer` | PASS; все обязательные тесты прошли, entrypoint-маркер присутствует |
| `./scripts/test-smoke-guards.sh` | PASS |
| `./scripts/smoke-dedicated-server.sh` | PASS; nonce-bound sentinel опубликован только из `ServerStartedEvent`, bind `127.0.0.1:0` |
| `./scripts/smoke-client-ci.sh` | PASS; fixture, LWJGL, OpenAL, sound engine, atlas и post-init подтверждены |

Client gate использует `ALSOFT_DRIVERS=null`: это детерминированный OpenAL backend без физического аудиоустройства, но инициализация audio stack и sound engine остаются обязательными. Post-init marker должен оставаться истинным 20 последовательных наблюдений (примерно 5 секунд), поэтому ранние LWJGL/mod markers не дают ложный успех. Отдельный client job сначала выполняет `prepareClientRun` со strict dependency verification: на холодном GitHub-hosted checkout он загружает и готовит уже проверенные Minecraft assets до входа в 180-секундную границу фактического запуска. Это не подменяет smoke и не ослабляет deadline: `smoke-client-ci.sh` независимо запускает client под `xvfb`, требует все runtime-признаки и применяет полный fail-closed supervisor к самому процессу и teardown.

Оба smoke-профиля используют отдельный Log4j2 config с единственным `Console target="SYSTEM_OUT"` appender; `File`/`RollingFile` appenders отсутствуют. Перед запуском удаляется старый `run/<kind>/logs`, а появление любого файла там немедленно считается ошибкой. Fatal predicates, client console gates и diagnostic tails читают только `phase0-console.log`, который физически ограничен FIFO consumer ровно 8 MiB; один event больше лимита не может увеличить файл сверх cap.

До рекурсивного preflight устанавливаются общий timeout-supervisor и `EXIT`/`INT`/`TERM` traps; только после этого guard канонизирует fixture и fail closed проверяет каждый существующий компонент пути. Fixture, `run`, профиль, Gradle user/project cache должны быть настоящими каталогами текущего пользователя с сохранённой device/inode identity. Каждый рекурсивный обход обоих cache и выбранного профиля выполняется одним NUL-safe потоком без follow и ограничен 100 000 записями. Весь producer+validator pipeline, включая каждую per-entry `stat`-проверку, работает в private worker mode библиотеки под одним 30-секундным GNU `timeout --signal=KILL`; hard process-group boundary выбран для этого read-only scan, чтобы ни producer, ни validator, игнорирующий TERM, не пережил преждевременно завершившийся worker shell. Worker различает «найден non-directory», validator failure и producer failure; timeout, превышение cap или неполный поток отклоняются. Та же единственная capped NUL-safe операция одновременно решает, содержит ли `logs` хотя бы один файл: второго newline-based/TOCTOU-обхода нет, а любое traversal/type/ownership нарушение fail closed считается file diagnostic. Symlink, чужой owner, смена `st_dev`, hard-linked regular file и неожиданный FIFO/device/socket также отклоняются; `/proc/self/mountinfo` отдельно запрещает сам fixture и любой вложенный mountpoint, включая same-filesystem bind mount. Для `eula.txt`, `server.properties`, console log/FIFO, `logs` и обоих sentinel действует явный allowlist типа. Каталоги создаются по одному только под уже проверенным parent, обычные файлы создаются с noclobber и mode `0600`, а cleanup удаляет лишь ранее подготовленный allowlisted путь после повторной проверки parent identity. Adversarial suite подставляет symlink вместо fixture root, `run`, `run/server|client`, вложенных cache/profile entries и каждого managed file/FIFO/sentinel и сверяет, что внешний target не изменился; отдельный case меняет sentinel уже после подготовки и доказывает отказ cleanup. Локальный user/mount-namespace regression bind-mount внешнего каталога на `run/server/logs` завершился отказом подготовки и сохранил внешний marker byte-identical.

Положительная server readiness не зависит от console relay: скрипт удаляет stale/temp sentinel, передаёт собственный nonce, а fixture публикует его через temp+move только из фактического `ServerStartedEvent`. Сразу после публикации fixture вызывает `MinecraftServer.halt(false)`; скрипт принимает успех только после status 0 прямого Gradle wrapper и исчезновения всех процессов с точной парой `PHASE0_SMOKE_SERVER_NONCE=<nonce>`. Client post-initialization gate аналогично публикует nonce только после 20 стабильных client ticks, затем завершает только процессы с точным client marker. Linux `/proc/<pid>/environ` scanner ограничивает совпавший набор 64 PID, исключает собственный shell, повторно читает marker непосредственно перед каждым TERM/KILL, чтобы сузить окно PID reuse, имеет bounded iteration/deadline и никогда не использует `pkill`/поиск по командной строке. Успех обоих скриптов требует нулевого множества сразу после teardown и повторно через секунду. Два последовательных реальных server run и два client run дали четыре разных nonce, wrapper status 0 для обоих server run и ноль delayed matches после каждого, включая тёплый cache и последовательные single-use Gradle daemons.

Оба sentinel публикуются atomic move, когда filesystem его поддерживает; Java fallback использует `REPLACE_EXISTING`, а принимающая сторона во всех случаях требует точные размер, nonce и завершающий newline, поэтому stale, incomplete и oversized значения отклоняются. Авторитетный 180-секундный supervisor запускается до preflight: preflight и runtime loop расходуют один общий deadline, а его TERM инициирует nonce-owned teardown; отдельный 20-секундный `--kill-after` остаётся только жёстким fallback для cleanup, игнорирующего TERM. Child принимает supervisor только если совпали inode исполняемого `timeout`, заранее сохранённые PID/starttime прямого parent и весь ограниченный 64 KiB NUL-разделённый `/proc/<ppid>/cmdline`: абсолютный `timeout`, `--signal=TERM`, точный `--kill-after`, запрошенная duration, script token и каждый аргумент. PID сохраняется до command substitution, поэтому специальное значение Bash `BASHPID` не может незаметно подмениться PID subshell; отдельная регрессия повторяет успешный PID/starttime/argv handshake 25 раз. Поэтому другой настоящий `timeout` с подделанным inode marker, но иной duration/argv, отклоняется. Истечение supervisor всегда возвращает наружу GNU `timeout` status `124`, а runtime loop больше не создаёт новые 180 секунд после подготовки. Self-tests отдельно доказывают успешную server readiness при полностью пустом/buffer-stalled console и корректном nonce, missing/stale/incomplete/oversized ошибки обоих sentinel, допустимую narrator fallback-ошибку, Log4j status/config failures, canonical Gradle caches, все path/symlink abuse cases, точную границу console cap, непрерывную запись, один oversized console event, отсутствие file diagnostics, естественный nonce-owned exit, завершение процесса в отдельной session и сохранность постороннего процесса. Новые deadline-регрессии отклоняют 33-entry дерево при test cap 32, по отдельности завершают игнорирующие TERM fake producer `find` и validator-side `stat` общим hard scan deadline без оставшегося исполняемого процесса (`Z`/`X` считаются завершёнными), отдельно доказывают producer-failure status, требуют status `124` от двухсекундного общего supervisor во время preflight, отклоняют настоящий `timeout 5s`, выдающий себя за запрошенный `1s`, распознают diagnostic-файл с newline в имени и fail closed ограничивают зависший diagnostic traversal. Dedicated server с `online-mode=false` слушает только loopback.

## Остаточные риски

- Формальный score равен `0.30` при пороге `0.85`, поэтому `quality_gate_passed: false` и `needs_followup: true`; scorer дополнительно сообщает ownership mismatch для трёх разрешённых `scripts/provenance/**` путей. Независимый semantic/adversarial review дал `APPROVE, no remaining code/doc blocker`, но exact-hash root exception должно быть привязано именно к текущему frozen patch; любой другой SHA-256 его не покрывает.
- Exact GitHub Actions push и pull-request runs прошли на implementation commit `5fd2bdb7a0a12dce2716c24479bfd301ab14a612`; любое последующее изменение workflow или fixture требует нового hosted run и не наследует этот результат автоматически.
- Windows `gradlew.bat` имеет статически проверяемый fail-closed checksum guard, но пока не запускался на Windows runner.
- `ubuntu-24.04` — изменяемый hosted image. Actions зафиксированы полными commit SHA, но образ runner остаётся доверенной внешней границей.
- Client job устанавливает `xvfb`, `xauth` и `x11-xkb-utils` из изменяемого Ubuntu repository. Они не входят в release artifact.
- Runtime/path tracking намеренно Linux-only: ему нужны `/proc/<pid>/environ`, `/proc/self/mountinfo`, Python 3, GNU `grep -z`, `setsid`, GNU `stat`, GNU `find` и GNU `timeout`. Это соответствует обоим заявленным smoke jobs на `ubuntu-24.04`; перенос этих scripts на macOS/Windows без отдельного backend не заявлен и завершится fail closed.
- Path guard защищает от заранее подготовленного недоверенного состояния ignored `run/`, включая symlink/hardlink, different-device и mountpoint escape, но Bash path operations не дают race-free `openat(2)`/directory-fd semantics. Активный конкурентный процесс того же Unix-пользователя, способный менять дерево между lstat/inode/mountinfo check и системным вызовом, процесс, создающий mount после проверки, и PID/environ-check→`kill(pid)` race остаются вне threat boundary. Hosted job использует изолированный checkout без такого writer/mount/process control; любой shared/self-hosted runner обязан обеспечить ту же изоляцию либо заменить guard на dirfd/openat/pidfd/mount-aware helper.
- Fixture, pack/lock и dependency manifest согласованно маркируют оригинальный код проекта как `Apache-2.0` согласно принятому ADR-0001. Это не перелицензирует Minecraft, NeoForge, Gradle/JDK, transitive dependencies или иной сторонний материал; корневые `LICENSE` и `THIRD_PARTY_NOTICES.md` должны интегрироваться вместе с baseline до публикации.

## Официальные источники

- NeoForge 26.1 release notes: <https://neoforged.net/news/26.1release/>
- официальный MDK 26.1.2: <https://github.com/NeoForgeMDKs/MDK-26.1.2-ModDevGradle>
- официальный NeoForge Maven: <https://maven.neoforged.net/releases/net/neoforged/neoforge/>
- ModDevGradle 2.0.141: <https://plugins.gradle.org/plugin/net.neoforged.moddev/2.0.141>
- Gradle 9.2.1 checksums: <https://gradle.org/release-checksums/>
- Gradle dependency verification: <https://docs.gradle.org/9.2.1/userguide/dependency_verification.html>
- Gradle Java toolchains и explicit locations: <https://docs.gradle.org/9.2.1/userguide/toolchains.html#sec:custom_loc>
- Apache Log4j 2 configuration: <https://logging.apache.org/log4j/2.x/manual/configuration.html>
- setup-java v5 exact version syntax: <https://github.com/actions/setup-java/blob/v5.2.0/README.md#supported-version-syntax>
- setup-java v5 multiple JDKs: <https://github.com/actions/setup-java/blob/v5.2.0/README.md#install-multiple-jdks>
- Temurin releases: <https://adoptium.net/temurin/releases/>
