# Value Bet Finder — Estado Canônico

> Atualizado: 2026-09-11 BRT  
> Repo: `kauefsantos/quant-football-insights`  
> Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a`  
> URL publicada: `https://quant-football-insights.lovable.app/`  
> Baseline funcional auditado antes da limpeza pós-auditoria: `98cdb0a4c88023d16b0ab41d8af24d6a34d1a6dc`

## Fontes de verdade

- **Lovable Cloud** = fonte de verdade do banco, ambiente e runtime publicados.
- **GitHub `main`** = fonte de verdade do código versionado, migrations, testes e regras de negócio.
- Não usar outro projeto Lovable e não tratar um Supabase conectado separadamente como banco canônico deste app.
- Não manipular manualmente `supabase_migrations.schema_migrations` para “alinhar” histórico.

## Estado das auditorias

### RLS — fechado

- RLS habilitado nas tabelas públicas auditadas.
- Privilégios de browser removidos.
- Funções privilegiadas com `search_path` endurecido e execução restrita ao `service_role`.
- CI de segurança do banco passou no fechamento.

### Segurança — fechado

- autenticação global nas server functions;
- login Google + allowlist validada no servidor;
- service role restrita ao boundary server-side;
- `/api/elo-sync` protegido por Bearer secret;
- CSP/headers e cache/noindex endurecidos;
- transições críticas de apostas protegidas contra disputa/duplicidade.

Residuais documentados continuam sendo melhorias operacionais, não blockers estruturais.

### Backend — fechado como eixo de implementação

Rodadas consolidadas:

1. **Estrutural** — fluxo, mercados, integrações, duplicações e regras de negócio.
2. **Integridade operacional** — funil progressivo de odds, IDs versionados, banca transacional, controle de correlação e limite diário no banco.
3. **Quant/API** — CLV, priors/standings 5Dollar, requests compostas, validação cronológica OOS e política híbrida NB2/Poisson.

PR principal da rodada 3: **#44**, merge `630ce99cf598c6d8c45b68cb0debf7e7af6dc940`.

Residual operacional: um smoke autenticado/reprocessamento normal pós-publicação ainda deve ser usado quando houver sessão adequada para validar o caminho completo no runtime. Isso não representa pendência de código/migration do Backend.

### Frontend — fechado P0 a P3

- **P0/P1 — PR #45**: erro explícito, fluxo único de odds, odds automáticas visíveis, lifecycle protegido, resultado recuperável e ações críticas mais claras.
- **P2 — PR #46**: navegação mobile, acessibilidade, touch targets, performance, analytics somente leitura e gráfico de banca melhorado.
- **P3 — PR #47**: continuidade de rota após login, estados finais, semântica e refinamentos de UX.

Baseline publicada após P3: `98cdb0a4c88023d16b0ab41d8af24d6a34d1a6dc`.

Não há P4 estrutural aberta no Frontend.

## Fluxo atual da aplicação

`Enviar jogos → Preparar → Conferir odds → Ver sugestões → Registrar aposta → Em andamento → Desempenho`

- **Registrar aposta** significa registrar no painel uma aposta que o usuário fez na Bet365; o sistema não envia apostas à casa.
- **Em andamento** é a única tela de settlement operacional.
- **Desempenho** é somente leitura.

## Política experimental de mercados

Arquivo canônico: `src/lib/engine/market-policy.ts`.

### Escanteios

- partida: âncora 9.5; Over `[9.5, 10.5]`; Under `[9.5, 8.5, 7.5, 6.5]`;
- time: âncora 4.5; Over `[4.5, 5.5, 6.5, 7.5]`; Under `[4.5, 3.5, 2.5]`.

### Gols

- partida: âncora 2.5; Over `[2.5, 3.5]`; Under `[2.5, 1.5]`;
- geração experimental atual não cria BTTS/team goals no fluxo novo.

### Cartões

- partida e time: âncora 4.5; Over `[4.5, 5.5, 6.5]`; Under `[4.5, 3.5, 2.5]`.

### Resultado

- 1X2: HOME / DRAW / AWAY;
- dupla chance: 1X / X2 / 12.

Máximo de anchors de cotação plenamente modelados por jogo: **20**.

A linha de referência nunca é value sem preço real compatível.

## Regra de value

