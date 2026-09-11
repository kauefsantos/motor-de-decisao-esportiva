# Elo P2 — point-in-time de ligas

Data: 2026-09-11

## Problema observado

O P1 conectou o Elo hierárquico ao fluxo cross-league, mas uma run histórica continuava sem aplicar o ajuste. A causa era temporal: `elo_league_ratings` mantém somente o snapshot atual. Quando `prediction_at` era anterior a `updated_at`, o backend falhava fechado mesmo existindo histórico interligas suficiente antes da previsão.

Caso que expôs o problema: Napoli x Arsenal, run de 2026-09-09. O ledger possuía evidência prévia para Serie A e Premier League, porém não havia snapshot materializado com `updated_at < prediction_at`.

## Correção

`elo-feature.server.ts` agora usa duas camadas:

1. Para previsões presentes/futuras, tenta primeiro o snapshot materializado em `elo_league_ratings`, desde que ele seja anterior ao `prediction_at`.
2. Para reprocessamentos históricos, reconstrói o rating da liga a partir de `elo_league_fixture_history`, usando somente fixtures com `kickoff_at < prediction_at`.

A reconstrução respeita a mesma ordenação determinística do rebuild (`kickoff_at`, `competition_id`, `fixture_id`), recalcula a quantidade de evidências no instante da previsão e reaplica as restrições estruturais de hierarquia:

- divisão inferior <= rating da liga-pai - 70;
- ligas `CORE` de nível 2+ <= menor rating do Big Five - 25.

O gate de segurança permanece inalterado: uma liga só entra no Elo hierárquico quando possui pelo menos 3 partidas interligas anteriores ao `prediction_at`.

## Escopo

A mudança afeta somente a obtenção point-in-time do Elo de liga no ajuste hierárquico de gols. Não altera:

- Elo doméstico dos clubes;
- fórmula de redistribuição de lambdas;
- total esperado de gols;
- corners/cards;
- EV, banca ou seleção de portfólio;
- RLS, autenticação ou schema do banco.

Não há migration nesta correção.
