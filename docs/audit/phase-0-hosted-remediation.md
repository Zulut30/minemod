# Phase 0: hosted remediation и итоговая привязка

Дата решения: 2026-07-21. Это приложение к `phase-0-orchestration-exceptions.md`; оно не изменяет исходные score `0.26` и `0.30` и не объявляет compatibility pack production-ready.

## Исходная интеграция

Два bootstrap-артефакта были объединены только через проверенный integration dry-run:

- control-plane patch: SHA-256 `84c5f6319e60f85a9a89b603e3790502d0213a02d11261b6e62c50e04d83c355`;
- NeoForge patch: SHA-256 `7425431fd01f7cbd4f824a1a514155cfafd4605beb74040f8497c0a99828f24e`;
- authoritative combined patch: SHA-256 `a01d9c530752694a3862140c4a0a6e64cb566421932e9ee70b5a9ad672ed4b28`, `1563799` байт, `50` файлов, `34742` вставки;
- combined dry-run evidence: SHA-256 `0b1bd9a06bc48732839d24611d1e533cb24245053334015728cbf6280de7c5b5`;
- exact integration commits: `3946e57d1ee4ab76bb8ef231c16d93c0ed0ec501` и `39aa194fe79d4f4ebf0a2153e4516b64be97849e`.

Combined dry-run прошёл Node 24.11.0 lint/typecheck/test/build, ShellCheck, exact Java 21/25, strict dependency verification, clean Gradle build, byte-identical provenance regeneration, GameTest, guard suite, dedicated-server smoke, headless-client smoke и repository diff-check. Два прежних dry-run не используются как доказательство: первый был неполным из-за неверного внешнего вызова ShellCheck, второй получил пустой patch из-за отсутствия intent-to-add для новых файлов.

## Что обнаружил hosted runner

Первые реальные GitHub-hosted прогоны честно сохранены как failures:

