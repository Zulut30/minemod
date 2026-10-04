# Обязательные проверки перед merge

Roadmap 014. Настройка `main` применена через GitHub API 4 октября 2026 года и проверена повторным GET. Это действующая защита ветки, а не только предложение в YAML.

Источник настройки: [branch-protection-main.json](branch-protection-main.json). Evidence: [readback и hashes](evidence/merge-checks-014.json).

Для merge нужны свежие проверки GitHub Actions, привязанные к приложению `15368`:

| Check | Проверяемая область |
|---|---|
| `control-plane` | Lint, полный TypeScript typecheck, unit/integration suites, core и desktop build |
| `studio-windows` | Portable packages, HTTP MCP, Windows package и скрытый desktop E2E |
| `Fabric 1.20.1 / Java 17 production target` | Strict online/offline clean build, серверные GameTests, client/server smoke и generated build |
| `fabric`, `fabric-client` | Существующие regression suites отдельного Fabric 26.2 target |
| `neoforge`, `client-smoke` | Существующие NeoForge и client regression suites |

Ветка должна быть актуальна относительно `main` (`strict: true`). Правила применяются и к администратору. Force push и удаление `main` запрещены. Требование дополнительных reviewers не добавлялось; назначенные роли code/art/release review остаются отдельными gates.

Сломанная TypeScript-схема или транзакция вызывает failure `control-plane` и блокирует merge. Переименование job требует сначала согласовать YAML и settings: имя обязательного check должно совпадать точно. Сторонний статус с тем же текстом от другого GitHub App не заменяет требуемую проверку.

## Состояние на момент настройки

В run `37217477326` для source `26567c9be3f0ec2bf2067e4562bf04f09253a1dc` прошли `control-plane`, `studio-windows`, production 1.20.1, `neoforge` и `client-smoke`. Старый `fabric` failed, зависимый `fabric-client` skipped. Общий workflow failed; merge до исправления regression запрещён. Новая реализация ещё находится в ветке `codex/production-roadmap-100`, её наличие не означает интеграцию в `main` или выпуск.

Настройка не делает художественную или игровую приёмку автоматически успешной. Повторный код/pack/asset change требует проверки новой revision по применимым gates.

Официальный контракт API: [GitHub branch protection](https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2022-11-28#update-branch-protection). Для обновления использовать подготовленный JSON и затем повторный GET; при rollback сохранять остальные действующие правила владельца.
