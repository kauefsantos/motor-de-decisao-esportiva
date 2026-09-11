# Documentação do Motor de Decisão Esportiva

Este diretório reúne a documentação de produto, arquitetura, auditorias e operação do projeto.

A intenção é separar dois níveis de leitura:

- **Portfólio** — para entender rapidamente o problema, a solução e a abordagem low-code.
- **Técnico** — para consultar decisões quantitativas, segurança, Elo e continuidade operacional.

---

## Comece por aqui

| Documento | Para quem | O que mostra |
| --- | --- | --- |
| [CASE_STUDY.md](CASE_STUDY.md) | Recrutadores, clientes e portfólio | problema, estratégia low-code, evolução e competências demonstradas |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Produto, dados e engenharia | camadas, fluxo, boundaries, segurança e fontes de verdade |
| [PROJECT_STATE.md](PROJECT_STATE.md) | Continuidade técnica | estado operacional canônico e decisões vigentes |

---

## Backend e modelos

| Documento | Conteúdo |
| --- | --- |
| [BACKEND_AUDIT_CLOSE_2026-09-10.md](BACKEND_AUDIT_CLOSE_2026-09-10.md) | fechamento da auditoria de backend |
| [BACKEND_MARKET_POLICY_2026-09-10.md](BACKEND_MARKET_POLICY_2026-09-10.md) | política atual de mercados e linhas |
| [BACKEND_ROUND3_QUANT_VALIDATION_2026-09-10.md](BACKEND_ROUND3_QUANT_VALIDATION_2026-09-10.md) | validação quantitativa e política de distribuições |
| [FIVE_DOLLAR_API_AUDIT_2026-09-10.md](FIVE_DOLLAR_API_AUDIT_2026-09-10.md) | utilização e limitações da API esportiva |

---

## Elo

| Documento | Conteúdo |
| --- | --- |
| [ELO_V1.md](ELO_V1.md) | definição do Elo de times |
| [ELO_AUDIT_2026-09-08.md](ELO_AUDIT_2026-09-08.md) | auditoria da camada hierárquica |
| [ELO_RUNBOOK.md](ELO_RUNBOOK.md) | operação e manutenção do Elo |

---

## Segurança

| Documento | Conteúdo |
| --- | --- |
| [RLS_SECURITY.md](RLS_SECURITY.md) | política de RLS e privilégios do banco |
| [SECURITY_AUDIT_2026-09-10.md](SECURITY_AUDIT_2026-09-10.md) | auditoria de autenticação, servidor, headers e riscos residuais |

---

## Como interpretar a documentação

A documentação histórica registra decisões tomadas ao longo da evolução do produto. Quando houver divergência entre um documento antigo e o estado atual, a ordem de prioridade é:

1. código e migrations no `main`;
2. `PROJECT_STATE.md`;
3. documentos de fechamento/auditoria mais recentes;
4. documentos históricos.

Para uma leitura de portfólio, `CASE_STUDY.md` e `ARCHITECTURE.md` são suficientes. Os demais documentos existem para demonstrar rastreabilidade e profundidade técnica.
