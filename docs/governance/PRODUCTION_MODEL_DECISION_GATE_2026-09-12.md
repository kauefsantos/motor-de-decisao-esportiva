# Gate de modelo validado para decisão operacional — 2026-09-12

## Objetivo

Separar de forma explícita **pesquisa experimental** de **decisão operacional executável**.

O motor pode continuar gerando previsões experimentais para análise, comparação e evolução metodológica. Entretanto, uma previsão só pode ser persistida em `decision_opportunity_queue` quando existir evidência formal de validação fora da amostra e calibração registrada.

## Regra canônica

Uma oportunidade operacional deve satisfazer simultaneamente:

1. a previsão pertence ao `run` e ao jogo corretos;
2. `data_status = OK`;
3. `model_status = PRODUCTION_VALIDATED` na previsão;
4. existe uma entrada correspondente em `model_versions` para a mesma família e versão;
5. `model_versions.validation_status = PRODUCTION_VALIDATED`;
6. `calibration_version` é não nula e coincide entre previsão e versão registrada;
7. a probabilidade de decisão é a `conservative_probability` quando disponível, ou `p_cal` como fallback; a `model_probability` bruta não é autorizada como probabilidade operacional;
8. probabilidade de decisão >= 70%;
9. odd de entrada >= 1,70;
10. EV >= 8%;
11. edge >= 5 pontos percentuais;
12. linha informada coincide com a linha modelada;
13. odd automática não está expirada;
14. no máximo 3 oportunidades, no máximo 1 principal por jogo e no máximo 2 da mesma família.

Os limites são inclusivos. `70,00%`, `1,70`, `8,00%` e `5,00 p.p.` passam; valores imediatamente inferiores falham.

## Modelos experimentais

`EXPERIMENTAL_CURRENT_SEASON`, `MODEL_NOT_PRODUCTION_VALIDATED`, ausência de `calibration_version`, ausência de `p_cal`/`conservative_probability` ou versão não validada **nunca** autorizam uma aposta executável.

Quando o pipeline atual produzir apenas previsões experimentais, o resultado operacional esperado é **zero apostas**. Isso é um resultado válido e não deve ser convertido em erro nem contornado pelo frontend.

## Promoção de modelo

A promoção para `PRODUCTION_VALIDATED` deve acontecer em mudança própria e auditável. No mínimo, a evidência precisa registrar:

- divisão temporal ou walk-forward sem vazamento futuro;
- tamanho da amostra de treino e teste;
- Brier Score;
- log loss;
- calibração por faixas e erro de calibração;
- comparação contra baseline relevante;
- versão imutável do modelo;
- versão de calibração;
- data de avaliação e janela de dados utilizada;
- mercados/linhas para os quais a validação é válida.

Não é permitido promover um modelo apenas porque ROI, hit rate ou uma amostra curta de apostas foi positiva.

## Defesa em profundidade

O bloqueio é mantido no Lovable Cloud dentro de `replace_decision_queue_atomic`, e não apenas na interface. Assim, uma chamada privilegiada ou frontend desatualizado também não consegue inserir uma previsão experimental na fila operacional.

A fila ainda valida vínculo run/prediction, probabilidade persistida, linha, odds, concentração e freshness.

## Regressão obrigatória

O banco deve provar que:

- uma previsão experimental com probabilidade/odd/EV/edge artificialmente altos gera **0** oportunidades executáveis;
- uma previsão `PRODUCTION_VALIDATED` com calibração coerente pode seguir quando todos os outros gates são atendidos;
- usar uma probabilidade diferente de `conservative_probability`/`p_cal` é bloqueado;
- falsificar a linha continua bloqueado.

## Estado na criação desta regra

Na auditoria de 2026-09-12, os modelos registrados no Lovable Cloud ainda estavam classificados como não validados para produção. Portanto esta mudança não promove nenhum modelo existente e pode reduzir a fila operacional a zero até que a etapa de validação quantitativa seja concluída.
