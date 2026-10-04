# Измерения исходного результата

Roadmap: пункт 010, пока частично выполнен. Команда на pinned Node 24.11.0:

```powershell
node --experimental-strip-types scripts/measure-editor-baseline.mjs
```

Скрипт измеряет реальные editor-core mutations и deterministic item export на зафиксированном fixture: пять warmup, тридцать измерений, отдельные samples, p50/p95/max и ошибки. PNG/JSON/BBModel hashes проверяются; повторный экспорт должен совпадать. Mutation изменяет геометрию, export использует один неизменный контрольный source. Время включает валидацию и сериализацию внутри операции, но не snapshot подготовку, transport, render или очередь desktop.

Report записывается в новую директорию `output/production-baseline/`. Поля policy/input hashes, toolchain, environment и source revision позволяют повторять сравнение. Измерение одного небольшого fixture не доказывает latency на максимальном input или слабом ПК. Это не in-game или artistic PASS.

Даже при достижении core thresholds итоговый статус `PARTIAL`: first user-accepted export, success rate настоящих агентных сеансов, число ручных исправлений и human art ratings остаются `null`, пока нет соответствующих наблюдений. Ошибки и failed samples сохраняются; превышение core target завершает команду с exit 1.

Пункт 010 остаётся открытым до измерения полного пользовательского пути и получения реальных художественных оценок. Его нельзя закрыть быстротой синтетической операции или придумать среднюю оценку отсутствующих reviewers.
