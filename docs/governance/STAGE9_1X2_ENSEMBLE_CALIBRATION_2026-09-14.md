# Stage 9 — calibração governada do 1X2 uncertainty-linear 40%

Data: 14/09/2026

## Objetivo

Calibrar a distribuição 1X2 do modelo doméstico já congelado:

`goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040`

A Stage 9 não altera a fórmula de direção, o peso 0,40, o Elo +60, o Davidson, as lambdas de gols, os thresholds de decisão ou o holdout final. Ela atua somente depois da probabilidade 1X2 bruta do ensemble.

## Protocolo temporal

- ajuste interno: somente partidas anteriores a 01/04/2026;
- seleção interna: 01/04/2026 até 31/05/2026;
- refit congelado: somente dados anteriores a 01/06/2026;
- shadow retrospectivo: 01/06/2026 até 13/09/2026;
- holdout prospectivo intocado: a partir de 14/09/2026.

A janela retrospectiva nunca seleciona hiperparâmetros. O holdout prospectivo nunca participa de fitting, seleção, tuning ou escolha de família.

## Famílias de calibração avaliadas

A seleção interna compara candidatos pré-declarados:

- temperature scaling com blends parciais;
- isotonic classwise com múltiplas granularidades e blends;
- vector scaling regularizado;
- Dirichlet/joint multiclass regularizado;
- shrinkage suave para as frequências de classe aprendidas somente no período de ajuste.

O candidato precisa preservar Brier e LogLoss na seleção interna e reduzir o max calibration gap para ser considerado elegível. Entre os elegíveis, o gate de 10 p.p. recebe prioridade; depois são usados max gap, LogLoss e Brier como desempate.

## Gate retrospectivo para SHADOW_READY

A Stage 9 só pode persistir `SHADOW_READY` quando todos os itens forem verdadeiros:

- amostra de fit >= 1.000;
- amostra de seleção >= 300;
- shadow retrospectivo >= 300;
- candidato estritamente elegível na seleção temporal;
- Brier calibrado não pior que o uncertainty-linear 40% bruto;
- LogLoss calibrado não pior que o uncertainty-linear 40% bruto;
- max calibration gap <= 0,10;
- cobertura de estabilidade por período e por liga;
- pelo menos metade dos períodos elegíveis preserva simultaneamente Brier e LogLoss;
- pelo menos metade das ligas com n >= 30 preserva simultaneamente Brier e LogLoss;
- ausência de leakage temporal.

O Lovable Cloud valida novamente esses requisitos antes de aceitar `SHADOW_READY`.

## Holdout e promoção

O holdout final começa em 14/09/2026 e requer pelo menos 200 fixtures liquidadas, com previsão anterior ao kickoff e placar final sem conflito.

Para `HOLDOUT_PASSED` são obrigatórios simultaneamente:

- n >= 200;
- Brier calibrado <= Brier bruto do ensemble;
- LogLoss calibrado <= LogLoss bruto do ensemble;
- max calibration gap <= 0,10;
- pelo menos três ligas com n >= 20;
- estabilidade de scoring em pelo menos metade das ligas elegíveis;
- no-leakage.

`HOLDOUT_PASSED` ainda é verificado por uma RPC de promoção separada. Apenas `promote_stage9_1x2_if_holdout_passed()` pode atualizar o registro exato para `PRODUCTION_VALIDATED`, e a função revalida fit, shadow, holdout, amostra, calibração e estabilidade antes do update.

Não existe caminho de promoção por override, relaxamento do limite de 10 p.p., reaproveitamento do retrospectivo como holdout final ou alteração manual do status.

## Runtime

Quando o calibrador está `SHADOW_READY`, novas previsões 1X2 do modelo exato recebem `p_cal` e `calibration_version`, mas continuam experimentais.

Somente depois de o registro exato estar `PRODUCTION_VALIDATED` novas previsões desse modelo recebem também:

- `model_status = PRODUCTION_VALIDATED`;
- `conservative_probability = p_cal`.

Mercados de gols não recebem esta calibração. Modelos legados e confrontos interligas não recebem parâmetros da Stage 9.

## Governança preservada

Permanecem inalterados:

- probabilidade mínima de decisão: 70%;
- odd mínima: 1,70;
- EV mínimo: 8%;
- edge mínimo: 5 p.p.;
- máximo de 3 picks;
- Kelly 0,25;
- teto informacional de stake: 1%;
- zero picks como resultado válido;
- gate canônico de calibração máxima: 10 p.p.;
- stake real bloqueada enquanto a versão exata não estiver `PRODUCTION_VALIDATED`.
