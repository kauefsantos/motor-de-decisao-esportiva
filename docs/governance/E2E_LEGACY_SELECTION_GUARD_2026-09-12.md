# E2E — remoção do guard legado de seleções

## Evidência

Na validação pós-publicação do eixo E2E, o Lovable Cloud ainda possuía dois triggers ativos em `experimental_bet_tracking`:

- `trg_experimental_selection_limit`, política canônica atual, com máximo fixo de 3 seleções;
- `experimental_selection_limit_guard`, política legada, com máximo de 2 em dias úteis e 3 nos fins de semana.

A segunda regra poderia bloquear uma terceira seleção válida em dias úteis, divergindo do frontend, do seletor de portfólio e de `replace_decision_queue_atomic`.

## Correção

A migração `20260912210500_drop_legacy_experimental_selection_guard.sql` remove exclusivamente o trigger e a função legados. A proteção canônica `trg_experimental_selection_limit` permanece ativa.

## Regressão obrigatória

`supabase/tests/e2e_market_funnel_legacy_selection_guard.test.sql` exige simultaneamente:

- ausência do trigger legado;
- ausência da função privada legada;
- presença e habilitação do trigger canônico de máximo fixo de 3.

A regra de negócio final continua sendo **zero a três oportunidades**, sem distinção entre dia útil e fim de semana.
