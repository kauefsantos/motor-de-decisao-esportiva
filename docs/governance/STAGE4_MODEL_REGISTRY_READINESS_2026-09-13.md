# Etapa 4 — prontidão do registro de modelos

## Evidência observada antes desta entrega

O registro histórico continha versões antigas como `corners-baseline-v1`, enquanto o runtime de escanteios domésticos efetivamente compõe `corners-negbin-v2` com a política de distribuição e persiste versões como `corners-negbin-v2+nb2` ou `corners-negbin-v2+poisson`.

Esse desalinhamento impede que a validação de produção seja corretamente vinculada ao artefato executado.

## Política desta entrega

- registrar as versões exatas emitidas pelo runtime;
- preservar versões históricas existentes para rastreabilidade;
- não marcar qualquer versão como `PRODUCTION_VALIDATED`;
- não preencher `calibration_version` antes da fase de calibração;
- gravar métricas OOS somente na versão exata avaliada;
- tratar fallback Poisson como artefato distinto de NB2;
- deixar modelos cross-league para pacote posterior, pois têm composição de features diferente.

## Estado esperado pós-execução

`corners-negbin-v2+nb2` deve possuir um relatório walk-forward real em `out_of_sample_metrics`, porém continuar `NOT_PRODUCTION_VALIDATED` e com `calibration_version = null`.

Somente um resultado `READY_FOR_CALIBRATION` autoriza avançar à próxima fase da Etapa 4. Ele não autoriza o uso na fila de decisão de produção.
