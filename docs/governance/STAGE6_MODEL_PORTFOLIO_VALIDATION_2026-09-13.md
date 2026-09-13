# Stage 6 — Portfólio de Modelos: validação, calibração e Champion–Challenger

Data: 13/09/2026

## Estado deste artefato

Este documento acompanha a mudança versionada da Stage 6 e registra somente o que está implementado na branch/PR. Ele **não** afirma merge, aplicação no Lovable Cloud, publicação ou validação em produção antes dessas etapas ocorrerem e serem comprovadas.

PR em andamento: `#124` — `Stage 6: inventário e validação temporal do portfólio de modelos`.

Migration versionada nesta PR: `supabase/migrations/20260913223000_stage6_model_portfolio_validation.sql`.

A migration deve permanecer somente versionada na branch enquanto a PR não estiver mergeada. Ela só pode ser aplicada ao **Lovable Cloud** depois de todos os gates obrigatórios ficarem verdes, a PR ser squash-mergeada e o novo `main` ser confirmado.

## Objetivo

A Stage 6 mede, de forma temporal e fora da amostra, se o artefato **exato** usado em runtime possui evidência quantitativa suficiente para avançar no lifecycle de validação. A Stage 6 não tem obrigação de aprovar modelo algum.

Nenhum modelo deve ser promovido apenas para manter o sistema operacional ou produzir apostas. Se a evidência for insuficiente ou negativa, o artefato permanece bloqueado.

## Regras de negócio preservadas

A Stage 6 não altera os gates da fila final nem as regras de stake. Permanecem válidos, entre outros:

- probabilidade operacional calibrada/conservadora >= 70%;
- odd de execução >= 1,70;
- EV >= 8%;
- edge >= 5 pontos percentuais;
- dados, linha, prediction, run e match corretos;
- modelo autorizado para produção;
- odd de execução atual/fresca;
- 0–3 apostas finais;
- máximo de 1 aposta principal por partida;
- máximo de 2 apostas da mesma família;
- zero apostas é resultado válido.

Stake positiva continua restrita a artefato `PRODUCTION_VALIDATED`, dados aprovados, `calibration_version` compatível e probabilidade operacional calibrada/conservadora. Artefatos experimentais permanecem `OBSERVATION_ONLY` com stake 0.

## Artefatos GOALS do primeiro pacote

O primeiro pacote da Stage 6 trata separadamente os artefatos domésticos:

### 1X2

- `goals-baseline-v2-recency`
- `goals-baseline-v2-recency+elo-v1-w020`

### BTTS

- `goals-baseline-v2-recency`
- `goals-baseline-v2-recency+elo-v1-w020`

Artefatos cross-league permanecem inventariados separadamente e não podem ter suas métricas misturadas com os modelos domésticos.

## Protocolo temporal

Protocolo: `stage6-goals-walk-forward-v1`.

A validação usa walk-forward temporal com:

- janela de lookback de 365 dias;
- somente partidas anteriores ao fixture avaliado;
- exclusão de partidas do mesmo dia e do futuro;
- deduplicação de fixture com comportamento fail-closed;
- Elo point-in-time, usando ratings anteriores à partida;
- baseline empírico calculado somente com treino passado;
- métricas por artefato, liga e período;
- amostra OOS mínima de 200 observações;
- tolerância máxima de calibration gap de 0,1.

Métricas registradas incluem Brier, LogLoss, ECE, max calibration gap e métricas multiclass quando aplicável.

## Readiness e promoção

`INSUFFICIENT_DATA` significa que o artefato permanece bloqueado.

Para chegar a `READY_FOR_CALIBRATION`, o artefato precisa satisfazer simultaneamente os critérios quantitativos definidos no código, incluindo desempenho superior ao baseline, calibração dentro da tolerância e estabilidade mínima por ligas e períodos.

`READY_FOR_CALIBRATION` **não** significa `PRODUCTION_VALIDATED`.

O relatório desta etapa força `promotion.productionValidated = false`. A migration desta PR também não promove `validation_status` e não cria calibration fictícia.

Se algum artefato chegar a `READY_FOR_CALIBRATION`, uma etapa posterior deve ajustar a calibração em período temporal separado e avaliá-la em outro período posterior. Ajuste e avaliação da calibração nunca podem usar o mesmo conjunto.

## Registry e inventário

A migration registra no inventory/registry as versões reais de GOALS observadas no runtime, preservando registros históricos já existentes. A promoção e a decisão Champion–Challenger devem ser realizadas por artefato exato, nunca apenas por família genérica.

A migration também adiciona RPCs server-only para inventário, paginação do dataset de validação e lifecycle dos jobs de validação. Funções administrativas permanecem restritas a `service_role` onde aplicável.

## Proteções de não-leakage e não-promoção

Os testes da Stage 6 cobrem, entre outros:

- futuro não entra no treino;
- mesmo dia não entra no treino;
- alterar resultado futuro não muda prediction histórica;
- fixture duplicado falha fechado;
- Elo usa snapshot point-in-time;
- alterar Elo futuro não contamina prediction passada;
- cross-league não contamina o artefato doméstico;
- artefatos base e Elo mantêm identidades separadas;
- amostra pequena resulta em `INSUFFICIENT_DATA`;
- `promotion.productionValidated` permanece `false`.

## Estado dos demais eixos do portfólio

- `corners-negbin-v2+nb2`: permanece challenger `NOT_PRODUCTION_VALIDATED`; não reabrir a Stage 4 nem promovê-lo sem evidência temporal materialmente nova.
- `cards-bet365-points-proxy-hybrid-v3`: permanece `BLOCKED_BY_DEFINITION` enquanto a definição/fonte dos dados não for compatível com o settlement Bet365.
- artefatos cross-league de GOALS devem ser avaliados separadamente em etapa própria.

## Ordem obrigatória de rollout

1. concluir todos os gates obrigatórios da PR;
2. resolver review threads pendentes;
3. squash-merge somente com todos os gates verdes;
4. confirmar o novo SHA do `main`;
5. confirmar Lovable sincronizado no mesmo SHA;
6. somente então aplicar `20260913223000_stage6_model_portfolio_validation.sql` no Lovable Cloud;
7. confirmar release e RPCs;
8. publicar;
9. validar produção/HTTP;
10. executar os quatro jobs reais de GOALS domestic via `kick_stage6_goals_validation`;
11. coletar período, sample, Brier, LogLoss, baseline, ECE, max calibration gap, estabilidade por liga/período e readiness por artefato;
12. decidir o lifecycle de cada artefato sem relaxar critérios.

Implementado, testado, mergeado, aplicado ao Lovable Cloud, publicado e validado em produção devem continuar sendo reportados como estados distintos.