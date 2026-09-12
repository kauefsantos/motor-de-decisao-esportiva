# Catálogo de fontes de dados

O catálogo operacional vive em `public.source_definitions`. Este documento descreve o contrato de governança.

| Fonte | Versão | Papel | Status |
| --- | --- | --- | --- |
| `five_dollar_football` | `five-dollar-v1` | dados esportivos principais | ACTIVE |
| `five_dollar_bet365_odds` | `five-dollar-bet365-odds-v1` | odds por evento | ACTIVE |
| `five_dollar_bet365_day_odds` | `five-dollar-bet365-day-odds-v1` | odds por dia | ACTIVE |
| `five_dollar_standings_card` | `five-dollar-standings-card-v1` | apoio de cartões | ACTIVE |
| `five_dollar_standings_corner` | `five-dollar-standings-corner-v1` | apoio de escanteios | ACTIVE |
| `research_adapter` | `research-v1` | dados públicos/pesquisa | ACTIVE/secondary |
| demais adapters preparados | versão cadastrada | referência/fallback | REFERENCE |

## Campos obrigatórios de governança
Cada fonte deve ter: `source`, `definition_version`, provider, data owner, data steward, quality tier, expectativa de SLA, `reviewed_at`, `next_review_at` e `governance_status`.

`license_or_terms` deve ser preenchido quando os termos/licença forem comprovados. Ausência de evidência não deve ser preenchida por suposição.

## Linhagem
Novos registros de `raw_observations` e `source_fetches` são aceitos somente quando `source + definition_version` estiver cadastrado. Registros históricos anteriores ao controle podem permanecer como legado até reconciliação, mas não autorizam novas fontes não catalogadas.
