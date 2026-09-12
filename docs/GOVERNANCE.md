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

## Revisão de acessos
Revisão mínima trimestral para aplicação, GitHub e Lovable. Superfícies externas não verificáveis pela automação ficam com status `REVIEW_REQUIRED`, nunca presumidas como conformes.

## Cadência
- Fontes/modelos/Elo/analytics/schema: revisão a cada 90 dias ou quando houver mudança material.
- Acessos: trimestral.
- Itens externos sem evidência: nova tentativa em até 30 dias.
