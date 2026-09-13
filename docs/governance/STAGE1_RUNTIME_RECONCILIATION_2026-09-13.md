# Etapa 1 — reconciliação do Lovable Cloud

Data: 13/09/2026

## Motivo

A auditoria de liberação encontrou drift entre o estado versionado no GitHub e o estado vivo do Lovable Cloud. Em particular, objetos de desempenho já descritos por migrations versionadas não estavam integralmente presentes no runtime, e uma execução real de `COLLECT` registrou `canceling statement due to statement timeout` durante consulta ao histórico bruto.

Esta etapa não altera modelo esportivo, probabilidade, odds, EV, edge, seleção, stake nem qualquer regra de decisão. O objetivo é somente tornar a infraestrutura de runtime reproduzível e estável antes das próximas etapas funcionais.

## Escopo deste PR

A migration `20260913143000_reconcile_performance_runtime.sql` é forward-only e idempotente. Ela reconcilia:

- índices de hot path de `raw_observations`, `model_predictions`, `normalized_match_stats`, `source_fetches`, `analysis_runs` e `experimental_bet_tracking`;
- helper server-only para leitura indexada do cache bruto;
- RPCs owner-scoped usados em métricas, banca, histórico e apostas abertas;
- armazenamento server-only de Web Vitals com RLS;
- retenção limitada de dados de desempenho;
- wrappers de manutenção que cedem quando existem jobs de análise em `QUEUED` ou `RUNNING`;
- schedules de Elo, manutenção 5Dollar e retenção de performance;
- registro explícito da reconciliação em `app_schema_releases`.

## Segurança e invariantes

Permanecem inalterados:

- probabilidade mínima final: 70%;
- odd mínima: 1,70;
- EV mínimo: 8%;
- edge mínimo: 5 p.p.;
- máximo de 3 escolhas finais;
- máximo de 1 escolha principal por partida;
- máximo de 2 da mesma família;
- zero escolhas continua válido;
- predictions experimentais não são promovidas;
- modelos não recebem `PRODUCTION_VALIDATED` por esta mudança.

As novas funções são revogadas de `public`, `anon` e `authenticated` e concedidas somente a `service_role` quando aplicável.

## Critério de conclusão

Este PR só pode ser considerado concluído quando:

1. as migrations puderem ser aplicadas do zero no banco local de CI;
2. os testes pgTAP, incluindo `performance_runtime_reconciliation.test.sql`, estiverem verdes;
3. todos os gates obrigatórios do PR estiverem verdes;
4. o merge ocorrer via squash conforme o ruleset do repositório;
5. a migration estiver aplicada no Lovable Cloud;
6. os índices, RPCs, tabela de Web Vitals e cron jobs forem verificados diretamente no Lovable Cloud;
7. a consulta que anteriormente sofreu timeout for revalidada no runtime.

Até esses passos serem concluídos, a mudança deve ser descrita apenas como **implementada na branch/PR**, não como publicada ou validada em produção.

## Fora deste PR

Este PR não tenta reconstruir artificialmente o histórico da tabela oficial `supabase_migrations.schema_migrations`. A reconciliação do ledger histórico será tratada separadamente e somente depois que o estado vivo estiver estável e verificável, para evitar registrar como executada uma migration que nunca tenha sido aplicada integralmente.
