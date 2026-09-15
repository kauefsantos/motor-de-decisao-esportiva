# Motor de Decisão Esportiva — estado canônico

> Atualizado: 15/09/2026  
> Repositório: `kauefsantos/motor-de-decisao-esportiva`  
> Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a`  
> Aplicação: `https://quant-football-insights.lovable.app/`

Este documento registra o estado vigente do produto. Auditorias datadas preservam a trilha histórica, mas não substituem o código do `main`, as migrations versionadas ou o estado vivo do Lovable Cloud.

## Fontes de verdade

- **GitHub `main`**: código, testes, migrations, contratos e documentação versionados.
- **Lovable Cloud**: banco, runtime e estado operacional vivos.
- **Lovable**: aplicação canônica ligada a este repositório; não criar projeto paralelo para continuar o produto.
- Implementado, testado, mergeado, sincronizado, publicado e validado em produção são estados distintos e devem ser descritos separadamente.

## Estado técnico atual

- Aplicação full-stack: operacional.
- Autenticação/autorização: implementadas e cobertas por regressões.
- Lovable Cloud: migrations versionadas e regressões no CI.
- Pipeline principal: operacional com checkpoints, retries e retomada.
- Elo hierárquico: automatizado e auditável.
- Motor de valor: regras determinísticas de probabilidade, odd, EV e edge.
- Modelo 1X2 de uso diário: experimental.
- Stage 9: primeira execução automática natural concluída em 15/09/2026; calibração rejeitada pelos gates.
- Certificação estatística formal: **não concluída**.
- Execução automática de apostas: não existe.

## Dual-track vigente

A aplicação opera em dois trilhos independentes.

### Trilho A — modo diversão / experimental

Modelo 1X2 atual:

`goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040`

Fluxo conceitual:

`Goals+Elo → Elo-Davidson +60 → uncertainty-linear 40% → HOME/DRAW/AWAY`

O modo diversão permanece disponível mesmo enquanto o modelo está com `PRODUCTION_VALIDATED=false`.

Regras canônicas de seleção:

- probabilidade >= 70%;
- odd >= 1,70;
- EV >= 8%;
- edge >= 5 pontos percentuais;
- máximo de 3 oportunidades finais;
- máximo de 1 oportunidade principal por partida;
- máximo de 2 oportunidades da mesma família;
- zero oportunidades é um resultado válido.

Esse trilho serve para análise, acompanhamento de previsões, odds, EV, edge, resultados e desempenho. Ele **não desbloqueia stake real** e não transforma um modelo experimental em modelo certificado.

### Trilho B — Stage 9 / laboratório estatístico

A Stage 9 trabalha em segundo plano e não bloqueia o modo diversão.

Ela avalia a calibração do mesmo modelo direcional congelado, sem relaxar a fórmula para obter aprovação. Os gates incluem:

- max calibration gap <= 10 p.p.;
- Brier não piorar;
- LogLoss não piorar;
- estabilidade temporal;
- estabilidade por liga;
- zero leakage;
- holdout prospectivo suficiente e intocado.

O holdout prospectivo começa em `14/09/2026` e exige no mínimo `200` partidas settled/intocadas. Retrospectiva não pode ser reutilizada como holdout final.

Somente o caminho governado de promoção pode definir `PRODUCTION_VALIDATED`. Stake real permanece separado e bloqueado até essa certificação formal.

## Auditoria operacional da Stage 9 — 15/09/2026

A primeira execução automática natural ocorreu na janela principal das **06:15 America/Sao_Paulo**.

Estado vivo confirmado no Lovable Cloud:

- job `stage9-1x2-ensemble-calibration-v1` criado às `09:15:00Z`, iniciado às `09:15:02Z` e concluído às `09:15:54Z`;
- status do job: `DONE`;
- `last_error`: vazio;
- artefato `stage9-ensemble-calibration-v1-fit-through-2026-05-31` criado;
- status do artefato: `REJECTED`;
- readiness: `CALIBRATION_REJECTED`;
- holdout prospectivo: `NOT_STARTED`;
- status do modelo: `NOT_PRODUCTION_VALIDATED`;
- modo diversão permaneceu ativo e inalterado.

Resultado retrospectivo da rodada:

