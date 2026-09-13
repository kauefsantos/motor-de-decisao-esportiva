# Motor de Decisão Esportiva — estado canônico

> Atualizado: 12/09/2026  
> Repositório: `kauefsantos/motor-de-decisao-esportiva`  
> Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a`  
> Aplicação: `https://quant-football-insights.lovable.app/`

Este documento registra o **estado vigente** do produto. Auditorias datadas preservam a trilha histórica, mas não substituem o código do `main`, as migrations versionadas ou o estado vivo do Lovable Cloud.

## Fontes de verdade

- **GitHub `main`**: código, testes, migrations, contratos e documentação versionados.
- **Lovable Cloud**: banco, runtime e estado operacional vivos.
- **Lovable**: aplicação canônica ligada a este repositório; não criar projeto paralelo para continuar o produto.
- Implementado, testado, mergeado, publicado e validado em produção são estados distintos e devem ser descritos separadamente.

## Estado dos eixos auditados

Os eixos de RLS, segurança da informação, backend/frontend, UX/UI, responsividade, acessibilidade, desempenho/escalabilidade, integrações/automações, banco/integridade, governança, arquitetura/qualidade e regras de negócio passaram pelas rodadas de correção previstas nesta etapa.

As issues de fechamento desta rodada (`#97`, `#98`, `#99` e `#100`) estão concluídas. PRs históricos divergentes foram encerrados quando o mesmo escopo foi reimplementado sobre o `main` atual.

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

### Manual/contingência

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

O CSV permanece como contingência. A aplicação **não executa apostas**.

## Automação D+2

- primeira tentativa diária às **12:45** em `America/Sao_Paulo`;
- data analisada: **D+2** no calendário local;
- tentativas curtas de recuperação às 12:50, 12:55 e 13:00;
- uma chave determinística por owner/data impede runs duplicados;
- recuperação reutiliza os leases, retries e o worker existentes;
- competições elegíveis vêm de `elo_target_leagues` e `elo_cross_competitions` ativas;
- partidas automáticas entram com IDs oficiais da 5Dollar e confiança 1.0;
- se não houver partidas elegíveis, nenhum run vazio é fabricado;
- o aviso não tem horário fixo: o worker existente envia `ANALYSIS_READY` somente ao finalizar o pipeline;
- a automação prepara a análise, mas não congela a odd como preço definitivo; o fluxo de decisão continua sujeito às regras de frescor e aos gates finais.

Detalhes: `docs/governance/SCHEDULED_D2_ANALYSIS_2026-09-12.md`.

## Regra canônica da fila final

Uma oportunidade só pode persistir na fila principal quando atende simultaneamente aos gates vigentes:

- probabilidade de decisão **>= 70%**;
- odd real **>= 1,70**;
- valor esperado (EV) **>= 8%**;
- edge **>= 5 pontos percentuais**;
- dados aprovados pelo pipeline;
- linha recebida compatível exatamente com a linha modelada;
- prediction pertencente à `run` e partida corretas;
- modelo elegível para produção;
- odd automática dentro da janela de frescor de **10 minutos**.

As fronteiras são **inclusivas**: 70%, 1,70, 8% e 5 p.p. atendem o limite mínimo.

### Concentração e quantidade

- máximo de **3** oportunidades finais por rodada;
- máximo de **1** oportunidade principal por partida;
- máximo de **2** oportunidades da mesma família de mercado;
- não existe mais regra diferente para dia útil e fim de semana;
- **zero apostas é um resultado válido**; o sistema não fabrica recomendações para preencher uma cota.

`MAX_SELECTIONS = 3` é a fonte única do limite no seletor de portfólio.

## Gate de modelos em produção

Ter um modelo implementado não significa que ele esteja validado para decisão real.

A fila final exige status compatível com **`PRODUCTION_VALIDATED`** e a probabilidade conservadora/calibrada correspondente. Previsões experimentais podem ser calculadas e observadas, mas não são promovidas automaticamente para decisão.

Na validação de produção do gate, uma prediction experimental artificialmente forte foi corretamente impedida de persistir. Uma sonda sintética e reversível comprovou que um modelo marcado como validado pode persistir somente quando a probabilidade e a linha correspondem ao contrato esperado; divergências foram bloqueadas.

Nenhum modelo esportivo existente foi promovido apenas para gerar apostas. Portanto, uma fila operacional vazia continua sendo comportamento correto enquanto os critérios de validação não forem atendidos.

## Arquitetura atual

### Decision queue

- fronteira crítica tipada, sem `any` deliberado;
- RPCs encapsulados em repository tipado;
- schema de runtime do Lovable Cloud explicitado no boundary administrativo;
- gates de arquitetura/typecheck impedem reintrodução de `explicit any` no caminho crítico.

### Mercados experimentais

O antigo orquestrador monolítico foi decomposto em responsabilidades separadas:

- contratos;
- construção de datasets;
- serviço de predição;
- repository de persistência;
- avaliação de value e tracking.

A decomposição preservou os thresholds e as regras quantitativas. A limpeza das predictions experimentais continua ocorrendo antes da recomputação para impedir que uma falha deixe previsões antigas parecendo atuais.

### Processamento resiliente

