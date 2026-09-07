# Elo v1 — operações

## Bootstrap

A primeira execução de `POST /api/elo-sync` importa até 365 dias de partidas encerradas das ligas cobertas e reconstrói os ratings cronologicamente.

## Atualização diária

A execução deve ocorrer às 05:00 em America/Sao_Paulo. O scheduler chama a rota protegida com o token armazenado em `elo_cron_config`. A rotina reconsulta três dias para absorver correções tardias e faz upsert por fixture antes de reconstruir a liga.

## Auditoria

- `elo_sync_state`: última execução, status, chamadas e erros.
- `elo_fixtures`: ledger de resultados usados.
- `elo_fixture_history`: rating antes/depois de cada partida.
- `elo_team_ratings`: snapshot atual.
- `elo_prediction_context`: Elo e lambdas usados em cada previsão.

## Segurança temporal

Previsões consultam somente `elo_fixture_history.kickoff_at < prediction_at`. Partidas posteriores ao momento da previsão nunca entram no rating usado naquela previsão.
