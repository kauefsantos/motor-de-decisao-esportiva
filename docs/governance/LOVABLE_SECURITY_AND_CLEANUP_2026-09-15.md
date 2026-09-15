# Lovable security hardening e limpeza operacional — 15/09/2026

## Objetivo

Registrar e governar as alterações feitas diretamente pelo ambiente Lovable em 15/09/2026 e a correção de banco necessária para concluir a limpeza das análises antigas sem afetar apostas, histórico de desempenho, modelos ou regras quantitativas.

## Segurança incorporada ao código versionado

A migration `20260915004337_ce1bb2f6-ab04-45f5-987c-d2e16299e813.sql` endurece o Lovable Cloud em dois pontos.

### Search path de funções

As funções abaixo passam a usar `search_path = ''`:

- `public.elo_is_target_league(text, text)`;
- `public.elo_league_key(text, text)`;
- `public.normalize_brazil_league_lineage()`;
- `public.normalize_prediction_outcome_distribution()`.

Os objetos persistentes referenciados por essas funções já usam nomes de schema explícitos quando necessário.

### RLS owner-scoped

Foram adicionadas policies owner-scoped para:

- `public.analysis_drafts` — SELECT/INSERT/UPDATE/DELETE do proprietário autorizado;
- `public.analysis_draft_games` — ownership herdado do draft pai;
- `public.decision_opportunity_queue` — ownership da run via `private.owns_run(run_id)`;
- `public.push_delivery_outbox` — leitura pelo próprio usuário; escrita continua restrita ao processamento confiável do servidor.

As quatro tabelas já tinham RLS ativo e não possuíam grants diretos de tabela para `anon` ou `authenticated`. As policies adicionadas mantêm defesa em profundidade sem tornar as tabelas publicamente acessíveis.

`public.is_approved_app_user()` permanece `SECURITY DEFINER` e executável pelo papel autenticado porque é o gate utilizado pelo middleware de autenticação para consultar informações que o usuário autenticado não pode ler diretamente. `anon` não possui EXECUTE. A função verifica apenas o usuário da sessão e retorna um booleano; essa exceção é deliberada e não deve ser removida sem redesenhar o fluxo de autenticação.

## Contrato de `raw_observations.observation_key`

O coletor passou a enviar `observation_key: ""` no payload de inserção para satisfazer o contrato tipado/NOT NULL. O valor não é tratado como fonte de verdade: os triggers `BEFORE INSERT` recalculam a chave usando `public.raw_observation_identity(...)` antes da persistência e da verificação de duplicidade.

Essa alteração não modifica identidade, deduplicação ou regra de negócio da observação.

## Limpeza operacional das análises antigas

Antes da exclusão, foi validado no Lovable Cloud que as 53 runs alvo (`6 ERROR` e `47 READY_FOR_ODDS`) possuíam:

- `0` registros em `experimental_bet_tracking`;
- `0` `final_selections`;
- `0` `user_odds`;
- `0` itens na `decision_opportunity_queue`.

Portanto, a limpeza não incluía apostas registradas nem histórico de desempenho.

A limpeza parcial feita anteriormente já havia removido dados pesados dessas runs. Restavam `881` registros em `matches` e `1.607` registros correspondentes em `match_external_ids`.

Os `match_external_ids` foram removidos de forma determinística por chave primária. O delete de `matches` continuava excedendo o timeout mesmo depois disso.

## Causa do timeout e correção permanente

A investigação mostrou que `public.raw_observations` estava logicamente vazia, porém ainda ocupava aproximadamente `538 MB` em armazenamento físico após a limpeza em massa. A tabela possui FK de `match_id` para `public.matches(id)`, mas não havia um índice simples de apoio em `match_id`.

Consequência: a verificação referencial ao excluir registros pai em `matches` podia provocar varreduras caras em `raw_observations`.

A migration `20260915102600_support_match_fk_cleanup.sql` adiciona:

```sql
create index if not exists idx_raw_observations_match_id
  on public.raw_observations(match_id);
```

No Lovable Cloud vivo o índice foi criado antes de concluir a limpeza. Após sua criação, os deletes de `matches` passaram a responder normalmente.

## Resultado operacional validado

Após a correção:

- `1.607` IDs externos das runs alvo foram removidos;
- `881` partidas das runs alvo foram removidas;
- `6` runs `ERROR` foram removidas;
- `47` runs `READY_FOR_ODDS` foram removidas;
- permaneceu `1` run `COMPLETED`;
- permaneceram `2` drafts `FINALIZED`;
- `ERROR = 0` e `READY_FOR_ODDS = 0` para `analysis_runs`;
- apostas e seleções das 53 runs alvo eram inexistentes e, portanto, não foram apagadas;
- `raw_observations`, já com `0` linhas, foi truncada para recuperar o espaço físico residual, caindo de aproximadamente `538 MB` para cerca de `72 kB`.

O `TRUNCATE` foi uma operação administrativa de limpeza sobre uma tabela confirmada como vazia e não é reproduzido por migration.

## Escopo preservado

Nada desta intervenção altera:

- modelo 1X2 vigente;
- uncertainty-linear 40%;
- Elo-Davidson +60;
- probabilidade mínima de 70%;
- odd mínima de 1,70;
- EV mínimo de 8%;
- edge mínimo de 5 p.p.;
- máximo de 3 oportunidades;
- Stage 9 ou seus gates;
- `PRODUCTION_VALIDATED`;
- bloqueio de stake real;
- automação D+2;
- regra de zero picks como resultado válido.

## Regra de continuidade

As alterações feitas diretamente pelo Lovable devem ser trazidas ao fluxo versionado antes de serem consideradas governadas: branch, PR, todos os gates obrigatórios verdes, merge, sincronização do Lovable e validação viva. O estado administrativo do Lovable Cloud deve ser inspecionado separadamente do estado do código.
