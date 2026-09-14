# Stage 7C — calibração multiclasses conjunta do 1X2 + Elo

Data: 2026-09-14

## Objetivo

A Stage 7C mantém congelado o challenger `goals-baseline-v2-recency+elo-v1-w020` e testa calibração conjunta das três probabilidades 1X2. O objetivo é corrigir as relações entre HOME, DRAW e AWAY sem alterar o modelo preditivo, sem reduzir a tolerância de calibração e sem autorizar stake real.

## Métodos candidatos

A seleção interna compara duas famílias regularizadas:

- `vector_scaling`: escala e intercepto por classe sobre log-probabilidades;
- `dirichlet`: matriz multiclasses completa sobre log-probabilidades, regularizada em direção à identidade.

Cada família é testada com diferentes valores de regularização e níveis de `blend` com a probabilidade crua. O `blend` reduz risco de sobreajuste e é selecionado junto com os demais hiperparâmetros.

## Separação temporal

- fitting interno: datas anteriores a 2026-04-01;
- seleção interna: 2026-04-01 até 2026-05-31;
- refit do método escolhido: todas as observações anteriores a 2026-06-01;
- shadow retrospectivo intocado: 2026-06-01 até 2026-09-13;
- holdout prospectivo: previsões persistidas a partir de 2026-09-14 e feitas antes do jogo.

O shadow retrospectivo não participa da escolha de família, regularização ou `blend`.

## Gate para SHADOW_READY

O candidato só pode avançar se, na janela retrospectiva intocada:

1. mantiver vantagem de Brier contra o baseline;
2. mantiver vantagem de LogLoss contra o baseline;
3. não degradar Brier versus a probabilidade crua;
4. não degradar LogLoss versus a probabilidade crua;
5. tiver `maxCalibrationGap <= 0.10`;
6. tiver cobertura mínima de estabilidade por ligas e períodos;
7. houver dados suficientes nas janelas de fitting, seleção e shadow.

Qualquer falha resulta em `CALIBRATION_REJECTED`.

## Holdout prospectivo

Somente um artefato `SHADOW_READY` recebe `p_cal` e `calibration_version` nas previsões futuras. O holdout final exige pelo menos 200 partidas concluídas, cobertura mínima de três ligas, manutenção de Brier/LogLoss e `maxCalibrationGap <= 0.10`.

`HOLDOUT_PASSED` continua diferente de `PRODUCTION_VALIDATED`. A promoção para dinheiro real exige alteração governada separada.

## Segurança operacional

- nenhuma função desta Stage define `PRODUCTION_VALIDATED`;
- `conservative_probability` continua nula durante shadow;
- stake positiva continua bloqueada pelo gate de produção;
- regras canônicas permanecem: probabilidade >=70%, odd >=1.70, EV >=8%, edge >=5 p.p. e máximo 3 seleções;
- zero apostas continua sendo resultado válido.