- jobs persistidos;
- lease e heartbeat;
- retomada de jobs parados;
- checkpoints por etapa;
- coleta em batches de 4 partidas;
- partidas concluídas não são processadas novamente;
- trabalho parcial de uma partida interrompida é limpo antes de nova tentativa;
- dispatch e rechain reconciliados entre GitHub e Lovable Cloud;
- prevenção de duplicidade aplicada em mais de uma camada.

## Elo

O Elo inclui ratings domésticos, hierarquia entre ligas, comparação cross-league e reconstrução point-in-time.

A auditoria desta rodada confirmou coerência da hierarquia e fórmula. O fechamento diário foi simplificado para executar rebuild e auditoria uma única vez, removendo o gatilho duplicado que repetia esse trabalho.

A migration correspondente foi publicada no Lovable Cloud. A próxima execução agendada do `elo_finalize_daily()` permanece como confirmação operacional natural de que o ciclo diário acrescenta somente uma auditoria.

## Home e retomada

A Home funciona como painel de ação owner-scoped:

- rascunhos e runs retomáveis pertencem ao usuário autenticado;
- ações de retomada usam pares reais `Button -> Link`;
- “Sugestões para registrar” leva diretamente à run proposta quando existe pendência;
- a Home não carrega `experimental_bet_tracking` diretamente;
- o Lovable Cloud resolve a run proposta por `get_owner_latest_proposed_run_id(p_owner_id)`, helper server-only com filtro explícito pelo owner da `analysis_run`.

## Banca, stake e CLV

- stake sugerido é permitido somente quando o modelo atende ao status de validação exigido;
- modelos não validados permanecem em modo observacional;
- captura de CLV possui tentativas limitadas a 3;
- novas tentativas são agendadas com espera de +15 e +30 minutos;
- o Lovable Cloud reforça a regra de stake validado no banco;
- settlement e operações críticas de banca permanecem transacionais.

## Evidência E2E real de 12/09/2026

Run: `b39e5c38-6d06-4e0b-84af-1464885dc5c0`.

Partidas:

- Palmeiras x São Paulo;
- Botafogo x RB Bragantino;
- Santos x Cruzeiro.

Resultado observado:

- 7 etapas concluídas;
- 3 partidas resolvidas;
- 234 contratos bloqueados;
- 0 oportunidades publicadas;
- 0 seleções finais;
- run chegou a `READY_FOR_ODDS`.

Principais bloqueios registrados:

- 117 `MODEL_NOT_PRODUCTION_VALIDATED`;
- 78 contratos de cartões sem dados suficientes de amarelos/vermelhos;
- 15 por ausência de xG;
- 12 por ausência de chutes;
- 12 por ausência de chutes no alvo.

Esse resultado é considerado correto: o motor preferiu não recomendar a inventar dados ou ultrapassar os gates.

## CI e governança

Antes de merge, a cadeia atual cobre:

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

O repositório mantém ainda `SECURITY.md`, `CONTRIBUTING.md`, CODEOWNERS, template de PR, Dependabot e documentação de arquitetura/governança.

## Publicação no Lovable Cloud nesta rodada

Foram publicados e verificados, entre outros:

- gate de modelo validado para a fila de decisão;
- defesa de linha/prediction/run na persistência;
- remoção do guard legado de seleção 2/3;
- fechamento único de rebuild/auditoria Elo;
- correção de dispatch de automação;
- stake validado e retry limitado de CLV;
- helper owner-scoped da Home `get_owner_latest_proposed_run_id(uuid)`.

Para o helper da Home foi confirmado no Lovable Cloud:

- função existente;
- `service_role` com permissão de execução;
- usuário autenticado sem permissão direta;
- owner inexistente retorna `null`;
- release `20260912-owner-latest-proposed-run` registrado.

A automação D+2 descrita acima deve ser considerada **versionada no código somente após o merge do PR correspondente** e **operacional somente depois da migration publicada e do primeiro disparo observado no Lovable Cloud**.

## Limitações e validações ainda não afirmadas

Os itens abaixo **não** devem ser descritos como validados em produção:

1. interrupção deliberada no meio de `COLLECT` seguida de retomada real — a lógica e os testes existem, mas esse kill test específico não foi executado em produção nesta rodada;
2. próxima execução agendada do fechamento diário Elo — necessária apenas como confirmação operacional do comportamento já corrigido, não como blocker estrutural;
3. modelos esportivos atuais como `PRODUCTION_VALIDATED` — nenhum foi promovido artificialmente;
4. primeiro disparo real da automação D+2 às 12:45 e a notificação correspondente — permanecem validação operacional após publicação.

## Regra para futuras mudanças

Antes de alterar comportamento:

1. conferir o `main` atual e o estado vivo do Lovable Cloud;
2. preservar as fontes de verdade acima;
3. não relaxar gates para produzir recomendações;
4. versionar mudanças de banco em migration;
5. adicionar regressão correspondente;
6. passar todos os gates obrigatórios antes do merge;
7. registrar separadamente o que foi implementado, testado, mergeado, publicado e validado em produção.

## Referências

- `README.md` — apresentação do projeto e regra atual do funil;
- `docs/ARCHITECTURE.md` — arquitetura e boundaries;
- `docs/GOVERNANCE.md` — decisões de governança técnica;
- `docs/CASE_STUDY.md` — narrativa de portfólio;
- `docs/ELO.md` e `docs/ELO_RUNBOOK.md` — Elo e operação;
- `docs/governance/` — evidências e decisões versionadas;
