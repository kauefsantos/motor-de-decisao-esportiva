# Gatilho interno de análise no mesmo dia — 2026-09-15

## Objetivo

Versionar o mecanismo interno usado para iniciar, sob demanda, uma análise de partidas do próprio dia a partir de um horário mínimo em `America/Sao_Paulo`.

O gatilho existe apenas para acionar o fluxo `SAME_DAY_ANALYSIS` já implementado no endpoint interno de manutenção. Ele não cria um pipeline alternativo e não altera regras estatísticas, filtros de mercado ou critérios de seleção.

## Função governada

`public.kick_same_day_analysis(p_after_local_time text)`

Responsabilidades:

- validar o corte local no formato `HH:MM`;
- ler o token de manutenção somente dentro do Lovable Cloud;
- chamar `/api/five-dollar-maintenance` com `action = SAME_DAY_ANALYSIS`;
- encaminhar `afterLocalTime` sem converter o valor para outro fuso;
- registrar a chamada em `public.automation_runs` para rastreabilidade.

A ação chamada usa a data corrente em `America/Sao_Paulo`, consulta fixtures oficiais no provedor 5Dollar, filtra apenas competições ativas/autorizadas e mantém somente jogos cujo kickoff seja igual ou posterior ao corte solicitado.

## Segurança

A função é `SECURITY DEFINER` com `search_path` fixo e qualificação explícita de objetos sensíveis.

Permissões:

- `public`: revogada;
- `anon`: revogada;
- `authenticated`: revogada;
- `service_role`: execução permitida.

O token de manutenção não é devolvido pela função, não é persistido em `automation_runs` e não precisa ser exposto ao cliente nem a comandos operacionais de disparo.

## Idempotência e integridade

A criação da run continua usando `create_scheduled_analysis_run_atomic`, preservando a mesma chave idempotente por proprietário/data da automação oficial. O enfileiramento continua usando `enqueue_scheduled_analysis_job_atomic` e o worker normal.

Consequências:

- uma segunda tentativa para a mesma data deve reutilizar/retomar a run existente em vez de criar processamento paralelo;
- identidade de liga, time e fixture continua baseada nos IDs oficiais do provedor;
- nenhuma run vazia deve ser criada quando não existirem fixtures elegíveis;
- estados terminais continuam protegidos contra re-enfileiramento.

## Regras de negócio preservadas

Esta mudança não altera:

- modelos ou versões de modelo;
- Elo;
- Stage 9;
- probabilidade mínima;
- odd mínima;
- EV mínimo;
- edge mínimo;
- limites do portfólio;
- stake;
- automação D+2 oficial;
- política de zero oportunidades.

O processamento iniciado por este gatilho percorre o pipeline canônico existente e deve terminar nos mesmos estados e contratos usados pelas demais análises.

## Operação

Uso operacional esperado, somente por contexto autorizado de `service_role`:

```sql
select public.kick_same_day_analysis('13:00');
```

O retorno é o `request_id` da chamada assíncrona. A execução deve ser acompanhada por `automation_runs`, `analysis_runs` e `analysis_jobs`; sucesso do disparo não equivale a análise concluída.