| Exact commit | Push | Pull request | Причина |
| --- | --- | --- | --- |
| `39aa194fe79d4f4ebf0a2153e4516b64be97849e` | [29846508842](https://github.com/Zulut30/minemod/actions/runs/29846508842) | [29846509114](https://github.com/Zulut30/minemod/actions/runs/29846509114) | `setup-java` экспортировал hosted-toolcache alias, а Gradle напечатал канонический `/usr/lib/jvm` target; raw-path comparison был ложным отрицанием |
| `2881d0e86d6e82630c6dfb67e3aaaa87dae6e11b` | [29846906261](https://github.com/Zulut30/minemod/actions/runs/29846906261) | [29846911978](https://github.com/Zulut30/minemod/actions/runs/29846911978) | сравнение toolchains уже прошло, но workflow записал alias в `PHASE0_JAVA*_HOME`, который fail-closed provenance generator правильно отклонил как неканонический путь |
| `a670773b092887e8127aa3d4b94cff4259fc9450` | [29847272151](https://github.com/Zulut30/minemod/actions/runs/29847272151) | [29847275808](https://github.com/Zulut30/minemod/actions/runs/29847275808) | отдельный client job имел холодный asset cache; подготовка runtime была ошибочно включена в 180-секундный deadline фактического smoke |

Исправления разделены на три узких коммита:

1. `2881d0e86d6e82630c6dfb67e3aaaa87dae6e11b` сравнивает canonical toolchain locations;
2. `a670773b092887e8127aa3d4b94cff4259fc9450` записывает canonical existing JDK directories в оба job;
3. `5fd2bdb7a0a12dce2716c24479bfd301ab14a612` выполняет strict-verified `prepareClientRun` до входа в неизменённый 180-секундный client supervisor.

Ни одно исправление не ослабляет exact version/vendor checks, provenance generator, dependency verification или readiness predicates. Неизменённый 180-секундный deadline по-прежнему ограничивает фактический client smoke; `prepareClientRun` намеренно вынесен до него и ограничен 10-минутным timeout всего hosted job.

## Frozen remediation patch

Итоговый full-index diff от `39aa194fe79d4f4ebf0a2153e4516b64be97849e` до `5fd2bdb7a0a12dce2716c24479bfd301ab14a612` зафиксирован как:

- SHA-256 `ed3867b29c203e2db5049d8be183136b0b37573cf9e249355a7b49cfe9ad5a7f`;
- размер `12946` байт;
- ровно `3` файла, `47` вставок и `8` удалений;
- пути: `.github/workflows/phase-0.yml`, `docs/audit/neoforge-26.1.2-baseline.md`, `scripts/test-smoke-guards.sh`.

Формальный final run Codex Dev Team: `20260721162559-543c56`.

- patch score: `0.81` при пороге `0.85`, `quality_gate_passed:false`; risk `low`, ownership `pass`, auth/migrations/lockfile не затронуты;
- score artifact SHA-256: `50f130452b0f99e40443f96fd238535f1aa1e9e65a04b1f73891ff1768d33234`;
- integration verification `20260721163022-3d0c55`: `6/6` команд завершились с exit `0`; result artifact SHA-256 `823150ca4ad6fc3f6ccc9614a83c56a2886cb022574ba0d2b355d7de3dc68b6c`;
- exact patch повторно прошёл `git diff --check`, ShellCheck с `--source-path=SCRIPTDIR`, `bash -n`, PyYAML parse, полный `test-smoke-guards.sh` и byte-identical `cmp`;
- итоговый read-only review: `APPROVE`, findings/required fixes/test gaps отсутствуют; review artifact SHA-256 `6c290e75ca18f8917801a4183b37cc02205c9fb94db3730c50999a2e612ff417`.

Worker sandbox не разрешал создание тестового Unix-domain socket, поэтому первоначальный worker report содержит один failure. Последующий verification выполнил тот же exact worktree вне этого ограничения и прошёл полный suite. Формула score также вычла `0.075` за три изменённых файла и `0.032365` за размер patch; AF_UNIX capability failure был единственной причиной падения ниже порога `0.85`, но не единственной причиной снижения от `1.00`. Scorer не агрегирует поздний verification и потому сохранил `0.81`; этот результат не переписывается как pass.

Во время первого экспорта DevTeam также повредил один UTF-8 символ в сохранённом patch. Повреждённый artifact был отклонён reviewer. Patch штатно перегенерирован через `git diff --binary --full-index` из сохранённого worker worktree; после этого его SHA-256, размер, byte identity и applicability совпали с frozen remediation patch, а повторный review дал `APPROVE`.

## Hosted результат

На exact commit `5fd2bdb7a0a12dce2716c24479bfd301ab14a612` оба независимых запуска завершились `success`:

- [push run 29847982768](https://github.com/Zulut30/minemod/actions/runs/29847982768), 2026-07-21 16:18:16–16:24:55 UTC;
- [pull-request run 29847983659](https://github.com/Zulut30/minemod/actions/runs/29847983659), 2026-07-21 16:18:17–16:24:47 UTC.

В обоих runs прошли control-plane install/lint/typecheck/test/build, canonical Java bootstrap, reviewed checksums, strict Gradle configuration и clean build, byte-identical provenance regeneration, GameTest, полный smoke guard suite, dedicated server, strict `prepareClientRun` и headless client.

## Решение root orchestrator

Для exact remediation SHA `ed3867b29c203e2db5049d8be183136b0b37573cf9e249355a7b49cfe9ad5a7f` принимается ограниченное исключение только для `min_patch_score` `0.81/0.85`: AF_UNIX capability failure раннего worker sandbox был единственной причиной результата ниже порога и закрыт последующим `6/6` verification и двумя hosted successes. Ownership, semantic review, applicability, byte identity и test gates не waived.

Исходные условия 1–6 выполнены combined artifact и integration commit `39aa194fe79d4f4ebf0a2153e4516b64be97849e`, но условие 7 на этом commit не прошло. После трёх hosted portability failures был создан отдельный remediation diff; его hosted successes на `5fd2bdb7a0a12dce2716c24479bfd301ab14a612` предшествуют ретроспективному freeze/verification/review run `20260721162559-543c56`. Root orchestrator явно принимает это отклонение от исходного порядка только для exact remediation SHA выше. Совокупность исходного combined artifact, отдельной remediation-привязки и hosted evidence закрывает Phase 0 bootstrap gate, но не меняет статус pack на production, не даёт Windows/macOS coverage и не распространяется на любой другой patch SHA или последующее изменение workflow/fixture.
