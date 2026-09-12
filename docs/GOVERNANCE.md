# Governança de dados e do sistema

## Fontes de verdade
- Lovable Cloud: runtime, banco e ambiente operacional.
- GitHub `main`: código, migrations, testes, contratos e documentação versionada.

## Domínios e responsáveis
| Domínio | Data owner | Responsável técnico | Regra de mudança |
| --- | --- | --- | --- |
| Fontes | Product/Data Owner | Repository Maintainer | PR + CI + revisão do catálogo |
| Modelos | Quantitative Model Owner | Repository Maintainer | testes + evidência point-in-time/OOS quando aplicável |
| Elo | Quantitative Model Owner | Repository Maintainer | regressão/auditoria Elo |
| Banca/Analytics | Product/Data Owner | Repository Maintainer | versão/dicionário da métrica |
| Segurança/Acessos | System Owner | Repository Maintainer | revisão trimestral |
| Schema | Data/System Owner | Repository Maintainer | migration + testes do banco |

Enquanto o projeto for single-maintainer, o `CODEOWNERS` aponta para o mantenedor atual. Não se exige uma segunda pessoa inexistente; quando houver outro responsável, o ruleset deve passar a exigir code-owner approval.

## Mudanças
Toda mudança relevante deve entrar por PR e informar impacto, evidência e rollback. Alterações de banco fazem parte do `test-and-build`, portanto não podem ser mergeadas se migrations/pgTAP falharem.

## Métricas
Definições canônicas ficam em `docs/METRICS_GLOSSARY.md` e em `public.metric_definitions`. Mudanças semânticas criam nova versão; não reescrevem o significado histórico.

## Fontes e linhagem
O catálogo canônico é `public.source_definitions`, complementado por `docs/DATA_CATALOG.md`. Novas observações/fetches devem usar uma combinação `source + definition_version` registrada.

## Histórico de alterações
Código/schema: Git + migrations + `app_schema_releases`.
Configurações governadas: `governance_change_log` registra INSERT/UPDATE/DELETE com before/after, papel de banco, usuário quando disponível e timestamp.

`governance_change_log` é **append-only**: o `service_role` não possui `UPDATE` ou `DELETE`, e um trigger de imutabilidade rejeita mutações de linhas existentes. Correções de histórico exigem uma migration explícita, nunca edição operacional silenciosa.

## Revisão de acessos
Revisão mínima trimestral para aplicação, GitHub e Lovable. Superfícies externas não verificáveis pela automação ficam com status `REVIEW_REQUIRED`, nunca presumidas como conformes.

## Cadência
- Fontes/modelos/Elo/analytics/schema: revisão a cada 90 dias ou quando houver mudança material.
- Acessos: trimestral.
- Itens externos sem evidência: nova tentativa em até 30 dias.

## Integration and automation resilience (2026-09-12)

External integrations and scheduled jobs are governed as recoverable distributed work. FiveDollar transient failures use bounded retries through the shared provider rate budget; API-Football uses the same distributed cache/rate primitives as its fallback path. Background analysis uses renewable short leases, heartbeat and fenced state transitions. Analysis-ready notifications are durable outbox events rather than best-effort side effects. HTTP pg_cron/pg_net dispatches are recorded in `automation_runs` and reconciled against the pg_net response table so dispatch success is not confused with endpoint success. Football local-time interpretation is anchored to the IANA zone `America/Sao_Paulo`, including historical DST.

## UX/UI e fluxo de decisão (2026-09-12)

A jornada principal é governada como um fluxo único e server-backed em quatro macroetapas: **Enviar e validar → Preparar → Conferir e escolher → Revisar e registrar**. O frontend não deve criar uma segunda fonte de verdade para resultado, seleção, limite diário ou progresso crítico.

Regras de governança da interface:
- o limite ativo é de até **3 escolhas por `target_date` em qualquer dia da semana**;
- reload/retomada deve recuperar estado persistido antes de repetir preparação, cotação ou seleção;
- falha de carregamento nunca pode ser apresentada como “nenhuma opção”;
- `localStorage` não é fonte de verdade para resultados ou escolhas do fluxo ativo;
- linguagem técnica de integrações, cache, rate limit e infraestrutura deve ficar em detalhes/diagnóstico, não na tarefa principal;
- métricas esperadas e realizadas devem ser nomeadas de forma distinta, por exemplo **EV esperado** versus **ROI realizado**;
- ações que alteram banca ou encerram aposta exigem confirmação e bloqueio contra duplo clique;
- mudanças em `AppShell`, fluxo de resultado, registro de aposta ou navegação devem manter os contratos de UX em `src/frontend-ux-contract.test.ts` verdes.

O relatório de referência desta revisão é `docs/UX_UI_AUDIT_2026-09-12.md`.
