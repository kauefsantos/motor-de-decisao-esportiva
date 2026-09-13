# Análise automática D+2 — 2026-09-12

## Objetivo

Automatizar a preparação diária das análises sem depender do CSV como entrada principal. O modo manual continua disponível como contingência.

## Regra operacional

- Primeira tentativa diária: **12:45 em `America/Sao_Paulo`**.
- Data analisada: **D+2** no calendário de São Paulo.
- Exemplo: execução em 13/09 prepara os jogos de 15/09.
- O agendamento usa a zona IANA `America/Sao_Paulo`; não depende de UTC-3 fixo.
- Há tentativas curtas de recuperação em 12:50, 12:55 e 13:00. Elas são idempotentes e não criam uma segunda análise para a mesma data.

## Descoberta das partidas

A fonte automática é a 5DollarFootballAPI, já usada pelo pipeline. O calendário é consultado por janela de data D+2 e a aplicação mantém apenas partidas:

1. ainda não iniciadas;
2. pertencentes a uma competição ativa em `elo_target_leagues` ou `elo_cross_competitions`;
3. com `fixture_id`, `home_team_id`, `away_team_id`, `league_id` e horário oficial completos.

O caminho automático não usa o nome dos clubes como identidade. Os nomes são apenas rótulos de apresentação. As chaves persistidas em `match_external_ids` são:

- `five_dollar_fixture`;
- `five_dollar_team_home`;
- `five_dollar_team_away`;
- `five_dollar_league`.

Todos entram com confiança 1.0 porque vêm diretamente do calendário da fonte. Com isso, o passo `RESOLVE` fica concluído na criação do run e o worker começa em `COLLECT`.

## Idempotência e recuperação

A análise automática usa uma chave determinística por `owner + target_date`, além de advisory lock e do índice único já existente em `analysis_runs`. Uma nova chamada para a mesma data:

- reutiliza o run existente;
- não duplica partidas;
- não duplica o job;
- retoma job em erro usando o mecanismo existente de retry/lease;
- reutiliza `kick_analysis_worker()` para continuar a cadeia normal.

O `analysis-worker-watch` continua responsável por recuperar jobs enfileirados ou leases expirados.

## Término e notificação

O pipeline permanece inalterado nas regras de negócio:

`COLLECT → CLEAN → FEATURES → PROBABILITY → GATES → MARKETS`

Ao terminar `MARKETS`, o run chega a `READY_FOR_ODDS`. O worker existente então enfileira o evento `ANALYSIS_READY` no outbox de Web Push e aciona o dispatcher.

A notificação não tem horário fixo: ela é emitida quando o processamento realmente termina.

Como o Web Push atual não carrega payload criptografado com `runId`, um alvo manual salvo pelo navegador expira em quatro horas. Assim, uma notificação automática posterior abre a Home em vez de direcionar para um run antigo; a Home apresenta a retomada da análise mais recente.

## Odds e decisão

A automação D+2 **não transforma a odd coletada às 12:45 em preço definitivo de aposta**. O objetivo do processamento antecipado é preparar dados, features, modelos e mercados.

Ao entrar para decidir, continuam valendo as regras atuais de preço e frescor, inclusive expiração de odds automáticas em 10 minutos e os gates finais:

- probabilidade >= 70%;
- odd >= 1.70;
- EV >= 8%;
- edge >= 5 p.p.;
- dados aprovados;
- linha compatível;
- prediction/run/match coerentes;
- modelo `PRODUCTION_VALIDATED`.

Zero oportunidades continua sendo um resultado válido.

## Sem partidas elegíveis

Se não houver jogos D+2 dentro do escopo ativo, nenhum run vazio é fabricado. A execução termina como no-op (`NO_ELIGIBLE_FIXTURES`).

## Fora do escopo desta mudança

Esta automação não:

- promove modelos para `PRODUCTION_VALIDATED`;
- altera limiares de decisão;
- muda o limite de 0–3 escolhas;
- altera Elo;
- remove o fluxo manual/CSV;
- relaxa limites, retries ou proteções contra duplicidade.
