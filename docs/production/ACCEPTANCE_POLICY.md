# Пороги приёмки v1

Roadmap: пункт 006. Машиночитаемая политика: [acceptance-policy.v1.json](acceptance-policy.v1.json). Это заранее заданные targets, а не отчёт об их достижении.

Художественная политика сохраняет [rubric 0.1.0](../quality/art-quality-rubric-v0.md): total ≥85/100, technical ≥27/30, visual ≥24/30, in-game ≥21/25, provenance ≥13/15. Ни один hard blocker не допускается. `N/A` требует предусмотренной применимости и rationale; высокий total не компенсирует слабую категорию. Approval принадлежит человеку и связывает точные ArtSpec/candidate/scorecard hashes.

Глобальные authoring limits совпадают с существующими contracts/service. Бюджет конкретного класса задаётся ArtSpec и [контрольным брифом](CONTROL_BRIEFS.md); он может быть строже. Координаты и rotations дополнительно ограничены экспортируемым target. Разрешённый cube budget — техническое ограничение, а не художественная оценка.

## Аппаратный профиль и измерения

Reference PC реально опрошен: Windows 11 x64, Ryzen 9 5950X, 32 logical processors, около 32 GiB RAM, RTX 4060 Ti. Он позволяет начать сопоставимые измерения; минимальные требования к ПК и более широкая аппаратная поддержка не заявляются до проверки других профилей.

Для каждого измерения записываются OS/build, CPU/GPU/driver, app revision, input hash, профиль и методика. После пяти warmup-итераций сохраняются тридцать отдельных результатов, p50/p95/max, ошибки и peak memory всей process group. Самый быстрый запуск не заменяет p95; failed-операции не удаляются из отчёта. Порог считается выполненным только при отсутствии ошибок и применимой нагрузке.

Core mutation target ≤200 ms p95, export ≤1500 ms p95 на контрольном проекте. Desktop capture ≤5 s, save ≤1 s, warm open ≤3 s, frame ≤33.4 ms p95; peak процесса и его детей ≤2 GiB. Core-результат не подтверждает desktop responsiveness. Проверки max-size input выполняются дополнительно, без объявления маленького fixture доказательством всех нагрузок.

Игровой профиль: 32 companions и 64 decorative blocks на согласованных ArtSpec budgets; frame p95 ≤33.4 ms и server tick p95 ≤50 ms. Render/tick и correctness записываются раздельно; GPU/GUI settings и расстояния фиксируются. Это требования к будущему проверенному fixture, а не заявление о сегодняшнем FPS.

Обязательные suites перечислены в JSON. R1/R2/R3 применяют [свои gates](RELEASE_GATES.md); полная production-приёмка включает все releaseChecks, человеческую оценку и отсутствие unresolved critical/high findings.

Изменение thresholds, hardware profile или benchmark создаёт новую policy version до review с причиной и сохранением прошлых результатов. Нельзя уменьшать требования задним числом, чтобы сделать существующий candidate зелёным.

## Приёмка пункта 006

Art minimums сверены с rubric; authoring limits — с текущими константами; reference hardware — с CIM-запросом. Tests, budgets, latency/memory targets и способ измерения записаны до formal candidate review. Фактическое достижение производительности остаётся пунктами 10 и 79.
