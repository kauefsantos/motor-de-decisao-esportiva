# Emerald Night UI — 2026-09-13

## Objetivo

Atualizar a identidade visual do Bet Value Engine para uma interface night com acento emerald, preservando a arquitetura, os fluxos, a responsividade e as regras de negócio existentes.

## Paleta aprovada

- background principal: `#08110F`
- superfície/card: `#111E1A`
- superfície elevada/secundária: `#162720`
- verde principal: `#2DD4A3`
- verde de destaque/hover/sucesso: `#3BE0B1`
- verde profundo/muted: `#12372C`
- borda: `#243B32`
- texto principal: `#F2F7F5`
- texto secundário: `#94AFA5`
- erro/perda: `#F87171`
- atenção: `#FBBF24`

## Princípios

1. O verde representa ação, oportunidade e estado positivo; não deve dominar todas as superfícies.
2. Vermelho e âmbar permanecem semânticos para erro/perda e atenção.
3. O fundo continua escuro e de baixo brilho para preservar a leitura prolongada e a estética de terminal quantitativo.
4. Cards, bordas, grade e sombras são discretos para não competir com probabilidades, odds, EV, edge e decisões.
5. A mudança é somente visual: não altera modelos, probabilidades, odds, gates quantitativos, portfólio, agendamento D+2 ou stake.

## Implementação

A alteração é centralizada nos tokens globais de `src/styles.css`, permitindo que componentes existentes que usam `background`, `surface`, `primary`, `accent`, `success`, `warning`, `destructive`, `border`, `input` e `ring` herdem a nova identidade sem duplicação de cores em componentes individuais.

O fundo recebe uma grade mais sutil e um brilho radial emerald de baixa intensidade. Painéis mantêm transparência e recebem bordas/sombras mais delicadas.

## Regressão

`src/emerald-night-theme-contract.test.ts` protege:

- os principais tokens aprovados;
- a remoção dos antigos acentos roxo/ciano;
- a separação semântica de verde, vermelho e âmbar;
- dark mode, foco visível e reduced-motion.

## Fora de escopo

- redesenho estrutural de páginas;
- novo fluxo de odds manuais;
- mudanças no backend;
- mudanças no Lovable Cloud;
- publicação por ambiente Lovable.

A entrega deste eixo é exclusivamente por commit/PR no GitHub.
