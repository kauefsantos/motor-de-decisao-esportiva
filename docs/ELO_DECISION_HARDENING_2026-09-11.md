# Elo → regras de decisão: validação pós-integração (2026-09-11)

## Escopo

Esta rodada foi aberta depois da integração runtime do Elo hierárquico para verificar se a nova feature exigia alterar o Motor 2, o EV mínimo, o peso do Elo, a banca ou a política de seleção.

## Evidência observada no Lovable Cloud

### Comparação pareada: cross-league com e sem Elo

Nos 9 jogos cross-league já finalizados que possuem `elo_prediction_context` hierárquico, foi possível reconstruir o cenário sem Elo usando os `base_lambda_*` gravados e comparar com os `adjusted_lambda_*` usados pelo modelo.

| Métrica | Baseline sem Elo | Com Elo hierárquico |
| --- | ---: | ---: |
| Brier multiclasses (1X2) | 0,17272 | **0,15435** |
| Log loss (1X2) | 0,88273 | **0,81020** |
| Probabilidade média atribuída ao resultado observado | 0,41901 | **0,45177** |

A amostra é pequena (`n=9`), portanto serve como smoke quantitativo, não como base para retunagem.

### Peso do Elo

Foi executada uma grade somente nesses mesmos 9 jogos, variando o peso de redistribuição de 0,00 a 0,40. O desempenho melhorou monotonicamente nesta amostra até 0,40. Isso **não** autoriza aumentar o peso atual de 0,20: com `n=9`, fazê-lo seria overfitting. O peso `0,20` permanece como escolha conservadora enquanto a amostra cresce.

### Evidência de Elo de liga

No histórico de `elo_league_fixture_history`, o Elo de liga já apresentou sinal útil no bucket de 3–9 jogos prévios: Brier 0,1713 versus 0,1833 de uma previsão neutra de 50%. O desempenho melhora em buckets de evidência maiores. Portanto, o gate atual de mínimo 3 jogos continua defensável e não foi elevado arbitrariamente.

### Calibração da decisão de value

O ledger `experimental_bet_tracking` possui apenas 5 decisões encerradas (3 WIN, 2 LOSS) nesta data. Esse volume é insuficiente para estimar uma correção de calibração ou um haircut numérico confiável para `pCons`.

Por isso **não foi criado desconto percentual arbitrário** na probabilidade e não foi alterado o `EV_TARGET` de 2%.

## Decisões de negócio

Mantidos sem alteração:

- `ELO_GOAL_SHARE_WEIGHT = 0.20`;
- `EV_TARGET = 0.02`;
- limite de seleções por dia (2 em dias úteis, 3 no fim de semana);
- regra de uma seleção automática por partida;
- Kelly fracionado e hard cap de stake;
- Elo fora de escanteios e cartões;
- preservação de `lambdaHome + lambdaAway` no ajuste Elo.

## Hardening implementado

O Motor 2 agora expõe explicitamente a origem da probabilidade usada na decisão:

- `RAW_EXPERIMENTAL`: probabilidade experimental bruta, ainda sem calibração out-of-sample suficiente;
- `CONSERVATIVE_CALIBRATED`: probabilidade conservadora/calibrada quando essa camada existir;
- `OUTCOME_DISTRIBUTION`: contratos asiáticos precificados pela distribuição completa.

Também passa a devolver `decisionProbability`, deixando auditável qual probabilidade realmente entrou em fair odd, edge e EV.

Os nomes legados `edgeCons` e `evCons` foram preservados para compatibilidade com UI/ledger, mas, quando `probabilityBasis = RAW_EXPERIMENTAL`, eles devem ser lidos como edge/EV experimental — não como afirmação de calibração conservadora.

## Próximo gatilho quantitativo

Não retunar o peso do Elo nem criar `pCons` calibrado enquanto não houver amostra walk-forward suficiente por coorte. A validação futura deve separar, no mínimo:

- `SAME_LEAGUE` / Elo local;
- `CROSS_LEAGUE_HIERARCHICAL` / Elo global;
- 1X2;
- dupla chance.

Até lá, o modelo continua explicitamente experimental e a matemática do Motor 2 permanece estável.
