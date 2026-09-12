# Stake validado e retry de CLV — 2026-09-12

## Regra operacional de stake

Kelly fracionado é uma consequência da probabilidade estimada. Portanto ele só pode ser usado quando a previsão que originou a seleção está `PRODUCTION_VALIDATED`, com dados `OK`, `calibration_version` registrada e probabilidade operacional vinculada a `conservative_probability`/`p_cal`.

Sinais experimentais e registros legados permanecem disponíveis para pesquisa e histórico, mas a sugestão automática de stake é `0` (`OBSERVATION_ONLY`). O Lovable Cloud aplica a mesma regra por trigger: uma chamada direta não consegue transformar um registro experimental em aposta `OPEN`/`SETTLED` com stake positivo.

A banca continua usando os limites configurados de Kelly fracionado e cap operacional somente depois desse gate.

## CLV

A captura de closing price continua usando Bet365 via FiveDollar e não altera resultados históricos quando o preço de fechamento está indisponível.

Falhas recuperáveis passam a ter estado explícito:

- `clv_attempts`: 0 a 3;
- `clv_next_retry_at`: próxima tentativa permitida;
- primeira indisponibilidade: retry após 15 minutos;
- segunda indisponibilidade: retry após 30 minutos;
- terceira: encerra o orçamento automático de retries;
- `UNSUPPORTED` não é retentado.

Ao abrir Analytics, no máximo duas capturas vencidas são novamente tentadas por carregamento. Isso evita rajadas sobre o provedor e torna a recuperação eventual sem loop infinito.

## Princípios

- CLV ausente não é convertido em zero.
- ROI/hit-rate não substituem calibração do modelo.
- dados da política legada continuam separados da política atual.
- nenhum retry pode ultrapassar três tentativas automáticas por registro.
- nenhuma melhoria deste pacote promove modelos experimentais.
