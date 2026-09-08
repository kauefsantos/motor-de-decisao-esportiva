# Value Bet Finder — Estado Canônico

> Atualizado: 2026-09-08
> Repo: `kauefsantos/quant-football-insights`
> Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a` (`Value Bet Finder`)
> Workspace: `IgC7Z3MS5vlDXWjvizgE`
> Preview: `https://id-preview--28664075-8af4-4155-9ee9-8ed86021681a.lovable.app`
> Commit funcional atual: `8ede9e30f43d8c003d96be35890b1af02ae2cde5`

## Regras que não podem ser quebradas

- NUNCA criar/remixar outro projeto Lovable sem pedido explícito.
- Preferir GitHub + Supabase e evitar gastar créditos Lovable desnecessariamente.
- Nunca pedir/expor API keys.
- Motor 1 não usa odds; Motor 2 recebe odds manualmente.
- Nunca usar dados posteriores ao `prediction_at`.
- Não inventar estatísticas/probabilidades nem marcar modelo como produção validada sem validação real.
- Cards/shots/SOT permanecem bloqueados até compatibilidade de definição/settlement ser validada.

## Fluxo

CSV: `Data`, `Partida`, `Horário`, `Campeonato`.

Interface: Enviar jogos → Preparar análise → Conferir mercados → Ver seleções → Apostas abertas → Desempenho.

Timezone: `America/Sao_Paulo`. Bookmaker operacional: bet365 Brasil.

## 5DollarFootballAPI

Plano atual: **Pro US$5/mês**, confirmado em 08/09/2026.

Integração atual:
- limite local conservador de 9 req/min;
- respeita rate headers/429/Retry-After;
- fixtures do dia paginadas (`per_page=100`) e deduplicadas;
- `fixtureId`, home/away team IDs e `leagueId` persistidos;
- ligas domésticas usam histórico bulk por `leagueId`, até 365 dias pré-`prediction_at`;
- competições continentais usam histórico recente por time para recuperar também as ligas domésticas;
- `raw_observations` agora é lido com paginação real, sem `.limit(10000)` truncando a base Pro.

Teste do feed Pro em 09/09/2026 retornou 72 fixtures, incluindo Champions, Championship, Libertadores e Sul-Americana.

## Resolver

Aliases determinísticos adicionados sem baixar o threshold global, incluindo:
- Charlton Athletic ↔ Charlton
- Queens Park Rangers ↔ QPR
- Derby County ↔ Derby
- West Bromwich Albion ↔ West Brom
- Norwich City ↔ Norwich
- Birmingham City ↔ Birmingham
- Atlético-MG ↔ Atletico Mineiro
- Estudiantes ↔ Estudiantes LP
- VfB Stuttgart ↔ Stuttgart

Threshold de aceitação continua conservador (`0.78`).

## Modelo de gols

Versão: `goals-baseline-v2-recency`.

- rolling 365 dias;
- meia-vida 120 dias (`0.5^(ageDays/120)`);
- ataque/defesa por mando + shrinkage;
- Poisson independente → matriz de placares → 1X2/BTTS/totais/team goals;
- `sampleSize` é número real de jogos.

### Jogos continentais / cross-league

Versão auxiliar: `cross-league-domestic-v1`, ainda dentro do MESMO Motor 1.

Para Champions/Libertadores/Sul-Americana etc.:
- identifica a liga doméstica principal de cada clube usando os próprios dados 5Dollar dos últimos 365 dias;
- exige pelo menos 3 partidas domésticas válidas para cada clube;
- estima força ofensiva/defensiva de cada clube relativa à própria liga;
- combina bases das duas ligas de forma conservadora e aplica ajuste suavizado;
- NÃO converte Elo de países diferentes sem normalização validada;
- se não houver histórico doméstico suficiente, bloqueia em vez de inventar.

## Corners

Base: `corners-baseline-v1`, rolling 365 dias.

Em confrontos continentais pode usar `corners-baseline-v1+cross-league-domestic-v1` com a mesma lógica doméstica conservadora. Mercados: total da partida e total por time.

## Elo

Feature auxiliar do modelo de gols, nunca segundo motor.

