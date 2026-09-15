# Índice de apoio para limpeza de partidas — 15/09/2026

## Contexto

Durante a limpeza administrativa das 53 análises antigas (`6 ERROR` e `47 READY_FOR_ODDS`), os dados pesados já haviam sido removidos e foi confirmado que essas runs não possuíam apostas registradas, seleções finais, odds do usuário ou itens ativos na fila de decisão.

Restavam `881` partidas e seus IDs externos. Os IDs externos puderam ser eliminados, mas a exclusão das partidas continuava excedendo o timeout.

## Causa identificada

`public.raw_observations` estava com `0` linhas vivas após a limpeza, porém ainda mantinha centenas de MB de armazenamento físico. A tabela possui FK por `match_id` para `public.matches(id)`, mas não havia um índice simples de apoio em `raw_observations(match_id)`.

Ao excluir registros pai em `matches`, a verificação referencial podia provocar varreduras caras em `raw_observations`, mesmo quando a tabela estava logicamente vazia.

## Correção

Foi criado no Lovable Cloud, e agora é versionado pela migration `20260915102600_support_match_fk_cleanup.sql`, o índice:

```sql
create index if not exists idx_raw_observations_match_id
  on public.raw_observations(match_id);
```

No estado vivo, o índice foi criado antes de retomar a limpeza. Depois disso, os deletes de `matches` passaram a responder normalmente e as `881` partidas remanescentes foram removidas, seguidas das 53 runs alvo.

`raw_observations`, já confirmada com `0` registros, foi posteriormente truncada como operação administrativa para recuperar o espaço físico residual. O `TRUNCATE` não faz parte da migration e não deve ser reproduzido automaticamente.

## Escopo preservado

A mudança é exclusivamente estrutural/performance de integridade referencial. Não altera modelos, probabilidades, thresholds, Stage 9, stake, automações, ownership, RLS ou regras de negócio.

## Continuidade

O índice deve permanecer versionado mesmo com `raw_observations` pequena ou vazia, porque a tabela volta a crescer com novas coletas e a FK continuará sendo verificada em futuras operações de manutenção/exclusão de partidas.
