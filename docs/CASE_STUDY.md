# Case Study — Motor de Decisão Esportiva

## Visão geral

O **Motor de Decisão Esportiva** é um projeto de produto digital criado para transformar um processo esportivo complexo em uma experiência guiada, auditável e repetível.

A construção começou com uma abordagem low-code para acelerar interface e fluxo de uso. Conforme o produto ganhou regras de negócio, integrações, persistência e requisitos de segurança, a arquitetura foi evoluída para uma combinação de **Lovable + código TypeScript + Supabase/PostgreSQL + GitHub**.

Esse caminho é parte central do case: o objetivo não foi substituir engenharia por low-code, mas usar cada ferramenta no ponto em que ela entrega mais valor.

---

## O desafio

Uma análise pré-jogo pode parecer simples na interface, mas envolve várias etapas difíceis de coordenar:

- receber uma lista de partidas em formatos diferentes;
- identificar corretamente times, competições e horários;
- consultar dados externos;
- evitar uso de informação posterior ao momento da previsão;
- transformar histórico esportivo em probabilidades;
- comparar probabilidades com odds reais;
- impedir que preço influencie indevidamente o modelo de probabilidade;
- controlar quantidade e correlação das sugestões;
- registrar resultados sem perder integridade da banca;
- manter o processo compreensível para quem não é técnico.

Além disso, o produto precisava continuar simples de usar mesmo depois de ganhar bastante complexidade no backend.

---

## Estratégia de produto

O fluxo foi reduzido a seis momentos claros:

1. **Enviar jogos**
2. **Preparar análise**
3. **Conferir odds**
4. **Ver sugestões**
5. **Acompanhar apostas em andamento**
6. **Analisar desempenho**

A interface esconde a maior parte da complexidade técnica, mas cada etapa possui contratos explícitos no backend.

Essa separação permitiu evoluir modelos, segurança e integrações sem transformar a experiência do usuário em um painel excessivamente técnico.

---

## Estratégia low-code

### O que ficou no Lovable

O Lovable foi usado principalmente como acelerador de produto:

- criação e iteração de interface;
- refinamentos visuais e responsivos;
- exploração rápida de fluxos;
- sincronização com GitHub;
- publicação da aplicação.

### O que saiu do low-code e virou código explícito

As partes de maior risco ou maior valor de negócio foram consolidadas em código versionado:

- regras quantitativas;
- política de mercados;
- cálculo de valor esperado;
- regras de banca;
- integrações externas;
- autenticação e autorização;
- migrations e transações do banco;
- testes de regressão;
- CI;
- hardening de segurança.

### Princípio usado

> **Low-code para acelerar mudança. Código explícito para proteger regras, dados e integridade.**

Essa divisão tornou o projeto mais sustentável e evitou dependência excessiva do construtor visual.

---

## Evolução técnica

### 1. Protótipo funcional

A primeira versão estabeleceu o fluxo básico de CSV → processamento → oportunidades → resultado.

### 2. Integração de dados

O backend passou a resolver partidas, coletar dados externos, registrar lineage e armazenar observações normalizadas.

### 3. Modelos quantitativos

Foram criados modelos para gols, escanteios e cartões, além de Elo como feature auxiliar. As distribuições de contagem usam políticas de fallback quando a validação não sustenta um modelo mais complexo.

### 4. Motor de valor

Probabilidade e preço foram separados em dois estágios independentes. A odd da casa não participa da geração da probabilidade.

### 5. Integridade operacional

A banca experimental recebeu operações atômicas, limite diário protegido no banco e controle para evitar duplicidade de settlement.

### 6. Segurança

O projeto passou por revisão específica de RLS, autenticação, boundary server-side, service role, CSP e privilégios do banco.

### 7. UX e acessibilidade

O frontend foi auditado em prioridades P0–P3, cobrindo estados de erro, navegação mobile, acessibilidade, touch targets, performance e continuidade de rota após login.

### 8. Limpeza pós-auditoria

Depois das correções, o repositório recebeu uma rodada de limpeza para remover scaffolding e fluxos legados que já não representavam o produto final.

---

## Decisões de arquitetura importantes

### Probabilidade não conhece a odd

Essa decisão evita que o motor de previsão se adapte ao preço da casa. O sistema primeiro estima probabilidade e só depois calcula valor.

### O banco também protege as regras

Limites e transições críticas não ficam apenas na interface. Operações sensíveis são protegidas por funções, triggers e transações no PostgreSQL.

### Integrações usam adapters

Dados externos são normalizados antes de chegar ao motor. Isso reduz acoplamento entre fornecedor e regras de negócio.

### Estado do projeto documentado

Além do código, o repositório mantém documentação de continuidade operacional, auditorias e decisões quantitativas.

---

## Qualidade e governança

O projeto possui:

- GitHub como fonte de verdade do código;
- PRs por rodada de mudança relevante;
- CI para testes e build;
- testes unitários e E2E do motor experimental;
- migrations versionadas;
- auditorias separadas por eixo;
- documentação de riscos residuais;
- limpeza periódica de código morto.

O resultado é um fluxo de desenvolvimento mais próximo de um produto mantido do que de um protótipo descartável.

---

## Competências demonstradas

Este case evidencia principalmente:

### Produto e low-code

- transformar problema em fluxo de uso;
- prototipar com Lovable;
- manter simplicidade de UX apesar da complexidade do backend;
- decidir o que deve ou não permanecer no low-code.

### Dados e backend

- modelagem de dados;
- ETL/normalização;
- integração com APIs;
- regras transacionais;
- versionamento de migrations;
- separação entre coleta, features, modelos e valor.

### Engenharia

- TypeScript full-stack;
- React/TanStack;
- PostgreSQL/Supabase;
- autenticação e autorização;
- testes;
- CI;
- segurança por camadas.

### Governança

- documentação técnica;
- auditoria por eixo;
- rastreabilidade de decisões;
- controle de dívida técnica;
- uso de IA como acelerador com revisão e validação.

---

## Limitações assumidas

O produto é experimental e não se apresenta como sistema de execução automática de apostas.

- não envia apostas para bookmaker;
- não força uma quantidade mínima de sugestões;
- não trata todos os mercados como igualmente validados;
- bloqueia ou faz fallback quando os dados não sustentam uma decisão;
- mantém alguns settlements como aproximações quando a API não fornece granularidade suficiente.

Essas limitações são deliberadas e fazem parte da governança do produto.

---

## Resultado do case

O projeto mostra uma evolução importante: de uma ideia construída rapidamente em low-code para uma aplicação com **arquitetura explícita, regras versionadas, banco transacional, segurança, testes, integração de dados e documentação operacional**.

Para portfólio, o principal valor está justamente nessa transição: demonstrar que ferramentas low-code podem acelerar um projeto sem impedir disciplina de engenharia quando o produto começa a exigir confiabilidade real.
