# Motor de Decisão Esportiva — estado canônico

> Atualizado: 11/09/2026  
> Repositório: `kauefsantos/motor-de-decisao-esportiva`  
> Lovable canônico: `28664075-8af4-4155-9ee9-8ed86021681a`  
> URL publicada: `https://quant-football-insights.lovable.app/`  
> Baseline quantitativo pós-Elo: `f0ad5bfc2b2e9e0895129f73d3d0b6b229938eaf`

Este arquivo registra decisões vigentes. Auditorias datadas preservam a trilha histórica, mas não substituem este estado nem o código do `main`.

## Fontes de verdade

- **Lovable Cloud** = banco, ambiente e runtime vivos.
- **GitHub `main`** = código, migrations, testes e regras de negócio versionadas.
- Não criar outro projeto Lovable para continuar este produto.
- Não tratar um Supabase conectado separadamente como banco canônico.
- Não manipular manualmente `supabase_migrations.schema_migrations`.

## Estado dos eixos auditados

### RLS — fechado

- RLS habilitado nas superfícies públicas auditadas;
- privilégios diretos de browser removidos das tabelas operacionais;
- funções privilegiadas endurecidas e restritas ao boundary de servidor/service role;
- testes de segurança do banco versionados.

### Segurança — fechado

- autenticação global das server functions;
- Google login com allowlist validada no servidor;
- service role confinada a módulos server-side;
- CSRF e headers/CSP endurecidos;
- operações críticas de banca protegidas contra concorrência/duplicidade;
- `/api/elo-sync` existe somente como fallback `POST` protegido; a rotina diária Elo roda por `pg_cron` no banco.

Riscos residuais documentados são itens de manutenção, não blockers estruturais conhecidos.

### Backend — fechado como eixo de implementação

O backend passou por três rodadas principais:

1. arquitetura e regras de mercado;
2. integridade operacional — funil progressivo de odds, IDs versionados, banca transacional, limite diário e correlação;
3. qualidade quantitativa/API — CLV, features de pesquisa point-in-time, política NB2/Poisson e validação cronológica.

Após a integração do Elo hierárquico, uma rodada adicional corrigiu a semântica de probabilidade usada pelo Motor 2: o fluxo experimental agora declara explicitamente `RAW_EXPERIMENTAL` em vez de tratar probabilidade bruta como se já fosse conservadora/calibrada.

### Frontend — fechado P0 a P3

- fluxo único de odds e erros explícitos;
- odds automáticas visíveis;
- navegação/mobile/acessibilidade melhorados;
- telas de acompanhamento e analytics com papéis separados;
- continuidade de rota após login;
- nenhuma pendência estrutural P0–P2 conhecida.

### Elo — fechado

A arquitetura atual inclui:

- Elo local de times;
- Elo de ligas com prior + evidência interligas;
- Elo global para comparações cross-league;
- continuidade em promoção/rebaixamento;
- gate mínimo de evidência para ligas;
- reconstrução point-in-time para runs históricas;
- integração efetiva com o modelo de gols e o Motor 2.

A aplicação do Elo hierárquico foi comprovada em runtime no Lovable Cloud com `CROSS_LEAGUE_HIERARCHICAL`, `elo-v2-hierarchical`, lambdas persistidos e probabilidades recalculadas. A soma dos lambdas permanece preservada.

Referência atual: [ELO.md](ELO.md) e [ELO_RUNBOOK.md](ELO_RUNBOOK.md).

## Fluxo da aplicação

```text
Enviar jogos
→ Preparar análise
→ Conferir odds
→ Ver sugestões
→ Registrar aposta feita fora do sistema
→ Em andamento
→ Desempenho
```

O produto não envia apostas à Bet365.

## Modelo de decisão

A separação estrutural é:

```text
Motor esportivo, sem odd da casa
→ model_probability
→ preço real da Bet365
→ Motor 2 / EV
→ seleção de portfólio
```

A odd nunca é feature do modelo esportivo.

### Probabilidade usada pelo Motor 2

O contrato atual expõe:

