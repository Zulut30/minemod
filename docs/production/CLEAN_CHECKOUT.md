# Воспроизводимый старт из чистого checkout

Пункт 012, в работе. Заявленный scope: TypeScript bundles на Linux x64 и Windows x64, Windows x64 package Studio и production fixture Fabric 1.20.1 / Java 17 на Linux x64. Воспроизводимый запуск команд не означает побайтную идентичность JAR/EXE между машинами. Подпись пакета, установка зависимостей полностью без сети и другие ОС не подтверждены.

## До установки зависимостей

Создайте новый clone выбранного commit в отдельном каталоге. Не копируйте туда `output/`, `node_modules/`, `dist/`, fixture `run/`, локальные Gradle caches или конфигурацию агента. Нужны Git, Node 24.11.0 с Corepack и Python 3; версия pnpm 11.8.0 и integrity закреплены в `package.json`.

```powershell
node scripts/verify-clean-checkout.mjs
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck:all
corepack pnpm lint
corepack pnpm build
corepack pnpm --filter @mcdev/model-editor build
```

Проверка до install сравнивает сырые bytes каждого tracked file с Git blob выбранного HEAD. Поэтому скрытая в обычном diff нормализация CRLF тоже обнаруживается. Она отдельно проверяет POSIX LF/shebang, Git executable bits и физические permissions на Linux, четыре production wrapper inputs и pinned wrapper JAR. Generated dirs и untracked source inputs приводят к отказу. Проверка не запускает shell из payload, не исправляет файлы и не меняет настройки Git пользователя.

В `.gitattributes` обычный исходный текст имеет LF. Для reviewed packs, fixtures, provenance и third-party включено `-text`: checkout сохраняет их bytes, включая batch-файлы, без повторной нормализации. Не запускайте массовый `renormalize` по trusted inputs. Поведение проверено по [официальной документации Git](https://git-scm.com/docs/gitattributes) и Context7; wrapper inputs не изменялись.

## Windows Studio

```powershell
corepack pnpm test:portable
corepack pnpm --filter @mcdev/model-editor test:mcp
corepack pnpm --filter @mcdev/model-editor package
corepack pnpm --filter @mcdev/model-editor exec node scripts/test-desktop.mjs --packaged
```

`package` создаёт `output/model-editor/` самостоятельно. Точный путь нового EXE записан в `latest-build.json`. Hidden packaged tests открывают собственные скрытые окна; действие не требует управления рабочим столом пользователя. Пакет содержит Electron, а developer Node используется для сборки и тестов. Native Windows JAR build runner не заявляется.

## Linux production fixture

Нужен точный Eclipse Temurin 17.0.19+10. URL Linux x64 archive и SHA256 находятся в `packs/fabric-1.20.1/runtime-r5/versions.lock.json`; archive перед распаковкой должен пройти проверку SHA256. Установите `JAVA_HOME` и `MCDEV_JAVA17_HOME` на этот JDK вне checkout; не используйте другой major или автоматическое обновление.

```bash
python3 scripts/verify-fabric-production-inputs.py
python3 scripts/verify-minecraft-inputs.py
export MCDEV_FABRIC_TEST_JAVA_HOME="$MCDEV_JAVA17_HOME"
export GRADLE_USER_HOME="$PWD/fixtures/fabric-1.20.1-empty/run/gradle-home"
export MCDEV_FABRIC_TEST_GRADLE_HOME="$GRADLE_USER_HOME"
export GRADLE_PROJECT_CACHE_DIR="$PWD/fixtures/fabric-1.20.1-empty/run/project-cache"
cd fixtures/fabric-1.20.1-empty
./gradlew --project-cache-dir "$GRADLE_PROJECT_CACHE_DIR" --no-daemon --dependency-verification strict clean build
./gradlew --project-cache-dir "$GRADLE_PROJECT_CACHE_DIR" --offline --no-daemon --dependency-verification strict clean build
```

Первый online bootstrap получает pinned Gradle и dependencies, повтор использует созданный cache. GameTests, dedicated-server/client smoke и generated equipment/config clean build выполняет production job в `.github/workflows/phase-0.yml`. Их команды и отдельные отчёты остаются источником runtime evidence. Визуальная приёмка authored моделей в Minecraft этим не подтверждается.

## Проверки и evidence

В трёх обязательных CI jobs guard выполняется перед frozen install. Начальные `output/` и package caches отсутствуют; report создаётся только после успешного guard. Source SHA, tree, число проверенных файлов, отсутствовавшие generated dirs, permissions и bootstrap hashes сохраняются в артефактах каждого job.

Guard suite создаёт собственный disposable clone с `core.autocrlf=true`. Проверяются raw CRLF corruption, bootstrap corruption, изменённый executable bit, untracked input и четыре заранее существовавших generated dirs; после восстановления clone снова совпадает с первоначальным отчётом. Linux дополнительно проверяет отказ после снятия physical executable bit. Рабочая копия пользователя не очищается.

Локальный Windows guard suite прошёл. Hosted checks нового source ещё ожидаются; пункт пока открыт. Legacy Fabric 26.2 checksum failure относится к отдельному regression-target и не обходится ради общего зелёного статуса.

Первый hosted source `37077a4` прошёл fresh-checkout guards на Linux/Windows и production runtime, но новый evidence uploader выявил старый статический smoke-test с точным общим числом upload-шагов. NeoForge job отказал до dedicated-server smoke. Этот отказ сохранён; проверка заменена на конкретные обязательные artifact/guard commands. Новый source ещё требует hosted проверки, исключения проверки не добавлялись.
