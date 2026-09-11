# Elo — runbook operacional

Este runbook descreve a operação atual do Elo de times e ligas. A arquitetura e as regras quantitativas ficam em [ELO.md](ELO.md).

## Fonte de verdade

- **Lovable Cloud / PostgreSQL**: estado vivo dos ratings, históricos, auditorias e jobs.
- **GitHub `main`**: código, migrations, testes e definições versionadas.
- Não editar `supabase_migrations.schema_migrations` manualmente para reconciliar histórico.

## Agendamento diário

A atualização principal roda diretamente no PostgreSQL por `pg_cron`; ela não depende do navegador nem do chat do Lovable.

Estado operacional validado em 11/09/2026:

| Job | Agenda UTC | Horário BRT | Papel |
| --- | --- | --- | --- |
| `elo-daily-incremental` | `*/2 6-7 * * *` | 03:00–04:58 | percorre os alvos domésticos/cross-league em lotes compatíveis com o rate limit |
| `elo-daily-finalize` | `5 8 * * *` | 05:05 | conclui a rodada e executa auditorias de cobertura/integridade |

Existe também um job histórico de bootstrap desativado; ele não participa da rotina diária.

## Endpoint HTTP

`POST /api/elo-sync` permanece apenas como **fallback administrativo protegido** para uma sincronização explícita server-side.

- `GET` retorna 405.
- `POST` exige autenticação do cron/Bearer configurada no servidor.
- A rotina diária normal não depende desse endpoint.
- Não expor nem registrar o segredo usado para autenticar esse fallback.

## Bootstrap e reconstrução

O histórico usa partidas encerradas da 5DollarFootballAPI e reconstrói ratings cronologicamente.

Para um rebuild:

1. validar primeiro o estado atual do banco e os alvos configurados;
2. usar as funções/jobs já existentes em vez de editar ratings manualmente;
3. preservar a ordem cronológica das fixtures;
4. ao final, executar a auditoria de integridade e cobertura;
5. não apagar histórico de previsão ou contexto Elo para “alinhar” números.

## Objetos operacionais principais

- `elo_sync_state` — estado de sincronização e erros;
- `elo_target_leagues` — ligas domésticas alvo e metadados canônicos;
- `elo_fixtures` — resultados domésticos usados;
- `elo_fixture_history` — Elo local antes/depois de cada partida;
- `elo_team_ratings` — snapshot local atual;
- `elo_league_fixture_history` — evidência e evolução entre ligas;
- `elo_league_ratings` — snapshot atual de força das ligas;
- `elo_prediction_context` — ratings/lambdas efetivamente usados em cada previsão;
- `elo_seed_rebuild_queue` — fila de continuidade/rebuild quando aplicável.

## Auditoria diária

A rodada deve ser considerada saudável somente quando:

- alvos esperados terminarem sem `ERROR`/`RUNNING` residual;
- cobertura doméstica obrigatória estiver completa;
- auditoria de integridade dos times não apontar divergências;
- restrições hierárquicas de liga permanecerem válidas;
- não houver violações de continuidade/seed entre divisões;
- o finalize registrar estado coerente com a rodada incremental.

Um finalize não deve mascarar alvos que ainda estejam em erro.

## Segurança temporal e reprocessamento

### Times

Previsões consultam apenas histórico com `kickoff_at < prediction_at`.

### Ligas

Em uma previsão histórica, se o snapshot atual da liga for posterior a `prediction_at`, o backend reconstrói o rating point-in-time a partir de `elo_league_fixture_history` usando somente jogos anteriores ao instante da previsão.

Isso é obrigatório para evitar leakage e reproduzir runs antigas.

## Diagnóstico de previsão cross-league

Para confirmar que o Elo hierárquico foi aplicado a um jogo continental:

1. localizar a linha em `elo_prediction_context` pelo `run_id` + `match_id`;
2. verificar `elo_scope = 'CROSS_LEAGUE_HIERARCHICAL'`;
3. verificar `model_version = 'elo-v2-hierarchical'`;
4. conferir ratings locais, ratings das ligas e ratings globais;
5. confirmar que `base_lambda_home + base_lambda_away` é igual à soma dos lambdas ajustados;
6. conferir em `model_predictions` o suffix `cross-league-domestic-v1+elo-v2-hierarchical` para 1X2/dupla chance.

Se o ajuste não for aplicado, verificar primeiro:

- existência de Elo pré-jogo dos dois clubes;
- correspondência dos IDs 5Dollar;
- rating point-in-time das ligas;
- mínimo de 3 partidas de evidência interligas para cada liga;
- classificação correta da competição como cross-league.

O fallback sem Elo é comportamento esperado quando um requisito não pode ser comprovado.

## Alterações futuras

Qualquer mudança de K, peso Elo, vantagem de mando, gate de evidência ou regra hierárquica deve:

- ser versionada;
- ter teste de regressão;
- ser avaliada cronologicamente/out-of-sample;
- não ser calibrada a partir de poucos jogos recentes;
- preservar a separação entre probabilidade esportiva e preço da casa.
