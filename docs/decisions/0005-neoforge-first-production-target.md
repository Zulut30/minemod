# ADR-0005: NeoForge 26.1.2 как первый production target

## Статус

Принято.

## Дата

2026-07-29.

## Контекст

Phase 0 уже содержит проверенный baseline NeoForge 26.1.2/Java 25 и отдельные compatibility packs для Fabric. Исторический ADR-0003 временно назначал Fabric первым target, из-за чего README, исполнимый control plane и исследовательский план стали противоречить друг другу.

## Решение

- первый production target — NeoForge 26.1.2 на Java 25;
- Fabric, Forge и Paper реализуются отдельными compatibility packs;
- общий межплатформенный контракт — ModSpec, а не обязательный общий Java-код;
- JEI и Jade остаются optional dependencies;
- `package` и `publish` являются разными операциями;
- исторические Fabric-возможности не считаются доказательством NeoForge parity.

ADR-0003 и ADR-0004 сохраняются как история Fabric-направления, но больше не определяют первый production target.

## Последствия

Application, CLI и MCP должны сначала закрывать NeoForge vertical path. Новые NeoForge-возможности получают собственные compiler/runtime tests, GameTests и dedicated-server gate. Статус Phase 0 не меняется автоматически после принятия этого решения.
