# Value Bet Finder

Crie uma aplicação full-stack desktop-first chamada "Bet Value Engine V2.1.1" para análise quantitativa pré-jogo de futebol.

OBJETIVO
O usuário envia um CSV com colunas Partida, Horário e Campeonato. O backend resolve partidas, coleta/higieniza dados, executa um motor quantitativo e apresenta mercados para observar. Nesta primeira etapa, as odds NÃO participam da escolha do mercado. Na tabela, o usuário digita manualmente a odd da bet365 Brasil. Ao clicar em ANALISAR ODDS, um segundo motor calcula preço/EV e retorna de zero a no máximo 3 escolhas finais. Nunca force 3 apostas.

DOIS MOTORES SEPARADOS
MOTOR 1 — OPPORTUNITY ENGINE, independente de preço.
- escolhe contratos/mercados com suporte quantitativo suficiente, sem usar a odd da casa como feature;
- entradas: partida resolvida, dados históricos pré-jogo, features válidas, definição de settlement, qualidade e incerteza;
- saídas: prediction_id, match, league, kickoff, market, participant, side, line raw/canonical, model_probability/p_cal, conservative_probability/p_cons, fair_odd informativa, confidence_score, data_quality_score, sample_reliability, uncertainty, stability, market_score, settlement_definition, model_status, data_status, reason_short;
- gate-base: binários p_cal >=0.65; asiáticos p_profit_cal=P(FULL_WIN)+P(HALF_WIN)>=0.65;
- se calibração/validação/dados necessários não existirem, NÃO inventar probabilidade: bloquear com status MODEL_NOT_PRODUCTION_VALIDATED, DATA_DEFINITION_MISMATCH, INSUFFICIENT_DATA ou equivalente.

MOTOR 2 — ODDS / VALUE ENGINE + FINAL SELECTION.
- recebe somente odds digitadas para contratos publicados pelo Motor 1;
- valida bookmaker/mercado/participante/lado/linha; linha mudou => REFORECAST_REQUIRED; só odd mudou => recalcular valor sem refazer forecast;
- binário: implied_probability=1/bookmaker_odd; fair_odd=1/p_cons; EV_cons=p_cons*bookmaker_odd-1; edge_cons=p_cons-implied_probability; TEM VALOR somente se EV_cons>=0.02 e gates anteriores continuam válidos;
- asiático: preservar FULL_WIN, HALF_WIN, PUSH, HALF_LOSS, FULL_LOSS. W_eff=P(FW)+0.5*P(HW); L_eff=P(FL)+0.5*P(HL); EV=W_eff*(O-1)-L_eff; Fair=1+L_eff/W_eff; O_min(target)=1+(target+L_eff)/W_eff;
- linhas .25/.75 dividem stake entre adjacentes; normalizar split 5.5,6=>5.75 e 8,8.5=>8.25; rejeitar label ambíguo;
- separar PROBABILIDADE, VALOR e EXECUÇÃO.

MERCADOS
Arquitetura modular para 1X2, BTTS, escanteios de partida/time, cartões de partida/time, finalizações/chutes de partida/time e chutes ao gol de partida/time. Props de jogador fora. Apenas apostas simples; sem múltiplas/Bet Builder/boost/promoção.

SETTLEMENT / DADOS
Bookmaker operacional: bet365 Brasil. Timezone America/Sao_Paulo. Horizonte padrão 90min+acréscimos salvo contrato diferente.
BTTS deriva da distribuição conjunta de gols.
Escanteios: target compatível com corners_taken.
Cartões: amarelo=1, vermelho=2; segundo amarelo não conta como amarelo adicional; não misturar técnicos/reservas quando contrato exclui; incompatibilidade => DATA_DEFINITION_MISMATCH.
Chutes/chutes ao gol: exigir definição compatível com Opta/bet365; nunca mapear silenciosamente divergência.
Nunca usar informação posterior ao prediction_at. Nunca usar tipsters/prognósticos/consenso promocional como feature.