Versão: `elo-v1-w020`.
- inicial 1500; K=20;
- mando entra na atualização do rating, sem duplicar o mando do modelo de gols;
- ajuste dos lambdas preserva `lambdaTotal`;
- lookup doméstico agora prefere o `leagueId` oficial da 5Dollar, evitando problemas de slug;
- cross-country Elo continua bloqueado sem normalização validada.

Tabelas: `elo_fixtures`, `elo_team_ratings`, `elo_fixture_history`, `elo_sync_state`, `elo_prediction_context`.

Cron Supabase: **03:00 Brasília** (`0 6 * * *`). O nome legado do job pode conter `0500`, mas o schedule é 06:00 UTC. A rotina usa espaçamento de 6.2s e foi ampliada para ligas Pro relevantes: top-5 + segundas divisões, Brasil A/B, Portugal, Holanda, Bélgica, Turquia, Argentina, Equador, Noruega, Eslováquia, MLS e Saudi Pro quando disponíveis.

## Motor 1

Mercados experimentais ativos: corners, gols, team goals, 1X2, double chance, BTTS.

Gate-base:
- binário `p_cal >= 0.65`;
- asiático `p_profit_cal >= 0.65`.

Status continua experimental/`MODEL_NOT_PRODUCTION_VALIDATED` quando aplicável.

## Motor 2

Odds manuais bet365 Brasil. EV mínimo 2%.

Binário: `EV = p_cons * odd - 1`.

Asiático: preservar FW/HW/PUSH/HL/FL; `W_eff=P(FW)+0.5P(HW)`, `L_eff=P(FL)+0.5P(HL)`, `EV=W_eff*(O-1)-L_eff`, `fair=1+L_eff/W_eff`.

Linha mudou → reforecast. Só odd mudou → recalcula valor. Seleção final nunca força apostas; máximo operacional atual: 2 em dias úteis / 3 no fim de semana.

## Banca piloto

Início: 07/09/2026. Banca inicial: **R$10,00**.
- stake mínima Bet365: R$0,50;
- referência proporcional: 5% da banca disponível;
- fractional Kelly 0.25 como controle secundário;
- 0 = recusar aposta.

Aposta oficial #1: Vitória x Grêmio, Over 9,5 escanteios @1,80, stake R$0,50, p registrada 74,6%, fair 1,34, EV +34,28%, originalmente OPEN/PENDING. Nunca recalcular retroativamente essa aposta com modelos novos.

## Analytics e decisão futura

Dashboard acompanha banca, ROI, CLV, calibração, drawdown e desempenho por mercado.

- FUNDO DO POÇO: banca R$0 → revisão completa antes de novas apostas.
- AUGE / elegível para API-Football Pro: pelo menos 100 apostas liquidadas + CLV médio positivo + erro de calibração <= 5 p.p.; ROI é confirmação, não critério isolado.

Revisão automática diária: 03:00 Brasília.

## Última correção validada

PR #14 `Fix 5Dollar Pro continental pipeline` foi mergeado em `8ede9e30f43d8c003d96be35890b1af02ae2cde5`.

CI final em main: E2E experimental + unit tests + build = **SUCCESS**.

Supabase também foi atualizado diretamente para reconhecer novas ligas Elo e manter o rate limit seguro. Validações retornaram true para Championship, Spain Segunda, Netherlands Eerste Divisie, Norway Eliteserien, Slovakia Super Liga e Ecuador LigaPro.

## Próximo passo

**Reprocessar o mesmo CSV de 09/09/2026.** Depois comparar com a run anterior (`c7b23ffb-f156-4fac-a37b-83d6780a40bc`):
- resolução externa (antes 13/17);
- aliases antes ambíguos;
- observações e fixtures únicos;
- previsões de Champions/Libertadores/Championship;
- fallback continental doméstico;
- Elo aplicado/fallback;
- problemas restantes.

Para continuar em outro chat:

> Leia `docs/PROJECT_STATE.md` do repositório `kauefsantos/quant-football-insights`, confira GitHub/Lovable/Supabase e continue a partir do próximo passo. Não crie outro projeto Lovable.
