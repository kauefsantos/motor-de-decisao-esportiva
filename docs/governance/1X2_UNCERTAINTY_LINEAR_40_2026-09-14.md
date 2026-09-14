# 1X2 uncertainty-linear 40% — integração governada

Data: 14/09/2026

## Decisão

O fluxo experimental de 1X2 passa a usar, em partidas domésticas da mesma liga com histórico suficiente, o ensemble `uncertainty-linear 40%` identificado na Stage 8.

A fórmula é:

```text
incerteza = 1 - (maior probabilidade BASE - segunda maior probabilidade BASE)
peso_elo = 0,40 * incerteza
P_final = (1 - peso_elo) * P_goals+elo + peso_elo * P_elo_davidson60
```

As três probabilidades HOME/DRAW/AWAY são normalizadas após o blend. O Elo auxiliar é reconstruído point-in-time com mando fixo de +60 e snapshots conservadores por data; o coeficiente de empate Davidson é estimado apenas com partidas anteriores dentro da janela de 365 dias.

## Evidência retrospectiva que motivou a integração

No diagnóstico Stage 8, sobre a janela pareada de 1.017 partidas, `uncertainty-linear 40%` apresentou aproximadamente:

- Brier: 0,62288, melhor que o incumbent 0,62560;
- LogLoss: 1,03621, melhor que o incumbent 1,03957;
- ECE: 3,01%, melhor que o incumbent 3,39%;
- max calibration gap: 20,26%, melhor que 29,92%, mas ainda acima do gate canônico de 10 p.p.

Esse candidato foi identificado como diagnóstico retrospectivo e, portanto, a integração **não equivale a validação de produção nem promoção automática**.

## Escopo de runtime

- `1x2`: usa o ensemble quando o Elo-Davidson point-in-time possui histórico suficiente;
- `double_chance`: é derivado da mesma distribuição 1X2 para preservar coerência matemática;
- `goals_match_total` e demais mercados de gols: continuam usando as lambdas existentes; o ensemble não altera a intensidade de gols;
- sem histórico auxiliar suficiente: mantém-se o 1X2 do modelo de gols e registra-se fallback explícito;
- confrontos interligas/continentais: permanecem no caminho hierárquico atual até existir validação específica do ensemble nesse domínio. A Stage 8 que originou a fórmula avaliou ligas domésticas e não autoriza extrapolação silenciosa.

A versão registrada para predictions que efetivamente usam o ensemble recebe o sufixo `1x2-uncertainty-linear-v1-w040`.

## Governança preservada

Esta mudança não altera:

- `PRODUCTION_VALIDATED=false`;
- gate de calibração máxima de 10 p.p.;
- probabilidade mínima de decisão de 70%;
- odd mínima de 1,70;
- EV mínimo de 8%;
- edge mínimo de 5 p.p.;
- máximo de 3 seleções;
- Kelly 0,25 e teto informacional de stake de 1%;
- bloqueio de stake real enquanto o modelo não estiver validado;
- holdout prospectivo final, que continua sem uso para seleção de feature/fórmula.

## Critério de validação posterior

A integração técnica só poderá ser tratada como modelo validado após evidência governada de que o candidato satisfaz simultaneamente Brier, LogLoss, max calibration gap <= 0,10, tamanho amostral, estabilidade temporal, estabilidade por liga e ausência de leakage.
