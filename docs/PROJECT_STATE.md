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
- prazo absoluto de sessão de 30 dias validado no servidor pelo timestamp OAuth assinado no `amr` do JWT; `token_refresh` não reinicia o prazo;
- `session_id` assinado é obrigatório nas operações autenticadas;
- service role confinada a módulos server-side;
- CSRF e headers/CSP endurecidos, incluindo `base-uri 'none'`, `script-src-attr 'none'`, bloqueio de objetos e ausência de `unsafe-eval`;
- Web Push aceita somente endpoints HTTPS de provedores conhecidos e repete a validação imediatamente antes do `fetch`, com redirects bloqueados contra SSRF;
- CI executa auditoria de dependências de alta severidade e Gitleaks sobre o histórico completo;
- operações críticas de banca protegidas contra concorrência/duplicidade;
- `/api/elo-sync` existe somente como fallback `POST` protegido; a rotina diária Elo roda por `pg_cron` no banco.

Riscos residuais documentados são itens de manutenção, não blockers estruturais conhecidos. `unsafe-inline` permanece temporariamente na CSP por compatibilidade do runtime TanStack/Lovable e o broker OAuth Lovable legado deve ser migrado separadamente, com validação de login em preview e produção. Referência: [SECURITY_HARDENING_2026-09-11.md](SECURITY_HARDENING_2026-09-11.md).

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
- interface mobile-first para iPhone com navegação inferior, safe areas do notch/Home Indicator e alvos de toque de 44–48 px;
- autenticação mobile/standalone persiste a sessão, mas o prazo máximo de 30 dias não depende mais de `localStorage`: o browser apenas espelha a política e o servidor rejeita sessões que ultrapassam o timestamp OAuth assinado;
- identidade visual instalada com ícones próprios do Bet Value em 32, 180, 192 e 512 px, incluindo `apple-touch-icon` e manifest;
- metadados de instalação e `site.webmanifest` para uso em modo standalone ao adicionar a aplicação à Tela de Início do iOS;
- a etapa de preparação não depende mais da aba permanecer aberta: o telefone enfileira o job e a tela apenas acompanha o estado persistido no servidor;
- Web Push no PWA instalado pode avisar quando a preparação termina; a permissão só é pedida por ação explícita do usuário e negar avisos não bloqueia a análise;
- mojibake comum de UTF-8 é reparado na ingestão de CSV e também na exibição de competições históricas, evitando textos como `ItÃ¡lia`;
- durante o fluxo de análise, a UI informa a regra vigente: probabilidade do modelo estritamente acima de 70%, odd real e EV mínimo de 2%;
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
→ gate operacional de confiança > 70%
→ preço real da Bet365
→ Motor 2 / EV
→ seleção de portfólio
```

A odd nunca é feature do modelo esportivo.

### Probabilidade usada pelo Motor 2

O contrato atual expõe:

- `decisionProbability` — probabilidade realmente usada na decisão;
- `RAW_EXPERIMENTAL` — previsão bruta do piloto experimental;
- `CONSERVATIVE_CALIBRATED` — reservado para uma camada futura realmente calibrada;
- `OUTCOME_DISTRIBUTION` — base de decisão em contratos asiáticos.

Não criar haircut/calibração arbitrária sem amostra out-of-sample suficiente.

### Regra operacional de confiança

- `MIN_MODEL_PROBABILITY = 70%` como fronteira, com comparação **estrita**;
- **70,0% reprova**; somente valores **> 70%** podem seguir para avaliação de value e seleção;
- a regra vale também para o fluxo experimental e para promoção manual de alternativas, pois todas passam por `evaluateValue`;
- uma oportunidade abaixo do limite recebe `MODEL_PROBABILITY_BELOW_THRESHOLD`, fica com probabilidade bloqueada e não tem EV usado para recomendação;
- o seletor de portfólio repete o gate como defesa em profundidade para impedir que resultados antigos/stale com EV positivo sejam promovidos.

### Value

- `EV_TARGET = 2%`;
- probabilidade > 70% é pré-condição de recomendação, mas **não significa value**;
- uma odd só é value quando existe preço real compatível e EV mínimo de 2%;
- probabilidade <= 70% é descartada da recomendação mesmo quando a odd produziria EV matemático positivo;
- seleção automática evita mais de uma escolha do mesmo jogo;
- limite operacional: 2 seleções em dia útil e 3 no fim de semana;
- o limite é teto, nunca meta: o sistema pode retornar 0, 1, 2 ou 3 seleções conforme os filtros.

## Política experimental de mercados

Arquivo canônico: `src/lib/engine/market-policy.ts`.

- **Gols da partida:** âncora 2.5, referências Over 3.5 e Under 1.5;
- **1X2:** HOME / DRAW / AWAY;
- **dupla chance:** 1X / X2 / 12;
- **escanteios da partida:** âncora 9.5;
- **escanteios por time:** âncora 4.5;
- **cartões da partida/time:** âncora 4.5;
- o fluxo novo não gera BTTS/team goals para cotação;
- `MODEL_LEAN_THRESHOLD = 70%`, com regra de negócio interpretada de forma estrita: somente probabilidade > 70% é confiança suficiente.

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

## Análise em segundo plano e notificações

A preparação `RESOLVE → COLLECT → CLEAN → FEATURES → PROBABILITY → GATES → MARKETS` é persistida em `analysis_jobs` e executada no servidor. O upload cria o run, enfileira o job e só depois navega para a tela de processamento.

- PostgreSQL/`pg_net` dispara `/api/analysis-worker` usando um `dispatch_token` aleatório por job, mantido fora do browser;
- cada chamada do worker executa no máximo uma etapa e re-enfileira a seguinte, reduzindo risco de timeout de uma requisição longa;
- `analysis-worker-watch` em `pg_cron` roda a cada minuto como backstop para jobs enfileirados ou travados;
- jobs `RUNNING` sem heartbeat por 20 minutos podem ser retomados; etapas já registradas em `completed_steps` não são repetidas;
- a tela de processamento consulta `analysis_runs`, `analysis_jobs` e `pipeline_logs`; ao reabrir o app, reconstrói o progresso real e segue para odds quando o run chega a `READY_FOR_ODDS`;
- subscriptions Web Push ficam em `push_subscriptions`, com RLS por `auth.uid()`; entrega é feita somente no servidor;
- endpoint de subscription é validado por allowlist HTTPS de provedores Web Push no cadastro e novamente no envio; destinos legados não confiáveis são removidos e redirects HTTP são recusados para impedir SSRF;
- o service worker `public/sw.js` recebe o evento `push`, exibe uma notificação visível e abre a análise ao toque;
- a chave VAPID privada é derivada apenas no servidor a partir de segredo já existente, com separação de domínio; somente a chave pública é enviada ao browser;
- Web Push é um complemento: falha, bloqueio ou recusa de notificação não altera o resultado da análise.

Nenhuma regra quantitativa, Elo, mercado, cálculo de value ou regra de banca é executada de forma diferente por causa dessa camada operacional.

## Observabilidade do funil de decisão

A rota autenticada e somente leitura `/diagnostico` audita a run mais recente sem alterar dados. Ela deriva métricas das tabelas operacionais já existentes (`analysis_runs`, `model_predictions`, `experimental_odds_snapshots` e `experimental_bet_tracking`) e usa os mesmos helpers canônicos de política de mercado para evitar uma segunda definição da regra de 70%.

O painel mostra:

- jogos e anchors modelados;
- quantidade estritamente acima de 70% e quantidade bloqueada em 70% ou menos;
- buckets >70–<75, 75–<80, 80–<85 e 85%+;
- preços automáticos válidos, falhas/linhas incompatíveis e contratos não expostos pela API;
- preços automáticos que atingem EV mínimo de 2%;
- sugestões finais e teto diário;
- contador explícito de eventual cotação automática que tenha vazado para probabilidade <=70%.

Runs criadas antes da ativação da regra estrita são tratadas como **legado** e nunca como prova de conformidade da regra nova. A auditoria datada está em `docs/DECISION_FUNNEL_AUDIT_2026-09-11.md`.

Limitação conhecida: o ledger completo de todas as odds manuais avaliadas/rejeitadas ainda não é persistido; por isso o contador de EV da tela é explicitamente o EV dos preços automáticos auditados. A seleção final continua protegida pelo gate estrito no backend.

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
→ bun audit --audit-level=high
→ Gitleaks no histórico completo
→ server secret boundary
→ functional decision-flow E2E
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
