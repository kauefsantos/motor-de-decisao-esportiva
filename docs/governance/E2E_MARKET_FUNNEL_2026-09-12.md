# E2E Market Funnel — 12/09/2026

## Objetivo

Garantir que o backend analise a rodada completa, mas exponha ao fluxo principal do frontend somente oportunidades que sobrevivam à régua quantitativa e operacional. Zero oportunidades é um resultado válido; o sistema nunca deve fabricar recomendações para preencher uma cota.

## Régua final de publicação

Uma oportunidade só pode integrar a fila principal quando cumprir simultaneamente:

- probabilidade de decisão **>= 70%**;
- odd de entrada **>= 1,70**;
- EV de decisão **>= 8%**;
- edge de decisão **>= 5 pontos percentuais**;
- `data_status = OK`;
- linha da casa compatível com a linha modelada; mudança de linha exige novo forecast;
- previsão pertencente ao mesmo run e partida;
- quando a odd utilizada é a cotação automática persistida, idade máxima de 10 minutos no momento de construir a fila.

Os limites são inclusivos: 70,00% e odd 1,70 passam; 69,99% e odd 1,69 reprovam.

## Quinze controles do eixo

1. `COLLECT` processa a rodada em lotes pequenos e retomáveis.
2. Uma partida incompleta é limpa e refeita isoladamente em uma retomada, evitando duplicação.
3. Todas as partidas não ignoradas da rodada permanecem no universo de análise do backend.
4. O frontend operacional recebe somente o portfólio final qualificado.
5. O gate de confiança é >=70%.
6. O gate de preço é odd >=1,70.
7. A oportunidade exige EV >=8% e edge >=5 p.p.
8. Dados não aprovados (`data_status != OK`) bloqueiam a execução.
9. A preparação experimental mantém mínimos de histórico/amostra antes de criar candidatos; não é criado um score fictício de confiabilidade onde o modelo ainda não o persiste.
10. Mudança de linha é tratada como `REFORECAST_REQUIRED` e não como oportunidade estável.
11. Conflitos identificados na preparação de datasets são excluídos da amostra utilizada; definições incompatíveis não liberam execução.
12. Cotação automática usada na fila tem janela máxima de 10 minutos; input manual continua passando pela mesma régua quantitativa.
13. Há no máximo uma seleção principal por partida.
14. Há no máximo duas seleções da mesma família entre as três finais.
15. O resultado final contém de zero a três oportunidades, sem regra legada de 2 em dias úteis / 3 no fim de semana.

## Defesa em profundidade

A regra é repetida em três camadas:

1. Motor de value (`src/lib/engine/value.ts`) — calcula e bloqueia a oportunidade.
2. Seletor de portfólio (`src/lib/engine/portfolio-selection.ts`) — revalida os gates, correlação e top-3 antes de espelhar para a interface.
3. Lovable Cloud (`replace_decision_queue_atomic`) — rejeita persistência privilegiada se qualquer threshold ou limite estrutural for violado.

A compatibilidade de linha também é protegida na persistência por `trg_decision_queue_line_compatibility`: a linha canônica da fila deve ser exatamente a mesma da previsão do mesmo run, partida e `prediction_id`, inclusive quando a gravação é privilegiada. Esse controle foi adicionado após um teste transacional pós-merge demonstrar que a função anterior aceitava `line_canonical` divergente; o teste de regressão reproduz a tentativa e exige bloqueio antes de aceitar a linha modelada correta.

A tela `/diagnostico` mede a mesma lógica usada pelo backend e sinaliza qualquer seleção persistida fora da régua.

## Coleta retomável

`COLLECT` usa lotes de quatro partidas. O progresso concluído é persistido em `pipeline_logs` com `step = COLLECT_MATCH_DONE`. Se a execução terminar antes do lote completar a rodada, o worker libera o lease sem marcar `COLLECT` como concluído, reenfileira o mesmo job e continua nas partidas pendentes.

Antes de refazer uma partida que não possui marcador de conclusão, somente os dados parciais daquele `run_id + match_id` são removidos. Partidas já concluídas não são coletadas novamente.

## Cenários obrigatórios de regressão/E2E

- rodada pequena e rodada grande (ex.: 55 partidas);
- interrupção durante `COLLECT` e retomada sem duplicar partidas concluídas;
- 69,99% vs 70,00%;
- odd 1,69 vs 1,70;
- EV 7,99% vs 8,00%;
- edge 4,99 p.p. vs 5,00 p.p.;
- linha alterada depois da modelagem;
- tentativa de persistência privilegiada com `line_canonical` diferente da previsão;
- dado com status não aprovado;
- odd automática expirada;
- duas oportunidades do mesmo jogo;
- três oportunidades da mesma família;
- mais de três oportunidades qualificadas;
- nenhuma oportunidade qualificada;
- tentativa de persistir uma previsão de outro run;
- reload/retry do fluxo sem refazer decisões já persistidas.

## Critério de encerramento

Este eixo só pode ser considerado concluído quando:

- CI e regressões estiverem verdes;
- migração estiver aplicada e validada no Lovable Cloud;
- revisão publicada estiver confirmada em produção;
- um run real percorrer `RESOLVE -> COLLECT -> CLEAN -> FEATURES -> PROBABILITY -> GATES -> MARKETS` sem erro;
- não houver duplicação indevida na retomada;
- a fila final possuir apenas oportunidades dentro da régua, ou zero quando nenhuma sobreviver;
- frontend, backend e diagnóstico apresentarem o mesmo estado.