| Métrica | Bruto | Calibrado | Gate |
| --- | ---: | ---: | --- |
| Brier | 0,622963 | 0,623138 | não poderia piorar — falhou |
| LogLoss | 1,035706 | 1,035890 | não poderia piorar — falhou |
| Max calibration gap | — | 19,68% | <= 10% — falhou |

A rodada preservou evidência de ausência de leakage e cobertura de estabilidade, mas isso não compensa a falha simultânea dos gates de calibração, Brier e LogLoss. A promoção foi corretamente bloqueada.

Eventos registrados no laboratório:

- `CALIBRATION_STARTED`;
- `CALIBRATION_RESULT`, avisando que nenhum candidato ficou apto para promoção;
- `DAILY_STATUS`, registrando o artefato como `REJECTED` e o modelo como `NOT_PRODUCTION_VALIDATED`.

Não repetir a mesma calibração apenas para buscar aprovação. Uma nova tentativa deve depender de nova hipótese/evidência e continuar respeitando os mesmos gates.

## Hardening de segurança — 15/09/2026

Foi aplicada no Lovable Cloud e versionada a migration:

`20260915004337_ce1bb2f6-ab04-45f5-987c-d2e16299e813.sql`

Ela adiciona defesa em profundidade sem ampliar acesso do browser:

- `analysis_drafts`: policies owner-scoped para SELECT/INSERT/UPDATE/DELETE;
- `analysis_draft_games`: policies herdando a propriedade do draft pai;
- `decision_opportunity_queue`: policies por proprietário da run via `private.owns_run(run_id)`;
- `push_delivery_outbox`: leitura limitada ao próprio usuário; escrita/dispatch continuam server-side;
- as quatro tabelas permanecem com RLS habilitado e sem grants diretos para `anon`/`authenticated`.

Também foi fixado `search_path=''` em:

- `public.elo_is_target_league(text, text)`;
- `public.elo_league_key(text, text)`;
- `public.normalize_brazil_league_lineage()`;
- `public.normalize_prediction_outcome_distribution()`.

`public.is_approved_app_user()` continua como exceção intencional `SECURITY DEFINER`: `anon` não possui EXECUTE, `authenticated` possui EXECUTE porque o middleware de autenticação precisa consultar o gate sobre o próprio usuário. Essa função não deve ser aberta para consulta arbitrária de terceiros.

O insert de `raw_observations` passou a enviar `observation_key=''` apenas para satisfazer o contrato tipado. A identidade não confia nesse valor: `ignore_duplicate_raw_observation()` e `set_raw_observation_key()` recalculam a chave no banco antes da persistência/deduplicação.

## Limpeza operacional — 15/09/2026

Foi concluída a limpeza que havia parado por timeout no Lovable:

- 53 runs paradas removidas: 6 `ERROR` e 47 `READY_FOR_ODDS`;
- 881 partidas pertencentes a essas runs removidas;
- antes da remoção foi confirmado que **nenhuma das 53 runs possuía aposta registrada**;
- dados pesados dessas runs já removidos anteriormente foram reconciliados;
- rascunhos com erro, job com erro e outbox morto já haviam sido removidos.

O gargalo foi identificado: `raw_observations` tinha `0` linhas vivas, mas ainda ocupava aproximadamente `463 MB` físicos após os deletes anteriores. FKs de `matches` precisavam percorrer tabelas logicamente vazias porém fisicamente grandes. A limpeza cancelou apenas a tentativa de manutenção travada e compactou por `TRUNCATE` exclusivamente tabelas confirmadas com `0` registros vivos, sem apagar registros válidos.

Estado final revalidado:

- `0` runs `ERROR`;
- `0` runs `READY_FOR_ODDS`;
- `0` partidas vinculadas às pendências removidas;
- `1` run `COMPLETED` preservada;
- `2` drafts `FINALIZED` preservados;
- `5` notificações `SENT` preservadas.

## Fluxo principal

### Automático diário

```text
12:45 America/Sao_Paulo
→ descobrir calendário D+2 na 5Dollar
→ filtrar competições ativas do escopo Elo
→ persistir fixture/time/liga por IDs oficiais
→ COLLECT
→ CLEAN
→ FEATURES
→ PROBABILITY
→ GATES
→ MARKETS
→ READY_FOR_ODDS
→ push “Análise pronta” quando o processamento realmente terminar
→ usuário entra para conferir odds e decidir
```

