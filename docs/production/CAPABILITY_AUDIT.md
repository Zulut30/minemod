# Аудит возможностей на старте production-работ

Roadmap: пункт 004. Проверка: 4 октября 2026 года. Это аудит текущего рабочего дерева, где Studio и ряд интеграций ещё не входят в начальный commit `e64fee0`. Он не является аудитом готового production-релиза.

## Свежие проверки

На Node 24.11.0 / pnpm 11.8.0 в Windows 11 x64 повторно выполнены с exit 0:

- `corepack pnpm typecheck:all` — основной TypeScript и host/renderer Studio.
- `corepack pnpm lint` — ESLint с запретом warnings.
- `corepack pnpm --filter @mcdev/assets-contracts --filter @mcdev/assets-core --filter @mcdev/editor-core --filter @mcdev/cli --filter @mcdev/mcp-server -r test` — пять portable-пакетов.
- `corepack pnpm --filter @mcdev/model-editor test:mcp` — реальные HTTP-клиенты, auth/origin/limits, conflicts, locks, preview isolation и export.

Команды, hashes logs и выбранных исходников сохранены в [audit-004.json](evidence/audit-004.json). Полный workspace suite, clean desktop rebuild, новые GameTests и игровой рендер в этой проверке не запускались. Packaged Studio 0.5.1 подтверждён отдельно [архивным отчётом и актуальными hashes](evidence/studio-0.5.1-local.json).

## Матрица возможностей

| Возможность | Фактическое состояние | Авторитетный источник / проверка | Следующий обязательный шаг |
|---|---|---|---|
| ModSpec/ArtSpec schemas | Реализованы; часть gameplay schemas шире возможностей компилятора | `packages/modspec/index.ts`; CLI/MCP portable tests | Version/migration и точная capability validation, пункт 19 |
| Fabric basic content | Реализованы регистрации items/blocks, equipment, recipes, loot, locales | `packages/compiler-fabric/compiler.ts`, compiler README | Свежий clean build и игровые tests, 71–75 |
| Equipment visuals | Детерминированные icons и wearable layers из palette/profile | `packages/assets-core/equipment-texture.ts`, compiler README | Художественная/игровая приёмка и отдельный authored path, 41–66 |
| Обычные items/blocks | Реализованы с placeholder и предупреждением | compiler `PLACEHOLDER_ASSETS_USED`, `cube_all` | Настоящие текстуры, reviewed contract и release blocker, 58–64 |
| Settings/join event | Generated YACL/Mod Menu и server join-message path существуют | compiler/client separation; `docs/LIBRARY_INTEGRATIONS.md` | Native gameplay screens/menus и runtime matrix, 69–75 |
| Owned entities/screens | Compiler отклоняет неподдержанный gameplay | compiler `validateSupportedSpec` / `SPEC_UNSUPPORTED` | Runtime/companions/ritual/menu, 67–69 |
| Cuboid contracts/BBModel | Реализованы модели, UV/rig contracts и editable export | assets-contracts/core и portable tests | Выбранный version-tested entity animation runtime, 67 |
| Held-item export | JSON/PNG/BBModel, bounds/UV/rotation validation реализованы | `packages/assets-core/minecraft-item.ts`, `painted-item.ts`, свежие tests | Approved asset integration и gameplay transforms, 61–66 |
| Studio project/geometry | Реализовано; editor validation принимает `held-item` | `packages/editor-core/index.ts:223`, свежие tests | Block target, группы/precision/UX, 24–25, 63 |
| Studio painting/UV | Реализованы локальные операции, pixel history, locks | `packages/editor-core/texture.ts`, texture tests | ArtSpec-aware density/seams и пользовательский QA, 51–57 |
| Studio variants | До четырёх независимых snapshots; restore/history/permissions | editor-core variants tests | Настоящие сеансы генерации трёх разных форм, 31–36 |
| Studio project persistence | Файловый worker и atomic-persistence tests существуют | `apps/model-editor/worker/persistence.ts`, editor tests | Crash/disk-full/migration и clean-machine recovery, 26–28, 78 |
| Dark theme/review | Реализованы views, silhouette, square 64 и nearest 32 | renderer Viewport/ReviewBoard; archived packaged report | Полная accessibility и художественная матрица, 22–23, 43–45 |
| Studio MCP | 10 closed tools; service auth/origin/bytes/CAS проверены | `apps/model-editor/worker/mcp.ts`, свежий HTTP suite | Installed-client model turns и security audit, 31–40, 81–90 |
| Концепты оружия | Есть оригинальный concept и три editable candidates | `fixtures/assets/weapon-directions.mjs`, `docs/MODEL_EDITOR_WEAPON_REDESIGN.md` | Человеческая оценка и formal game evidence, 41–50, 76 |
| Artistic acceptance | Не получена для текущих candidates | `STUDIO_BUILD.json`: pending human acceptance | ArtSpec/scorecard/approval exact hashes, 49 |
| Formal rubric evaluator | Документирован контракт; полной автоматической реализации нет | `docs/quality/art-quality-rubric-v0.md` | Реализовать blockers/evidence/review states, 49, 77 |
| Авторский ассет в JAR | Не интегрирован как production-path | compiler README: authored assets fail closed | Versioned reviewed bundle/ModSpec references, 61–64 |
| Windows→game build | Studio работает отдельно; native Windows runner не поддержан | `packages/build-runner/internal.ts:2439` | Явный Linux runner workflow без ослабления checks, 12–15 |
| Production pack | Exact baseline, статус experimental-local-runtime-pass | `packs/fabric-1.20.1/pack.json` | Hosted 1.20.1 CI, GameTests и license review, 11–13, 71–90 |
| GitHub CI | Есть control plane, Windows job в working tree и старые regression jobs | `.github/workflows/phase-0.yml` | Commit полного source baseline и hosted production matrix, 12–16 |
| Release pipeline | Сборка отдельного EXE существует; full signed/update release не доказан | Studio package script; pack/artifact contracts | Installer, signing, bundle verifier, rollback, 94–99 |

## Доказанные ограничения среды

WSL-проверка текущего ПК вернула `REGDB_E_CLASSNOTREG`: доступного WSL runner этим путём сейчас нет. Это не запрещает desktop-разработку и не является основанием ослаблять Linux/POSIX guard. Hosted CI или отдельно проверенный Linux runner необходимы для соответствующих production-пунктов.

Открытая пользовательская Studio из старой package directory не заменялась и не закрывалась. Background verification использует отдельные скрытые окна только при фактических desktop-tests.

## Приёмка пункта 004

Каждое утверждение в матрице опирается на текущий source, точный report или свежую команду. «Реализовано» не выдаётся за «проверено в игре». Gaps связаны с roadmap; initial dirty tree обозначен явно. Повторный аудит требуется после изменения контрактов или release candidate.
