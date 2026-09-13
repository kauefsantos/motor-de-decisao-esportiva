# Stage 5 — Odds, value e operação financeira

Escopo isolado da Etapa 4.

Objetivo: tornar auditável e fail-closed o caminho entre a cotação real e a exposição financeira, sem alterar os gates de validação de modelo.

## Eixos
- correspondência exata entre mercado, seleção e linha;
- freshness e origem da cotação usada na decisão;
- cálculo de probabilidade implícita, edge e EV sobre a probabilidade canônica;
- seleção final de 0 a 3, uma principal por partida e no máximo duas da mesma família;
- stake/bankroll e prevenção de duplicidade;
- settlement e CLV usando a odd realmente executada;
- revalidação da odd no momento em que uma aposta real é registrada.

## Isolamento da Etapa 4
Enquanto o PR #122 estiver aberto, esta etapa permanece em `feat/stage5-odds-value-governance`. Nenhuma migration desta etapa será aplicada ao Lovable Cloud e nenhuma publicação será feita antes de atualizar a branch com o `main` já contendo o fechamento da Etapa 4.

## Achados iniciais
1. A freshness de odd automática já é verificada na criação da fila, mas a fila não registra explicitamente a origem e o instante da cotação.
2. A tela de registro da aposta pede apenas stake; a odd realmente disponível no momento da aposta não é reconfirmada nem reavaliada antes da exposição financeira.
3. O CLV usa `entry_odd`; portanto `entry_odd` precisa representar a odd realmente executada, enquanto a odd que originou a decisão deve ser preservada separadamente.

## Pacote 5A
- adicionar trilha de `decision_odd` e metadados da cotação;
- exigir odd atual para stake positiva;
- recalcular odd mínima, edge e EV no servidor antes de abrir a aposta;
- atualizar `entry_odd` para a odd efetivamente executada;
- preservar a odd/EV/edge da decisão original em campos separados;
- manter sinais sem modelo `PRODUCTION_VALIDATED` incapazes de receber stake positiva.
