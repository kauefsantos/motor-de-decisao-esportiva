# Value Bet Finder — Estado Canônico do Projeto

> Última consolidação: 2026-09-08
> Repositório: `kauefsantos/quant-football-insights`
> Projeto Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a`
> Display name: `Value Bet Finder`
> Workspace Lovable: `IgC7Z3MS5vlDXWjvizgE`
> Preview: `https://id-preview--28664075-8af4-4155-9ee9-8ed86021681a.lovable.app`
> Commit funcional imediatamente anterior a este documento: `1eda5b838e37312353d7bc85f6f82fda612a1887`

## Regra operacional principal

- NUNCA criar, remixar ou iniciar outro projeto Lovable sem pedido explícito.
- Continuar somente no projeto canônico acima.
- Preferir edições via GitHub e leitura/SQL direto no projeto para poupar créditos Lovable.
- Não expor ou pedir API keys no chat.

## Objetivo do produto

Aplicação quantitativa pré-jogo de futebol com dois motores separados:

1. **Motor 1 — Opportunity Engine**
   - não usa odds da casa como feature;
   - estima probabilidades e publica mercados apenas quando há suporte de dados/modelo;
   - trabalha com `prediction_at` estrito para impedir leakage.

2. **Motor 2 — Odds / Value Engine**
   - recebe apenas a odd informada manualmente pelo usuário;
   - calcula implied probability, edge, EV e seleção final;
   - nunca força quantidade de apostas.

## Fluxo atual da interface

1. Enviar jogos
2. Preparar análise
3. Conferir mercados
4. Ver seleções
5. Apostas abertas
6. Desempenho

CSV oficial:
- `Data`
- `Partida`
- `Horário`
- `Campeonato`

Timezone operacional: `America/Sao_Paulo`.

## Provedor atual

### 5DollarFootballAPI Pro — US$5/mês

Upgrade confirmado em 2026-09-08.

O sistema continua usando a mesma integração 5Dollar nativa, mas foi adaptado ao Pro:

- limite local conservador: **9 chamadas/minuto**;
- antigo teto local de 300/h removido;
- respeita `X-RateLimit-*`, `Retry-After` e HTTP 429;
- fixtures do dia paginadas com `per_page=100`;
- dedupe por fixture ID;
- `leagueId` persistido como `five_dollar_league`;
- histórico preferencial por liga em bulk, até 365 dias pré-`prediction_at`;
- fallback por time somente quando necessário.

Teste real após upgrade para 09/09/2026 retornou **72 fixtures** no feed do dia e passou a incluir jogos que antes estavam fora do Community, como Champions League, Championship, Libertadores e Sul-Americana.

Exemplos confirmados no feed Pro:
- Barcelona x Feyenoord
- Liverpool x Atlético de Madrid
- Napoli x Arsenal
- PSG x Slovan Bratislava
- Sporting x Galatasaray
- Stuttgart x Viking FK
- Derby x West Brom
- Norwich x Birmingham
- Palmeiras x LDU Quito
- Estudiantes x Corinthians
- Santos x Atlético-MG

## Modelo de gols

Versão atual: **`goals-baseline-v2-recency`**.

Características:
- janela móvel de até **365 dias**;
- apenas jogos estritamente anteriores ao `prediction_at`;
- mesma liga para o baseline doméstico;
- meia-vida de recência: **120 dias**;
- peso: `0.5^(ageDays/120)`;
- mantém shrinkage;
- `sampleSize` continua sendo contagem real de partidas, não soma de pesos;
- saída em `lambdaHome`, `lambdaAway`, `lambdaTotal`;
- Poisson independente gera matriz de placares;
- dela derivam 1X2, BTTS e totais de gols.

Não marcar como produção validada apenas porque roda. Status permanece experimental até evidência suficiente.

## Modelo de corners

Versão base: `corners-baseline-v1`.

O pipeline experimental agora usa janela móvel de até **365 dias**, em vez de limitar somente à temporada corrente.

Mercados atualmente habilitados:
- total de escanteios da partida;
- total de escanteios por time.

Cards / shots / shots on target continuam bloqueados para seleção até compatibilidade de definição e settlement ser validada.

## Elo

Elo é **feature auxiliar do mesmo modelo de gols**, não um segundo motor.

Versão: `elo-v1-w020`.

Parâmetros principais:
- rating inicial: 1500;
- K = 20;
- mando usado na atualização do Elo, mas não duplicado no ajuste de gols;
- rating armazenado é neutro;
- ajuste Elo redistribui `lambdaHome`/`lambdaAway` preservando `lambdaTotal`;
- se Elo não estiver disponível ou não for comparável, o modelo segue sem Elo.

Tabelas Supabase:
- `elo_fixtures`
- `elo_team_ratings`
- `elo_fixture_history`
- `elo_sync_state`
- `elo_prediction_context`

A rotina diária do Elo está agendada às **03:00 de Brasília** (`0 6 * * *` em UTC). O nome histórico do job no banco pode ainda mencionar `0500`, mas o schedule efetivo é 06:00 UTC = 03:00 BRT.

Cobertura Elo doméstica foi ampliada para aproveitar o Pro, incluindo primeiras e segundas divisões relevantes. Para partidas continentais/cross-league, não assumir que Elo 1500 de países diferentes é diretamente comparável; usar fallback sem Elo quando a comparação não for segura.

