# Resolução da auditoria funcional — 11/09/2026

## Escopo

Este documento registra as correções aplicadas aos achados F01–F05 da auditoria de funcionalidades e regras de negócio.

## F01 — fallback manual abaixo do gate de confiança

Corrigido. Quando a busca automática de odds falha, o fallback manual usa `passesExperimentalModelGate`. Previsões em 69% e exatamente 70% não entram na fila manual; apenas probabilidades estritamente maiores que 70% seguem para cotação.

## F02 — semântica MODEL_LEAN em 70%

Corrigido no fluxo ativo. A análise persistida usa `passesExperimentalModelGate` também para direção de modelo. Exatamente 70% produz direção neutra; valores estritamente maiores podem produzir `MODEL_LEAN_*` quando não existe value confirmado.

## F03 — ledger incompleto das avaliações

Corrigido com `experimental_value_evaluations`.

- toda odd efetivamente avaliada é persistida, selecionada ou rejeitada;
- o ledger é separado de `experimental_bet_tracking`;
- uma identidade de avaliação combina run, prediction e fingerprint do preço/linha/probabilidade;
- reprocessar exatamente a mesma avaliação não cria duplicação;
- uma nova odd para a mesma previsão preserva histórico distinto;
- escrita/leitura operacional permanece atrás da boundary de servidor/service role.

## F04 — resultado detalhado dependente do navegador

Corrigido com `experimental_analysis_results` e `getPersistedExperimentalResult`.

O servidor persiste o snapshot canônico da análise por `runId`. Ao abrir uma rota de resultado experimental sem cache local, `ExperimentalResultHydrator` recupera o snapshot antes de renderizar a rota e restaura o cache. `localStorage` passa a ser otimização de leitura, não a origem do resultado.

## F05 — E2E funcional fora do CI

Corrigido com `src/functional-decision-flow.e2e.test.ts` e etapa explícita `Functional decision-flow E2E` no workflow principal.

O teste é determinístico e não depende de login Google pessoal nem de API externa. Ele cobre:

- fronteira 69% / 70% / >70%;
- semântica estrita de MODEL_LEAN;
- probabilidade → odd → EV;
- bloqueio de 70%;
- correlação por partida;
- limite de seleção.

Os Playwright autenticados existentes permanecem disponíveis como smoke opcional de ambiente.

## Regras preservadas

- probabilidade esportiva separada do preço da casa;
- confiança estritamente maior que 70%;
- EV mínimo de 2%;
- no máximo uma seleção por jogo;
- teto de 2 seleções em dia útil e 3 no fim de semana;
- o teto não é meta e o sistema pode retornar zero sugestões.

## Validação

A correção só deve ser incorporada ao `main` com CI e regressão de banco verdes. A migration é versionada; não requer manipulação manual de tabelas de controle de migrations nem bypass de RLS.