No caminho automático, `RESOLVE` já nasce concluído: nomes de clubes são rótulos, não identidade. A identidade é formada por `fixture_id`, `home_team_id`, `away_team_id` e `league_id` da fonte.

### Manual / contingência

```text
Enviar CSV
→ validar partidas
→ RESOLVE
→ COLLECT
→ CLEAN
→ FEATURES
→ PROBABILITY
→ GATES
→ MARKETS
→ conferir odds
→ fila de decisão
→ revisar
→ registrar aposta feita fora do sistema
→ acompanhar resultado e analytics
```

O CSV permanece como contingência. A aplicação não executa apostas.

## Automação D+2

- primeira tentativa diária às **12:45** em `America/Sao_Paulo`;
- data analisada: **D+2** no calendário local;
- tentativas curtas de recuperação às 12:50, 12:55 e 13:00;
- chave determinística por owner/data impede runs duplicados;
- recuperação reutiliza leases, retries e worker existentes;
- competições elegíveis vêm de `elo_target_leagues` e `elo_cross_competitions` ativas;
- partidas automáticas entram com IDs oficiais da 5Dollar e confiança 1.0;
- se não houver partidas elegíveis, nenhum run vazio é fabricado;
- `ANALYSIS_READY` é enviado somente ao finalizar o pipeline;
- a automação prepara a análise, mas não congela a odd como preço definitivo.

Detalhes: `docs/governance/SCHEDULED_D2_ANALYSIS_2026-09-12.md`.

### Exceção operacional de 15/09/2026

Existe um job one-off `one-off-odds-alert-2026-09-15` programado para `09:00 America/Sao_Paulo` (`12:00 UTC`) com escopo dos dias 15 e 16. O próprio comando chama `cron.unschedule(...)` após o disparo, portanto não deve virar recorrência permanente. Como qualquer automação, o fato de estar agendada não prova execução: depois das 09:00, consultar o Lovable Cloud antes de afirmar entrega.

## Gate de produção e dinheiro real

A certificação de produção e o modo diversão são propositalmente separados.

- O modo diversão pode calcular e exibir previsões experimentais.
- A fila/gate de produção continua exigindo status compatível com `PRODUCTION_VALIDATED` quando o fluxo exigir certificação formal.
- Stake real permanece bloqueado para modelos não validados.
- Nenhum modelo é promovido artificialmente para gerar picks.
- Uma fila operacional vazia continua sendo comportamento válido.

A separação evita transformar a falta de certificação estatística em indisponibilidade do produto, sem reduzir os controles do caminho real-money.

## Arquitetura atual

### Decision queue

- fronteira crítica tipada;
- RPCs encapsulados em repositories;
- acesso privilegiado ao Lovable Cloud mantido server-side;
- gates de arquitetura/typecheck evitam reintrodução de acessos inseguros no caminho crítico.

### Mercados experimentais

O orquestrador foi decomposto em contratos, construção de datasets, serviço de predição, repository de persistência e avaliação de value/tracking.

A decomposição preserva thresholds e regras quantitativas. Predictions experimentais antigas são removidas antes da recomputação para impedir que falhas deixem resultados antigos aparentando ser atuais.

### Processamento resiliente

- jobs persistidos;
- lease e heartbeat;
- retomada de jobs parados;
- checkpoints por etapa;
- coleta em batches;
- partidas concluídas não são processadas novamente;
- trabalho parcial interrompido é reconciliado antes da nova tentativa;
- dispatch e rechain protegidos contra duplicidade.

## Elo

O Elo inclui ratings domésticos, hierarquia entre ligas, comparação cross-league e reconstrução point-in-time. O fechamento diário executa rebuild e auditoria sem duplicar o mesmo trabalho.

## Home, notificações e retomada

A Home funciona como painel de ação owner-scoped:

- rascunhos e runs retomáveis pertencem ao usuário autenticado;
- ações de retomada apontam para a run correta;
- a central **Laboratório Stage 9** exibe eventos relevantes sem ler tabelas privadas de validação diretamente no browser;
- a UI identifica explicitamente `Modo diversão · Ativo · experimental`;
- notificações da Stage 9 possuem histórico recente e contador de não lidas.