## Regras de Motor 1

- nenhuma odd de bookmaker como feature;
- probabilidades determinísticas no backend;
- `prediction_at` sempre respeitado;
- binários: gate-base `p_cal >= 0.65`;
- asiáticos: `p_profit_cal >= 0.65`;
- não inventar probabilidades nem preencher dado essencial faltante silenciosamente;
- se dados/modelo não bastarem: bloquear honestamente.

Mercados experimentais ativos:
- corners
- gols
- team goals
- 1X2
- double chance
- BTTS

## Regras de Motor 2

Bookmaker operacional: **bet365 Brasil**.

Binário:
- `implied_probability = 1 / odd`
- `EV = p_cons * odd - 1`
- valor somente se `EV >= 2%`

Asiático:
- preservar FULL_WIN / HALF_WIN / PUSH / HALF_LOSS / FULL_LOSS;
- `W_eff = P(FW) + 0.5*P(HW)`
- `L_eff = P(FL) + 0.5*P(HL)`
- `EV = W_eff*(O-1) - L_eff`
- `fair = 1 + L_eff/W_eff`
- `O_min = 1 + (target + L_eff)/W_eff`

Linha alterada exige reforecast. Mudança apenas na odd recalcula valor sem refazer forecast.

Seleção final: no máximo 3; nunca forçar aposta.

## Banca operacional do piloto

Piloto oficial iniciado em 07/09/2026.

- banca inicial: **R$10,00**;
- stake mínima operacional Bet365: **R$0,50**;
- referência proporcional: **5% da banca disponível**;
- fractional Kelly: **0,25** como controle secundário;
- se sugestão positiva ficar abaixo de R$0,50 e a aposta for selecionada, piso operacional = R$0,50;
- `0` significa não apostar;
- próxima aposta recalcula usando banca disponível após stake travada.

## Primeira aposta oficial

Aposta #1 registrada:
- Vitória x Grêmio
- Mais de 9,5 escanteios
- Bet365 @ 1,80
- stake R$0,50
- probabilidade do modelo registrada: 74,6%
- fair odd: 1,34
- odd mínima alvo: 1,37
- EV registrado: +34,28%
- status: OPEN / PENDING na última consolidação

Não reinterpretar retroativamente essa aposta com versões novas do modelo.

## Analytics

Tabelas:
- `experimental_bet_tracking`
- `experimental_bankroll_config`

Dashboard acompanha:
- banca inicial / atual / disponível;
- stake aberta;
- lucro/prejuízo;
- ROI;
- wins/losses/hit rate;
- probabilidade média prevista;
- closing odd / CLV quando preenchido;
- drawdown máximo;
- curva de banca;
- desempenho por família de mercado;
- calibração por buckets;
- histórico detalhado.

## Critério para comprar API-Football Pro futuramente

Não comprar para salvar modelo sem evidência.

Status **AUGE — ELEGÍVEL PARA COMPRAR API-FOOTBALL PRO** quando houver, como primeiro checkpoint:
- pelo menos **100 apostas liquidadas**;
- **CLV médio positivo**;
- erro de calibração **<= 5 pontos percentuais**;
- ROI usado como confirmação, não como requisito isolado.

Status **FUNDO DO POÇO** se a banca chegar a **R$0,00**; nesse caso revisar completamente antes de novas apostas.

## Revisão automática diária

Há uma automação de revisão diária às **03:00 de Brasília** para classificar o projeto como:
- AVANÇANDO
- NEUTRO
- REGREDINDO
- FUNDO DO POÇO
- AUGE — ELEGÍVEL PARA COMPRAR API-FOOTBALL PRO

A revisão deve olhar banca, apostas liquidadas, ROI, CLV, calibração, drawdown, mercados e saúde técnica/CI.

## Situação técnica mais recente

- Lovable está sincronizado ao repositório GitHub.
- Projeto está privado e não publicado.
- Supabase ativo.
- CI/build passaram nas mudanças do upgrade Pro.
- Pipeline foi adaptado para coleta Pro, janela rolling e Elo.
- O CSV de 09/09 **ainda deve ser reprocessado como teste de aceitação final após o upgrade Pro**.

## Próximo passo recomendado

1. Rodar novamente o CSV de 09/09/2026 no Value Bet Finder.
2. Comparar Community vs Pro:
   - partidas resolvidas externamente;
   - páginas de fixtures do dia;
   - league IDs persistidos;
   - histórico coletado por liga;
   - volume de fixtures históricos únicos;
   - mercados produzidos;
   - Elo aplicado vs fallback;
   - bloqueios remanescentes e motivos.
3. Corrigir somente problemas reproduzidos nesse teste, sem abrir novas features antes de estabilizar o pipeline.

## Como continuar em um chat novo

Mensagem sugerida:

> Leia `docs/PROJECT_STATE.md` do repositório `kauefsantos/quant-football-insights`, confira o estado atual do GitHub/Lovable/Supabase e continue a partir do próximo passo. Não crie outro projeto Lovable.

Este arquivo deve ser atualizado após mudanças arquiteturais importantes para continuar sendo a referência canônica do projeto.
