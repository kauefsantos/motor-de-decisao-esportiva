# Elo v1

O Elo é uma feature auxiliar do modelo de gols existente; não é um segundo motor.

- Fonte: 5DollarFootballAPI, somente partidas encerradas.
- Bootstrap: até 365 dias acessíveis no plano atual.
- Persistência: Supabase (`elo_fixtures`, `elo_fixture_history`, `elo_team_ratings`).
- Atualização: rotina protegida `/api/elo-sync`, agendada para 05:00 America/Sao_Paulo.
- Rating inicial: 1500.
- K: 20.
- Mando: entra apenas na expectativa usada para atualizar o Elo; o rating armazenado é neutro.
- O mando é estimado da própria liga quando há pelo menos 30 partidas anteriores, com fallback conservador de 60 pontos e limite de 120.
- Na previsão, a consulta usa o último rating estritamente anterior a `prediction_at`.
- O Elo redistribui o `lambdaTotal` do modelo de gols entre mandante e visitante; não altera o total esperado de gols.
- Diferença Elo usada no ajuste é limitada a ±300 pontos e recebe peso 0,20 na versão experimental.
- Se não houver Elo pré-jogo para os dois times na mesma liga, o modelo mantém o baseline sem Elo.
- Todo ajuste aplicado fica registrado em `elo_prediction_context`.

Status: experimental / não validado para produção. A ativação não altera o Motor 2, gates de valor ou regras de banca.
