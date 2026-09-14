# Stage 7 — 1X2 + Elo: calibração e holdout prospectivo final

Data de congelamento: 14/09/2026

## Objetivo

A Stage 7 trata exclusivamente o artefato doméstico `1X2 / goals-baseline-v2-recency+elo-v1-w020`, que na Stage 6 superou o baseline em Brier e LogLoss, mas falhou o limite de calibração. A Stage 7 não reduz nenhuma régua e não promove automaticamente nenhum modelo.

## Por que o holdout final começa em 14/09/2026

Os resultados históricos até 12/09/2026 já foram observados durante a Stage 6. Portanto, reutilizá-los como se fossem um holdout final "intocado" criaria viés de seleção. Eles podem ser usados para ajustar e fazer uma checagem retrospectiva do calibrador, mas não como evidência final de produção.

A evidência final passa a ser prospectiva: somente previsões gravadas a partir de 14/09/2026, antes do jogo, com o calibrador já congelado, podem compor o holdout final.

## Artefato congelado

- família: `1X2`
- modelo: `goals-baseline-v2-recency+elo-v1-w020`
- calibrador: temperature scaling multiclasses
- calibration version: `temperature-v1-fit-through-2026-05-31`
- início do holdout prospectivo: `2026-09-14`
- mínimo do holdout prospectivo: 200 partidas completas
- tolerância máxima de calibration gap: 0,10

## Fase A — ajuste retrospectivo

O temperature scaling é ajustado somente nas previsões walk-forward anteriores a 01/06/2026. O parâmetro otimizado é uma única temperatura positiva, minimizando LogLoss multiclasses. Odds nunca entram como feature.

## Fase B — shadow retrospectivo

As previsões de 01/06/2026 até 13/09/2026 são usadas como checagem retrospectiva separada do fitting. Essa faixa já foi indiretamente observada na Stage 6 e, por isso, **não** é considerada holdout final.

Para o calibrador ser marcado `SHADOW_READY`, a checagem exige simultaneamente:

- amostra de fitting >= 1.000 previsões;
- amostra retrospectiva >= 300 previsões;
- Brier calibrado melhor que o baseline retrospectivo;
- LogLoss calibrado melhor que o baseline retrospectivo;
- Brier calibrado não pior que o modelo cru;
- LogLoss calibrado não pior que o modelo cru;
- max calibration gap <= 0,10;
- cobertura mínima de estabilidade por ligas e períodos.

Se qualquer condição falhar, o calibrador fica `REJECTED` e não é aplicado nem em shadow prospectivo.

## Fase C — shadow prospectivo

Se a Fase B passar, o calibrador congelado passa a ser anexado somente às previsões 1X2 do artefato exato. O runtime persiste:

- `model_probability`: probabilidade crua;
- `p_cal`: probabilidade calibrada congelada;
- `calibration_version`: versão exata do calibrador;
- `model_status`: continua experimental;
- `conservative_probability`: continua nula enquanto não houver promoção explícita.

Isso permite avaliar exatamente as probabilidades que foram conhecidas antes do jogo, sem reconstruí-las depois do resultado.

## Fase D — holdout prospectivo final

O holdout usa somente partidas com:

- previsão criada em ou após 14/09/2026;
- previsão criada antes da data do jogo;
- três lados 1X2 completos (`HOME`, `DRAW`, `AWAY`);
- modelo e calibration version exatos;
- fixture canônico sem conflito;
- resultado final disponível.

Com menos de 200 partidas, o único resultado permitido é `PROSPECTIVE_HOLDOUT_PENDING`.

Com >= 200 partidas, o gate exige:

- Brier calibrado <= Brier cru;
- LogLoss calibrado <= LogLoss cru;
- max calibration gap <= 0,10;
- cobertura de pelo menos 3 ligas com >= 20 partidas cada.

Se passar: `HOLDOUT_PASSED`.
Se falhar: `HOLDOUT_FAILED`.

`HOLDOUT_PASSED` **não é** `PRODUCTION_VALIDATED`.

## Promoção continua separada

Nenhuma migration, job ou função da Stage 7 pode escrever `PRODUCTION_VALIDATED`. Mesmo um holdout aprovado ainda exige uma mudança de governança separada que confira artefato, calibration version, relatório, segurança e regressões antes de promover.

Enquanto isso:

- stake real continua bloqueada;
- `model_status` operacional continua experimental;
- zero apostas continua resultado válido;
- permanecem inalterados: p >=70%, odd >=1,70, EV >=8%, edge >=5 p.p., máximo 3, no máximo 1 principal por partida e 2 da mesma família.

## Estados possíveis

`CALIBRATION_REJECTED` → calibrador não segue adiante.

`SHADOW_READY` → ajuste/checagem retrospectiva aprovados; começa coleta prospectiva.

`PROSPECTIVE_HOLDOUT_PENDING` → coleta prospectiva ainda abaixo de 200 partidas.

`HOLDOUT_FAILED` → evidência prospectiva reprovou; nenhuma promoção.

`HOLDOUT_PASSED` → evidência prospectiva aprovou; ainda requer promoção governada explícita.
