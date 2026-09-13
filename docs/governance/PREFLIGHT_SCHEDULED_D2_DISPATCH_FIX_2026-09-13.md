# Preflight — correção do dispatcher agendado D+2 — 2026-09-13

## Evidência de produção

Na auditoria final pré-operação, o Lovable Cloud mostrou quatro falhas consecutivas do job `scheduled-d2-analysis` na janela local de 12:45, 12:50, 12:55 e 13:00 de 2026-09-13.

A falha era determinística:

`there is no unique or exclusion constraint matching the ON CONFLICT specification`

A função `public.kick_scheduled_daily_analysis()` escrevia em `public.automation_runs` com `ON CONFLICT(request_id) DO NOTHING`, porém `request_id` é protegido por um índice único parcial (`WHERE request_id IS NOT NULL`). PostgreSQL não pode inferir esse índice parcial com aquele conflict target.

## Correção

A migration `20260913233000_scheduled_d2_dispatch_conflict_fix.sql` substitui somente o conflict handler do ledger por `ON CONFLICT DO NOTHING`, mesma estratégia já adotada nos dispatchers de análise, manutenção externa e push.

Não foram alterados:

- horário operacional: primeira tentativa às 12:45 em `America/Sao_Paulo`, com recuperação às 12:50, 12:55 e 13:00;
- alvo D+2;
- fonte/identidade FiveDollar;
- escopo de campeonatos autorizado;
- idempotência da criação do run e do job;
- regras quantitativas, modelos, probabilidades, odds, EV, edge, seleção de portfólio ou stake;
- gates de autorização de produção.

## Regressão adicionada

`supabase/tests/automation_dispatch_conflict_fix.test.sql` agora verifica explicitamente que `kick_scheduled_daily_analysis()`:

1. não reintroduz `ON CONFLICT(request_id)`;
2. mantém escrita idempotente com `ON CONFLICT DO NOTHING`.

## Critério de encerramento

A correção só é considerada concluída após:

1. migrations e pgTAP verdes em banco local limpo;
2. CI, Database Security e Static diagnostics verdes;
3. squash merge em `main`;
4. sincronização do mesmo commit no Lovable;
5. aplicação da migration no Lovable Cloud;
6. chamada real de `kick_scheduled_daily_analysis()` sem erro e registro correspondente em `automation_runs`/resposta HTTP;
7. rechecagem de que nenhum modelo ou stake foi promovido por efeito colateral.