## Banca, stake e CLV

- stake sugerido/real segue o gate de validação formal;
- modelos não validados permanecem experimentais/observacionais para esse fim;
- captura de CLV possui retries limitados;
- Lovable Cloud reforça regras transacionais de banca e settlement.

## CI e governança

Antes de merge, a cadeia obrigatória cobre:

```text
lint + typecheck + architecture boundaries
→ dependency vulnerability gate
→ secret scan
→ server secret boundary
→ governance documentation gate
→ versioned route tree
→ migrations + regressões de banco
→ functional decision-flow E2E
→ experimental engine E2E
→ unit tests
→ production build
→ bundle performance budget
→ concurrent load smoke
→ Chromium + Firefox + WebKit
→ responsividade + acessibilidade
```

O repositório mantém `SECURITY.md`, `CONTRIBUTING.md`, CODEOWNERS, template de PR, Dependabot e documentação de arquitetura/governança.

## Estado da publicação

Em 14/09/2026, a PR #143 foi mergeada por squash e publicada. Na validação pós-publicação foi detectado que o código havia sincronizado antes das duas migrations da Stage 9 chegarem ao Lovable Cloud. A divergência foi corrigida aplicando, na ordem:

1. `20260914213000_stage9_1x2_ensemble_calibration.sql`;
2. `20260914224500_stage9_dual_track_lab_notifications.sql`.

Em 15/09/2026, o hardening produzido pelo ambiente Lovable chegou ao commit `76477df5d4d253b1d03d672a09960638caef90cc` e sua migration foi confirmada no Lovable Cloud. Esse conjunto deve passar pelo fluxo GitHub/PR/CI antes de ser considerado reconciliado com o `main`.

## Validações ainda não afirmadas

Os itens abaixo não devem ser descritos como validados em produção até haver evidência viva correspondente:

1. `SHADOW_READY` para a Stage 9 — a calibração atual foi `REJECTED`;
2. primeiro ciclo de atualização do holdout — permanece `NOT_STARTED` enquanto não houver candidato apto;
3. `PRODUCTION_VALIDATED` para o modelo atual — continua falso até todos os gates retrospectivos e prospectivos serem cumpridos;
4. interrupção deliberada no meio de `COLLECT` seguida de retomada real, caso ainda não exista evidência posterior específica desse kill test;
5. entrega efetiva do alerta one-off das 09:00 de 15/09/2026 — verificar após a janela, não inferir apenas pela existência do cron.

Esses itens não bloqueiam o modo diversão.

## Regra para futuras mudanças

Antes de alterar comportamento:

1. conferir o `main` atual e o estado vivo do Lovable Cloud;
2. preservar as fontes de verdade;
3. não relaxar gates para produzir recomendações;
4. versionar mudanças de banco em migration;
5. adicionar regressão correspondente;
6. passar todos os gates obrigatórios antes do merge;
7. confirmar sincronização GitHub/Lovable após o merge;
8. registrar separadamente o que foi implementado, testado, mergeado, sincronizado, publicado e validado em produção.

## Referências

- `README.md` — apresentação do projeto e regra atual do funil;
- `docs/ARCHITECTURE.md` — arquitetura e boundaries;
- `docs/GOVERNANCE.md` — governança técnica;
- `docs/CASE_STUDY.md` — narrativa de portfólio;
- `docs/ELO.md` e `docs/ELO_RUNBOOK.md` — Elo e operação;
- `docs/governance/1X2_UNCERTAINTY_LINEAR_40_2026-09-14.md` — modelo 1X2 experimental atual;
- `docs/governance/STAGE9_1X2_ENSEMBLE_CALIBRATION_2026-09-14.md` — protocolo estatístico Stage 9;
- `docs/governance/STAGE9_DUAL_TRACK_LAB.md` — separação modo diversão / laboratório;
- `supabase/migrations/20260915004337_ce1bb2f6-ab04-45f5-987c-d2e16299e813.sql` — hardening owner-scoped/search_path de 15/09;
- `docs/governance/` — evidências e decisões versionadas.