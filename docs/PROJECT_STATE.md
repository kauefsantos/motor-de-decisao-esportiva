# Value Bet Finder — Estado Canônico

> Atualizado: 2026-09-08 20:55 BRT
> Repo: `kauefsantos/quant-football-insights`
> Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a` (`Value Bet Finder`)
> Workspace: `IgC7Z3MS5vlDXWjvizgE`
> Preview: `https://id-preview--28664075-8af4-4155-9ee9-8ed86021681a.lovable.app`
> Baseline funcional após a reconciliação: `6a304b67ba6bb2b7bd3616ebcfca4ddfe7640a9a` (merge PR #22)
> PR #23 foi somente documental; antes de qualquer nova alteração, confirme novamente o HEAD real de `main` e o `latest_commit_sha` do Lovable.
> Baseline auditado antes da reconciliação: `f59e26276986737448ae02e66a19b24a87eab77b` (merge PR #21)

## Regras que não podem ser quebradas

- NUNCA criar/remixar outro projeto Lovable sem pedido explícito.
- Preferir GitHub + Supabase e evitar gastar créditos Lovable desnecessariamente.
- Nunca pedir/expor API keys.
- Motor 1 não usa odds como feature; odds entram somente depois das probabilidades.
- Nunca usar dados posteriores ao `prediction_at`.
- Não inventar estatísticas/probabilidades nem marcar modelo como produção validada sem validação real.
- Cards/shots/SOT permanecem bloqueados até compatibilidade de definição/settlement ser validada.
- Migrações já materializadas no banco não devem ser reaplicadas cegamente apenas para corrigir histórico de `schema_migrations`.

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
- `raw_observations` é lido com paginação real, sem `.limit(10000)` truncando a base Pro.

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

Versão de base: `cross-league-domestic-v1`, ainda dentro do MESMO Motor 1.

Para Champions/Libertadores/Sul-Americana etc.:
- identifica a liga doméstica principal de cada clube usando os próprios dados 5Dollar dos últimos 365 dias;
- exige pelo menos 3 partidas domésticas válidas para cada clube;
- estima força ofensiva/defensiva de cada clube relativa à própria liga;
- combina bases das duas ligas de forma conservadora;
- o Elo cross-league só é acrescentado quando houver evidência interligas medida suficiente e temporalmente válida;
- se o Elo hierárquico não estiver elegível, o modelo faz fallback sem esse ajuste em vez de transformar prior em evidência.

## Corners

Base: `corners-baseline-v1`, rolling 365 dias.

Em confrontos continentais pode usar `corners-baseline-v1+cross-league-domestic-v1` com a mesma lógica doméstica conservadora. Mercados: total da partida e total por time.

## Elo hierárquico — estado real validado

Elo continua sendo **feature auxiliar do modelo de gols**, nunca um segundo motor.

Versões:
- time local: `elo-v1-w020`;
- liga: `league-elo-v1`;
- composição cross-league: `hierarchical-elo-v1`.

### Elo de times

- inicial 1500; K=20;
- cada time é avaliado na escala local de sua liga;
- mando entra na atualização do rating, sem duplicar o mando do modelo de gols;
- ajuste dos lambdas preserva `lambdaTotal`;
- lookup doméstico prefere o `leagueId` oficial da 5Dollar;
- leitura para previsão é estritamente anterior ao `prediction_at`.

### Elo de ligas / cross-league

PR #20 adicionou a camada hierárquica e PR #21 adicionou o gate de evidência medida.

- `global_team_elo = league_elo + (team_local_elo - 1500)`;
- league Elo parte de priors estruturais, mas o prior sozinho **não** pode alterar uma previsão;
- para aplicar `CROSS_LEAGUE_HIERARCHICAL`, cada liga precisa de pelo menos **3 partidas interligas reais** em `evidence_matches`;
- o snapshot de liga também precisa existir antes do `prediction_at`;
- sem essas condições, o forecast segue sem Elo hierárquico;
- atualização interligas usa K efetivo 6 e mantém o league Elo limitado a ±60 do prior;
- divisão inferior com pai configurado fica no máximo 70 pontos abaixo da divisão superior;
- divisões inferiores `CORE` também ficam abaixo do piso atual das Big 5 em pelo menos 25 pontos.

Estado do banco validado em 08/09/2026 após o rollout:
- 32 ligas-alvo ativas;
- 737 ratings de times (`elo-v1-w020`);
- 32 ratings de liga (`league-elo-v1`);
- 9 competições cross-league ativas;
- 1.275 fixtures continentais/interligas armazenadas;
- 480 fixtures realmente aproveitadas para atualizar league Elo;
- 20/32 ligas já possuem `evidence_matches >= 3`;
- auditoria: 32/32 ligas `OK`, 0 violações hierárquicas, 0 erros de sync;
- piso das Big 5 ≈ 1559,32 e maior rating de segunda divisão = 1505;
- drift médio local máximo ≈ 12,63, dentro da tolerância auditada de 25.

Tabelas principais: `elo_fixtures`, `elo_team_ratings`, `elo_fixture_history`, `elo_target_leagues`, `elo_cross_competitions`, `elo_cross_fixtures`, `elo_league_ratings`, `elo_league_fixture_history`, `elo_audit_runs`, `elo_sync_state`, `elo_prediction_context`.

### Lacuna de validação ainda aberta

Os 18 registros existentes em `elo_prediction_context` ainda são do modelo antigo (`elo-v1-w020`) e não têm `elo_scope` preenchido. Portanto, a implementação hierárquica está no código e o ledger de ligas está auditado, mas ainda falta registrar uma **nova previsão continental pós-rollout** que demonstre no banco:
- `CROSS_LEAGUE_HIERARCHICAL` quando as duas ligas passam o gate de evidência;
- fallback sem Elo quando uma das ligas não passa o gate.

Não considerar essa validação E2E concluída até existir esse registro.

## Jobs diários do Elo — estado real validado

O cron monolítico antigo foi substituído pela fila incremental.

Jobs ativos no Supabase:
- `elo-daily-incremental`: `*/2 6-7 * * *` UTC = a cada 2 minutos entre **03:00 e 04:58 BRT**; processa um alvo por invocação;
- `elo-daily-finalize`: `5 8 * * *` UTC = **05:05 BRT**; reconstrói league Elo, roda auditoria e consolida `elo_sync_state`.

Job legado `elo-bootstrap-now` está inativo.

Estado consolidado após o rollout:
- `elo_sync_state.model_version = hierarchical-elo-v1`;
- `last_status = OK`;
- 32 ligas processadas;
- 11.356 fixtures domésticas no ledger;
- `pendingTargets = 0`;
- último finalize/audit manual do rollout terminou OK.

**Importante:** os novos job IDs 8/9 ainda não possuem execução normal registrada em `cron.job_run_details`. A primeira janela agendada real após o rollout precisa ser conferida depois de 05:05 BRT. O estado atual prova que as funções e a fila foram executadas no rollout, mas ainda não prova o primeiro ciclo automático completo desses novos jobs.

## Divergência de histórico de migrações

O schema live contém as tabelas/funções do Elo hierárquico e está operacional, porém `supabase_migrations.schema_migrations` ainda lista somente:
- `20260906172209`
- `20260906181530`
- `20260906195556`

Ou seja: o banco materializado avançou além do histórico oficial de migrações; as migrations do repositório a partir de 07/09 não estão refletidas nessa tabela de histórico.

Além disso, o audit live já usa `local_mean_drift` com tolerância 25 e resumo expandido, enquanto o arquivo original `20260908230000_hierarchical_league_elo.sql` carregava a versão inicial do audit.

Reconciliação concluída no código via PR #22:
- nova migration aditiva/idempotente `20260908235000_reconcile_hierarchical_elo_audit.sql` espelha no repositório a definição de audit que já está saudável no banco;
- CI da PR #22 passou em **Experimental engine E2E + unit tests + build**;
- PR #22 mergeada em `6a304b67ba6bb2b7bd3616ebcfca4ddfe7640a9a`;
- Lovable canônico sincronizou automaticamente após os merges do `main`;
- o banco não precisou receber DDL corretivo, pois já possuía a definição reconciliada;
- `schema_migrations` continua divergente e não deve ser “consertado” manualmente nem por replay cego das migrations antigas.

## Motor 1

Mercados experimentais ativos: corners, gols, team goals, 1X2, double chance, BTTS.

Gate-base:
- binário `p_cal >= 0.65`;
- asiático `p_profit_cal >= 0.65`.

Status continua experimental/`MODEL_NOT_PRODUCTION_VALIDATED` quando aplicável.

## Motor 2

EV mínimo 2%.

Binário: `EV = p_cons * odd - 1`.

Asiático: preservar FW/HW/PUSH/HL/FL; `W_eff=P(FW)+0.5P(HW)`, `L_eff=P(FL)+0.5P(HL)`, `EV=W_eff*(O-1)-L_eff`, `fair=1+L_eff/W_eff`.

Linha mudou → reforecast. Só odd mudou → recalcula valor. Seleção final nunca força apostas; máximo operacional atual: 2 em dias úteis / 3 no fim de semana.

### Coleta automática de odds Bet365

Implementada pelos PRs #15 e #16.

Fluxo preserva separação dos motores:
1. Motor 1 calcula probabilidades sem preço.
2. Aplica gate.
3. Só depois a 5Dollar Pro consulta Bet365.
4. Motor 2 calcula EV/edge e seleção.

Automático quando há contrato seguro:
- 1X2;
- BTTS;
- total de gols da partida quando a linha Bet365 coincide com a linha modelada;
- total de escanteios da partida quando a linha coincide.

Não sintetizar preço quando a API não entrega diretamente:
- double chance;
- gols por time;
- escanteios por time.

O preflight usa `/fixtures?include=odds` para aproveitar 1X2 e linhas principais antes de gastar chamadas individuais; `/fixtures/{id}/odds` é usado somente quando necessário.

Validação na run de 09/09/2026:
- 131 oportunidades passaram pelo gate;
- 2 receberam odd automática (`BTTS Sim` em Stuttgart x Viking FK e Sporting x Galatasaray, ambas 1.571 naquele snapshot);
- 41 ficaram `LINE_MISMATCH` porque a linha principal atual da Bet365 diferia da linha modelada;
- 88 eram contratos não expostos diretamente pela API;
- 0 erros de fonte;
- somente 2 chamadas individuais de odds foram necessárias.

Possível evolução posterior: reforecast automático da distribuição para a linha principal oferecida pela Bet365 em gols/escanteios, sem usar o preço como feature.

## Seleções qualificadas fora do corte automático

PRs #17, #18 e #19 consolidaram o fluxo de alternativas qualificadas.

Na tela de resultado experimental, “Outras odds avaliadas” é dividida em:
- **Qualificadas fora da seleção final**: passaram probabilidade + valor + execução, mas ficaram fora por limite/ranking. Aparecem com odd, EV e botão **Selecionar**.
- **Sem margem ou não executáveis**: ficam em lista recolhível com motivo.

Ao clicar em **Selecionar**:
- backend revalida a mesma odd no Motor 2;
- revalida gate, linha, EV e execução;
- confere vagas da rodada contando apenas `PROPOSED` + `OPEN`;
- uma sugestão `DECLINED` libera vaga;
- se houver vaga, cria nova `PROPOSED` no `experimental_bet_tracking` e ela entra no fluxo normal de confirmação/stake;
- não permite ultrapassar o limite diário nem bypassar banca/regras.

## Banca piloto

Início: 07/09/2026. Banca inicial: **R$10,00**.
- stake mínima Bet365: R$0,50;
- referência proporcional: 5% da banca disponível;
- fractional Kelly 0.25 como controle secundário;
- 0 = recusar aposta.

Aposta oficial #1: Vitória x Grêmio, Over 9,5 escanteios @1,80, stake R$0,50, p registrada 74,6%, fair 1,34, EV +34,28%. Nunca recalcular retroativamente essa aposta com modelos novos.

## Analytics e decisão futura

Dashboard acompanha banca, ROI, CLV, calibração, drawdown e desempenho por mercado.

- FUNDO DO POÇO: banca R$0 → revisão completa antes de novas apostas.
- AUGE / elegível para API-Football Pro: pelo menos 100 apostas liquidadas + CLV médio positivo + erro de calibração <= 5 p.p.; ROI é confirmação, não critério isolado.

A revisão Elo diária agora termina às 05:05 BRT depois da fila incremental iniciada às 03:00.

## Últimas validações

CSV 09/09 após correções Pro:
- 17/17 jogos resolvidos pela 5Dollar;
- 7.782 observações brutas;
- 510 previsões experimentais;
- 17/17 jogos com previsões;
- 131 previsões acima do gate.

Estado técnico validado em 08/09/2026:
- baseline funcional pós-reconciliação = `6a304b67ba6bb2b7bd3616ebcfca4ddfe7640a9a`;
- PR #23 foi somente atualização documental posterior;
- Lovable canônico acompanhou os merges de `main`;
- PR #20 (Elo hierárquico), PR #21 (evidence gate) e PR #22 (reconciliação do audit) mergeadas;
- banco hierárquico preenchido e auditoria `OK`;
- jobs incrementais ativos;
- migration history ainda divergente do schema materializado;
- falta uma nova previsão continental pós-rollout e o primeiro ciclo cron automático completo dos jobs 8/9.

## Próximo passo obrigatório

1. Rodar uma nova análise continental pós-rollout e conferir `elo_prediction_context`:
   - aplicar `CROSS_LEAGUE_HIERARCHICAL` somente com evidência >= 3 em ambas as ligas e snapshot pré-`prediction_at`;
   - confirmar fallback sem Elo nos casos sem evidência suficiente.
2. Depois da primeira janela automática, conferir `cron.job_run_details` dos jobs 8/9, novo `elo_audit_runs` e `elo_sync_state`.
3. Só depois voltar ao próximo item funcional da UI: teste visual de “Qualificadas fora da seleção final” / botão **Selecionar** e, se aprovado, avaliar reforecast automático para a linha principal Bet365.

Para continuar em outro chat:

> Leia `docs/PROJECT_STATE.md` do repositório `kauefsantos/quant-football-insights`, confira GitHub/Lovable/Supabase e continue a partir do próximo passo. Não crie outro projeto Lovable. Antes de alterações, valide o estado real do banco e do main, incluindo Elo hierárquico e jobs diários.
