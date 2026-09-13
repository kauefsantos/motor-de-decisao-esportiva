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
