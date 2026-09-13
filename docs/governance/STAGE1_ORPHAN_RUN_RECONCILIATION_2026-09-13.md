# Etapa 1 — reconciliação de runs órfãs

Data: 13/09/2026

## Evidência observada no Lovable Cloud

A auditoria encontrou cinco `analysis_runs` históricos com `status='RUNNING'` e sem registro correspondente em `analysis_jobs`. Sem job persistido, lease ou worker associado, essas runs não podem avançar e permanecem indefinidamente aparentando estar em processamento.

## Regra adotada

Uma run é considerada órfã somente quando atende simultaneamente a todos os critérios:

- `analysis_runs.status='RUNNING'`;
- não existe `analysis_jobs` para a mesma `run_id`;
- `analysis_runs.updated_at` está parado há pelo menos 30 minutos.

A reconciliação **não recria trabalho nem supõe etapas concluídas**. Ela marca a run como `ERROR` e preserva no campo `notes`:

- instante da reconciliação;
- motivo `RUNNING_WITHOUT_JOB`;
- `current_step` anterior para rastreabilidade.

Runs com job existente e runs ainda dentro da janela de 30 minutos não são alteradas.

## Automação

O Lovable Cloud executa `reconcile_orphan_analysis_runs(30)` a cada 15 minutos. A função é server-only e não possui `EXECUTE` para `public`, `anon` ou `authenticated`.

## Invariantes preservados

Esta mudança não altera coleta, modelos, thresholds, predictions, odds, fila de decisão, stake, settlement nem resultados. Ela apenas corrige um estado operacional impossível: `RUNNING` sem job capaz de executar o pipeline.

## Critério de conclusão

A correção só será considerada validada em produção depois de:

1. migrations e regressões locais verdes;
2. CI completo verde;
3. merge via squash;
4. sincronização do commit com Lovable;
5. publicação da migration no Lovable Cloud;
6. confirmação de que as cinco runs históricas deixaram `RUNNING` e receberam metadados de reconciliação;
7. confirmação de que não há run atual com job válido alterada pela rotina.