- EV alvo experimental: **2%**.
- Não há gate de probabilidade bruto para declarar value no Motor 2.
- Lean de modelo em 55% não equivale a value confirmado.
- Seleção automática: no máximo uma seleção por jogo; alternativas correlacionadas permanecem separadas.
- Limite operacional: **2 seleções em dia útil / 3 no fim de semana**.

## Distribuições de contagem — runtime atual

- `corners_match_total`: NB2 quando há evidência/alpha válidos; senão Poisson.
- `corners_team_total`: mesma regra.
- `cards_match_total`: mesma regra.
- `cards_team_total`: **Poisson**.
- cross-league corners sem alpha: Poisson.
- gols: política própria já existente, sem alteração pela rodada 3.

A decisão NB2 vs Poisson deve continuar baseada em evidência OOS, não preferência manual.

## Cartões — contrato operacional

Bet365:

- amarelo = 1;
- vermelho = 2;
- segundo amarelo é ignorado como amarelo adicional;
- cartões de não-jogadores são excluídos;
- settlement em 90 min programados.

A resposta agregada da 5Dollar `{yellow, red}` não traz identidade suficiente para reproduzir tudo exatamente.

Proxy canônico: `bet365-yellow1-red2-aggregate-v1`, com `yellow + 2 * red`.

Nunca descrever o settlement de cartões como exato enquanto a fonte continuar agregada.

## 5DollarFootballAPI Pro

Plano Pro ativo durante a auditoria de setembro/2026.

Uso consolidado:

- requests compostas `/fixtures?include=odds,events,stats` quando vantajosas;
- standings de corner/card usados como priors/feature de pesquisa quando point-in-time válido;
- Bet365 list/snapshot para preço operacional;
- tick-by-tick history não é assumido, pois pertence ao plano Ultra.

Health auditado desde 08/09: **992/992 chamadas OK, 0 non-OK, 0 HTTP 429** no período verificado.

Não adicionar limiter distribuído sem evidência de necessidade.

## CLV

A rodada 3 adicionou persistência/diagnóstico de opening/closing price e CLV por contrato exato.

CLV é métrica de acompanhamento; não deve vazar informação futura para a previsão.

## Elo

O Elo hierárquico permanece feature auxiliar, não motor independente.

Arquivos/runbooks: `docs/ELO_V1.md`, `docs/ELO_RUNBOOK.md`, `docs/ELO_AUDIT_2026-09-08.md`.

Regras essenciais:

- leitura estritamente anterior ao `prediction_at`;
- hierarquia de liga/divisão deve continuar respeitada;
- prior de liga não substitui evidência interligas;
- job diário e finalize permanecem separados conforme migrations/runbook.

## Banca experimental

- confirmação e settlement usam RPCs transacionais;
- limite diário também é protegido por trigger no banco;
- `DECLINED` libera slot; `PROPOSED`, `OPEN` e `SETTLED` contam conforme regra versionada;
- não recalcular retroativamente apostas históricas apenas porque o modelo evoluiu.

## Run histórica conhecida

Run `d43e0099-b7b2-482c-8fd9-995be9b53394`, target `2026-09-11`, chegou a ter **1545** `experimental_predictions` antes do reprocessamento do catálogo novo.

Não apagar/reconstruir manualmente via SQL. Se precisar atualizar essa run, usar o fluxo autenticado de `prepareExperimentalMarketsRun` e verificar novamente o estado real depois.

## Migrations críticas recentes

- `20260911000500_atomic_experimental_bankroll.sql`
- `20260911000600_selection_limit_counts_settled.sql`
- `20260911010000_quantitative_api_round3.sql`

Live Lovable Cloud foi reconciliado por DDL aditivo durante as auditorias sem editar `schema_migrations` manualmente.

## Testes e CI

CI atual executa:

- boundary de secrets;
- E2E do motor experimental;
- Vitest completo;
- build.

Os scripts Python Playwright em `tests/e2e/` foram atualizados para a UI nova, porém continuam fora do CI por dependerem de uma sessão Google autorizada. Não enfraquecer autenticação para automatizá-los.

## Regra para próximas alterações

Antes de qualquer mudança relevante:

1. confirmar HEAD real de `main`;
2. confirmar sync do Lovable;
3. manter Lovable Cloud como fonte de verdade do runtime/banco;
4. evitar reabrir RLS, Segurança, Backend ou Frontend sem evidência concreta de regressão;
5. alterações quantitativas novas devem vir com evidência OOS e teste;
6. alterações de UI não devem recriar scaffolding genérico ou componentes não usados.
