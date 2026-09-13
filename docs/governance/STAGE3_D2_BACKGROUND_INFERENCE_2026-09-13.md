# Etapa 3 — D+2 com inferência em background

Data: 13/09/2026

## Objetivo

Garantir que a análise automática D+2 só seja declarada `READY_FOR_ODDS` depois que as previsões da própria run tiverem sido calculadas e persistidas, sem depender de o usuário abrir a tela de oportunidades.

## Evidências que motivaram a correção

No Lovable Cloud, execuções recentes com status `READY_FOR_ODDS` foram encontradas com `model_predictions = 0`, enquanto a abertura posterior da interface criava essas previsões. Isso mostrava que o estado de prontidão descrevia apenas o término dos passos do worker, não a disponibilidade real das previsões.

Também foi identificado que o cron `scheduled-d2-analysis` falhou em 13/09/2026 às 12:45, 12:50 e 12:55 America/Sao_Paulo. `kick_scheduled_daily_analysis()` usava `ON CONFLICT(request_id)` contra um índice único parcial de `automation_runs`, o que não é inferido por esse conflict target. O efeito observado foi a ausência da run automática para 15/09/2026.

## Contrato após a Etapa 3

O fluxo automático passa a ser:

1. descoberta D+2 por IDs oficiais da fonte;
2. criação idempotente da run e do job;
3. coleta, limpeza e features;
4. inferência experimental no worker;
5. persistência em `model_predictions`;
6. gates e diagnóstico dos contratos de produção;
7. verificação explícita de que há previsões persistidas;
8. somente então `READY_FOR_ODDS`;
9. notificação `ANALYSIS_READY` somente após o worker concluir esse estado.

A mesma rotina server-side de preparação de previsões é reutilizada pelo worker e pela retomada autenticada da interface. Isso remove a implementação duplicada da inferência, mantendo um único caminho de cálculo/persistência.

## Fail closed

Se a inferência não produzir nenhuma previsão persistível, a run não pode receber `READY_FOR_ODDS`. O passo falha, o job segue o tratamento de erro existente e nenhuma notificação de análise pronta é emitida.

`READY_FOR_ODDS` significa que existem previsões preparadas para que o usuário confira preços atuais; não significa que exista uma aposta aprovada.

## Modelos e regras preservados

Esta etapa não promove modelos. As previsões preparadas continuam marcadas como `EXPERIMENTAL_CURRENT_SEASON` e `MODEL_NOT_PRODUCTION_VALIDATED` até a Etapa 4 de validação quantitativa.

Também permanecem inalteradas as regras canônicas de decisão: probabilidade >= 70%, odd >= 1,70, EV >= 8%, edge >= 5 p.p., máximo de três seleções e zero seleções como resultado válido.

Odds de D+2 não são usadas para selecionar apostas. O usuário deve trabalhar com a cotação real e atual quando entrar posteriormente na aplicação.

## Reconciliação do Lovable Cloud

A migration `20260913170000_stage3_d2_background_inference.sql` substitui somente o dispatcher D+2 para usar `ON CONFLICT DO NOTHING`, compatível com a unicidade parcial de `request_id`, mantendo execução exclusiva do `service_role`.

Após merge, sincronização e publicação, a execução perdida de 13/09/2026 deve ser recuperada por uma chamada manual idempotente a `kick_scheduled_daily_analysis()` e acompanhada até seu estado final.

## Replay real de produção — criação da run

Depois da publicação do primeiro pacote da Etapa 3, o replay idempotente conseguiu criar o request HTTP do dispatcher, comprovando a correção do `ON CONFLICT`. O request `96`, porém, retornou HTTP 500 ao tentar criar a run D+2 de 15/09/2026.

A resposta pública mascarava corretamente o detalhe interno, então a falha foi reproduzida de forma transacional no Lovable Cloud usando o mesmo payload de 12 partidas armazenado no cache da 5Dollar. A exceção exata foi `SQLSTATE 42883: function pg_catalog.coalesce(text, unknown) does not exist`.

A causa estava em `create_scheduled_analysis_run_atomic`: a função executa com `search_path=''` e qualificava `COALESCE` como `pg_catalog.coalesce(...)`. `COALESCE` é uma expressão SQL nativa, não uma função do catálogo. A migration `20260913173500_stage3_d2_create_run_coalesce_fix.sql` mantém todos os gates de identidade, competição, idempotência e autorização, alterando somente essas expressões para o `coalesce(...)` válido.

## Replay real de produção — inferência

Após a correção acima, o request `97` criou com sucesso a run `37b0c61d-05b3-4505-9abc-5a6a74b5b077` para 15/09/2026 com 12 partidas resolvidas por IDs oficiais. A coleta concluiu 12/12 e o worker avançou por `CLEAN` e `FEATURES` até `PROBABILITY`.

A primeira chamada longa do worker excedeu 120 segundos durante a coleta, mas o mecanismo de retomada preservou o mesmo job e as chamadas seguintes concluíram os checkpoints sem `last_error`, comprovando a retomada idempotente do fluxo.

Em `PROBABILITY`, o replay revelou um terceiro bloqueio real: `Falha ao paginar raw_observations: canceling statement due to statement timeout`. A leitura antiga tentava transferir todas as observações 5Dollar dos 365 dias anteriores para depois deduplicar em memória. No Lovable Cloud, essa janela continha 291.401 linhas JSON.

A migration `20260913183000_stage3_model_history_query.sql` removeu a paginação por offset da aplicação e introduziu uma RPC server-only. No runtime real, entretanto, o primeiro desenho ainda tentava deduplicar o histórico bruto inteiro a cada inferência. O índice de expressões foi criado com sucesso no servidor, mas a RPC continuou ultrapassando o limite de execução inclusive em janelas curtas, mostrando que o custo de deduplicação on-demand permanecia inadequado.

## Histórico canônico materializado

A migration `20260913193000_stage3_model_history_materialized.sql` substitui a deduplicação on-demand por uma camada compacta em `private.five_dollar_model_matches`:

- uma linha por fixture histórica, em vez de dezenas de observações e recoletas;
- placar, escanteios, cartões e IDs de mandante/visitante consolidados;
- `first_observed_at` e `last_observed_at` preservados;
- qualquer divergência de identidade ou valor entre observações marca `has_conflict=true` e a fixture fica fora da inferência;
- um trigger mantém novas observações automaticamente;
- o backfill histórico é limitado a no máximo 62 dias por execução;
- a RPC pública server-only preserva seu contrato e sintetiza o formato já consumido pelo motor, sem exigir mudança nas regras quantitativas;
- o cutoff continua estrito: somente fixtures com `first_observed_at < prediction_at` e dentro da janela solicitada são expostas ao modelo.

O benchmark real que motivou essa decisão mostrou que 30 dias de observações relevantes representavam 9.927 registros, mas apenas 574 fixtures canônicas; a agregação por janela terminou em aproximadamente 2,5 segundos no Lovable Cloud. Essa estrutura também prepara a Etapa 4 ao impedir que recoletas da mesma partida inflem artificialmente o tamanho da amostra de validação.

O replay só pode ser considerado validado depois que a camada materializada passar por todos os gates, for mergeada e aplicada, o histórico for preenchido por janelas e a mesma run real de 15/09 for retomada até `DONE`, com `model_predictions > 0` antes de `READY_FOR_ODDS`.
