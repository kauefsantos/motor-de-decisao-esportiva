# Arquitetura e qualidade do código

## Objetivo

Este documento registra as fronteiras técnicas obrigatórias do Motor de Decisão Esportiva. O objetivo é reduzir acoplamento, duplicação e regressões conforme o produto cresce, sem alterar regras quantitativas ou regras de negócio por efeito colateral de refatorações.

## Camadas e responsabilidades

### `src/routes/`

Responsável por composição de páginas, parâmetros de rota e metadados. Rotas não acessam o cliente administrativo do banco diretamente.

### `src/components/` e `src/hooks/`

Responsáveis por apresentação, interação e estado de interface. Componentes devem consumir contratos de aplicação/server functions em vez de importar detalhes internos do motor quantitativo quando existir uma fachada de aplicação apropriada.

### `src/lib/application/`

Orquestra casos de uso. Coordena domínio, repositories e providers, mas não contém detalhes visuais.

### `src/lib/domain/`

Contém cálculo e regras de negócio puras que não dependem de UI, rede ou banco.

### `src/lib/repositories/`

Concentra acesso e tradução de persistência. Consultas privilegiadas devem ser owner/run scoped sempre que o contexto permitir. RPCs do runtime que ainda não constam no snapshot gerado ficam isoladas no bridge `runtime-rpc.server.ts` até a próxima regeneração do schema.

### `src/lib/adapters/` e providers

Isolam contratos externos. Rate limit, retry, cache e tradução do formato do fornecedor não devem vazar para componentes.

### `src/lib/engine/`

É a camada quantitativa pura. Código de produção dentro de `engine/` não pode abrir banco, importar rotas/componentes ou hospedar orquestração server-only. Treino/persistência deve ficar em `application/` + `repositories/`.

### `src/lib/pipeline/`

Cada etapa de integração pesada pode ter um módulo próprio. `RESOLVE` e `COLLECT` foram extraídos do antigo arquivo monolítico; `pipeline.server.ts` mantém a orquestração das etapas e as transformações internas restantes.

## Tipagem do Lovable Cloud

- `src/integrations/supabase/types.ts`: snapshot gerado do schema.
- `src/integrations/supabase/database.types.ts`: única fachada canônica importada pelo runtime.
- nenhum runtime deve importar um patch paralelo como `types.live.ts`.
- RPCs ainda não presentes no snapshot gerado são tipadas e isoladas em repository server-only; casts não devem se espalhar por Server Functions.

Quando o snapshot gerado for atualizado a partir do schema operacional, as extensões já incorporadas devem ser removidas da fachada.

## Erros

Falhas de autenticação, autorização, validação, conflito, indisponibilidade externa e erro interno devem usar `BackendError` ou um contrato explicitamente tipado. Código de aplicação não deve inferir semântica HTTP apenas pela redação de uma mensagem humana.

## Fluxo de decisão

Existe um único fluxo vigente de odds e decisão: `DecisionQueueGate` / `DecisionQueueFlow`, com estado persistido no backend e limite diário retornado pelo serviço. O antigo `ExperimentalMarketsPilot`, que continha a regra obsoleta de 2 seleções em dias úteis e 3 no fim de semana, foi removido.

Formatadores, tipos de fila e fallback de elegibilidade ficam centralizados na camada de aplicação; ações repetidas de aceitar/recusar/finalizar ficam no hook `useDecisionQueueActions`.

## Pipeline

`pipeline.server.ts` continua sendo o dispatcher canônico, mas resolução de partidas e coleta externa são módulos independentes:

- `pipeline/resolve.server.ts`
- `pipeline/collect.server.ts`
- `pipeline/provider.server.ts`

Novos provedores devem entrar pela política/provider correspondente, evitando novos grandes blocos condicionais na orquestração central.

## Auditoria com service role

A autorização acontece antes da leitura privilegiada. Quando uma análise possui IDs de partidas conhecidos, consultas a tabelas auxiliares devem usar esses IDs no próprio SQL; não é permitido carregar registros de outros owners para só depois descartá-los em memória.

## Qualidade no CI

O CI deve bloquear merge quando qualquer uma destas etapas falhar:

1. lint;
2. TypeScript `--noEmit`;
3. boundaries arquiteturais;
4. dependency/secret/security gates;
5. migrations e regressões de banco;
6. E2E funcional;
7. E2E quantitativo;
8. testes unitários;
9. build;
10. budget de bundle e smoke de carga;
11. matriz de navegadores/acessibilidade.

O script `scripts/check-architecture-boundaries.mjs` impede regressões estruturais básicas como server orchestration dentro do engine, imports do runtime de tipos obsoletos e acesso privilegiado direto em rotas.

## Tipografia

A família continua sendo IBM Plex Sans para conteúdo e IBM Plex Mono para odds/métricas. Novas interfaces devem preferir utilitários semânticos:

- `type-page-title`
- `type-section-title`
- `type-body`
- `type-label`
- `type-meta`
- `type-caption`
- `type-metric`
- `type-odds`

`text-[10px]` e `text-[11px]` existentes permanecem protegidos por um piso de legibilidade, mas não devem ser o padrão para novos componentes.

## Critério de refatoração

Refatorações arquiteturais não podem alterar probability gates, seleção de portfólio, Elo, idempotência, regras de banca ou contratos de mercado sem uma mudança funcional explicitamente revisada e testada.
