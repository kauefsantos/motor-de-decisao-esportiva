# Stake validado e retry de CLV — 2026-09-12

## Regra operacional de stake

Kelly fracionado só pode ser usado quando a previsão que originou a seleção está `PRODUCTION_VALIDATED`, com dados `OK`, `calibration_version` registrada e probabilidade operacional vinculada a `conservative_probability`/`p_cal`.

Sinais experimentais permanecem disponíveis para pesquisa, mas a sugestão automática é `0` (`OBSERVATION_ONLY`). O Lovable Cloud aplica a mesma regra por trigger, impedindo que uma chamada direta abra uma nova aposta experimental com stake positivo.

Para preservar a verdade histórica, uma aposta legada que **já estava OPEN** antes desta regra pode ser encerrada como `SETTLED` desde que seu stake não seja alterado. Isso permite liquidar apostas realmente realizadas sem autorizar novas exposições experimentais.

## CLV

A captura de closing price continua usando Bet365 via FiveDollar. Falhas recuperáveis passam a ter estado explícito:

- `clv_attempts`: 0 a 3;
- `clv_next_retry_at`: próxima tentativa permitida;
- primeira indisponibilidade: retry após 15 minutos;
- segunda: retry após 30 minutos;
- terceira: encerra o orçamento automático;
- `UNSUPPORTED` não é retentado;
- `SOURCE_UNAVAILABLE`, `NO_CLOSING_PRICE` e o estado legado `UNAVAILABLE` podem entrar no retry quando vencidos.

Ao abrir Analytics, no máximo duas capturas vencidas são novamente tentadas por carregamento. Isso evita rajadas sobre o provedor e fornece recuperação eventual sem loop infinito.

## Princípios

- CLV ausente não é convertido em zero.
- ROI/hit-rate não substituem calibração.
- políticas legadas continuam separadas da política atual.
- nenhum retry ultrapassa três tentativas automáticas por registro.
- nenhum modelo experimental é promovido por este pacote.
