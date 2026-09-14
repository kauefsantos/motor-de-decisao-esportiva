# Motor de Decisão Esportiva — estado canônico

> Atualizado: 14/09/2026  
> Repositório: `kauefsantos/motor-de-decisao-esportiva`  
> Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a`  
> Aplicação: `https://quant-football-insights.lovable.app/`

Este documento registra o estado vigente do produto. Auditorias datadas preservam a trilha histórica, mas não substituem o código do `main`, as migrations versionadas ou o estado vivo do Lovable Cloud.

## Fontes de verdade

- **GitHub `main`**: código, testes, migrations, contratos e documentação versionados.
- **Lovable Cloud**: banco, runtime e estado operacional vivos.
- **Lovable**: aplicação canônica ligada a este repositório; não criar projeto paralelo para continuar o produto.
- Implementado, testado, mergeado, publicado e validado em produção são estados distintos e devem ser descritos separadamente.

## Estado técnico atual

- Aplicação full-stack: operacional.
- Autenticação/autorização: implementadas e cobertas por regressões.
- Lovable Cloud: migrations versionadas, com regressões no CI.
- Pipeline principal: operacional com checkpoints, retries e retomada.
- Elo hierárquico: automatizado e auditável.
- Motor de valor: regras determinísticas de probabilidade, odd, EV e edge.
- Modelo 1X2 de uso diário: experimental.
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

## Auditoria operacional da Stage 9 — 14/09/2026

Estado vivo confirmado no Lovable Cloud após a publicação do dual-track:

- migration-base da Stage 9 aplicada e registrada;
- migration de notificações/orquestração dual-track aplicada e registrada;
- registry do modelo Stage 9 presente;
- funções de calibração, holdout e promoção governada presentes;
- `private.model_lab_events` presente;
- feed da UI exposto por RPC server-side owner-scoped;
- `anon` e `authenticated` sem permissão direta de execução do feed;
- `service_role` com permissão de execução;
- trigger de eventos da Stage 9 presente;
- cron `stage9-daily-lab` ativo;
- janela principal às `06:15 America/Sao_Paulo`;
- recuperação às `06:20 America/Sao_Paulo`;
- evento inicial `LAB_ENABLED` registrado com o título “Stage 9 agora trabalha em paralelo”;
- status atual do modelo: `NOT_PRODUCTION_VALIDATED`.

No momento desta auditoria havia:

- `0` jobs Stage 9 executados;
- `0` artefatos de calibração/holdout Stage 9.

Esse estado é esperado: a rotina foi instalada após a janela diária de 14/09. Nenhuma execução manual foi forçada apenas para produzir evidência. A primeira execução automática natural deve ocorrer em **15/09/2026 às 06:15 America/Sao_Paulo**, com recuperação às 06:20 se necessária.

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

## Estado da publicação em 14/09/2026

A PR #143 foi mergeada por squash e publicada. Na validação pós-publicação foi detectado que o código havia sincronizado antes das duas migrations da Stage 9 chegarem ao Lovable Cloud. A divergência foi corrigida aplicando, na ordem:

1. `20260914213000_stage9_1x2_ensemble_calibration.sql`;
2. `20260914224500_stage9_dual_track_lab_notifications.sql`.

Após isso foram revalidados registry, RPCs, trigger, cron, permissões do feed, evento inicial e status `NOT_PRODUCTION_VALIDATED`.

## Validações ainda não afirmadas

Os itens abaixo não devem ser descritos como validados em produção até haver evidência viva correspondente:

1. primeira execução automática real da Stage 9 em 15/09/2026 às 06:15;
2. primeiro artefato de calibração da Stage 9 produzido pelo job automático;
3. primeiro ciclo de atualização do holdout após eventual `SHADOW_READY`;
4. `PRODUCTION_VALIDATED` para o modelo atual — continua falso até todos os gates retrospectivos e prospectivos serem cumpridos;
5. interrupção deliberada no meio de `COLLECT` seguida de retomada real, caso ainda não exista evidência posterior específica desse kill test.

Esses itens não bloqueiam o modo diversão.

## Regra para futuras mudanças

Antes de alterar comportamento:

1. conferir o `main` atual e o estado vivo do Lovable Cloud;
2. preservar as fontes de verdade;
3. não relaxar gates para produzir recomendações;
4. versionar mudanças de banco em migration;
5. adicionar regressão correspondente;
6. passar todos os gates obrigatórios antes do merge;
7. registrar separadamente o que foi implementado, testado, mergeado, publicado e validado em produção.

## Referências

- `README.md` — apresentação do projeto e regra atual do funil;
- `docs/ARCHITECTURE.md` — arquitetura e boundaries;
- `docs/GOVERNANCE.md` — governança técnica;
- `docs/CASE_STUDY.md` — narrativa de portfólio;
- `docs/ELO.md` e `docs/ELO_RUNBOOK.md` — Elo e operação;
- `docs/governance/1X2_UNCERTAINTY_LINEAR_40_2026-09-14.md` — modelo 1X2 experimental atual;
- `docs/governance/STAGE9_1X2_ENSEMBLE_CALIBRATION_2026-09-14.md` — protocolo estatístico Stage 9;
- `docs/governance/STAGE9_DUAL_TRACK_LAB.md` — separação modo diversão / laboratório;
- `docs/governance/` — evidências e decisões versionadas.
