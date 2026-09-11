# Value Bet Finder

Aplicação privada para análise quantitativa pré-jogo de futebol, comparação de odds da Bet365 e acompanhamento de uma banca experimental.

## Fluxo atual

1. **Enviar jogos** — upload de CSV com `Data`, `Partida`, `Horário` e `Campeonato`.
2. **Preparar** — resolução das partidas, coleta/higienização dos dados e cálculo das probabilidades.
3. **Conferir odds** — o sistema tenta preencher odds Bet365 automaticamente; o usuário completa apenas o que ficou sem preço seguro.
4. **Ver sugestões** — o motor de valor avalia as odds disponíveis e pode retornar zero, uma ou mais sugestões dentro do limite operacional da rodada.
5. **Em andamento** — registro do resultado das apostas realmente feitas pelo usuário.
6. **Desempenho** — histórico e acompanhamento da banca em modo somente leitura.

O sistema **não executa apostas** e não força seleções quando os critérios não são atendidos.

## Regras centrais

- Probabilidade e preço permanecem separados: o preço da casa não é usado como feature do modelo.
- Nunca usar informação posterior ao `prediction_at`.
- Bookmaker operacional: **Bet365 Brasil**.
- Timezone operacional: **America/Sao_Paulo**.
- EV mínimo experimental: **2%**.
- Limite de sugestões: **2 em dias úteis e 3 no fim de semana**.
- A linha de referência nunca é tratada como value sem uma odd real compatível.
- Cartões usam proxy agregado compatível com a informação disponível na API; não tratar esse settlement como exato.
- Mercados/modelos permanecem experimentais quando ainda não possuem validação suficiente para produção.

## Modelos e mercados

O backend contém modelos de gols, escanteios, cartões, Elo e seleção de portfólio, além de validação temporal e métricas de acompanhamento.

Política experimental atual:

- **Gols da partida**: Over/Under nas linhas modeladas.
- **1X2**: mandante, empate e visitante.
- **Dupla chance**: 1X, X2 e 12.
- **Escanteios da partida e por time**: linhas centrais + escada definida em `src/lib/engine/market-policy.ts`.
- **Cartões da partida e por time**: mesma arquitetura de linhas; cartões por time usam Poisson no runtime atual.
- **Distribuições de contagem**: NB2 quando a validação e os dados sustentam o uso; caso contrário, fallback para Poisson.

Detalhes quantitativos e evidências estão em `docs/BACKEND_ROUND3_QUANT_VALIDATION_2026-09-10.md` e `docs/BACKEND_MARKET_POLICY_2026-09-10.md`.

## Odds Bet365 / 5DollarFootball

A integração usa a 5DollarFootballAPI Pro. O fluxo prioriza requisições compostas e consulta preços individuais apenas quando necessário.

Preenchimento automático direto atualmente cobre contratos que a API expõe de forma segura, incluindo 1X2, total de gols, total de escanteios e total de cartões da partida. Contratos sem preço direto ou com linha incompatível permanecem para conferência manual.

## Banca experimental

- O usuário confirma no painel apenas apostas que realmente fez fora do sistema.
- Confirmação e settlement da banca usam operações transacionais no backend.
- **Em andamento** é a única tela que encerra uma aposta e atualiza a banca.
- **Desempenho** é somente leitura.
- O limite diário também é protegido no banco.

## Segurança

- Login Google obrigatório.
- A allowlist real é validada no servidor; o frontend funciona apenas como gate de UX.
- Service role permanece restrita ao boundary server-side.
- RLS está habilitado nas tabelas públicas e o browser não possui privilégios diretos sobre elas.
- `/api/elo-sync` exige Bearer secret.
- Headers de segurança, CSP e no-cache/noindex são aplicados no servidor.

Auditorias fechadas: `docs/RLS_SECURITY.md`, `docs/SECURITY_AUDIT_2026-09-10.md` e `docs/BACKEND_AUDIT_CLOSE_2026-09-10.md`.

## Fontes de verdade

- **Lovable Cloud**: banco, ambiente e runtime publicados.
- **GitHub `main`**: código versionado, migrations, testes e regras de negócio.

Não criar outro projeto Lovable para este sistema. O projeto canônico é `28664075-8af4-4155-9ee9-8ed86021681a`.

## Desenvolvimento

O projeto usa **Bun**, TanStack Start, React, TypeScript, Tailwind e Supabase.

```bash
bun install
bun run dev
```

Validações principais:

```bash
bunx vitest run
bun run build
bun run lint
```

O CI também valida o boundary de secrets e o E2E do motor experimental.

## Estrutura principal

```text
src/
  components/                 UI específica da aplicação
  components/ui/              somente primitives realmente usadas
  integrations/               Lovable e Supabase
  lib/adapters/               adapters de dados externos
  lib/engine/                 regras/modelos quantitativos puros
  lib/*.functions.ts          server functions da aplicação
  routes/                     rotas TanStack
supabase/
  migrations/                 histórico versionado do schema
  tests/                      testes de segurança do banco
docs/                         auditorias, runbooks e estado canônico
```

O estado de continuidade do projeto deve ser mantido em `docs/PROJECT_STATE.md`.
