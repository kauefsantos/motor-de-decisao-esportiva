# Elo P1 — integração hierárquica no fluxo de apostas

Data: 11/09/2026

## Problema

O baseline de gols de partidas cross-league usava histórico doméstico dos clubes, mas o fluxo pulava `eloAdjustGoalForecast`. Com isso, a camada `CROSS_LEAGUE_HIERARCHICAL` existente no backend nunca chegava às probabilidades de 1X2/dupla chance das competições continentais.

## Correção

- o baseline cross-league permanece `crossLeagueGoalForecast`;
- depois do baseline, o mesmo `eloAdjustGoalForecast` passa a ser usado tanto para partidas domésticas quanto cross-league;
- o caminho hierárquico continua fail-closed: sem Elo doméstico pré-jogo dos dois clubes ou sem evidência mínima nas duas ligas, o baseline é mantido sem ajuste Elo;
- quando aplicado, o model version preserva o suffix do baseline cross-league e acrescenta o suffix do Elo hierárquico;
- corners, cards, regras de value, banca e frontend não foram alterados;
- o Elo continua preservando `lambdaHome + lambdaAway`, portanto não altera o total esperado de gols por construção.

## Regressão

Foi adicionado `src/elo-cross-league-integration.test.ts` para impedir que o branch cross-league volte a pular o ajuste Elo compartilhado.