- `decisionProbability` — probabilidade realmente usada no cálculo de value;
- `RAW_EXPERIMENTAL` — previsão bruta do piloto experimental;
- `CONSERVATIVE_CALIBRATED` — reservado para uma camada futura realmente calibrada;
- `OUTCOME_DISTRIBUTION` — base de decisão em contratos asiáticos.

Não criar haircut/calibração arbitrária sem amostra out-of-sample suficiente.

### Value

- `EV_TARGET = 2%`;
- não existe gate de probabilidade bruto para declarar value;
- lean de 55% é leitura de modelo, não confirmação de value;
- uma odd só é value quando existe preço real compatível;
- seleção automática evita mais de uma escolha do mesmo jogo;
- limite operacional: 2 seleções em dia útil e 3 no fim de semana.

## Política experimental de mercados

Arquivo canônico: `src/lib/engine/market-policy.ts`.

- **Gols da partida:** âncora 2.5, referências Over 3.5 e Under 1.5;
- **1X2:** HOME / DRAW / AWAY;
- **dupla chance:** 1X / X2 / 12;
- **escanteios da partida:** âncora 9.5;
- **escanteios por time:** âncora 4.5;
- **cartões da partida/time:** âncora 4.5;
- o fluxo novo não gera BTTS/team goals para cotação.

Máximo plenamente modelado de anchors de cotação por jogo: 20.

## Elo e mercados

O Elo redistribui `lambdaHome` e `lambdaAway` sem alterar `lambdaTotal`.

Consequência prática:

- 1X2 e dupla chance mudam;
- total de gols O/U não muda por causa do Elo quando depende somente da soma dos lambdas;
- corners/cards não recebem Elo.

O peso Elo continua em 0.20. A comparação cross-league inicial favoreceu a integração, mas a amostra ainda é pequena para retunar o parâmetro.

## Distribuições de contagem

- `corners_match_total`: NB2 quando elegível; fallback Poisson;
- `corners_team_total`: NB2 quando elegível; fallback Poisson;
- `cards_match_total`: NB2 quando elegível; fallback Poisson;
- `cards_team_total`: Poisson;
- cross-league corners sem dispersão validada: Poisson.

Mudanças de distribuição precisam continuar baseadas em evidência walk-forward/OOS.

## Cartões

Proxy operacional vigente: `bet365-yellow1-red2-aggregate-v1`.

A fonte agregada da 5Dollar não permite reproduzir perfeitamente exclusões de segundo amarelo/não-jogadores. Portanto o settlement de cartões não deve ser descrito como exato.

## Banca

- confirmação e settlement via RPCs transacionais;
- limite diário protegido também no banco;
- `DECLINED` libera slot;
- apostas históricas não são recalculadas retroativamente quando o modelo evolui.

## Elo operacional

Jobs diários principais no Lovable Cloud/PostgreSQL:

- `elo-daily-incremental`: 03:00–04:58 BRT, a cada 2 minutos;
- `elo-daily-finalize`: 05:05 BRT.

Detalhes e troubleshooting: [ELO_RUNBOOK.md](ELO_RUNBOOK.md).

## CI e governança GitHub

O `main` é protegido por ruleset com:

- Pull Request obrigatório;
- histórico linear;
- squash merge;
- bloqueio de force push e deleção;
- resolução de conversas;
- status `test-and-build` obrigatório e estrito.

CI executa:

```text
bun install --frozen-lockfile
→ server secret boundary
→ experimental engine E2E
→ Vitest completo
→ production build
```

Branches mergeadas devem ser removidas após o merge. Atualizações major do Dependabot não devem ser mergeadas em lote; avaliar individualmente com CI.

## Regra para próximas mudanças

Antes de alterar comportamento:

1. conferir `main` e o sync do Lovable;
2. preservar Lovable Cloud como fonte de verdade do runtime;
3. não reabrir RLS/Segurança/Backend/Frontend/Elo sem evidência concreta de regressão;
4. alterações quantitativas exigem versionamento, teste e evidência OOS;
5. não misturar probabilidade esportiva com preço da casa;
6. não recriar scaffolding UI ou fluxos legados sem uso real;
7. dependências só devem ser removidas junto com atualização coerente do lockfile e CI verde.