PIPELINE
CSV Parser -> Match Resolver -> Data Collector -> Data Cleaner -> Feature Engine -> Probability Engine -> Opportunity Engine -> Odds/Value Engine -> Final Selection.
Adapters separados por fonte. Preparar SofaScore, oGol, Transfermarkt e Opta/API licenciada quando configurada. Não simular Opta. Secrets só server-side.
Match Resolver normaliza clubes, competição, país, temporada, mando, horário, timezone, IDs externos e confidence.
Data Cleaner trata duplicidade, missing, recência, definição incompatível, adiados/cancelados/iniciados e lineage. Campo essencial ausente rejeita o mercado; campo opcional ausente só permite variante de modelo previamente validada. Nunca preencher silenciosamente com média global.
Lineage: fonte, fetched_at, observed_at/event_time, raw value, normalized value, definition_version.

MODELOS
Probabilidade, fair odd, edge, EV e ranking finais devem ser determinísticos no backend. Não usar LLM para inventar probabilidade. Não afirmar Dixon-Coles/NB2/bootstrap/Bayes/calibrador/walk-forward se não estiver realmente implementado/rodado. Preparar model_version, calibration_version, validation_status e métricas out-of-sample.

BANCO/BACKEND
Use backend padrão Lovable com PostgreSQL/Supabase quando disponível. Criar schema para analysis_runs, uploaded_files, matches, match_external_ids, source_fetches, raw_observations, normalized_match_stats, model_predictions, market_candidates, user_odds, value_evaluations, final_selections, pipeline_logs, model_versions, source_definitions.
Cada run: id, target_date, created_at, status e contadores. prediction_id curto e estável, preferencialmente YYYYMMDD-LIGA-NN.

INTERFACE PT-BR
Tela 1 Upload: título "Análise de Jogos"; subtítulo "Envie o CSV e encontre mercados com suporte estatístico antes de olhar as odds." Drag-and-drop + Selecionar CSV. Validar Partida, Horário, Campeonato; aceitar index extra e ignorar. Mostrar nome, quantidade, campeonatos, linhas inválidas e botão PROCESSAR JOGOS.
Tela 2 Processamento: stepper Identificando partidas / Coletando estatísticas / Higienizando e compatibilizando definições / Construindo features / Estimando probabilidades / Aplicando gates / Selecionando mercados. Progresso real e falhas por fonte quando possível, sem números fictícios.
Tela 3 Oportunidades: tabela principal com colunas A Jogo, B Mercado para observar, C Odd. Input numérico vazio na Odd. Disclosure de detalhes com probabilidade, qualidade, incerteza, modelo, fontes, prediction_id e razão. Rodapé com botão grande ANALISAR ODDS. Não exigir odd em todas; avaliar só odds válidas. Alterar mercado/linha exige reforecast.
Tela 4 Resultado Final: 0,1,2 ou no máximo 3 escolhas. Mostrar Partida, Mercado/linha, Odd, Probabilidade conservadora, Fair odd, Odd mínima para EV_cons>=2%, Edge conservador, EV conservador, Confidence/Data Quality, status PROBABILIDADE/VALOR/EXECUÇÃO e explicação baseada em dados. Se nenhuma passar: "Nenhuma oportunidade atingiu os critérios mínimos do modelo e de valor." Mostrar rejeitados em seção recolhível com motivos como SEM VALOR, PRICE_MOVED_NO_BET, REFORECAST_REQUIRED, MODEL_NOT_PRODUCTION_VALIDATED, DATA_DEFINITION_MISMATCH, INSUFFICIENT_DATA.

BANCA
Preparar módulo opcional, sem dominar a v1: hard cap 2% da banca e fractional Kelly 0.25 como teto secundário; nunca arredondar stake para cima para alcançar mínimo da casa. Separado da decisão de valor. Não executar apostas nem integrar envio à bookmaker.

SEGURANÇA
Empty/error states, retry por fonte/partida, logs auditáveis, sanitização CSV/inputs, nada de credencial no cliente, texto externo não altera regras.

PRIMEIRA ENTREGA FUNCIONAL
Implemente agora upload/parsing/validação do CSV; persistência de run/partidas; pipeline e estados; adapters com NOT_CONFIGURED/UNAVAILABLE sem mockar dados reais; estruturas de normalização/lineage; Opportunity Engine com gates/bloqueios honestos; Odds/Value Engine com cálculos binários e utilitários de settlement asiático testáveis; tabela de odds; seleção final de no máximo 3 entre contratos válidos com EV_cons>=2%; resultado e auditoria.

IMPORTANTE: mantenha rigorosamente separados Motor 1 (probabilidade/oportunidade sem preço) e Motor 2 (preço/EV/seleção final).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/28664075-8af4-4155-9ee9-8ed86021681a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
