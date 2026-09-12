# Auditoria de integrações e automações — 2026-09-12

## Escopo e fontes de verdade

- Runtime e banco: Lovable Cloud do projeto `quant-football-insights`.
- Código, migrations, testes e regras versionadas: GitHub `main`.
- Foco: serviços externos, cron, fuso horário, limites de uso, retry e prevenção de processamento duplicado.

## Regras de negócio revisadas

O fluxo CSV -> validação -> processamento -> fila -> escolha -> stake continua correto, com dois ajustes desta auditoria:

1. **Até três é realmente 1, 2 ou 3.** A seleção ganhou finalização explícita. O usuário pode deliberadamente seguir para stake com uma ou duas escolhas, sem precisar recusar toda a fila restante.
2. **Correlação é bloqueio condicional, não descarte.** Mercados qualificados do mesmo jogo permanecem na fila como alternativos. Só um mercado por jogo aparece por lote; quando um é aceito, os pares ficam `BLOCKED_CORRELATED`. Se a aposta aceita for recusada na etapa de stake, os pares qualificados voltam a `AVAILABLE`.

Continuam válidas as regras: no máximo três escolhas por usuário/data; nenhum preenchimento artificial do lote de dez; preço real e gates de probabilidade/valor/execução antes da fila; stake separado da escolha.

## Integração FiveDollar

### Validado

- `/status` em produção identificou plano `pro` e limite reportado 10/min.
- O envelope operacional permanece 9/min e é compartilhado via Lovable Cloud.
- Cache L2 é compartilhado entre instâncias.
- HTTP 429 persiste `blocked_until` e respeita `Retry-After` para bloquear novas chamadas.
- Não houve novo 429 observado após a implantação do rate limiter distribuído até o momento desta auditoria; a janela de observação ainda é curta.

### Achado: retry transitório do adapter principal

O adapter FiveDollar encerra a chamada como `UNAVAILABLE` após timeout, erro de rede ou HTTP 5xx; não há segunda tentativa bounded dentro da operação. Isso pode transformar indisponibilidade de poucos segundos em análise parcial. Correção recomendada: até três tentativas somente para timeout/rede/408/425/500/502/503/504, com backoff curto e nova aquisição do slot global em cada tentativa. Não repetir 4xx funcionais e não fazer espera longa inline para 429.

Este item não é alterado nesta migration porque muda a semântica de consumo de chamadas do provider e deve ter teste de adapter com fetch controlado antes da publicação.

## Prewarm FiveDollar

A execução validada encontrou 11 ligas relevantes e apenas 3 completamente pré-aquecidas; 8 permaneciam pendentes porque o job tinha uma única execução diária e cada passagem é propositalmente limitada a três ligas.

Correção: o mesmo job idempotente passa a executar às 06:10, 06:25, 06:40 e 06:55 UTC. Cada passagem continua limitada a no máximo sete chamadas externas e fica separada das demais por 15 minutos. Quatro passagens cobrem até 12 ligas e também funcionam como nova tentativa natural após falha transitória.

## Worker assíncrono

### Validado

- `analysis_jobs.run_id` converge para um job; enqueue é idempotente.
- `claim_analysis_job` usa update atômico e token de dispatch.
- Retry manual só consome `ERROR -> QUEUED` uma vez e gira o token.
- `analysis-worker-watch` roda a cada minuto.
- Os dois jobs reais concluídos tinham sete `attempts` e sete `completed_steps`, sem evidência de claim duplicado.
- Em uma execução o `pg_net` atingiu timeout de 120 s enquanto o server continuou trabalhando; a análise terminou normalmente depois.

### Achado arquitetural: lease sem heartbeat

Um step `RUNNING` é considerado abandonado após 20 minutos de `locked_at`. O worker não renova esse lease durante uma etapa longa. Se uma etapa legítima ultrapassar 20 minutos, outro dispatcher pode reivindicá-la. Hoje os tempos observados ficaram bem abaixo de 20 minutos, então não houve reprodução de duplicação em produção.

Correção recomendada antes de aumentar volume: lease token por claim + heartbeat periódico condicionado ao token e todas as gravações finais condicionadas ao mesmo lease. Isso evita que um worker antigo conclua depois de perder a posse.

## API-Football fallback

O fallback possui três tentativas com backoff, mas rate limiter e cache são locais à instância. Ele não está sendo usado como fonte principal no runtime atual. Se for reativado como fallback automático em múltiplas instâncias, deve migrar para a mesma infraestrutura distribuída de rate/cache da FiveDollar.

## Web Push

A notificação é best-effort e não afeta o status DONE da análise. Endpoints 404/410 são removidos e endpoints não confiáveis são descartados. A chamada não possui timeout explícito nem outbox/retry durável. Como é uma comunicação auxiliar, a prioridade é menor; se entrega garantida virar requisito, usar outbox persistente com tentativas limitadas.

## Fuso horário

- PostgreSQL/pg_cron: UTC.
- Regras de dia de negócio de Elo e manutenção: `America/Sao_Paulo`.
- `elo-daily-incremental`: 06:00–07:58 UTC (03:00–04:58 em São Paulo no offset atual).
- `elo-daily-finalize`: 08:05 UTC (05:05 local no offset atual).
- manutenção FiveDollar: 06:10/25/40/55 UTC (03:10/25/40/55 local no offset atual).
- pipeline do CSV ainda materializa kickoff com offset literal `-03:00`. Ele está correto para São Paulo hoje, mas deve ser substituído por conversão IANA se houver suporte a outro fuso ou mudança legal do offset.

## Automação Elo

`elo_sync_next_target` usa advisory lock, processa um alvo por vez e volta a tentar alvos `ERROR` após 10 minutos. O cron incremental executa a cada dois minutos na janela configurada. O finalizador marca `PARTIAL` se ainda houver alvo pendente/erro. Nos últimos dias observados, incremental e finalize concluíram com sucesso; houve um único `elo-bootstrap-now` cancelado em 08/09 e esse bootstrap está atualmente inativo.

## Itens externos não verificáveis daqui

- SLA contratual e garantia de disponibilidade da FiveDollar além do `/status` retornado pela própria API.
- Console de billing/cota e histórico completo do provedor fora do que a API expõe.
- Entrega final pelos serviços Apple/Google/Mozilla Web Push após o aceite HTTP do push service.
- Comportamento futuro caso o fuso oficial de São Paulo seja alterado por legislação.
