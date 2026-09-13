# Etapa 4 — validação walk-forward de escanteios

Data: 2026-09-13

## Objetivo

Validar quantitativamente o artefato que o runtime realmente emite para escanteios domésticos, sem promover modelo por configuração manual e sem usar snapshots duplicados como partidas independentes.

Artefato principal desta etapa:

- `corners-negbin-v2+nb2`

Fallback inventariado separadamente:

- `corners-negbin-v2+poisson`

Nenhum dos dois é promovido por esta entrega. Ambos permanecem `NOT_PRODUCTION_VALIDATED` e sem `calibration_version`.

## Fonte de dados

A validação lê exclusivamente `private.five_dollar_model_matches`, criada na Etapa 3, com uma linha canônica por `fixtureId`.

São excluídos:

- fixtures com `has_conflict=true`;
- jogos sem IDs oficiais dos times;
- jogos sem escanteios realizados;
- partidas do dia corrente/futuras;
- competições que não sejam ligas domésticas nesta primeira validação.

## Protocolo point-in-time

Versão: `stage4-corners-walk-forward-v1`.

Para cada partida-alvo:

1. o treino contém somente partidas da mesma competição;
2. a janela móvel é de 365 dias;
3. exige-se `training.date < target.date`, reproduzindo a regra atual do `prediction-service`;
4. nenhum jogo do mesmo dia da partida-alvo entra no treino;
5. `fitBaseline()` e `predict()` são os mesmos usados em produção experimental;
6. `chooseCountDistribution()` decide NB2 versus Poisson com a mesma política do runtime;
7. a linha de avaliação é o anchor operacional de `corners_match_total`, 9.5;
8. odds não entram no modelo nem na validação preditiva.

## Métricas

São persistidas para o artefato NB2:

- MAE versus baseline da competição;
- Brier Score versus baseline;
- Log Loss versus baseline;
- buckets de calibração;
- maior gap de calibração;
- Expected Calibration Error;
- estabilidade por competição para ligas com pelo menos 30 previsões OOS;
- quantidade de previsões NB2 e fallbacks Poisson.

A amostra OOS mínima herdada do contrato atual é de 60 previsões para que o resultado deixe de ser `INSUFFICIENT_OOS_DATA`.

## Resultado possível

O job pode retornar somente:

- `INSUFFICIENT_OOS_DATA`;
- `VALIDATION_FAILED`;
- `READY_FOR_CALIBRATION`.

`READY_FOR_CALIBRATION` **não significa produção validada**. Significa apenas que a probabilidade bruta passou os critérios quantitativos desta fase e pode avançar para construção/avaliação de um artefato de calibração out-of-sample.

A promoção para `PRODUCTION_VALIDATED` continua proibida enquanto não existirem, no mínimo:

- calibração OOS válida;
- `calibration_version` imutável;
- evidência do artefato exato modelo + calibração;
- passagem pelo gate de produção já existente.

## Execução operacional

A migration cria um job privado e um dispatcher server-only. O Lovable Cloud chama `/api/model-validation` com `jobId` + `dispatchToken` aleatório. O endpoint reivindica o job atomicamente, executa o validador TypeScript e persiste o relatório.

O relatório pode atualizar somente `out_of_sample_metrics` da versão exata. O job não altera `validation_status`, `calibration_version`, predictions, odds, fila de decisão ou apostas.

## Evidência da primeira execução real

O job `3f3c2686-cd79-4e3a-83cd-ad57e91b970c` terminou `DONE`, porém o relatório mostrou somente 953 linhas-fonte e previsões encerradas em 2025-11-22. O Lovable Cloud possuía 4.762 fixtures canônicos até 2026-09-12.

A investigação confirmou que o RPC original retornava 4.762 linhas quando executado diretamente no banco, mas a chamada pelo runtime recebia apenas o primeiro lote limitado pela camada de API. Como o resultado era ordenado por data, a primeira validação usou apenas a fatia histórica mais antiga. O `VALIDATION_FAILED` dessa execução é, portanto, evidência operacional de truncamento e **não pode ser usado como decisão final sobre o modelo**.

O follow-up adiciona paginação keyset limitada a 750 linhas por chamada, ordenada por `(fixture_date, fixture_id)`, detecção de fixture duplicado e limite defensivo de páginas. A execução final deve consumir o histórico canônico completo antes de qualquer conclusão quantitativa.

## Próximos passos

1. publicar o follow-up de paginação;
2. rerodar `kick_stage4_corners_validation()`;
3. comprovar cobertura até a data máxima do histórico canônico;
4. inspecionar as métricas OOS completas;
5. se `VALIDATION_FAILED`, manter modelo bloqueado e diagnosticar o motivo;
6. se `READY_FOR_CALIBRATION`, iniciar a fase de calibração OOS sem promover o modelo bruto.
