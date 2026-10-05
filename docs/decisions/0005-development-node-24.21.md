# ADR-0005: development Node 24.21.0

Статус: pin принят 5 октября 2026 года; подтверждение совместимости новой revision фиксируется в [toolchain evidence](../production/evidence/toolchain-011.json). До завершения hosted checks этот документ не заявляет production acceptance.

## Причина

Exact Node 24.11.0 сохранял воспроизводимость прежних проверок, но предшествует последующим security releases линии 24 LTS. [Июльский advisory](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases) фиксирует исправления HTTP/2, Permission Model, TLS и bundled libraries в 24.18.1. [24.21.0](https://nodejs.org/en/blog/release/v24.21.0), опубликованный 8 сентября 2026 года, включает последующие изменения этой линии, OpenSSL 3.5.8, Undici 7.29.1 и Corepack 0.36.0. Это основание обновить developer runtime; оно не является доказательством эксплуатации перечисленных CVE в MineMod.

## Решение

Закрепить Node 24.21.0 в root `engines.node` и трёх `setup-node` jobs. Exact pnpm 11.8.0 с SHA-512, dependency versions и lockfile сохраняются. Windows archive проверен по подписанному official release-key checksum до извлечения; evidence сохраняет key revision, fingerprint, archive hash и bounded paths. Глобальная установка Node и пользовательские настройки не меняются.

Developer runtime используется для CLI, сборки и проверок. Electron 44.5.1 имеет отдельный встроенный Node 24.21.0, подтверждённый actual `process.versions`; совпадение номера не заменяет самостоятельную проверку Electron distribution. Minecraft/Fabric/Java/Gradle tuple ADR-0004 и immutable packs этим решением не обновляются.

## Проверка

Новая revision должна пройти frozen install, lint, все type checks, portable tests и desktop MCP на Windows; packaged GUI tests работают только в собственных hidden windows. Hosted Linux выполняет full suite, production clean/offline build, GameTests и dedicated server/client. Clean-checkout guards продолжают требовать exact Node из `package.json`, сырые Git bytes и отсутствие generated directories. Старые evidence сохраняют Node 24.11.0; новые reports связываются с новой source revision.

Полный Fabric transitive license review и independent Electron/pnpm publisher review остаются отдельными gaps пункта 011. Успешная смена development pin сама по себе не закрывает весь пункт и не разрешает публикацию.
