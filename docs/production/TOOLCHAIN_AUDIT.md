# Проверка закреплённого toolchain

Пункт 011, в работе. Readonly аудит 5 октября 2026 года: [toolchain-011.json](evidence/toolchain-011.json). Версии, зависимости и trusted packs не изменены; это проверка существующих bytes и границ дальнейшего обновления.

| Компонент | Закреплённый ввод | Проверка сейчас | Осталось |
|---|---|---|---|
| Development Node | 24.11.0 Windows x64 | Архив SHA-256 совпал со свежим официальным `SHASUMS256.txt`; локальный LICENSE содержит MIT и bundled notices | PGP verification официальной подписи; review накопленных security fixes и новая проверенная toolchain revision |
| pnpm | 11.8.0 | Exact registry metadata/license/source; SHA-512 integrity соответствует `packageManager` | Отдельная проверка cached/downloaded tarball bytes; signature/provenance policy |
| Electron | 44.5.1 Windows x64 | Installed version/license, cached ZIP совпал с checksums package; Electron/Chromium license files присутствуют и имеют hashes | Проверка publisher source/signatures, полный distribution inventory и актуальности patch перед выпуском |
| Temurin | 17.0.19+10 Linux x64 | URL/SHA-256/source/license записаны в runtime-r5; hosted production job проверяет actual archive, identity и runtime | Финальный release inventory и лицензионная приёмка; Windows Java runner этим не заявляется |
| Gradle | 8.7 | Exact distribution hash и wrapper JAR hash из reviewed lock; локальный wrapper совпадает | Финальная release inventory; прочие платформы отдельно |
| Fabric target | 1.20.1 / Loader 0.19.3 / API 0.92.11+1.20.1 / Loom 1.6.12 | Strict verification metadata, native fixture build/runtime и ссылки на источники из lock | Полный transitive license review; derived-cache attestation остаётся отдельным gate |

Node major 24 находится в LTS по [официальной матрице](https://nodejs.org/en/about/previous-releases). Это не означает, что старый patch 24.11.0 включает последующие исправления. На дату аудита официальный [24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0) опубликован 8 сентября 2026 года. Security delta нужно проверить по [официальным advisories](https://nodejs.org/en/blog/vulnerability/), затем оформить отдельное обновление с повторными frozen install/build/runtime checks. Этот аудит не обновляет версии молча.

Electron поддерживает последние три stable major и последнюю minor в каждой по [официальной политике](https://www.electronjs.org/docs/latest/tutorial/electron-timelines). [Текущий schedule](https://releases.electronjs.org/schedule) показывает 44 stable и плановый EOL 2 марта 2027 года; даты и patch status нужно сверить перед distribution. Development Node и встроенный runtime Electron проверяются раздельно.

По [официальной процедуре Node](https://github.com/nodejs/node#verifying-binaries) и Context7 checksum проверяет bytes, а PGP verification устанавливает связь с release key. В текущем аудите выполнен checksum по HTTPS, PGP подпись не проверена. Electron cached ZIP сравнен с checksums установленного package, без заявления independent publisher signature.

Имеющийся [Fabric inventory](../provenance/fabric-1.20.1-dependencies.json) явно содержит `transitiveLicenseReviewComplete: false` и redistribution block. Reviewed source license одного компонента, strict Gradle verification или CI PASS этого флага не отменяют. [Container review](../provenance/fabric-1.20.1-container-review-r4.json) подтверждает вложенные JAR entries в своём scope, а не художественную/лицензионную или игровую приёмку всех generated outputs.

Аудит использует источники, licenses и hashes; пока остаются реальные gaps, пункт не отмечается завершённым. Технические CI evidence находятся в пунктах 012–016; legacy Fabric 26.2 checksum failure сохранён отдельно.
