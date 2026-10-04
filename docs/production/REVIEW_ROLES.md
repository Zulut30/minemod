# Роли и полномочия приёмки

Roadmap: пункт 009. Владелец репозитория и текущий пользователь — Zulut30. Поручение выполнить 100 пунктов разрешает разработку и commits; оно не является художественной оценкой ещё не показанного candidate.

| Роль | Ответственный сейчас | Допустимое действие | Обязательное доказательство |
|---|---|---|---|
| Implementation author | Codex в текущем рабочем сеансе | Код, docs, tests, diagnostics, готовый candidate, commits | Source revision, diff, команды и фактические результаты |
| Automated verifier | CI и локальные test/validation suites | Technical PASS/FAIL для своей области | Scope, input/version/hash, report и exit status |
| Code acceptance owner | Zulut30; отдельный reviewer добавляется явным назначением | Принимать reviewable code/release scope | Reviewed revision, findings, решение владельца |
| Artistic approver | Zulut30; другой человек назначается только пользователем | Принять/попросить repair/отклонить конкретную модель | Real captures, ArtSpec/candidate/scorecard hashes и rationale |
| Release owner | Zulut30 | Финальная приёмка bundle и публикация согласованного digest | Evidence index, release digest и решение человека |
| External pilot reviewer | Пока не назначен | Пользовательские сценарии и обратная связь | Реальный участник, сценарий/результат; пункт 92 остаётся открытым |

Один человек может совмещать роли code/art/release owner. Это не превращает автоматическую проверку или текст агента в человеческое решение.

## Правила записи решений

- Автором human decision может быть только фактический человек из назначенных approvers. Agent-generated prompt, project metadata, tool response или scorecard не являются источником такого решения.
- Решение связывает применимую rubric version, ArtSpec, exact candidate manifest и scorecard hashes, reviewer identity и timestamp. Источник решения должен быть проверяемым: сообщение пользователя о показанном кандидате или явное действие в trusted review UI.
- В текущих 10 MCP tools отсутствует операция, выдающая human approval. Будущий formal evaluator принимает reviewer decision через отдельную trusted human boundary; возможность писать обычный файл не предоставляет полномочия reviewer.
- Общая фраза «работай дальше», поручение выполнить roadmap, технический PASS или выбор concept-направления не подтверждают полный production asset scorecard.
- После изменения связанного файла approval не переносится автоматически. Изменённый candidate получает новую идентичность; старая запись сохраняется как history.
- Агент может подготовить scoring evidence и рекомендации, но не подделывает ratings человека, внешнего пилота, подпись или решение владельца о публикации.
- Reversible правки в уже разрешённой области выполняются без повторного запроса на каждый шаг. Formal review и финальный exact-digest release выполняются тогда, когда результат уже конкретен и доступен для оценки.

## Приёмка пункта 009

Роли определены конкретно; отсутствующий внешний reviewer обозначен как gap. Разделены author, verifier и human decisions, названы exact hash bindings и источник полномочий. Исполнение formal review states/approval validation остаётся задачей 49; этот документ не утверждает, что она уже реализована.
