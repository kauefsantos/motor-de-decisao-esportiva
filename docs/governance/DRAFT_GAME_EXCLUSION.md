# Exclusão opcional de partidas na validação

## Objetivo

Permitir que o usuário prossiga com uma rodada mesmo quando decide não analisar uma partida ambígua ou inválida, sem alterar a metodologia quantitativa, o Elo ou as regras do motor.

## Regra de negócio

- A exclusão é individual por jogo e persistida em `analysis_draft_games.ignored`.
- Jogos ignorados não contam como inválidos e não bloqueiam a validação do rascunho.
- O usuário pode reincluir o jogo antes da finalização.
- A finalização exige pelo menos uma partida não ignorada.
- `finalize_analysis_draft_atomic` copia para o run somente partidas com `ignored = false`.
- A ação é owner-scoped: o backend valida a propriedade do rascunho antes de alterar qualquer jogo.
- Ignorar/reincluir é idempotente; gravar novamente o mesmo estado não duplica processamento.

## UX

A tela de validação oferece `Não analisar este jogo` para partidas que precisam de atenção. Um jogo ignorado recebe o estado `Jogo não será analisado` e a ação `Reincluir jogo`.

O resumo distingue jogos que serão analisados, validados, que precisam de atenção e ignorados.

## Não afetado

Esta mudança não altera Elo, probabilidades, mercados, odds, EV, banca, seleção final ou qualquer cálculo quantitativo. Ela apenas controla quais linhas do rascunho chegam ao run.
