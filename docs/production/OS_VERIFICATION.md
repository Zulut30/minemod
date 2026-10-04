# Матрица проверок ОС

Roadmap 015. Desktop и игровой build runner имеют разные окружения. Linux-only runner проверяет настоящие filesystem permissions; declared pack modes не подменяют фактические Windows permissions.

| Область | Windows x64 | Linux x64 |
|---|---|---|
| Assets contracts/core, editor core, CLI, stdio MCP и application asset suites | `corepack pnpm test:portable` | Тот же набор входит в полный suite |
| TypeScript и lint | `corepack pnpm typecheck:all`, `corepack pnpm lint` | Те же команды в `control-plane` |
| Полный recursive suite | Явный отказ `FULL_TEST_SUITE_REQUIRES_LINUX_X64`; это не PASS и не skipped build | `corepack pnpm test`; pack modes, compiler, workspace transaction и runner guards проверяются без ослабления |
| Распространяемый Studio | Windows package и скрытые MCP/editor E2E в отдельном user data | Поддержка desktop distribution не заявляется |
| Fabric 1.20.1 JAR и Minecraft | Native Windows runner не поддержан; WSL/remote — отдельное Linux-окружение, если доступно | Отдельный `fabric-production`: locked Java 17, strict clean build, GameTests, client/server |
| Fabric 26.2 и NeoForge regression | Не относятся к Windows portable PASS | Отдельные существующие CI jobs; текущий Fabric 26.2 failure остаётся blocker |

`test:portable` является закрытым списком пяти проверенных packages и отдельного `application test:assets`. Полный `application test` с POSIX filesystem assumptions в portable-команду не включён. Список не автоматически расширяется на пакеты с POSIX assumptions. Система не запускает Linux suite на Windows с отключёнными permission/hash assertions. Native Windows JAR build и новый desktop target требуют отдельного плана и доказательств.

## Проверенный результат

Новый wrapper на Windows явно отказал полному suite; все пять packages прошли `test:portable`, включая реальные killed-process autosave tests. Packaged Windows proof: [026](evidence/autosave-026.json), hosted packaged baseline: [016](evidence/windows-packaged-016.json). На Linux новый entrypoint и полный suite прошли `control-plane` source `6c2fa4085fadf76da8095b43d2cbdba33059f60d` в run `37219185836`, job `111485907679`.

[Evidence](evidence/os-verification-015.json) содержит exact source и log hashes: на Windows получен явный отказ полного suite и PASS portable suite, на Linux проверен новый entrypoint и настоящие permission/hash assertions. Пункт 015 закрыт для указанной матрицы; native Windows runner не добавлен. Остальные игровые и artistic gates сохраняют собственные статусы.

Platform-specific claims в bug report должны содержать `process.platform`, архитектуру, версии Node/pnpm и конкретную команду. В отчёте отдельно показывать portable/package/game scopes. Инструкция setup в README и CONTRIBUTING не является обещанием, что каждый test/build работает на каждой ОС.
