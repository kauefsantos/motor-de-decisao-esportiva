# Auditoria do funil de decisão — 11/09/2026

## Escopo

Auditoria read-only do código em `main` e do Lovable Cloud canônico para confirmar a sequência:

```text
CSV
→ modelo esportivo
→ confiança > 70%
→ odd real Bet365
→ EV >= 2%
→ uma seleção por jogo
→ teto 2 dia útil / 3 fim de semana
```

Nenhuma análise de produção foi criada ou repetida durante a auditoria.

## Evidência no código

- `engine/value.ts`: o gate usa comparação estrita `> 0.70` antes do cálculo de value e devolve `MODEL_PROBABILITY_BELOW_THRESHOLD` quando a confiança não passa.
- `auto-bet365-odds.functions.ts`: apenas anchors que passam por `passesExperimentalModelGate` seguem para consulta automática da Bet365.
- `engine/portfolio-selection.ts`: o gate de probabilidade é repetido antes da seleção final como defesa em profundidade.
- `engine/opportunity.ts`: o Motor 1 de produção continua com gate-base de 75%, portanto não foi relaxado pela nova regra operacional.

## Evidência no Lovable Cloud

No momento da auditoria havia 47 runs, com datas-alvo de 06/09/2026 a 12/09/2026. O histórico contém registros gerados antes da nova regra, inclusive seleções com probabilidade inferior ou igual a 70%; eles foram preservados e não devem ser reescritos retroativamente.

A run mais recente concluída até `READY_FOR_ODDS` antes da ativação da nova regra tinha 58 jogos e 935 anchors experimentais. Desses, 145 estavam estritamente acima de 70% e 790 estavam em 70% ou menos. Não havia snapshots de odds para essa run no momento da conferência.

Portanto, ainda não existe evidência end-to-end de uma nova análise iniciada **depois** da ativação da régua estrita. O próximo CSV processado após o deploy será a primeira validação real em produção.

## Riscos residuais encontrados

1. O histórico anterior à regra de 70% permanece visível em acompanhamento/analytics. Isso é correto para preservar a trilha, mas deve ser interpretado como legado.
2. No fallback de UI que aparece se a busca automática de odds falhar, a lista manual ainda nasce da coleção preparada antes do filtro de confiança. O backend bloqueia qualquer recomendação final em 70% ou menos, mas a UI pode pedir uma odd desnecessária. É um problema de eficiência/UX, não um bypass da seleção final.
3. A classificação informativa `MODEL_LEAN_*` usa comparação `>= 70%` em um caminho de referência. Esse rótulo não promove uma seleção final, que continua protegida pelo gate estrito, mas a semântica deve ser alinhada numa próxima edição do módulo grande de mercados.
4. As avaliações que falham/passem por EV no fluxo experimental não têm ledger completo de todas as odds manuais avaliadas. A nova tela de diagnóstico consegue calcular EV dos preços automáticos auditados e as seleções finais, mas não deve apresentar isso como contagem exaustiva de odds manuais.

## Observabilidade adicionada

A rota autenticada `/diagnostico` consulta somente dados existentes e mostra:

- jogos enviados;
- anchors de mercado modelados;
- quantos ficaram em `<=70%` e quantos passaram de `70%`;
- distribuição `>70–<75`, `75–<80`, `80–<85`, `85%+`;
- snapshots de odds e preços automáticos válidos;
- número de preços automáticos que também atingem EV >= 2%;
- quantidade de sugestões finais e teto do dia;
- detecção de eventual preço automático consultado para uma previsão em `<=70%`.

A tela diferencia explicitamente dados históricos de uma run iniciada depois da ativação da nova regra, evitando usar runs antigas como falsa prova de conformidade.

## Critério de aceite do próximo E2E real

A próxima análise criada após a nova regra deve apresentar simultaneamente:

- `pricedAtOrBelow70 = 0`;
- nenhuma seleção com probabilidade `<=70%`;
- toda seleção com EV >= 2% e odd real;
- no máximo uma seleção por jogo;
- no máximo 2 seleções em dia útil ou 3 no fim de semana;
- o teto pode ficar incompleto quando não houver oportunidades suficientes.
