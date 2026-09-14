# Sincronização da banca e desempenho — 2026-09-14

## Problema observado

As telas **Em andamento** e **Desempenho** apresentavam saldos diferentes.

A causa era estrutural:

- `Em andamento` lia `get_owner_bankroll_metrics`, que calcula a banca canônica considerando todo o histórico financeiro do proprietário;
- `Desempenho` reconstruía a banca a partir apenas das linhas da política de decisão atual;
- existiam 16 registros históricos da política `decision-v1-legacy-pre-strict70`;
- 7 desses registros estavam encerrados com resultado líquido de `-R$ 0,65`;
- por isso a banca canônica era `R$ 9,35`, enquanto o painel da política atual reconstruía `R$ 10,00`.

## Correção arquitetural

Foi criada a Edge Function `bankroll-dashboard` como fonte canônica de leitura para o estado financeiro compartilhado entre acompanhamento e desempenho.

A função:

1. exige JWT válido;
2. resolve o usuário autenticado no servidor;
3. usa o `owner_id` derivado da autenticação, nunca recebido do cliente;
4. consulta `get_owner_bankroll_metrics` e `get_owner_home_metrics` no Lovable Cloud;
5. retorna `equity`, `available`, `locked`, `settledProfit` e configuração da banca;
6. responde com `Cache-Control: no-store`.

As telas `/open-bets` e `/analytics` passam a consumir o mesmo helper `getCanonicalBankrollSnapshot` e o mesmo cache key `canonical-bankroll`.

## Regra de apresentação

- **Em andamento** usa o snapshot canônico para saldo disponível, banca total e valor comprometido.
- **Desempenho** usa o mesmo snapshot para banca atual, banca inicial e resultado financeiro realizado.
- ROI, taxa de acerto, calibração, CLV e agrupamentos continuam calculados sobre o histórico elegível da política analítica, sem alterar as regras estatísticas existentes.

Assim, métricas estatísticas podem continuar respeitando a política de decisão vigente, mas o valor financeiro mostrado ao usuário não é mais reconstruído por caminhos diferentes.

## Reset autorizado do histórico

Por solicitação explícita do proprietário, foi zerado somente o histórico financeiro/de apostas associado ao proprietário atual:

- `experimental_bet_tracking`: 16 → 0 registros;
- `experimental_bankroll_config.start_date`: `2026-09-14`;
- `experimental_bankroll_config.initial_bankroll`: `R$ 10,00`.

Não foram apagados:

- `analysis_runs`;
- partidas;
- previsões;
- modelos;
- Elos;
- jobs;
- logs de análise.

Após o reset, `get_owner_bankroll_metrics` retornou:

- banca inicial: `R$ 10,00`;
- banca atual: `R$ 10,00`;
- saldo disponível: `R$ 10,00`;
- valor comprometido: `R$ 0,00`;
- resultado encerrado: `R$ 0,00`.

## Segurança e fail-closed

Se a Edge Function não conseguir autenticar o usuário ou carregar o snapshot canônico, as telas não devem substituir silenciosamente o valor por uma reconstrução alternativa. O usuário recebe erro de sincronização e pode tentar novamente.

Isso evita que duas fontes divergentes voltem a ser apresentadas como se representassem a mesma banca.
