# Elo — arquitetura canônica

> Estado consolidado em 11/09/2026. Este documento substitui a antiga descrição isolada do Elo v1 como referência principal da arquitetura atual.

O Elo é uma **feature auxiliar do modelo de gols**. Ele não recebe odds da casa, não calcula EV e não é um segundo motor de apostas.

## Camadas de rating

O sistema mantém duas escalas complementares:

1. **Elo local do time** — mede a força relativa do clube dentro do contexto doméstico em que foi calculado.
2. **Elo da liga** — mede a força estrutural da competição usando prior hierárquico e evidência real de jogos entre ligas.

Para comparações entre ligas, o rating efetivo do clube é:

```text
Elo global do time = Elo da liga + (Elo local do time - 1500)
```

Assim, dois ratings locais iguais a 1500 em campeonatos diferentes não são tratados automaticamente como forças globais equivalentes.

## Evidência e hierarquia de ligas

Os priors de liga funcionam como âncoras estruturais, não como evidência suficiente para uma aposta continental.

- O Elo hierárquico cross-league só pode ser aplicado quando **as duas ligas possuem pelo menos 3 partidas de evidência interligas**.
- Sem essa evidência, o pipeline falha fechado e mantém o baseline de gols sem Elo cross-league.
- Restrições hierárquicas impedem que divisões inferiores superem artificialmente suas ligas-pai por ruído de amostra.
- Promoção e rebaixamento preservam continuidade por meio do seed ajustado ao prior da nova competição.

## Segurança temporal

Toda previsão deve usar apenas informação disponível antes de `prediction_at`.

### Elo de times

O backend busca o último rating histórico cujo `kickoff_at < prediction_at`.

### Elo de ligas

Para previsões atuais, o snapshot pode ser usado quando ele já existia antes de `prediction_at`.

Para reprocessamentos históricos, o backend reconstrói o rating point-in-time a partir de `elo_league_fixture_history`, usando somente fixtures anteriores ao instante da previsão. Isso evita leakage e permite reproduzir runs antigas mesmo depois que o snapshot atual da liga foi atualizado.

## Aplicação ao modelo de gols

O Elo redistribui a expectativa de gols entre mandante e visitante, mas preserva a soma:

```text
lambdaHome_ajustado + lambdaAway_ajustado
=
lambdaHome_base + lambdaAway_base
```

Regras do ajuste:

- rating armazenado é neutro;
- vantagem de mando entra na atualização histórica do Elo, não é duplicada no ajuste da previsão;
- diferença efetiva é limitada a ±300 pontos;
- peso experimental atual do tilt Elo: `0.20`;
- o peso não foi retunado após a integração hierárquica porque a amostra cross-league comparável ainda é pequena.

## Escopos de previsão

### `SAME_LEAGUE`

Usa o Elo local dos dois times no mesmo contexto de liga e o suffix de modelo `elo-v1-w020`.

### `CROSS_LEAGUE_HIERARCHICAL`

Usa:

- Elo doméstico local de cada clube;
- Elo point-in-time da liga doméstica;
- transformação para Elo global;
- ajuste dos lambdas com o mesmo mecanismo conservador de redistribuição.

O suffix aplicado é `elo-v2-hierarchical`.

O baseline continental de gols continua sendo construído a partir do histórico doméstico dos clubes (`cross-league-domestic-v1`). A normalização de força entre países entra somente depois, na camada Elo hierárquica.

## Impacto por mercado

Como o ajuste preserva `lambdaTotal`:

- **1X2:** é alterado pelo Elo;
- **dupla chance:** é alterada pelo Elo;
- **gols da partida O/U:** a probabilidade não muda por causa do Elo quando depende apenas da soma dos lambdas;
- **escanteios e cartões:** não recebem Elo;
- BTTS/team goals poderiam reagir à divisão dos lambdas, mas não fazem parte do fluxo experimental atual de cotação de gols.

Por rastreabilidade, uma previsão de total de gols pode carregar o mesmo `model_version` do forecast que contém Elo, mesmo quando o Elo não altera numericamente aquele mercado. Isso não deve ser interpretado como atribuição causal do Elo ao Over/Under.

## Integração com o motor de valor

A cadeia canônica é:

```text
dados esportivos
→ baseline de gols
→ ajuste Elo quando elegível
→ model_probability
→ odd real da Bet365
→ Motor 2 / EV
→ seleção de portfólio
```

A odd da casa nunca retroalimenta o Elo nem o modelo esportivo.

No fluxo experimental atual, `model_probability` ainda é uma probabilidade bruta de modelo, não uma probabilidade conservadora calibrada. O Motor 2 expõe essa origem como `RAW_EXPERIMENTAL`. Quando existir uma camada calibrada com evidência suficiente, o contrato já suporta `CONSERVATIVE_CALIBRATED`.

## Validação concluída

A integração hierárquica foi validada em runtime no Lovable Cloud após as correções de P1 e point-in-time:

- `elo_scope = CROSS_LEAGUE_HIERARCHICAL` persistido em `elo_prediction_context`;
- `model_version` de gols contendo `cross-league-domestic-v1+elo-v2-hierarchical`;
- lambdas antes/depois registrados com soma preservada;
- probabilidades de 1X2 e dupla chance alteradas de acordo com o rating global;
- escanteios/cartões permaneceram isolados.

Uma comparação pareada inicial em 9 partidas cross-league reduziu Brier e log loss com o Elo hierárquico, mas a amostra é pequena demais para retunar o peso 0.20. Novos ajustes quantitativos devem exigir evidência out-of-sample maior.

## Tabelas e arquivos principais

Persistência/auditoria:

- `elo_fixtures`
- `elo_fixture_history`
- `elo_team_ratings`
- `elo_league_fixture_history`
- `elo_league_ratings`
- `elo_prediction_context`

Código:

- `src/lib/engine/elo.ts` — matemática base do Elo e ajuste de lambdas;
- `src/lib/elo-feature.server.ts` — resolução same-league/hierárquica e point-in-time;
- `src/lib/engine/cross-league.ts` — baseline doméstico para partidas continentais;
- `src/lib/experimental-markets-run.functions.ts` — integração com as previsões usadas no fluxo experimental.

Operação diária: [ELO_RUNBOOK.md](ELO_RUNBOOK.md).

Histórico de auditoria: [ELO_AUDIT_2026-09-08.md](ELO_AUDIT_2026-09-08.md), [ELO_P1_HIERARCHICAL_INTEGRATION_2026-09-11.md](ELO_P1_HIERARCHICAL_INTEGRATION_2026-09-11.md), [ELO_P2_POINT_IN_TIME_2026-09-11.md](ELO_P2_POINT_IN_TIME_2026-09-11.md) e [ELO_DECISION_HARDENING_2026-09-11.md](ELO_DECISION_HARDENING_2026-09-11.md).
