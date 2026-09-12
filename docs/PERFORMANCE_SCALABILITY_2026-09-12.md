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
- Conexões observadas: 7/60, 1 ativa.
- Chunks client antes do pacote: ~100 KiB e ~90 KiB gzip nos dois maiores arquivos.

## Budgets versionados

- Nenhum chunk JS client > 115 KiB gzip.
- CSS principal <= 20 KiB gzip.
- Smoke HTTP local: 60 requisições, concorrência 10, 0 erros e p95 <= 1.200 ms após warm-up.
- Browser smoke Chromium: DOMContentLoaded < 3 s, load < 4 s, LCP <= 2,5 s quando disponível e CLS <= 0,1.
- RUM autenticado: LCP, CLS e INP armazenados por 30 dias, sem identificador de conta.

## Regras de crescimento

1. Queries frequentes por `run_id` precisam de índice compatível.
2. Home/contadores não podem carregar toda a vida do usuário para agregar números simples.
3. `raw_observations` é operacional: payloads de runs finalizados/completos expiram em 90 dias; derivados permanecem.
4. Fetch/log técnico de runs finalizados expira em 180 dias.
5. Jobs pesados de Elo/manutenção cedem enquanto uma análise do usuário estiver em execução.
6. A cota distribuída do provedor externo nunca é contornada por retries ou paralelismo.
7. Aumentos de budget exigem medição, justificativa no PR e atualização deste documento.

## Escopo ainda não certificado automaticamente

O CI não simula centenas de usuários autenticados nem altera o limite comercial da API externa. Antes de crescimento multiusuário relevante, executar teste de carga autenticado em ambiente isolado e registrar p50/p95/p99, throughput, erros, CPU/IO e pressão de conexões.