# Desempenho e escalabilidade — baseline 2026-09-12

## Baseline de produção antes do pacote

- Banco Lovable Cloud: ~296 MB.
- `raw_observations`: ~239 MB / ~107 mil linhas (~80,7% do banco).
- Maior execução recente: 22.788 raw observations.
- Leitura completa dessa execução: ~2,53 s em `EXPLAIN ANALYZE`.
- `model_predictions` por `run_id`: ~226 ms com sequential scan.
- `normalized_match_stats` por `run_id`: ~143 ms com sequential scan.
- `source_fetches` por `run_id`: ~159 ms com sequential scan.
- Análises recentes concluídas: ~381–390 s (6,3–6,5 min), dominadas pela coleta externa.
- Cache bruto anterior: até 5.000 JSONs (~4,9 MB na amostra medida) carregados antes de localizar chaves em memória.
- Conexões observadas: 7/60, 1 ativa.
- Chunks client antes do pacote: ~100 KiB e ~90 KiB gzip nos dois maiores arquivos.
- Provedor principal: budget operacional distribuído de 9 requisições/minuto, preservado abaixo do limite comercial de 10/minuto.

## Budgets versionados

- Nenhum chunk JS client > 115 KiB gzip.
- CSS principal <= 20 KiB gzip.
- Smoke HTTP local: 60 requisições, concorrência 10, 0 erros e p95 <= 1.200 ms após warm-up.
- Browser smoke Chromium: DOMContentLoaded < 3 s, load < 4 s, LCP <= 2,5 s quando disponível e CLS <= 0,1.
- RUM autenticado: LCP, CLS, INP e TTFB armazenados por 30 dias, sem identificador de conta.
- Metas RUM: LCP <= 2,5 s, INP <= 200 ms, CLS <= 0,1 e TTFB <= 800 ms na faixa `good`.

## Controles de crescimento

1. Queries frequentes por `run_id` usam índices versionados e testados.
2. Home e banca agregam métricas no banco; Analytics e apostas abertas usam funções owner-scoped, evitando expandir todos os IDs de análises na aplicação.
3. O cache de `raw_observations` consulta apenas as chaves requeridas por uma análise, por índice de `cacheKey`; o preload incondicional de 5.000 JSONs não deve ser reintroduzido.
4. `raw_observations` é operacional: payloads de runs finalizados/completos expiram em 90 dias; resultados normalizados/modelados e decisões permanecem.
5. Fetch/log técnico de runs finalizados expira em 180 dias.
6. Jobs pesados de Elo/manutenção usam advisory lock e cedem enquanto uma análise do usuário estiver em execução/fila.
7. A cota distribuída do provedor externo nunca é contornada por retries ou paralelismo. Escala vem de cache, reutilização e disciplina de fila.
8. Aumentos de budget de frontend exigem medição, justificativa no PR e atualização deste documento.
9. Telemetria de Web Vitals é best-effort e nunca pode bloquear fluxo de usuário.
10. Este pacote não altera probability gates, regras de seleção, idempotência ou metodologia quantitativa.

## Escopo ainda não certificado automaticamente

O CI não simula centenas de usuários autenticados nem altera o limite comercial da API externa. A aplicação continua autorizando uma única conta Google aprovada por desenho de segurança. Antes de qualquer mudança para multiusuário, deve ser executado teste de carga autenticado em ambiente isolado registrando p50/p95/p99, throughput, erros, CPU/IO e pressão de conexões.

Uma amostra pequena ou inexistente de Web Vitals em produção não deve ser tratada como prova de que as metas foram atingidas.