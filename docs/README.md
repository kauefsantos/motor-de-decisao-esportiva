# Documentação do Motor de Decisão Esportiva

Este diretório reúne documentação de produto, arquitetura, auditorias, modelos e operação.

Há dois níveis de leitura:

- **Portfólio** — problema, solução, arquitetura e competências demonstradas.
- **Técnico** — decisões quantitativas, segurança, Elo, operação e rastreabilidade.

## Comece por aqui

| Documento | Para quem | O que mostra |
| --- | --- | --- |
| [CASE_STUDY.md](CASE_STUDY.md) | Recrutadores, clientes e portfólio | problema, estratégia low-code, evolução e competências demonstradas |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Produto, dados e engenharia | camadas, fluxo, boundaries, segurança e fontes de verdade |
| [PROJECT_STATE.md](PROJECT_STATE.md) | Continuidade técnica | estado canônico e decisões vigentes |

## Backend e modelos

| Documento | Conteúdo |
| --- | --- |
| [BACKEND_AUDIT_CLOSE_2026-09-10.md](BACKEND_AUDIT_CLOSE_2026-09-10.md) | fechamento da auditoria estrutural de backend |
| [BACKEND_MARKET_POLICY_2026-09-10.md](BACKEND_MARKET_POLICY_2026-09-10.md) | política de mercados e linhas |
| [BACKEND_ROUND3_QUANT_VALIDATION_2026-09-10.md](BACKEND_ROUND3_QUANT_VALIDATION_2026-09-10.md) | validação quantitativa e política NB2/Poisson |
| [FIVE_DOLLAR_API_AUDIT_2026-09-10.md](FIVE_DOLLAR_API_AUDIT_2026-09-10.md) | utilização e limitações da API esportiva |

## Elo

Referências vigentes:

| Documento | Conteúdo |
| --- | --- |
| [ELO.md](ELO.md) | arquitetura canônica: time, liga, Elo global, point-in-time e impacto nos mercados |
| [ELO_RUNBOOK.md](ELO_RUNBOOK.md) | operação diária, pg_cron, auditoria e troubleshooting |

Trilha histórica de auditoria:

| Documento | Conteúdo |
| --- | --- |
| [ELO_AUDIT_2026-09-08.md](ELO_AUDIT_2026-09-08.md) | auditoria da camada hierárquica e cobertura operacional |
| [ELO_P1_HIERARCHICAL_INTEGRATION_2026-09-11.md](ELO_P1_HIERARCHICAL_INTEGRATION_2026-09-11.md) | conexão do Elo hierárquico ao fluxo cross-league |
| [ELO_P2_POINT_IN_TIME_2026-09-11.md](ELO_P2_POINT_IN_TIME_2026-09-11.md) | reconstrução histórica de rating de liga |
| [ELO_DECISION_HARDENING_2026-09-11.md](ELO_DECISION_HARDENING_2026-09-11.md) | revisão pós-Elo das regras de decisão e semântica de probabilidade |

## Segurança

| Documento | Conteúdo |
| --- | --- |
| [RLS_SECURITY.md](RLS_SECURITY.md) | política de RLS e privilégios do banco |
| [SECURITY_AUDIT_2026-09-10.md](SECURITY_AUDIT_2026-09-10.md) | autenticação, servidor, headers e riscos residuais |

## Como interpretar a documentação

Quando um documento histórico divergir do estado atual, a prioridade é:

1. código e migrations no `main`;
2. `PROJECT_STATE.md`;
3. documentos canônicos atuais, como `ELO.md` e `ELO_RUNBOOK.md`;
4. documentos de fechamento/auditoria mais recentes;
5. registros históricos mais antigos.

Para leitura de portfólio, `CASE_STUDY.md` e `ARCHITECTURE.md` são suficientes. A documentação técnica existe para demonstrar rastreabilidade, governança e profundidade de implementação.
