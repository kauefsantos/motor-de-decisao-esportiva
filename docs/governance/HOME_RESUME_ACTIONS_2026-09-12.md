# Home resume actions — 2026-09-12

## Objetivo

A Home deve permitir retomar uma análise e abrir sugestões pendentes sem wrappers interativos ambíguos e sem transformar o frontend em uma segunda fonte de verdade.

## Contratos

- Botões de retomada renderizam `Button -> Link` diretamente.
- `RecentRun` permanece derivado do contrato de `getHomeSummary`; `any` não é aceito nessa fronteira.
- `Sugestões para registrar` só vira ação quando existe uma run proposta identificada pelo backend.
- O frontend não consulta `experimental_bet_tracking` para montar o resumo.
- A run proposta é resolvida no Lovable Cloud por `get_owner_latest_proposed_run_id(p_owner_id)`, com filtro explícito pelo owner da `analysis_run`.
- O helper é executável apenas pelo papel de serviço.

## Validação

- `src/home-resume-ux-contract.test.ts` cobre a composição de navegação, a tipagem e o uso do RPC owner-scoped.
- `supabase/tests/owner_latest_proposed_run.test.sql` cobre existência, privilégios, isolamento de owner e release marker.
- Os gates gerais de frontend, banco, E2E, build, performance, browsers e acessibilidade continuam obrigatórios antes do merge.

## Impacto de negócio

Nenhuma regra quantitativa, threshold, seleção, stake ou settlement é alterada. A mudança é exclusivamente de retomada/navegação e encapsulamento da leitura necessária para a Home.
