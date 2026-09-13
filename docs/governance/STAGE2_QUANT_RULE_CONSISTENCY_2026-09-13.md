# Etapa 2 — Consistência das regras quantitativas

Data: 13/09/2026

## Objetivo

Eliminar divergências entre o Opportunity Engine, o pipeline e o Value Engine sem reduzir os critérios canônicos de decisão e sem promover modelos experimentais.

## Regra canônica

A aplicação mantém uma única fonte compartilhada para os limites operacionais:

- probabilidade mínima: **70%**, inclusiva;
- odd mínima: **1,70**, inclusiva;
- EV mínimo: **8%**, inclusivo;
- edge mínimo: **5 pontos percentuais**, inclusivo;
- máximo de **3** seleções finais;
- zero seleções continua sendo resultado válido.

A Etapa 2 remove os números legados de 65% e 75% do gate operacional. O Opportunity Engine e o log de GATES passam a consumir a mesma constante de 70% usada pelo funil final. Isso não transforma modelo experimental em modelo de produção: os gates de `PRODUCTION_VALIDATED`, calibração, qualidade dos dados, linha e frescor continuam independentes e obrigatórios.

## Settlement asiático .25/.75

Linhas de quarto dividem o stake em duas linhas adjacentes, mas ambas são liquidadas sobre a **mesma contagem observada** na partida. Portanto, suas probabilidades não são independentes.

A implementação agora percorre a distribuição de contagem uma única vez. Para cada contagem possível, liquida as duas metades e somente então agrega o resultado em `FULL_WIN`, `HALF_WIN`, `PUSH`, `HALF_LOSS` ou `FULL_LOSS`.

Exemplo de regressão: Over 2.25 com 50% de probabilidade de 2 gols e 50% de 3 gols deve resultar exatamente em 50% `HALF_LOSS` e 50% `FULL_WIN`. Estados artificiais criados por multiplicação de marginais são proibidos.

## Testes obrigatórios

A mudança inclui regressões para:

- fronteira inclusiva de 70%;
- fronteira inclusiva de odd 1,70;
- permanência de EV 8%, edge 5 p.p. e máximo 3;
- Over/Under 2.25;
- Over/Under 2.75;
- soma da distribuição de settlement;
- E2E experimental usando os mesmos limites canônicos, sem aceitar o antigo EV de 2%.

## Fora de escopo

Esta etapa não:

- valida nem promove modelos esportivos;
- cria apostas para preencher cota;
- altera D+2;
- altera stake ou banca;
- altera RLS/autorização;
- muda o requisito de modelo `PRODUCTION_VALIDATED` para a fila real.
