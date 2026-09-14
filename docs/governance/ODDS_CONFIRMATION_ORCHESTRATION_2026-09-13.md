# Orquestração de odds e confirmação — 2026-09-13

## Objetivo

Transformar a etapa de odds em parte explícita do fluxo operacional diário sem alterar as probabilidades calculadas pelo modelo depois da análise inicial.

Fluxo alvo:

`12h45 -> análise automática -> probabilidades >= 70% -> odds automáticas -> pendências manuais -> confirmação -> refresh das odds automáticas -> EV/edge/portfólio -> resultado final`.

## Probabilidade congelada

A confirmação de odds **não executa novamente o modelo preditivo**. A previsão e a linha modelada permanecem as produzidas no pipeline original. Isso preserva o caráter prospectivo da análise e evita que a previsão mude em função da interação do usuário ou de preços posteriores.

## Pipeline automático

A etapa `ODDS` passa a ser a última etapa do worker, depois de `MARKETS`.

Ela:

1. seleciona somente âncoras de cotação que passam pelo gate experimental de probabilidade >= 70%;
2. consulta a Bet365 pela integração FiveDollar;
3. grava snapshots auditáveis em `experimental_odds_snapshots`;
4. identifica `MATCHED`, `LINE_MISMATCH`, `UNSUPPORTED`, `NO_PRICE` e `SOURCE_UNAVAILABLE`;
5. separa os contratos sem preço automático para entrada manual;
6. só então marca a análise como `READY_FOR_ODDS` e permite a notificação de análise pronta.

A etapa `MARKETS` deixa de marcar a análise como pronta antes da cotação automática, evitando uma janela em que a interface poderia abrir enquanto o preço inicial ainda não havia sido coletado.

## Confirmação do usuário

Ao selecionar **Confirmar odds e recalcular**, a aplicação obrigatoriamente consulta novamente as odds automáticas antes da decisão final.

Regras:

- preço automático fresco `MATCHED` sempre substitui qualquer preço automático anterior;
- preço automático antigo nunca é carregado adiante quando o refresh retorna linha diferente, ausência de preço ou indisponibilidade;
- odd manual é usada somente quando o contrato não está `MATCHED` no refresh;
- a linha enviada ao motor continua sendo a linha modelada congelada;
- após consolidar os preços, o motor reaplica odd mínima, EV, edge e seleção de portfólio;
- as regras de correlação, limite por partida e limite diário permanecem inalteradas;
- ausência de oportunidades continua sendo um resultado válido.

## Gates quantitativos preservados

Este fluxo não relaxa nenhum gate:

- probabilidade operacional >= 70%;
- odd de execução >= 1,70;
- EV >= 8%;
- edge >= 5 p.p.;
- no máximo 3 escolhas finais;
- no máximo 1 escolha principal por partida;
- no máximo 2 escolhas da mesma família;
- zero escolhas é permitido.

## Status de modelo e stake

A mudança de orquestração não promove nenhum modelo e não altera a autorização de stake. Modelos experimentais continuam observacionais e sem stake positiva enquanto não forem `PRODUCTION_VALIDATED` com calibração compatível.

## Segurança operacional

A coleta de odds foi extraída para um único serviço server-side reutilizável. O pipeline automático e a interface autenticada chamam a mesma implementação para evitar divergência de parser, linha, bookmaker, snapshot e política de fallback.

Nenhuma alteração operacional foi feita diretamente no ambiente Lovable/Lovable Cloud durante esta entrega; a mudança é entregue por GitHub/PR e depende de deploy posterior do commit aprovado.
