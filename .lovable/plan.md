# Correção E2E para a 5Dollar Community (API nativa)

Objetivo: fazer a coleta usar a API nativa da 5Dollar (Brasileirão Série A/B, 12 meses, 300/h e 20/min), com identidade de fonte própria, um único horário de corte por análise e um teste real de ponta a ponta com uma partida do Brasileirão.

## O que muda

1. **Novo canal nativo da 5Dollar**
   - Novo módulo de servidor para a API nativa (`https://api.5dollarfootballapi.com/v1`), autenticando pelo cabeçalho `Authorization: Bearer` com a chave já guardada no servidor. A chave nunca aparece em tela, registros, banco ou resposta.
   - Endpoints usados: agenda do dia para identificar a partida; `teams/{id}/fixtures` para o histórico do time (traz gols, escanteios e cartões); `fixtures/{id}/statistics` só quando faltar algo necessário (ex.: finalizações ao gol).
   - O canal antigo de compatibilidade (que respondia "endpoint não disponível") deixa de ser usado quando o provedor ativo é a 5Dollar. API-Sports e Desk Research ficam intactos.

2. **Controle de consumo**
   - Limite efetivo de 18 chamadas por minuto e contagem de 300 por hora, com fila sequencial.
   - Leitura e registro dos cabeçalhos de limite (limite, restante, reinício) em cada resposta.
   - Em caso de bloqueio por excesso (429): parar a etapa imediatamente, respeitar o tempo indicado e encerrar com estado parcial. Nenhuma tentativa de contornar o limite.
   - Antes de qualquer chamada: procurar o dado já gravado (mesma partida/time/janela) e reaproveitar.

3. **Identidade da fonte**
   - IDs externos passam a ser gravados como `five_dollar_fixture`, `five_dollar_team_home`, `five_dollar_team_away`, com fonte `five_dollar_football` e versão de definição `five-dollar-v1`. Nunca misturados com os IDs da API-Sports.
   - Registro em `source_definitions` para `five_dollar_football` com as informações do plano (Community Access, pacote Brasil, Série A + Série B, 12 meses). `configured` só vira verdadeiro depois de uma coleta real bem-sucedida.

4. **Horário de corte único**
   - A análise passa a ter um único horário de corte (`prediction_at`) gravado na execução e reutilizado em resolução, coleta, limpeza, features e modelo — em vez de ser recriado em cada etapa.
   - Nenhum jogo com início igual ou posterior a esse horário entra no histórico.

5. **Regras de definição para os dados nativos**
   - Escanteios do time → `corners_taken` (liberado para o mercado de escanteios).
   - Gols → `goals_scored` / `goals_conceded`.
   - Finalizações ao gol só pelo endpoint oficial de estatísticas.
   - Cartões: gravados apenas como dado bruto, sem liberar o mercado de cartões (a fonte não distingue segundo amarelo por participante).

6. **Ligação com o modelo de escanteios**
   - Com escanteios normalizados disponíveis, o fluxo existente segue até o modelo `corners-baseline-v1` e grava previsões experimentais em `model_predictions`.
   - A matemática do modelo não muda. Sem calibração e sem validação formal, o estado continua `MODEL_NOT_PRODUCTION_VALIDATED` e o Motor 1 segue bloqueando; previsões ficam marcadas como experimentais.

7. **Teste real**
   - Uma única partida do Brasileirão Série A ou B, sem simulação, percorrendo: CSV → identificação na 5Dollar → IDs próprios → histórico anterior ao corte → dados brutos → escanteios reais → normalização → rastreabilidade → features → execução experimental do modelo.
   - O teste para antes de chegar perto do limite de requisições.

## Relatório final que será entregue

Plano detectado | requisições usadas | restantes | partida | ID da partida | IDs dos times | jogos históricos | dados brutos | escanteios aceitos | normalizadas | previsões | estado. Mais: endpoints nativos realmente chamados, eventuais bloqueios 429, endpoints que não funcionaram, confirmação de que nenhum dado posterior ao corte foi usado e de que o modelo continua não validado para produção.

## Detalhes técnicos

- Novo `src/lib/adapters/five_dollar.server.ts` (cliente nativo: bearer, throttle 18/min + 300/h, leitura de `X-RateLimit-*`, respeito a `Retry-After`, cache em memória por endpoint) e `five_dollar.parse.ts` (fixtures nativos → `ProviderEvent`/`NormalizedStat`, reaproveitando os tipos de `sofascore.parse.ts` já usados pelo adapter atual).
- `api_football.server.ts` mantém o provedor `api_sports`; a rota `five_dollar` passa a delegar ao cliente nativo em vez do host de compatibilidade.
- `pipeline.server.ts`: `prediction_at` lido de `analysis_runs` (gravado em `notes` na criação da run, sem alteração de esquema) e passado às etapas; blocos de resolução/coleta ganham o ramo 5Dollar nativo com os novos nomes de `match_external_ids`; `markets()` deixa de recriar `new Date().toISOString()`.
- Cache/dedup: consulta a `raw_observations`/`match_external_ids` por `cacheKey` (`five_dollar:<teamId>:<janela>`) antes de chamar a API.
- `source_definitions`: upsert de `five_dollar_football` / `five-dollar-v1` com `metric_definitions` descrevendo escanteios, gols e cartões e `configured` atualizado só após coleta OK.
- Testes: unitários do parser nativo e do throttle (sem rede) via `bunx vitest run`, mais checagem de tipos.
