# Dicionário canônico de indicadores

As definições abaixo devem permanecer alinhadas com `public.metric_definitions`.

| Métrica | Versão | Fórmula | População | Unidade | Owner |
| --- | --- | --- | --- | --- | --- |
| ROI | v1 | `total_profit / total_stake` | apostas liquidadas com stake positiva | razão | bankroll_analytics |
| Hit rate | v1 | `wins / (wins + losses)` | somente WIN/LOSS | razão | bankroll_analytics |
| CLV | v1 | `entry_odd / closing_odd - 1` | odds de entrada/fechamento válidas > 1 | razão | bankroll_analytics |
| Max drawdown | v1 | `max((peak-current)/peak)` | série cronológica de banca liquidada | razão | bankroll_analytics |
| Model gate | strict70-v1 | `model_probability > 0.70` | política atual | booleano | models |

## Política de decisão

- `decision-v1-legacy-pre-strict70`: registros históricos anteriores à adoção do gate estrito ou incompatíveis com ele.
- `decision-v2-strict70`: política atual; **70,0% reprova**, somente `> 70%` pode avançar.

Analytics da política atual deve usar apenas `decision-v2-strict70`. Dados legados podem ser exibidos separadamente, mas não misturados silenciosamente em calibração/ROI/hit rate da política atual.

## Mudanças futuras

Mudança de fórmula, população, exclusão ou interpretação cria uma nova `definition_version`. Nunca reutilizar `v1` para significado diferente.
